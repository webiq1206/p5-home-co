/**
 * Records the team deleted in HubSpot.
 *
 * Owner decision, 17 November 2026: spam and junk leads are deleted in HubSpot
 * as a matter of routine, and that is never an integration failure. A deleted
 * deal is mirrored here (the P5 lead is closed as "Removed in HubSpot" and its
 * alerts stop), a deleted task is treated as dismissed, and nothing deleted is
 * ever recreated on its own. The one exception is a customer who writes in
 * again after the deletion: that is a new request, so HubSpot gets a deal
 * again (see `shouldRecreateDeal`).
 *
 * This replaces the earlier rule, which held every deleted deal or task as an
 * open "archive review" and reported the HubSpot integrations as failed until
 * the record was restored in HubSpot.
 */
import { isMissingRelation, query, transaction } from "../db.ts";
import { ensureP5HubSpotPortal } from "./hubspot-portal.ts";

export const REMOVED_IN_HUBSPOT = "Removed in HubSpot";

/** Thrown where a HubSpot deal or task the caller asked for has been deleted there. */
export class HubSpotRemovedError extends Error {
  readonly objectType: "deals" | "tasks";
  readonly remoteId: string;
  constructor(objectType: "deals" | "tasks", remoteId: string) {
    super(`removed_in_hubspot:${objectType}`);
    this.name = "HubSpotRemovedError";
    this.objectType = objectType;
    this.remoteId = remoteId;
  }
}

type Closing = { reason: string; action: string; detail: Record<string, unknown> };

/**
 * Close a lead that was removed in HubSpot or QuickBooks and quiet everything
 * that would keep asking someone to act on it. The lead and its history stay
 * in P5. A deal the team had already won stays won: deleting it elsewhere is
 * housekeeping, not a lost sale. Returns false when the lead does not exist.
 */
async function closeLocally(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, id: number, closing: Closing): Promise<void> {
  await client.query(
    `UPDATE deal SET
       stage=CASE WHEN stage='Closed Won' THEN stage ELSE 'Closed Lost' END,
       closed_lost_reason=CASE WHEN stage='Closed Won' THEN closed_lost_reason
                               ELSE COALESCE(NULLIF(btrim(closed_lost_reason),''),$2) END,
       closed_at=COALESCE(closed_at,now()),
       next_action=CASE WHEN stage='Closed Won' THEN next_action ELSE NULL END,
       next_action_at=CASE WHEN stage='Closed Won' THEN next_action_at ELSE NULL END,
       integration_sync_status='synced', last_integration_error=NULL,
       hubspot_sync_lease_until=NULL, updated_at=now()
     WHERE id=$1`,
    [id, closing.reason],
  );
  // Nothing is left to do for this lead, so its alerts and tasks are settled.
  await client.query(
    `UPDATE alert SET acknowledged_at=COALESCE(acknowledged_at,now())
      WHERE resolved_at IS NULL AND incident_id IN (SELECT id FROM lead_alert_incident WHERE deal_id=$1)`,
    [id],
  );
  await client.query(
    `UPDATE lead_alert_incident SET
       acknowledged_at=COALESCE(acknowledged_at,now()),
       acknowledgement_source=COALESCE(acknowledgement_source,$2),
       task_completed_at=COALESCE(task_completed_at,now()), last_error=NULL
     WHERE deal_id=$1 AND task_completed_at IS NULL`,
    [id, closing.action],
  );
  await client.query("UPDATE hubspot_lead_review SET released_at=COALESCE(released_at,now()),last_checked_at=now() WHERE deal_id=$1 AND released_at IS NULL", [id]);
  await client.query("DELETE FROM lead_hubspot_retry WHERE deal_id=$1", [id]);
  await client.query(
    `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value)
     VALUES ('deal',$1,$2,'integration','hubspot',$3::jsonb)`,
    [String(id), closing.action, JSON.stringify(closing.detail)],
  );
}

/** Close a lead removed somewhere other than HubSpot (QuickBooks). See leads/removed-everywhere.ts. */
export async function closeRemovedLead(dealId: number, reason: string, action: string, detail: Record<string, unknown>): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT id FROM deal WHERE id=$1 FOR UPDATE", [dealId]);
    await closeLocally(client, dealId, { reason, action, detail });
  });
}

