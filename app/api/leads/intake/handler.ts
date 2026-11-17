/**
 * Public lead intake endpoint.
 *
 * Accepts submissions from the P5 website and the sibling brand sites. Kept
 * deliberately forgiving about field names, because the brand sites are
 * separate codebases and should not need to change shape to post here.
 *
 * The two-step forms add optional fields and a second kind of post
 * (docs/lead-intake-contract.md): `submission_kind: "details"` with the same
 * `brand` and `external_id` merges into the lead Step 1 created instead of
 * creating another. A post without the new fields behaves exactly as before.
 */

import {collectAttribution,sourceFromAttribution} from "../../../lib/leads/attribution.ts";

import { isDatabaseConfigured } from "../../../lib/db.ts";
import {
  applyPendingDetails,
  holdPendingDetails,
  ingestLead,
  mergeLeadDetails,
  recordInitialFingerprint,
  type MergeResult,
} from "../../../lib/leads/intake.ts";
import {
  composeAddress,
  composeIntakeSummary,
  intakeNoticeLines,
  readIntakeExtras,
  readLeadDetails,
} from "../../../lib/leads/intakeContract.ts";
import { loadSettings } from "../../../lib/leads/settings.ts";
import { BRANDS, LEAD_SOURCES, type Brand, type LeadSource } from "../../../lib/leads/types.ts";
import { notifyLeadCreated, notifyLeadDetailsAdded, type LeadCreatedNotifyInput } from "../../../lib/notifications/lead-created.ts";
import type { Transport } from "../../../lib/notifications/transport.ts";
import { sendRequestConfirmation } from "../../../lib/leads/sendLeadConfirmation.ts";
import { scheduleIntentFor } from "../../../lib/leads/scheduleEmail.ts";
import { allowLeadIntake, type IntakeLimitVerdict } from "./abuse.ts";
import { submittedFieldsFromBody } from "../../../lib/leads/submittedFields.ts";
import { inlineSyncTimeoutMs, loadLeadAlert, startSync, within, type HubSpotSync } from "../../../lib/leads/leadPipeline.ts";

/** Reject oversized bodies before parsing them. */
const MAX_BODY_BYTES = 32 * 1024;

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

function pickBrand(value: unknown): Brand | null {
  const raw = str(value);
  if (!raw) return null;
  const match = BRANDS.find((b) => b.toLowerCase() === raw.toLowerCase());
  return match ?? null;
}

function pickSource(value: unknown): LeadSource {
  const raw = str(value);
  const match = LEAD_SOURCES.find((s) => s.toLowerCase() === (raw ?? "").toLowerCase());
  return match ?? "Organic Website";
}

/** Collect utm_* parameters from the body and the referring URL. */
function collectUtm(body: Record<string, unknown>): Record<string, string> | null {
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = str(body[key]);
    if (value) utm[key] = value;
  }
  return Object.keys(utm).length ? utm : null;
}

/**
 * The team emails one submission produces. Normally each is sent after the
 * response. When the caller asked to be told (`team_alert: "confirm"`, which
 * the brand sites send so they can skip their own team email), they are sent
 * before it and the response says whether they went.
 */
type TeamAlerts = {
  confirm: boolean;
  /** Test seam: the transport the team emails use. */
  transport?: Transport;
  /** Team-only lines from the brand site, printed in whatever email is sent. */
  teamNotes: string[];
  sends: Array<() => Promise<boolean>>;
};

function teamEmail(alerts: TeamAlerts, after: AfterResponse, send: () => Promise<boolean>): void {
  if (alerts.confirm) alerts.sends.push(send);
  else after(async () => { await send(); });
}

/** How long a caller that asked for confirmation waits for the team email. */
const CONFIRM_ALERT_TIMEOUT_MS = 20_000;

/** A merged Step 2 sends the team a short follow-up email after the response. */
function followUp(alerts: TeamAlerts, after: AfterResponse, merged: MergeResult, subjectPrefix?: string): void {
  if (merged.status !== "merged") return;
  const notice = {
    dealId: merged.dealId,
    brand: merged.brand,
    firstName: merged.firstName,
    lastName: merged.lastName,
    phone: merged.phone,
    email: merged.email,
    lines: merged.lines,
    reroutedFrom: merged.reroutedFrom,
    teamNotes: alerts.teamNotes,
  };
  teamEmail(alerts, after, () => notifyLeadDetailsAdded(notice, { ...(subjectPrefix ? { subjectPrefix } : {}), ...(alerts.transport ? { transport: alerts.transport } : {}) }));
}

/**
 * null when the post may proceed, else the 429 (or 503 when the counter
 * itself failed). A refusal is logged with the brand and sourceDetail, never
 * the person, so a brand meeting its address ceiling is visible in the logs.
 */
