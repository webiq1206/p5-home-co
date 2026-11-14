import { HubSpotLeadReviewError, providerRejectedEmail, holdLeadReview, heldLeadReview, recheckLeadReviews, openLeadReviewCount } from "./hubspot-lead-review.ts";
/**
 * HubSpot CRM sync.
 *
 * P5 owns operational state; HubSpot is the CRM system of record. This module
 * pushes contacts and deals up and records the resulting ids, so the two stay
 * joined without either becoming a copy of the other.
 *
 * Three rules shape everything here:
 *
 *   1. Sync never blocks intake. A lead is captured whether or not HubSpot is
 *      reachable, because losing a lead to an API outage is the one failure
 *      this system exists to prevent.
 *   2. Sync is idempotent. Records are matched on stored HubSpot ids first and
 *      by a unique search key second, so a retry updates rather than duplicates.
 *   3. Sync is off unless configured. With the flag off or the token missing,
 *      nothing is called and nothing is claimed.
 */

import { query } from "../db.ts";
import { hubspotRetryDue, recordHubspotFailure, clearHubspotBackoff } from "./hubspot-backoff.ts";
import { loadSettings } from "../leads/settings.ts";
import {
  contactProperties,
  dealProperties,
  detailsNoteBody,
  newRecordOwnerId,
  streetOnly,
  submissionNoteBody,
  type ContactSyncInput,
  type DealSyncInput,
} from "./hubspot-map.ts";
import { detailLines, type LeadDetails } from "../leads/intakeContract.ts";
import { leadFileAdminUrl } from "../leads/leadRequestFiles.ts";
import { normalizeEmail, normalizePhone } from "../leads/normalize.ts";
import { metaReviewLines } from "../leads/meta-contact.ts";
import { ensureP5HubSpotPortal } from "./hubspot-portal.ts";
import { attributionFields, type SubmittedField } from "../leads/submittedFields.ts";

const API = "https://api.hubapi.com";
const HUBSPOT_ATTRIBUTION_FIELDS = [
  "p5_gclid", "p5_gbraid", "p5_wbraid", "p5_fbclid", "p5_utm_source", "p5_utm_medium",
  "p5_utm_campaign", "p5_utm_term", "p5_utm_content", "p5_landing_page", "p5_referrer", "p5_service",
] as const;

/** HubSpot's documented burst allowance leaves room for a short backoff. */
const MAX_ATTEMPTS = 4;

export type SyncOutcome =
  | { status: "synced"; contactId: string; dealId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export class HubSpotError extends Error {
  // Declared and assigned explicitly rather than as constructor parameter
  // properties: Node's --experimental-strip-types erases types without
  // generating code, so `readonly x: T` in a constructor signature fails to
  // parse there even though the Next build accepts it. Writing it out keeps
  // the module loadable by both the app and the test runner.
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(message: string, httpStatus: number, retryable: boolean) {
    super(message);
    this.name = "HubSpotError";
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

function token(): string | undefined {
  return process.env.HUBSPOT_TOKEN;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One HubSpot request, with backoff for the failures worth retrying.
 *
 * 429 and 5xx are retried; 4xx are not, because a malformed property or a
 * missing scope will fail identically forever and should surface immediately
 * on the integration-health screen rather than burn the rate limit.
 */
async function call<T>(path: string, init: RequestInit): Promise<T> {
  const auth = token();
  if (!auth) throw new HubSpotError("HUBSPOT_TOKEN is not set.", 0, false);
  // Never write to any portal but P5's (hubspot-portal.ts). Retryable, so the
  // watchdog keeps the lead pending until the token is right.
  try {
    await ensureP5HubSpotPortal(auth);
  } catch (error) {
    throw new HubSpotError((error as Error).message, 0, true);
  }

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(API + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${auth}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (networkError) {
      lastError = (networkError as Error).message;
      if (attempt === MAX_ATTEMPTS) throw new HubSpotError(lastError, 0, true);
      await sleep(2 ** attempt * 250);
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    const body = await res.text();
    lastError = `HTTP ${res.status}: ${body.slice(0, 300)}`;
    if (res.status === 400 && /^\/crm\/v3\/objects\/contacts(?:\/[^/]+)?$/.test(path) && ["POST", "PATCH"].includes(init.method ?? "GET")) {
      let validation: unknown;
      try { validation = JSON.parse(body); } catch { /* Not a verified validation response. */ }
      if (providerRejectedEmail(validation)) throw new HubSpotLeadReviewError("invalid_email");
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new HubSpotError(lastError, res.status, retryable);
    }

    // Honour Retry-After when HubSpot sends it; otherwise exponential backoff.
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 250);
  }

  throw new HubSpotError(lastError, 0, true);
}

type IdResponse = { id: string };
type SearchResponse = { total: number; results: { id: string; properties?: Record<string, string | null> }[] };
type FoundContact = { id: string; ownerId: string | null };

/** Find a contact by email, the identifier HubSpot itself deduplicates on. */
async function findContactByEmail(email: string): Promise<FoundContact | null> {
  const res = await call<SearchResponse>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
      properties: ["email", "hubspot_owner_id"],
      limit: 1,
    }),
  });
  const found = res.results[0];
  return found ? { id: found.id, ownerId: found.properties?.hubspot_owner_id || null } : null;
}

