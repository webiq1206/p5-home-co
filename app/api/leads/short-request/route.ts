/**
 * Short primary lead form, including optional photos and plans.
 *
 * Two shapes share this route (app/lib/leads/shortRequest.ts): a request
 * (name, phone, a note; email optional unless the visitor asks to be
 * emailed) and a callback request from "Have us call you" (name and phone,
 * with an optional best time to call). Both create the same lead.
 *
 * The JSON intake route stays small on purpose. Files land here, after the
 * same lead record the rest of the site already creates.
 *
 * Two-step form (owner, 1 November): the browser sends Step 1 without files,
 * gets back the request id and a short-lived token (requestToken.ts), then
 * sends each file to ./files and any Step 2 details to ./details. Files a
 * no-JavaScript form posts here are still accepted, one verdict per file: a
 * bad file is named in the answer and never costs the lead.
 */

import { NextResponse, after } from "next/server";

import { isDatabaseConfigured } from "../../../lib/db.ts";
import { ingestLead } from "../../../lib/leads/intake.ts";
import { loadSettings } from "../../../lib/leads/settings.ts";
import { readShortRequest, shortRequestSummary } from "../../../lib/leads/shortRequest.ts";
import { readEachUpload } from "../../../lib/leads/shortRequestFiles.ts";
import { storeLeadRequestFiles } from "../../../lib/leads/leadRequestFiles.ts";
import { issueRequestToken, REQUEST_TOKEN_TTL_SECONDS } from "../../../lib/leads/requestToken.ts";
import { CONTACT_PREFERENCE_LABELS } from "../../../lib/leads/intakeContract.ts";
import { collectAttribution, sourceFromAttribution } from "../../../lib/leads/attribution.ts";
import { notifyLeadCreated, type LeadCreatedNotifyInput } from "../../../lib/notifications/lead-created.ts";
import { syncDealToHubSpot } from "../../../lib/integrations/hubspot.ts";
import { inlineSyncTimeoutMs, loadLeadAlert, startSync, within } from "../../../lib/leads/leadPipeline.ts";
import { submittedFieldsFromBody } from "../../../lib/leads/submittedFields.ts";
import { allowIntakeRequest } from "../intake/abuse.ts";
import { brandForProject } from "../../../quote/options.ts";
import { QUOTE_SERVICES } from "../../../quote/services.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 22 * 1024 * 1024;
const FILE_FAIL_MESSAGE =
  "Thanks. Your request is with the team. Some files did not attach. Call or text (208) 477-1169 and we will take them another way.";
const SAVED_MESSAGE = "Thanks. Your request is with the team and someone will follow up.";

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

