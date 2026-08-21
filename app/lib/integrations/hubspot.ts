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
import { loadSettings } from "../leads/settings.ts";
import {
  contactProperties,
  dealProperties,
  type ContactSyncInput,
  type DealSyncInput,
} from "./hubspot-map.ts";

const API = "https://api.hubapi.com";

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
type SearchResponse = { total: number; results: { id: string }[] };

/** Find a contact by email, the identifier HubSpot itself deduplicates on. */
async function findContactByEmail(email: string): Promise<string | null> {
  const res = await call<SearchResponse>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
      properties: ["email"],
      limit: 1,
    }),
  });
  return res.results[0]?.id ?? null;
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

async function upsertContact(
  input: ContactSyncInput,
  knownId: string | null,
): Promise<string> {
  const properties = contactProperties(input);

  if (knownId) {
    await call<IdResponse>(`/crm/v3/objects/contacts/${knownId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return knownId;
  }

  // Search before create: HubSpot rejects a duplicate email with 409, and a
  // pre-existing contact should be adopted rather than fought with.
  if (input.email) {
    const found = await findContactByEmail(input.email);
    if (found) {
      await call<IdResponse>(`/crm/v3/objects/contacts/${found}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
      return found;
    }
  }

  const created = await call<IdResponse>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  return created.id;
}

async function upsertDeal(
  input: DealSyncInput,
  knownId: string | null,
  p5DealId: number,
): Promise<string> {
  // The P5 deal id is the idempotency key, so a replayed sync updates the
  // same HubSpot deal instead of creating a second one.
  const externalId = input.externalLeadId ?? `p5-deal-${p5DealId}`;
  const properties = { ...dealProperties(input), p5_external_lead_id: externalId };

  const id = knownId ?? (await findDealByExternalId(externalId));

  if (id) {
    await call<IdResponse>(`/crm/v3/objects/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return id;
  }

  const created = await call<IdResponse>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  return created.id;
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
  hubspot_deal_id: string | null;
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
    `SELECT d.*, c.first_name, c.last_name, c.email, c.phone,
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

  try {
    const contactId = await upsertContact(
      {
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
      },
      row.hubspot_contact_id,
    );

    const hubspotDealId = await upsertDeal(
      {
        name: row.name,
        brand: row.brand as DealSyncInput["brand"],
        stage: row.stage as DealSyncInput["stage"],
        leadSource: row.lead_source as DealSyncInput["leadSource"],
        leadSourceDetail: row.lead_source_detail,
        projectType: row.project_type,
        propertyAddress: row.property_address,
        propertyCity: row.property_city,
        serviceArea: row.service_area,
        summary: row.summary,
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
      },
      row.hubspot_deal_id,
      dealId,
    );

    await associate(hubspotDealId, contactId);

    await query(
      `UPDATE deal SET hubspot_deal_id = $2, integration_sync_status = 'synced',
              last_integration_error = NULL, updated_at = now()
        WHERE id = $1`,
      [dealId, hubspotDealId],
    );
    await query("UPDATE contact SET hubspot_contact_id = $2 WHERE id = $1", [
      row.contact_id,
      contactId,
    ]);
    await query(
      `INSERT INTO audit_log (record_type, record_id, action, new_value, action_source, integration_source)
       VALUES ('deal',$1,'hubspot_synced',$2::jsonb,'integration','hubspot')`,
      [String(dealId), JSON.stringify({ hubspotDealId, contactId })],
    );

    return { status: "synced", contactId, dealId: hubspotDealId };
  } catch (error) {
    const message = (error as Error).message;
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

  const rows = await query<{ id: string }>(
    `SELECT id FROM deal
      WHERE integration_sync_status IN ('pending','failed')
      ORDER BY received_at ASC
      LIMIT $1`,
    [limit],
  );

  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await syncDealToHubSpot(Number(row.id));
    if (result.status === "synced") synced += 1;
    else if (result.status === "failed") failed += 1;
  }

  if (rows.length && !failed) {
    await query(
      `INSERT INTO integration_health (name, state, last_success_at, last_attempt_at, records_processed)
       VALUES ('hubspot','connected',now(),now(),$1)
       ON CONFLICT (name) DO UPDATE
         SET state='connected', last_success_at=now(), last_attempt_at=now(),
             records_processed=EXCLUDED.records_processed, last_error=NULL, updated_at=now()`,
      [synced],
    ).catch(() => undefined);
  }

  return { attempted: rows.length, synced, failed, skipped: 0 };
}
