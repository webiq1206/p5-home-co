/**
 * Calls, texts and notes logged in the P5 admin, pushed to HubSpot.
 *
 * The admin's "Log outcome" form records an activity row. This pushes it as
 * the matching HubSpot engagement, associated to the contact and the deal:
 *
 *   call outcomes (Connected, Left Voicemail, No Answer, Wrong Number...)
 *       -> CALL with the outcome as its title and disposition, the note as body
 *   Sent Text
 *       -> COMMUNICATION (channel SMS), HubSpot's object for logged texts.
 *          Where the portal or token refuses it (400/403/404, nothing created),
 *          the same text goes up as a NOTE headed "Text message (SMS)".
 *   everything else (Sent Email, Appointment Scheduled, Not Ready, notes...)
 *       -> NOTE headed with the outcome
 *
 * Calls, notes and communications are CRM engagements available on the free
 * tier. One rule borrowed from the inbox sync: an attempt is recorded before
 * the POST, and a request whose outcome is unknown (network failure, timeout)
 * is marked "uncertain" for an administrator and never posted again. A clear
 * HubSpot refusal (429/5xx) is retried by the watchdog, up to five times.
 */

import { query } from "../db.ts";
import { loadSettings } from "../leads/settings.ts";
import { ensureP5HubSpotPortal } from "./hubspot-portal.ts";

const API = "https://api.hubapi.com";
const MAX_ATTEMPTS = 5;

/** HubSpot-defined association type ids. */
export const ASSOCIATION_TYPES = {
  calls: { contact: 194, deal: 206 },
  notes: { contact: 202, deal: 214 },
  communications: { contact: 81, deal: 85 },
} as const;

/** HubSpot's default call outcome (hs_call_disposition) ids. */
export const CALL_DISPOSITIONS: Record<string, string> = {
  Connected: "f240bbac-87c9-4f6e-bf70-924b57d47db7",
  "Appointment Scheduled": "f240bbac-87c9-4f6e-bf70-924b57d47db7",
  "Left Voicemail": "b2cf5968-551e-4856-9783-52b3da59a7d0",
  "No Answer": "73a0d17f-1163-4015-bdd5-ec830791da20",
  "Wrong Number": "17b47fee-58de-441e-a44c-c6300d46f273",
};

export class ActivityApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ActivityRequest = (path: string, init: { method: string; body?: unknown }) => Promise<{ id?: string }>;

function defaultRequest(): ActivityRequest {
  return async (path, init) => {
    const token = process.env.HUBSPOT_TOKEN ?? "";
    try {
      await ensureP5HubSpotPortal(token);
    } catch (error) {
      // Nothing was sent: safe to retry once the token is right.
      throw new ActivityApiError(503, (error as Error).message);
    }
    let response: Response;
    try {
      response = await fetch(API + path, {
        method: init.method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ActivityApiError(0, "hubspot-network-or-timeout");
    }
    if (!response.ok) throw new ActivityApiError(response.status, `hubspot-http-${response.status}`);
    return (await response.json().catch(() => ({}))) as { id?: string };
  };
}

export type ActivityRow = {
  id: string;
  deal_id: string;
  kind: string;
  outcome: string | null;
  body: string | null;
  occurred_at: string | Date;
  hubspot_attempts: number;
  hubspot_deal_id: string | null;
  hubspot_contact_id: string | null;
  actor_name: string | null;
  actor_owner_id: string | null;
  deal_owner_id: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text of what was logged, for a call body or a text message. */
function plainBody(row: ActivityRow): string {
  return [
    row.outcome ? `Outcome: ${row.outcome}` : "",
    row.body ?? "",
    row.actor_name ? `Logged in P5 by ${row.actor_name}.` : "Logged in P5.",
    `P5 activity ${row.id}`,
  ].filter(Boolean).join("\n");
}

function noteHtml(heading: string, row: ActivityRow): string {
  return [
    `<p><strong>${escapeHtml(heading)}</strong></p>`,
    row.body ? `<p>${escapeHtml(row.body).replace(/\n/g, "<br>")}</p>` : "",
    `<p>${escapeHtml(row.actor_name ? `Logged in P5 by ${row.actor_name}.` : "Logged in P5.")} P5 activity ${escapeHtml(String(row.id))}.</p>`,
  ].filter(Boolean).join("");
}

export type EngagementPlan = { object: "calls" | "notes" | "communications"; properties: Record<string, string> };

/** What one activity becomes in HubSpot. Pure, so the mapping is testable. */
export function engagementFor(row: ActivityRow, smsFallback = false): EngagementPlan {
  const timestamp = new Date(row.occurred_at).toISOString();
  const owner = row.actor_owner_id || row.deal_owner_id;
  const withOwner = (properties: Record<string, string>) => (owner ? { ...properties, hubspot_owner_id: owner } : properties);
  if (row.kind === "call") {
    const disposition = row.outcome ? CALL_DISPOSITIONS[row.outcome] : undefined;
    return {
      object: "calls",
      properties: withOwner({
        hs_timestamp: timestamp,
        hs_call_title: `Call: ${row.outcome ?? "logged"}`,
        hs_call_body: plainBody(row),
        hs_call_direction: "OUTBOUND",
        hs_call_status: "COMPLETED",
        ...(disposition ? { hs_call_disposition: disposition } : {}),
      }),
    };
  }
  if (row.kind === "text" && !smsFallback) {
    return {
      object: "communications",
      properties: withOwner({
        hs_timestamp: timestamp,
        hs_communication_channel_type: "SMS",
        hs_communication_logged_from: "CRM",
        hs_communication_body: plainBody(row),
      }),
    };
  }
  const heading = row.kind === "text"
    ? `Text message (SMS) sent${row.outcome ? `: ${row.outcome}` : ""}`
    : row.kind === "note" ? `Note${row.outcome ? `: ${row.outcome}` : ""}` : `Outcome: ${row.outcome ?? row.kind}`;
  return { object: "notes", properties: withOwner({ hs_timestamp: timestamp, hs_note_body: noteHtml(heading, row) }) };
}

function associations(plan: EngagementPlan, contactId: string, dealId: string) {
  const types = ASSOCIATION_TYPES[plan.object];
  return [
    { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: types.contact }] },
    { to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: types.deal }] },
  ];
}