function isUpload(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function";
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    console.error("[short-request] DATABASE_URL is not configured; refusing the submission.");
    return NextResponse.json({ ok: false, error: "Lead intake is not configured yet." }, { status: 503 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a form submission." }, { status: 400 });
  }

  if (str(form.get("website_url") ?? form.get("company_website"))) {
    return NextResponse.json({ ok: false, error: "We could not accept that request." }, { status: 422 });
  }

  try {
    if (!(await allowIntakeRequest(request))) {
      return NextResponse.json(
        { ok: false, error: "Too many requests from this connection. Please wait an hour or call (208) 477-1169." },
        { status: 429 },
      );
    }
  } catch (error) {
    console.error("[short-request] anti-abuse check failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not safely accept that request just now." }, { status: 503 });
  }

  const formName = str(form.get("form")) ?? "Short request";
  const checked = readShortRequest((key) => form.get(key));
  if (!checked.ok) {
    return NextResponse.json({ ok: false, error: checked.error, field: checked.field }, { status: 422 });
  }
  const submitted = checked.value;
  const { name: wholeName, phone, email, project } = submitted;

  const parts = wholeName.split(/\s+/);
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  const rawBody: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") rawBody[key] = value;
  }
  const attribution = collectAttribution(rawBody);
  const isQuoteForm = formName === "Quote Landing Page";
  const attributedSource = sourceFromAttribution(attribution);
  const resolvedSource = isQuoteForm || attributedSource !== "Organic Website" ? attributedSource : "Organic Website";
  const service = QUOTE_SERVICES.find((entry) => entry.project === project);
  const brand = brandForProject(project);

  // Only a form without JavaScript sends files with the lead. Each file gets
  // its own verdict; none of them can stop the lead being saved.
  let uploads: Awaited<ReturnType<typeof readEachUpload>> = [];
  try {
    uploads = await readEachUpload([...form.getAll("files")].filter(isUpload));
  } catch (error) {
    console.error("[short-request] could not read files:", (error as Error).message);
  }
  const files = uploads.flatMap((upload) => (upload.file ? [upload.file] : []));
  // The browser says how many files it is about to send, for the team email.
  const filesExpected = Math.min(Math.max(Number(str(form.get("files_expected")) ?? 0) || 0, 0), 10);

  const summary = shortRequestSummary(submitted, files.map((file) => file.fileName));

  try {
    const settings = await loadSettings();
    const result = await ingestLead(
      {
        firstName,
        lastName,
        email,
        phone,
        brand,
        projectType: project,
        source: resolvedSource,
        sourceDetail: attribution?.gclid ?? attribution?.gbraid ?? attribution?.wbraid ?? attribution?.first_gclid ?? attribution?.utm_campaign ?? null,
        propertyAddress: submitted.address,
        propertyCity: null,
        summary,
        externalLeadId: null,
        originalForm: formName,
        originalCampaign: attribution?.first_utm_campaign ?? attribution?.utm_campaign ?? null,
        utm: (() => {
          const values = { ...(attribution ?? {}), ...(service ? { service: service.slug } : {}) };
          return Object.keys(values).length ? values : null;
        })(),
        receivedAt: new Date(),
        requestKind: submitted.kind === "callback" ? "callback" : "quote",
        contactPreference: submitted.contactPreference,
        bestTime: submitted.bestTime,
        submittedFields: submittedFieldsFromBody(rawBody),
        submissionChannel: "P5 website form",
      },
      settings,
    );

    if (result.status === "rejected") {
      const message = result.errors[0]?.message ?? "Check the name and phone and try again.";
      return NextResponse.json({ ok: false, error: message }, { status: 422 });
    }

    const created = result.status === "created";
    const filesFailed = uploads.filter((upload) => upload.error).map((upload) => ({ name: upload.name, error: upload.error }));
    let filesAttached = false;
    if (files.length && result.dealId > 0) {
      try {
        for (const outcome of await storeLeadRequestFiles(result.dealId, files)) {
          if (outcome.status === "rejected") filesFailed.push({ name: outcome.name, error: outcome.error });
        }
        filesAttached = true;
      } catch (error) {
        console.error("[short-request] lead saved but files did not attach:", (error as Error).message);
        filesFailed.push(...files.map((file) => ({ name: file.fileName, error: "That file did not attach." })));
      }
    }

    // Step 2 and the file uploads that follow prove they belong to this
    // request with this token. A lead without one is still a saved lead.
    let requestKey: { id: number; token: string; expiresIn: number } | null = null;
    if (result.dealId > 0) {
      try {
        requestKey = { id: result.dealId, token: issueRequestToken(result.dealId), expiresIn: REQUEST_TOKEN_TTL_SECONDS };
      } catch (error) {
        console.error("[short-request] could not issue a request token:", (error as Error).message);
      }
    }

    // HubSpot right away, bounded; the watchdog retries anything unfinished.
    const sync = created ? startSync(syncDealToHubSpot, result.dealId) : null;
    await within(sync, inlineSyncTimeoutMs());

    const filesMissing = filesFailed.length > 0 || (files.length > 0 && !filesAttached);
    // Mail runs after the response is finished, so a send failure cannot
    // change 201. Duplicate and rejected leads are not notified.
    // Synthetic estimator acceptances are skipped inside notifyLeadCreated.
    if (created) {
      const notice: LeadCreatedNotifyInput = {
        dealId: result.dealId,
        brand,
        projectType: project,
        firstName,
        lastName,
        email,
        phone,
        propertyCity: null,
        propertyAddress: submitted.address,
        summary,
        source: resolvedSource,
        originalForm: formName,
        extraLines: [
          submitted.kind === "callback" ? "Request: Callback request" : "Request: Quote request",
          `Preferred contact: ${CONTACT_PREFERENCE_LABELS[submitted.contactPreference]}`,
          submitted.bestTime ? `Best time to call: ${submitted.bestTime}` : "",
          filesExpected > 0 ? `Files: ${filesExpected} on the way. A short "Files added" email follows when they arrive.` : "",
        ].filter(Boolean),
        prepare: async () => {
          await within(sync, 10_000);
          return loadLeadAlert(result.dealId, { ...notice, prepare: undefined });
        },
      };
      after(async () => {
        await notifyLeadCreated(notice);
      });
    }
    return NextResponse.json(
      {
        ok: true,
        duplicate: result.status === "duplicate",
        accepted: created,
        callback: submitted.kind === "callback",
        filesAttached,
        filesFailed,
        request: requestKey,
        message: filesMissing ? FILE_FAIL_MESSAGE : SAVED_MESSAGE,
      },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    console.error("[short-request] failed:", (error as Error).message);
    return NextResponse.json(
      { ok: false, error: "We could not record that just now. Please call (208) 477-1169." },
      { status: 500 },
    );
  }
}