/**
 * The P5 lead whose HubSpot deal is gone.
 *
 * Deleted: the lead is closed as "Removed in HubSpot" and, for a deletion
 * noticed now (`carry`), what the estimator put in QuickBooks for it goes too.
 * Merged: the team merged two deals in HubSpot, which also archives one of
 * them. That is not a deletion. The lead follows the surviving deal, or, when
 * another lead already has that deal, closes as a duplicate; QuickBooks is
 * left alone either way.
 *
 * Returns the P5 deal id, or null when no P5 lead points at that HubSpot deal.
 */
export async function mirrorRemovedDeal(hubspotDealId: string, options: { carry?: boolean } = {}): Promise<number | null> {
  const carry = options.carry ?? true;
  const survivor = await mergedInto(hubspotDealId);
  let fresh = false;
  const dealId = await transaction(async (client) => {
    const found = await client.query<{ id: string; stage: string }>(
      "SELECT id,stage FROM deal WHERE hubspot_deal_id=$1 FOR UPDATE",
      [hubspotDealId],
    );
    const row = found.rows[0];
    if (!row) return null;
    const id = Number(row.id);
    const wasOpen = row.stage !== "Closed Won" && row.stage !== "Closed Lost";

    if (survivor) {
      const taken = await client.query("SELECT 1 FROM deal WHERE hubspot_deal_id=$1 AND id<>$2", [survivor, id]);
      if (!taken.rows.length) {
        // Follow the deal the team kept. Pending, so the next sync refreshes it.
        await client.query(
          "UPDATE deal SET hubspot_deal_id=$2, integration_sync_status='pending', last_integration_error=NULL, updated_at=now() WHERE id=$1",
          [id, survivor],
        );
        await client.query(
          `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value)
           VALUES ('deal',$1,'hubspot_deal_merged','integration','hubspot',$2::jsonb)`,
          [String(id), JSON.stringify({ from: hubspotDealId, into: survivor })],
        );
        return id;
      }
      await closeLocally(client, id, { reason: MERGED_IN_HUBSPOT, action: "hubspot_deal_merged", detail: { from: hubspotDealId, into: survivor, duplicate: true } });
      return id;
    }

    // Already mirrored for this HubSpot deal: only make sure nothing is left
    // waiting to be sent. The audit trail gets one entry per deletion, not
    // one per pass that notices it again.
    const already = await client.query(
      `SELECT 1 FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action='hubspot_deal_removed'
         AND new_value->>'hubspotDealId'=$2 LIMIT 1`,
      [String(id), hubspotDealId],
    );
    if (already.rows.length && !wasOpen) {
      await client.query(
        `UPDATE deal SET integration_sync_status='synced', last_integration_error=NULL, hubspot_sync_lease_until=NULL
          WHERE id=$1 AND (integration_sync_status<>'synced' OR last_integration_error IS NOT NULL)`,
        [id],
      );
      return id;
    }
    await closeLocally(client, id, { reason: REMOVED_IN_HUBSPOT, action: "hubspot_deal_removed", detail: { hubspotDealId, closedLocally: wasOpen } });
    fresh = true;
    return id;
  });
  await settleArchiveReview("deals", hubspotDealId);
  // Deletions carry across both systems (owner, 17 November 2026). Loaded on
  // demand, and a QuickBooks problem never undoes or fails the mirror: it is
  // noted on the lead and retried by the watchdog.
  if (dealId !== null && fresh && carry) {
    try {
      const everywhere = await import("../leads/removed-everywhere.ts");
      await everywhere.removeLeadFromQuickBooks(dealId);
    } catch (error) {
      console.error("[hubspot] QuickBooks was not cleaned up after a deal was deleted:", (error as Error).message);
    }
  }
  return dealId;
}

export const MERGED_IN_HUBSPOT = "Merged into another deal in HubSpot";

async function hubspotFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return null;
  // Never read or write any portal but P5's (hubspot-portal.ts).
  await ensureP5HubSpotPortal(token);
  return fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * The deal this one was merged into, or null. HubSpot lists the ids a deal
 * absorbed in `hs_merged_object_ids`. Any doubt (no token, an error, an odd
 * answer) reads as "not merged": the caller then treats the deal as deleted,
 * which is what a 404 on a deal nearly always is.
 */
export async function mergedInto(hubspotDealId: string): Promise<string | null> {
  try {
    const response = await hubspotFetch("/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "hs_merged_object_ids", operator: "CONTAINS_TOKEN", value: hubspotDealId }] }],
        properties: ["hs_merged_object_ids"], limit: 2,
      }),
    });
    if (!response?.ok) return null;
    const body = await response.json() as { results?: { id?: string; properties?: { hs_merged_object_ids?: string | null } }[] };
    const match = (body.results ?? []).find((deal) =>
      String(deal.properties?.hs_merged_object_ids ?? "").split(";").map((part) => part.trim()).includes(hubspotDealId));
    return match?.id && match.id !== hubspotDealId ? String(match.id) : null;
  } catch {
    return null;
  }
}