export type ActivityPushOutcome = "sent" | "waiting" | "retry" | "uncertain" | "failed" | "skipped";

async function mark(id: string, state: string, fields: { error?: string | null; objectId?: string | null; objectType?: string | null } = {}): Promise<void> {
  await query(
    `UPDATE activity SET hubspot_sync_state = $2, hubspot_last_error = $3,
            hubspot_activity_id = COALESCE($4, hubspot_activity_id), hubspot_object_type = COALESCE($5, hubspot_object_type)
      WHERE id = $1`,
    [id, state, fields.error ?? null, fields.objectId ?? null, fields.objectType ?? null],
  );
}

/**
 * Push one pending activity. Waits (state stays pending) until its deal and
 * contact have HubSpot ids; the deal sync supplies those.
 */
export async function pushActivityToHubSpot(activityId: number, request: ActivityRequest = defaultRequest()): Promise<ActivityPushOutcome> {
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled || !process.env.HUBSPOT_TOKEN) return "skipped";
  const rows = await query<ActivityRow>(
    `SELECT a.id, a.deal_id, a.kind, a.outcome, a.body, a.occurred_at, a.hubspot_attempts,
            d.hubspot_deal_id, c.hubspot_contact_id,
            actor.full_name AS actor_name, actor.hubspot_owner_id AS actor_owner_id,
            owner.hubspot_owner_id AS deal_owner_id
       FROM activity a
       JOIN deal d ON d.id = a.deal_id
       JOIN contact c ON c.id = d.contact_id
       LEFT JOIN app_user actor ON actor.id = a.user_id
       LEFT JOIN app_user owner ON owner.id = d.owner_user_id
      WHERE a.id = $1 AND a.hubspot_sync_state = 'pending'
        AND d.original_form IS DISTINCT FROM 'p5-estimator-synthetic-qa'`,
    [activityId],
  );
  if (!rows.length) return "skipped";
  const row = rows[0];
  if (!row.hubspot_deal_id || !row.hubspot_contact_id) return "waiting";

  // Durable intent before the POST: only one caller wins, and a lost
  // response can never become a second engagement.
  const claimed = await query(
    `UPDATE activity SET hubspot_sync_state = 'sending', hubspot_attempted_at = now(), hubspot_attempts = hubspot_attempts + 1
      WHERE id = $1 AND hubspot_sync_state = 'pending' RETURNING id`,
    [activityId],
  );
  if (!claimed.length) return "skipped";

  let plan = engagementFor(row);
  for (;;) {
    try {
      const created = await request(`/crm/v3/objects/${plan.object}`, {
        method: "POST",
        body: { properties: plan.properties, associations: associations(plan, row.hubspot_contact_id, row.hubspot_deal_id) },
      });
      if (!created.id) throw new ActivityApiError(0, "hubspot-create-without-id");
      await mark(row.id, "sent", { objectId: created.id, objectType: plan.object });
      return "sent";
    } catch (error) {
      const status = error instanceof ActivityApiError ? error.status : 0;
      const message = error instanceof Error ? error.message.slice(0, 300) : "hubspot-error";
      // A text the portal will not take as a communication goes up as a note.
      // HubSpot answered with a refusal, so nothing was created.
      if (plan.object === "communications" && [400, 403, 404].includes(status)) {
        plan = engagementFor(row, true);
        continue;
      }
      if (status === 0) {
        await mark(row.id, "uncertain", { error: message });
        return "uncertain";
      }
      if ((status === 429 || status >= 500) && row.hubspot_attempts + 1 < MAX_ATTEMPTS) {
        await mark(row.id, "pending", { error: message });
        return "retry";
      }
      await mark(row.id, "failed", { error: message });
      return "failed";
    }
  }
}

/** Watchdog retry path, after the deal sync has given deals their ids. */
export async function syncPendingActivities(limit = 25, request?: ActivityRequest): Promise<{ attempted: number; sent: number }> {
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled || !process.env.HUBSPOT_TOKEN) return { attempted: 0, sent: 0 };
  const rows = await query<{ id: string }>(
    `SELECT a.id FROM activity a JOIN deal d ON d.id = a.deal_id
      WHERE a.hubspot_sync_state = 'pending' AND d.hubspot_deal_id IS NOT NULL
      ORDER BY a.id LIMIT $1`,
    [limit],
  ).catch(() => []);
  let sent = 0;
  for (const row of rows) {
    if ((await pushActivityToHubSpot(Number(row.id), request)) === "sent") sent++;
  }
  return { attempted: rows.length, sent };
}