/**
 * Find a contact by phone when there is no email match. HubSpot stores phone
 * numbers as typed, so the search is a text query on the national digits and
 * the match is decided here on the normalized number. Exactly one match is
 * adopted; none, or more than one, means a new contact rather than a guess.
 */
async function findContactByPhone(phone: string): Promise<FoundContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const res = await call<SearchResponse>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      query: normalized.startsWith("+1") ? normalized.slice(2) : normalized.slice(1),
      properties: ["phone", "mobilephone", "hubspot_owner_id"],
      limit: 20,
    }),
  });
  const exact = (res.results ?? []).filter((row) =>
    [row.properties?.phone, row.properties?.mobilephone].some((value) => normalizePhone(value ?? null) === normalized));
  if (exact.length !== 1) return null;
  return { id: exact[0].id, ownerId: exact[0].properties?.hubspot_owner_id || null };
}

/** The owner a known contact already has, so a sync never reassigns it. */
async function contactOwner(id: string): Promise<string | null> {
  const res = await call<{ properties?: Record<string, string | null> }>(
    `/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=hubspot_owner_id`,
    { method: "GET" },
  );
  return res.properties?.hubspot_owner_id || null;
}

/** Find a deal previously synced from this P5 deal id. */
async function findDealByExternalId(externalLeadId: string): Promise<string | null> {
  const res = await call<SearchResponse>("/crm/v3/objects/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "p5_external_lead_id", operator: "EQ", value: externalLeadId },
          ],
        },
      ],
      properties: ["p5_external_lead_id"],
      limit: 1,
    }),
  });
  return res.results[0]?.id ?? null;
}

/**
 * Create or update the contact: by the stored id, else by email, else by
 * phone, else a new contact. Only non-empty values are written, so a blank
 * submission never clears a field HubSpot already holds. The owner is set
 * only where the contact has none, so a reassignment made in HubSpot stands.
 */