/**
 * Delete (HubSpot: archive) a deal or contact. True when it was removed or was
 * already gone. HubSpot keeps archived records restorable for 90 days.
 */
export async function archiveInHubSpot(objectType: "deals" | "contacts", id: string): Promise<boolean> {
  const response = await hubspotFetch(`/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response) return false;
  if (response.ok || response.status === 404) return true;
  throw new Error(`HubSpot would not delete the ${objectType === "deals" ? "deal" : "contact"} (HTTP ${response.status}).`);
}

/** Does this contact still have a deal? Any doubt answers yes, so a contact is never deleted on a guess. */
export async function contactHasOtherDeals(contactId: string): Promise<boolean> {
  try {
    const response = await hubspotFetch(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/deals?limit=5`);
    if (!response?.ok) return true;
    const body = await response.json() as { results?: unknown[] };
    return (body.results ?? []).length > 0;
  } catch {
    return true;
  }
}

/** A task someone deleted in HubSpot is dismissed: never recreated, never an error. */
export async function dismissRemovedTask(hubspotTaskId: string): Promise<void> {
  await transaction(async (client) => {
    const found = await client.query<{ id: string }>(
      `UPDATE lead_alert_incident SET
         acknowledged_at=COALESCE(acknowledged_at,now()),
         acknowledgement_source=COALESCE(acknowledgement_source,'hubspot_task_removed'),
         task_completed_at=COALESCE(task_completed_at,now()), last_error=NULL
       WHERE hubspot_task_id=$1 RETURNING id`,
      [hubspotTaskId],
    );
    for (const row of found.rows) {
      await client.query(
        "UPDATE alert SET acknowledged_at=COALESCE(acknowledged_at,now()) WHERE incident_id=$1 AND resolved_at IS NULL",
        [row.id],
      );
    }
  });
  await settleArchiveReview("tasks", hubspotTaskId);
}

/** Close a review the earlier rule left open. The table predates this module; a missing table is fine. */
async function settleArchiveReview(objectType: "deals" | "tasks", remoteId: string): Promise<void> {
  try {
    await query(
      `UPDATE hubspot_archive_review SET restored_at=now(),last_checked_at=now()
        WHERE object_type=$1 AND remote_id=$2 AND restored_at IS NULL`,
      [objectType, remoteId],
    );
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
  }
}

/**
 * Settle every review the earlier rule left open, without calling HubSpot:
 * each one was only ever written after HubSpot confirmed the record deleted.
 * Bounded so one pass cannot run long.
 */
export async function settleOpenArchiveReviews(limit = 200): Promise<number> {
  let rows: { object_type: "deals" | "tasks"; remote_id: string }[];
  try {
    rows = await query(
      "SELECT object_type,remote_id FROM hubspot_archive_review WHERE restored_at IS NULL ORDER BY confirmed_at,object_type,remote_id LIMIT $1",
      [limit],
    );
  } catch (error) {
    if (isMissingRelation(error)) return 0;
    throw error;
  }
  for (const row of rows) {
    // These deletions are old news: mirror them here, but never reach into
    // QuickBooks for something deleted before deletions carried across.
    if (row.object_type === "deals") await mirrorRemovedDeal(row.remote_id, { carry: false });
    else await dismissRemovedTask(row.remote_id);
  }
  return rows.length;
}

/**
 * The HubSpot deal for this lead was deleted. Should a new one be made?
 * Only when the customer has written in since: after the deletion when HubSpot
 * says when that was, otherwise after the last time this lead reached HubSpot.
 * A lead nobody has heard from again stays deleted.
 */
export async function shouldRecreateDeal(dealId: number, archivedAt: Date | null): Promise<boolean> {
  const [latest] = await query<{ at: string | null }>(
    "SELECT max(received_at)::text AS at FROM lead_intake_submission WHERE deal_id=$1",
    [dealId],
  );
  if (!latest?.at) return false;
  const submitted = new Date(latest.at).getTime();
  if (archivedAt) return submitted > archivedAt.getTime();
  const [synced] = await query<{ at: string | null }>(
    "SELECT max(occurred_at)::text AS at FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action='hubspot_synced'",
    [String(dealId)],
  );
  return synced?.at ? submitted > new Date(synced.at).getTime() : false;
}