async function checkLimit(
  request: Request,
  lead: Parameters<typeof allowLeadIntake>[1],
  body: Record<string, unknown>,
): Promise<Response | null> {
  let verdict: IntakeLimitVerdict;
  try {
    verdict = await allowLeadIntake(request, lead);
  } catch (error) {
    console.error("[intake] anti-abuse check failed:", (error as Error).message);
    return Response.json({ ok: false, error: "We could not safely accept that request just now." }, { status: 503 });
  }
  if (verdict.ok) return null;
  console.warn("[intake] rate limited", {
    brand: lead.brand,
    kind: lead.kind,
    reason: verdict.reason,
    sourceDetail: str(body.sourceDetail ?? body.source_detail),
  });
  return Response.json(
    {
      ok: false,
      error: verdict.reason === "identity"
        ? "We already have several requests from you this hour. Please call (208) 477-1169."
        : "Too many requests from this connection. Please wait an hour or call (208) 477-1169.",
    },
    { status: 429 },
  );
}

/** Work that runs after the response is sent (next/server `after` in the route). */
export type AfterResponse = (task: () => Promise<void>) => void;

/**
 * Outside effects the route wires in. route.ts passes the real HubSpot sync;
 * tests pass a mock or nothing, so no test can reach HubSpot.
 */
export type IntakeDeps = {
  /** Immediate HubSpot sync after the lead commits (the watchdog retries). */
  syncHubSpot?: HubSpotSync;
  /** Upper bound on how long the response waits for that sync. */
  inlineSyncTimeoutMs?: number;
  /**
   * The caller mails the team itself, in a message that carries everything the
   * "New lead" alert does. The guided estimator sets this so an estimate
   * produces ONE team email, not two (owner request, 16 November 2026). It
   * also holds back the "Request added" note a repeat submission from the same
   * person would send; the details are still merged onto the lead.
   */
  skipLeadAlert?: boolean;
  /** Test seam: how long a confirming caller waits for the team email. */
  confirmAlertTimeoutMs?: number;
  /** Test seam: the transport the team emails use (default: the configured one). */
  alertTransport?: Transport;
};

/**
 * The whole intake, free of next/server so tests can call it with a
 * constructed Request and a captured `after`. route.ts passes the real one.
 */
export async function handleIntake(request: Request, after: AfterResponse, deps: IntakeDeps = {}): Promise<Response> {
  const alerts: TeamAlerts = { confirm: false, teamNotes: [], sends: [], transport: deps.alertTransport };
  const response = await runIntake(request, after, deps, alerts);
  if (!alerts.confirm || !response.ok) {
    // A refused request that had already queued an email still sends it.
    for (const send of alerts.sends) after(async () => { await send(); });
    return response;
  }
  // The caller is waiting to hear whether the team email went. "none" means
  // this submission produced no email (an exact repeat, or details that are
  // waiting for their request): the caller decides what to do with that.
  let alert: "sent" | "failed" | "none" = "none";
  if (alerts.sends.length) {
    const all = Promise.all(alerts.sends.map((send) => send().catch(() => false)));
    const results = await Promise.race([
      all,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.confirmAlertTimeoutMs ?? CONFIRM_ALERT_TIMEOUT_MS)),
    ]);
    if (results === null) {
      // Still sending: say it is not confirmed, and let it finish.
      after(async () => { await all; });
      alert = "failed";
    } else {
      alert = results.every(Boolean) ? "sent" : "failed";
    }
  }
  const data = (await response.json()) as Record<string, unknown>;
  return Response.json({ ...data, alert }, { status: response.status });
}