async function upsertContact(
  input: ContactSyncInput,
  knownId: string | null,
  ownerId: string | null,
): Promise<string> {
  const properties = contactProperties(input);
  const update = async (found: FoundContact): Promise<string> => {
    const patch = { ...properties, ...(ownerId && !found.ownerId ? { hubspot_owner_id: ownerId } : {}) };
    if (Object.keys(patch).length) {
      await call<IdResponse>(`/crm/v3/objects/contacts/${found.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: patch }),
      });
    }
    return found.id;
  };

  if (knownId) {
    let owner: string | null = null;
    try { owner = await contactOwner(knownId); }
    catch (error) {
      if (error instanceof HubSpotError && error.httpStatus === 404) {
        const archived = await call<{ archived?: boolean }>(`/crm/v3/objects/contacts/${encodeURIComponent(knownId)}?archived=true`, { method: "GET" });
        if (archived.archived === true) throw new HubSpotLeadReviewError("archived_contact", knownId);
      }
      throw error;
    }
    return update({ id: knownId, ownerId: owner });
  }

  // Search before create: HubSpot rejects a duplicate email with 409, and a
  // pre-existing contact should be adopted rather than fought with.
  if (input.email) {
    const found = await findContactByEmail(input.email);
    if (found) return update(found);
  }
  if (input.phone) {
    const found = await findContactByPhone(input.phone);
    if (found) return update(found);
  }

  const created = await call<IdResponse>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties: { ...properties, ...(ownerId ? { hubspot_owner_id: ownerId } : {}) } }),
  });
  return created.id;
}

async function upsertDeal(
  input: DealSyncInput,
  knownId: string | null,
  p5DealId: number,
  availableProperties: ReadonlySet<string> | undefined,
  newDealOwnerId: string | null = null,
): Promise<string> {
  // The P5 deal id is the idempotency key, so a replayed sync updates the
  // same HubSpot deal instead of creating a second one.
  const externalId = input.externalLeadId ?? `p5-deal-${p5DealId}`;
  const properties = { ...dealProperties(input, availableProperties), p5_external_lead_id: externalId };

  const id = knownId ?? (await findDealByExternalId(externalId));

  if (id) {
    await call<IdResponse>(`/crm/v3/objects/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return id;
  }

  // A new deal is always assigned, so the owner's HubSpot app announces it.
  // An existing deal keeps whatever owner HubSpot has unless P5 assigned one.
  const created = await call<IdResponse>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties: (properties as Record<string, string>).hubspot_owner_id || !newDealOwnerId ? properties : { ...properties, hubspot_owner_id: newDealOwnerId },
    }),
  });
  return created.id;
}

/** Association types (HubSpot-defined): note to contact 202, note to deal 214. */
const NOTE_TO_CONTACT = 202;

/**
 * One HubSpot note per submission (lead_intake_submission), on the contact and
 * the deal, carrying every field the visitor sent and the attribution. Same
 * fallback rule as the details notes: a token without the notes scope marks
 * it delivered by description (the summary is there) and never retries.
 * Returns true when a transient failure means the deal should sync again.
 */
async function syncSubmissionNotes(dealId: number, hubspotDealId: string, contactId: string, row: DealRow): Promise<boolean> {
  const submissions = await query<{ id: string; channel: string; fields: SubmittedField[]; received_at: string }>(
    `SELECT id, channel, fields, received_at FROM lead_intake_submission
      WHERE deal_id = $1 AND hubspot_note_state = 'pending'
      ORDER BY received_at, id`,
    [dealId],
  ).catch(() => []);
  if (!submissions.length) return false;
  const attribution = attributionFields({
    source: row.lead_source,
    sourceDetail: row.lead_source_detail,
    originalForm: row.original_form,
    originalCampaign: row.original_campaign,
    externalLeadId: row.external_lead_id,
    facebookLeadId: row.facebook_lead_id,
    utm: row.utm,
  });
  const base = (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
  let retry = false;
  for (const submission of submissions) {
    const receivedAt = new Date(submission.received_at);
    try {
      const note = await call<IdResponse>("/crm/v3/objects/notes", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            hs_timestamp: String(receivedAt.getTime()),
            hs_note_body: submissionNoteBody({
              channel: submission.channel,
              receivedAt,
              fields: submission.fields ?? [],
              attribution,
              adminUrl: `${base}/admin/lead/${dealId}`,
            }),
            ...(row.owner_hubspot_id ? { hubspot_owner_id: row.owner_hubspot_id } : {}),
          },
          associations: [
            { to: { id: hubspotDealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_DEAL }] },
            { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] },
          ],
        }),
      });
      await query(
        "UPDATE lead_intake_submission SET hubspot_note_state = 'sent', hubspot_note_id = $2 WHERE id = $1",
        [submission.id, note.id],
      );
    } catch (error) {
      if (error instanceof HubSpotError && error.retryable) {
        retry = true;
        continue;
      }
      // 401/403 (no notes scope) or a malformed note fails the same way
      // forever. The deal description carries the summary; keep the fields
      // here and say so in the audit trail.
      await query("UPDATE lead_intake_submission SET hubspot_note_state = 'description' WHERE id = $1", [submission.id]);
      await query(
        `INSERT INTO audit_log (record_type, record_id, action, new_value, action_source, integration_source, succeeded, error)
         VALUES ('deal',$1,'hubspot_submission_note_fallback',$2::jsonb,'integration','hubspot',FALSE,$3)`,
        [String(dealId), JSON.stringify({ submissionId: submission.id }), (error as Error).message.slice(0, 300)],
      ).catch(() => undefined);
    }
  }
  return retry;
}

/** Associate a deal with its contact. Association type 3 is deal-to-contact. */
async function associate(dealId: string, contactId: string): Promise<void> {
  await call(`/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, {
    method: "PUT",
    body: JSON.stringify([
      { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 },
    ]),
  });
}

type DealRow = {
  id: string;
  name: string;
  brand: string;
  stage: string;
  lead_source: string;
  lead_source_detail: string | null;
  project_type: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state?: string | null;
  property_zip?: string | null;
  service_area: string | null;
  summary: string | null;
  estimated_value: string | null;
  received_at: string;
  sla_deadline: string | null;
  sla_status: string;
  first_attempt_at: string | null;
  first_two_way_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  appointment_at: string | null;
  external_lead_id: string | null;
  facebook_lead_id: string | null;
  original_form: string | null;
  original_campaign: string | null;
  closed_lost_reason: string | null;
  utm: Record<string, string> | null;
  hubspot_deal_id: string | null;
  request_kind: string | null;
  contact_preference: string | null;
  best_time: string | null;
  timeline: string | null;
  /** updated_at as text, so microseconds survive the round trip. */
  sync_version: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  hubspot_contact_id: string | null;
  contact_id: string;
  owner_name: string | null;
  owner_hubspot_id: string | null;
};

const d = (v: string | null) => (v ? new Date(v) : null);

/**
 * Every file on the lead as a link: brand-site links as sent, and P5's own
 * uploads through the admin-gated download route (sign in required).
 */
async function dealFileLinks(dealId: number): Promise<{ name: string; url: string }[]> {
  const linked = await query<{ file_name: string; url: string }>(
    "SELECT file_name, url FROM lead_file_link WHERE deal_id = $1 ORDER BY created_at, id",
    [dealId],
  ).catch(() => []);
  const own = await query<{ id: string; file_name: string }>(
    "SELECT id, file_name FROM lead_request_file WHERE deal_id = $1 ORDER BY created_at, id",
    [dealId],
  ).catch(() => []);
  return [
    ...linked.map((row) => ({ name: row.file_name, url: row.url })),
    ...own.map((row) => ({ name: row.file_name, url: leadFileAdminUrl(row.id) })),
  ];
}

/** Association type 214: note to deal (HubSpot-defined). */
const NOTE_TO_DEAL = 214;

/**
 * One HubSpot note per "Details added" submission, so the timeline shows when
 * the visitor added what. A token without the notes scope gets 403: the
 * details are already in the deal description (the summary carries every
 * "Details added" block), so the event is marked as delivered that way and
 * never retried. Returns true when a transient failure means the deal should
 * be synced again.
 */
async function syncDetailNotes(dealId: number, hubspotDealId: string): Promise<boolean> {
  const events = await query<{ fingerprint: string; details: LeadDetails; received_at: string }>(
    `SELECT fingerprint, details, received_at FROM lead_details_event
      WHERE deal_id = $1 AND hubspot_note_state = 'pending'
      ORDER BY received_at`,
    [dealId],
  ).catch(() => []);
  let retry = false;
  for (const event of events) {
    const details: LeadDetails = { ...event.details, files: event.details.files ?? [] };
    try {
      const note = await call<IdResponse>("/crm/v3/objects/notes", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            hs_timestamp: String(new Date(event.received_at).getTime()),
            hs_note_body: detailsNoteBody(detailLines(details)),
          },
          associations: [
            { to: { id: hubspotDealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_DEAL }] },
          ],
        }),
      });
      await query(
        "UPDATE lead_details_event SET hubspot_note_state = 'sent', hubspot_note_id = $3 WHERE deal_id = $1 AND fingerprint = $2",
        [dealId, event.fingerprint, note.id],
      );
    } catch (error) {
      const status = error instanceof HubSpotError ? error.httpStatus : 0;
      if (status === 401 || status === 403) {
        await query(
          "UPDATE lead_details_event SET hubspot_note_state = 'description' WHERE deal_id = $1 AND fingerprint = $2",
          [dealId, event.fingerprint],
        );
        await query(
          `INSERT INTO audit_log (record_type, record_id, action, new_value, action_source, integration_source, succeeded, error)
           VALUES ('deal',$1,'hubspot_note_fallback',$2::jsonb,'integration','hubspot',FALSE,$3)`,
          [String(dealId), JSON.stringify({ fingerprint: event.fingerprint }), "Notes are not available with this token; details are in the deal description."],
        ).catch(() => undefined);
      } else if (error instanceof HubSpotError && error.retryable) {
        retry = true;
      } else {
        // A malformed note fails the same way forever. The description has it.
        await query(
          "UPDATE lead_details_event SET hubspot_note_state = 'description' WHERE deal_id = $1 AND fingerprint = $2",
          [dealId, event.fingerprint],
        );
      }
    }
  }
  return retry;
}

/**
 * Sync one P5 deal, and its contact, into HubSpot.
 *
 * Returns rather than throws, so a caller in the intake path or the watchdog
 * can record the failure and carry on. The deal's sync status and last error
 * are always written, which is what makes a broken integration visible instead
 * of silent.
 */
export async function syncDealToHubSpot(dealId: number): Promise<SyncOutcome> {
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled) {
    return { status: "skipped", reason: "hubspotIntegrationEnabled is false." };
  }
  if (!token()) {
    return { status: "skipped", reason: "HUBSPOT_TOKEN is not set." };
  }

  const rows = await query<DealRow>(
    `SELECT d.*, d.updated_at::text AS sync_version, c.first_name, c.last_name, c.email, c.phone,
            c.hubspot_contact_id, u.full_name AS owner_name,
            u.hubspot_owner_id AS owner_hubspot_id
       FROM deal d
       JOIN contact c ON c.id = d.contact_id
       LEFT JOIN app_user u ON u.id = d.owner_user_id
      WHERE d.id = $1`,
    [dealId],
  );
  if (!rows.length) return { status: "failed", error: `Deal ${dealId} not found.` };
  const row = rows[0];
  if(row.original_form==="p5-estimator-synthetic-qa")return {status:"skipped",reason:"Synthetic estimator acceptance has downstream delivery suppressed."};
  if (await heldLeadReview(dealId, row.lead_source === "Facebook Lead Ad" ? normalizeEmail(row.email) : row.email)) return { status: "skipped", reason: "HubSpot delivery requires review; original lead and references preserved." };
  // The inline sync after intake and the watchdog can reach the same deal at
  // once. A short lease lets exactly one of them push it; the other skips and
  // the deal stays pending for the next pass. Released when this pass ends.
  const leased = await query<{ id: string }>(
    `UPDATE deal SET hubspot_sync_lease_until = now() + interval '2 minutes'
      WHERE id = $1 AND (hubspot_sync_lease_until IS NULL OR hubspot_sync_lease_until < now())
      RETURNING id`,
    [dealId],
  );
  if (!leased.length) return { status: "skipped", reason: "A HubSpot sync for this deal is already running." };
  try {
    if (!(await hubspotRetryDue(dealId))) return { status: "skipped", reason: "HubSpot retry backoff is active." };
    return await syncLeasedDeal(dealId, row);
  } finally {
    await query("UPDATE deal SET hubspot_sync_lease_until = NULL WHERE id = $1", [dealId]).catch(() => undefined);
  }
}

async function syncLeasedDeal(dealId: number, row: DealRow): Promise<SyncOutcome> {
  // Attribution fields are optional. A token without schema-read permission or
  // a portal where setup has not created them still syncs the operational lead.
  const propertyNames = await fetchDealPropertyNames().catch(() => null);
  const files = await dealFileLinks(dealId);

  try {
    const isMeta = row.lead_source === "Facebook Lead Ad";
    const ownerForNewRecords = newRecordOwnerId(isMeta ? null : row.owner_hubspot_id);
    let summary = row.summary;
    if (isMeta) {
      // The operational summary is whitespace-normalized during intake.
      // Rehydrate exact answers from the durable submission for the CRM,
      // rather than presenting that lossy summary as the original answers.
      const submissions = await query<{ fields: SubmittedField[] }>(
        `SELECT fields FROM lead_intake_submission WHERE deal_id=$1 AND channel='Facebook Lead Ad'
         ORDER BY received_at,id`, [dealId],
      );
      const attribution = attributionFields({
        source: row.lead_source, sourceDetail: row.lead_source_detail,
        originalForm: row.original_form, originalCampaign: row.original_campaign,
        externalLeadId: row.external_lead_id, facebookLeadId: row.facebook_lead_id, utm: row.utm,
      });
      if (submissions.length) summary = [
        ...(row.utm?.meta_test_lead === "true" ? ["TEST LEAD"] : []),
        ...metaReviewLines(row.email, row.phone),
        "Facebook Lead Ad — original submitted answers",
        ...submissions.flatMap(s => s.fields.map(f => `${f.label}: ${f.value}`)),
        "Meta attribution",
        ...attribution.map(f => `${f.label}: ${f.value}`),
      ].join("\n");
    }
    const contactId = await upsertContact(
      {
        firstName: isMeta && !row.first_name && !row.last_name ? "Meta lead (contact needs review)" : row.first_name,
        lastName: row.last_name,
        // HubSpot rejects malformed email properties. Preserve the exact value
        // in the local contact, deal description and raw-answers note instead.
        email: isMeta ? normalizeEmail(row.email) : row.email,
        phone: row.phone,
        address: streetOnly(row.property_address, row.property_zip),
        city: row.property_city,
        state: row.property_state ?? null,
        zip: row.property_zip ?? null,
      },
      row.hubspot_contact_id,
      ownerForNewRecords,
    );

    const hubspotDealId = await upsertDeal(
      {
        name: isMeta ? `${row.utm?.meta_test_lead === "true" ? "TEST LEAD — " : ""}${row.brand} lead: ${[row.first_name, row.last_name].filter(Boolean).join(" ") || "New contact"}` : row.name,
        brand: row.brand as DealSyncInput["brand"],
        stage: row.stage as DealSyncInput["stage"],
        leadSource: row.lead_source as DealSyncInput["leadSource"],
        leadSourceDetail: row.lead_source_detail,
        projectType: row.project_type,
        propertyAddress: row.property_address,
        propertyCity: row.property_city,
        serviceArea: row.service_area,
        summary,
        estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
        assignedTeamMember: row.owner_name,
        hubspotOwnerId: row.owner_hubspot_id,
        receivedAt: new Date(row.received_at),
        slaDeadline: d(row.sla_deadline),
        slaStatus: row.sla_status,
        firstAttemptAt: d(row.first_attempt_at),
        firstTwoWayAt: d(row.first_two_way_at),
        nextAction: row.next_action,
        nextActionAt: d(row.next_action_at),
        appointmentAt: d(row.appointment_at),
        externalLeadId: row.external_lead_id,
        facebookLeadId: row.facebook_lead_id,
        originalForm: row.original_form,
        originalCampaign: row.original_campaign,
        closedLostReason: row.closed_lost_reason,
        attribution: row.utm,
        requestKind: row.request_kind,
        contactPreference: row.contact_preference,
        bestTime: row.best_time,
        timeline: row.timeline,
        files,
      },
      row.hubspot_deal_id,
      dealId,
      propertyNames ?? undefined,
      ownerForNewRecords,
    );

    await associate(hubspotDealId, contactId);
    const retryDetailNotes = await syncDetailNotes(dealId, hubspotDealId);
    const retryNotes = (await syncSubmissionNotes(dealId, hubspotDealId, contactId, row)) || retryDetailNotes;

    // A visitor can add details while this sync runs. Only a deal that did
    // not change underneath it is marked synced; otherwise it stays pending
    // and the next watchdog tick sends the newer version.
    await query(
      `UPDATE deal SET hubspot_deal_id = $2,
              integration_sync_status = CASE WHEN $4::boolean OR updated_at::text IS DISTINCT FROM $3::text THEN 'pending' ELSE 'synced' END,
              last_integration_error = NULL, updated_at = now()
        WHERE id = $1`,
      [dealId, hubspotDealId, row.sync_version, retryNotes],
    );
    const attributionUnavailable = !propertyNames ||
      !HUBSPOT_ATTRIBUTION_FIELDS.some((field) => propertyNames.has(field));
    if (row.utm && Object.keys(row.utm).length && attributionUnavailable) {
      await query(
        `INSERT INTO audit_log (record_type, record_id, action, new_value, action_source, integration_source, succeeded, error)
         VALUES ('deal',$1,'hubspot_attribution_deferred',$2::jsonb,'integration','hubspot',FALSE,$3)`,
        [String(dealId), JSON.stringify({ attributionKeys: Object.keys(row.utm) }), "HubSpot attribution properties are unavailable or could not be verified."],
      );
    }
    await query("UPDATE contact SET hubspot_contact_id = $2 WHERE id = $1", [
      row.contact_id,
      contactId,
    ]);
    await query(
      `INSERT INTO audit_log (record_type, record_id, action, new_value, action_source, integration_source)
       VALUES ('deal',$1,'hubspot_synced',$2::jsonb,'integration','hubspot')`,
      [String(dealId), JSON.stringify({ hubspotDealId, contactId })],
    );

    if (retryNotes) await recordHubspotFailure(dealId);
    else await clearHubspotBackoff(dealId);
    return { status: "synced", contactId, dealId: hubspotDealId };
  } catch (error) {
    const message = (error as Error).message;
    if (error instanceof HubSpotLeadReviewError) await holdLeadReview(dealId, error, row.lead_source === "Facebook Lead Ad" ? normalizeEmail(row.email) : row.email);
    else await recordHubspotFailure(dealId);
    await query(
      `UPDATE deal SET integration_sync_status = 'failed',
              last_integration_error = $2, updated_at = now()
        WHERE id = $1`,
      [dealId, message],
    ).catch(() => undefined);
    await query(
      `INSERT INTO integration_health (name, state, last_attempt_at, last_error)
       VALUES ('hubspot','failed',now(),$1)
       ON CONFLICT (name) DO UPDATE
         SET state='failed', last_attempt_at=now(), last_error=EXCLUDED.last_error, updated_at=now()`,
      [message],
    ).catch(() => undefined);

    return { status: "failed", error: message };
  }
}

/**
 * Sync every deal that is pending or previously failed.
 *
 * Called by the watchdog, so a HubSpot outage self-heals on the next tick
 * rather than needing someone to notice and retry by hand.
 */
export async function syncPendingDeals(limit = 25): Promise<{
  attempted: number;
  synced: number;
  failed: number;
  skipped: number;
}> {
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled || !token()) {
    return { attempted: 0, synced: 0, failed: 0, skipped: 1 };
  }

  await recheckLeadReviews(id => call<{ archived?: boolean }>(`/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=hs_object_id`, { method: "GET" }));
  const rows = await query<{ id: string }>(
    `SELECT id FROM deal
      WHERE integration_sync_status IN ('pending','failed')
        AND original_form IS DISTINCT FROM 'p5-estimator-synthetic-qa'
        AND NOT EXISTS (SELECT 1 FROM hubspot_lead_review r WHERE r.deal_id=deal.id AND r.released_at IS NULL)
      ORDER BY received_at ASC
      LIMIT $1`,
    [limit],
  );

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const result = await syncDealToHubSpot(Number(row.id));
    if (result.status === "synced") synced += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
  }

  const reviews = await openLeadReviewCount();
  const [remaining] = await query<{count:string}>(`SELECT count(*)::text AS count FROM deal
    WHERE integration_sync_status IN ('pending','failed')
      AND original_form IS DISTINCT FROM 'p5-estimator-synthetic-qa'
      AND NOT EXISTS (SELECT 1 FROM hubspot_lead_review r WHERE r.deal_id=deal.id AND r.released_at IS NULL)`);
  const pendingRemaining=Number(remaining.count);
  if (reviews) {
    await query(`INSERT INTO integration_health(name,state,last_attempt_at,last_error,records_processed)
      VALUES('hubspot','failed',now(),$1,$2) ON CONFLICT(name) DO UPDATE SET state='failed',last_attempt_at=now(),last_error=EXCLUDED.last_error,records_processed=EXCLUDED.records_processed`,
      [`${reviews} lead delivery record(s) require review. Correct rejected email or verify archived contact restoration; original records preserved. ${failed} additional sync failure(s); ${pendingRemaining} other delivery record(s) remain pending or failed.`,synced]);
  } else if (pendingRemaining && !failed && !skipped) {
    await query(`INSERT INTO integration_health(name,state,last_attempt_at,last_error,records_processed)
      VALUES('hubspot','failed',now(),$1,$2) ON CONFLICT(name) DO UPDATE SET state='failed',last_attempt_at=now(),last_error=EXCLUDED.last_error,records_processed=EXCLUDED.records_processed`,
      [`${pendingRemaining} delivery record(s) remain pending or failed outside the completed batch.`,synced]);
  } else if (rows.length && !failed && !skipped && !pendingRemaining) {
    await query(
      `INSERT INTO integration_health (name, state, last_success_at, last_attempt_at, records_processed)
       VALUES ('hubspot','connected',now(),now(),$1)
       ON CONFLICT (name) DO UPDATE
         SET state='connected', last_success_at=now(), last_attempt_at=now(),
             records_processed=EXCLUDED.records_processed, last_error=NULL, updated_at=now()`,
      [synced],
    ).catch(() => undefined);
  }

  return { attempted: rows.length, synced, failed, skipped };
}

// ---------------------------------------------------------------------------
// Read-only configuration lookups for the Knowledge Center drift check.
// ---------------------------------------------------------------------------

export type LivePipelineStage = { id: string; label: string; displayOrder: number };

/**
 * The live deal pipeline's stages, or null when no token is configured.
 *
 * Null (not an error): drift checks report "unverifiable" rather than
 * failing, because a missing token is a deployment state, not config drift.
 */
export async function fetchDealPipelineStages(
  pipelineId = "default",
): Promise<LivePipelineStage[] | null> {
  if (!token()) return null;
  const res = await call<{ stages: { id: string; label: string; displayOrder: number }[] }>(
    `/crm/v3/pipelines/deals/${pipelineId}`,
    { method: "GET" },
  );
  return res.stages
    .map((s) => ({ id: s.id, label: s.label, displayOrder: s.displayOrder }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Names of all deal properties, or null when no token is configured. */
export async function fetchDealPropertyNames(): Promise<Set<string> | null> {
  if (!token()) return null;
  const res = await call<{ results: { name: string }[] }>(
    "/crm/v3/properties/deals",
    { method: "GET" },
  );
  return new Set(res.results.map((r) => r.name));
}