async function runIntake(request: Request, after: AfterResponse, deps: IntakeDeps, alerts: TeamAlerts): Promise<Response> {
  if (!isDatabaseConfigured()) {
    // Fail loudly to the operator, softly to the visitor: never imply a lead
    // was captured when there is nowhere to put it.
    console.error("[intake] DATABASE_URL is not configured; refusing the submission.");
    return Response.json(
      { ok: false, error: "Lead intake is not configured yet." },
      { status: 503 },
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "Request too large." }, { status: 413 });
  }

  // content-length can be absent (chunked), so the read body is measured too.
  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "Request too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  }

  // Honeypots must never receive a thank-you response: no lead was accepted.
  if (str(body.website_url ?? body.company_website)) {
    return Response.json({ ok: false, error: "We could not accept that request." }, { status: 422 });
  }

  const extras = readIntakeExtras(body);
  const details = extras.submissionKind === "details";
  alerts.confirm = extras.confirmAlert;
  alerts.teamNotes = extras.teamNotes;

  const brand = pickBrand(body.brand ?? body.company);
  if (!brand) {
    return Response.json(
      { ok: false, error: `brand is required and must be one of: ${BRANDS.join(", ")}` },
      { status: 400 },
    );
  }

  // Limits are keyed on the lead, not only the address: a brand server
  // forwards every visitor from one address (abuse.ts, INTAKE_LIMITS).
  const newRequest = { kind: "new" as const, brand, phone: str(body.phone ?? body.telephone), email: str(body.email) };

  if (details) {
    if (!extras.externalId) {
      return Response.json(
        { ok: false, error: "external_id is required when submission_kind is details." },
        { status: 400 },
      );
    }
    // Step 2 follows a lead already counted, so it has its own window.
    const limited = await checkLimit(request, { kind: "details", brand, externalId: extras.externalId }, body);
    if (limited) return limited;
    try {
      const merged = await mergeLeadDetails({ brand, externalId: extras.externalId }, readLeadDetails(body, extras));
      followUp(alerts, after, merged);
      if (merged.status !== "not_found") {
        return Response.json({
          ok: true,
          merged: merged.status === "merged",
          duplicate: merged.status === "duplicate",
          accepted: false,
          message: "Thanks. The details are with the team.",
        });
      }
      // Step 1 has not arrived (still in flight, retried, or its forward
      // failed). The details are never dropped: without a way to reach the
      // person they wait for Step 1; with one they become the lead below,
      // under the same external_id, and Step 1 then merges into it.
      if (!str(body.phone ?? body.telephone) && !str(body.email)) {
        const held = await holdPendingDetails(brand, extras.externalId, readLeadDetails(body, extras));
        if (held.status === "applied") {
          for (const result of held.results) followUp(alerts, after, result);
          return Response.json({ ok: true, merged: true, duplicate: false, accepted: false, message: "Thanks. The details are with the team." });
        }
        return Response.json(
          { ok: true, merged: false, duplicate: false, pending: true, accepted: false, message: "Thanks. The details are with the team." },
          { status: 202 },
        );
      }
    } catch (error) {
      console.error("[intake] details merge failed:", (error as Error).message);
      return Response.json(
        { ok: false, error: "We could not record that just now. Please call (208) 477-1169." },
        { status: 500 },
      );
    }
  }

  // A new request, or a Step 2 post becoming the lead because Step 1 has not
  // arrived: both count as a new request.
  const limited = await checkLimit(request, newRequest, body);
  if (limited) return limited;

  // Accept either split names or a single "name" field.
  let firstName = str(body.firstName ?? body.first_name);
  let lastName = str(body.lastName ?? body.last_name);
  const wholeName = str(body.name ?? body.fullName);
  if (!firstName && !lastName && wholeName) {
    const parts = wholeName.split(/\s+/);
    firstName = parts[0] ?? null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  const settings = await loadSettings();
  const attribution = collectAttribution(body);
  // Quote pages are public campaign destinations. Their source must reflect
  // retained click context, not a hardcoded label supplied by the browser.
  const isQuoteForm = str(body.form) === "Quote Landing Page";
  // The contact channel (form/email/phone) is not itself the marketing source.
  // Respect explicit non-organic integrations, but correct a default "Organic
  // Website" label when the same submission carries paid campaign evidence.
  const declaredSource = pickSource(body.source);
  const attributedSource = sourceFromAttribution(attribution);
  const resolvedSource = (isQuoteForm || (declaredSource === "Organic Website" &&
    attributedSource !== "Organic Website")) ? attributedSource : declaredSource;

  const summary = composeIntakeSummary(str(body.summary ?? body.message ?? body.description), extras);
  const propertyAddress = composeAddress(body.address ?? body.propertyAddress ?? body.street_address, body.zip ?? body.postal_code ?? body.postalCode);
  const propertyZip = str(body.zip ?? body.postal_code ?? body.postalCode)?.slice(0, 20) ?? null;
  const propertyState = str(body.state ?? body.province)?.slice(0, 60) ?? null;

  try {
    const result = await ingestLead(
      {
        firstName,
        lastName,
        email: str(body.email),
        phone: str(body.phone ?? body.telephone),
        brand,
         projectType: str(body.projectType ?? body.project_type ?? body.project),
         source: resolvedSource,
         sourceDetail: (isQuoteForm || resolvedSource !== declaredSource)
           ? attribution?.gclid ?? attribution?.gbraid ?? attribution?.wbraid ??
              attribution?.first_gclid ?? attribution?.utm_campaign ?? attribution?.fbclid ?? null
           : str(body.sourceDetail ?? body.source_detail),
        propertyAddress,
        propertyCity: str(body.city ?? body.propertyCity),
        summary,
        externalLeadId: str(body.externalLeadId ?? body.external_lead_id),
        originalForm: str(body.form ?? body.originalForm),
         originalCampaign: (isQuoteForm || resolvedSource !== declaredSource)
           ? attribution?.first_utm_campaign ?? attribution?.utm_campaign ?? null
           : str(body.campaign ?? body.originalCampaign),
          utm: (() => {
            const values = {
              ...(collectUtm(body) ?? {}),
              ...(attribution ?? {}),
              ...(str(body.service) ? { service: str(body.service)! } : {}),
            };
           return Object.keys(values).length ? values : null;
         })(),
        receivedAt: new Date(),
        brandExternalId: extras.externalId,
        requestKind: extras.requestKind,
        contactPreference: extras.contactPreference,
        bestTime: extras.bestTime,
        timeline: extras.timeline,
        files: extras.files,
        propertyState,
        propertyZip,
        submittedFields: submittedFieldsFromBody(body),
        submissionChannel: "Website form",
      },
      settings,
    );

    if (result.status === "rejected") {
      return Response.json({ ok: false, errors: result.errors }, { status: 422 });
    }

    // Out-of-order and repeated posts under one brand + external_id.
    if (extras.externalId && result.dealId > 0) {
      const own = readLeadDetails(body, extras);
      if (result.status === "created") {
        // A repeat of exactly this post stays a plain duplicate.
        await recordInitialFingerprint(result.dealId, own);
      } else {
        // The deal already existed: its Step 2 got here first, or a repeat
        // carries something new. Fill blanks and keep the words, never a
        // second deal. An identical repeat changes nothing.
        try {
          const late = await mergeLeadDetails({ brand, externalId: extras.externalId }, own, {
            heading: "Request received:",
            requestKind: extras.requestKind,
          });
          // The estimator's own team email already carries this request.
          if (!deps.skipLeadAlert) followUp(alerts, after, late, "Request added");
        } catch (error) {
          console.error("[intake] late request merge failed:", (error as Error).message);
        }
      }
      // Any Step 2 that was waiting for this Step 1.
      try {
        for (const pending of await applyPendingDetails(brand, extras.externalId)) followUp(alerts, after, pending);
      } catch (error) {
        console.error("[intake] pending details not applied:", (error as Error).message);
      }
    }

    // HubSpot right away, bounded so the visitor never waits on HubSpot. A
    // created lead, or a repeat that brought new fields, is pushed now; on a
    // timeout or failure the deal stays pending and the watchdog sends it.
    const sync = result.dealId > 0 ? startSync(deps.syncHubSpot, result.dealId) : null;
    await within(sync, deps.inlineSyncTimeoutMs ?? inlineSyncTimeoutMs());

    // Mail runs after the response is finished, so a send failure cannot
    // change 201 or 200. Duplicate and rejected leads are not notified.
    // Synthetic estimator acceptances are skipped inside notifyLeadCreated.
    if (result.status === "created") {
      const notice: LeadCreatedNotifyInput = {
        dealId: result.dealId,
        brand,
        projectType: str(body.projectType ?? body.project_type ?? body.project),
        firstName,
        lastName,
        email: str(body.email),
        phone: str(body.phone ?? body.telephone),
        propertyCity: str(body.city ?? body.propertyCity),
        propertyAddress,
        summary,
        source: resolvedSource,
        originalForm: str(body.form ?? body.originalForm),
        extraLines: intakeNoticeLines(extras),
        teamNotes: extras.teamNotes,
        propertyState,
        propertyZip,
        submittedFields: submittedFieldsFromBody(body),
        // Wait a little longer for the sync (it may still be running), then
        // read the saved lead back so the email carries the HubSpot links.
        prepare: async () => {
          await within(sync, 10_000);
          return loadLeadAlert(result.dealId, { ...notice, prepare: undefined });
        },
      };
      if (!deps.skipLeadAlert) teamEmail(alerts, after, () => notifyLeadCreated(notice, alerts.transport ? { transport: alerts.transport } : {}));
      // Quote landing is the P5 form that posts here and does not already
      // email the lead. The guided estimator and the brand sites send their
      // own customer mail, so they are not confirmed a second time.
      const quoteEmail = str(body.email);
      if (isQuoteForm && quoteEmail) {
        const confirmation = {
          email: quoteEmail,
          firstName,
          brandName: brand,
          intent: scheduleIntentFor({ requestKind: extras.requestKind, form: "Quote Landing Page" }),
        };
        after(async () => {
          await sendRequestConfirmation(confirmation);
        });
      }
    }

    // A duplicate is a success from the visitor's point of view: their enquiry
    // is on file. Saying otherwise would invite them to submit again.
    return Response.json(
      {
        ok: true,
        duplicate: result.status === "duplicate",
        accepted: result.status === "created",
        ...(details ? { merged: false } : {}),
        message: "Thanks. Your enquiry is with the right team and someone will be in touch.",
      },
      { status: result.status === "created" ? 201 : 200 },
    );
  } catch (error) {
    console.error("[intake] failed:", (error as Error).message);
    return Response.json(
      { ok: false, error: "We could not record that just now. Please call (208) 477-1169." },
      { status: 500 },
    );
  }
}
