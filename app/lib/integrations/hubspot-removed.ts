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

/**
 * Close the P5 lead whose HubSpot deal was deleted, and quiet everything that
 * would keep asking someone to act on it. The lead and its history stay in P5.
 * Returns the P5 deal id, or null when no P5 lead points at that HubSpot deal.
 */
export async function mirrorRemovedDeal(hubspotDealId: string): Promise<number | null> {
  const dealId = await transaction(async (client) => {
    const found = await client.query<{ id: string; stage: string }>(
      "SELECT id,stage FROM deal WHERE hubspot_deal_id=$1 FOR UPDATE",
      [hubspotDealId],
    );
    const row = found.rows[0];
    if (!row) return null;
    const id = Number(row.id);
    const wasOpen = row.stage !== "Closed Won" && row.stage !== "Closed Lost";
    // A deal the team had already won stays won: deleting it in HubSpot is
    // housekeeping there, not a lost sale. Anything still open is closed.
    await client.query(
      `UPDATE deal SET
         stage=CASE WHEN stage='Closed Won' THEN stage ELSE 'Closed Lost' END,
         closed_lost_reason=CASE WHEN stage='Closed Won' THEN closed_lost_reason
                                 ELSE COALESCE(NULLIF(btrim(closed_lost_reason),''),$2) END,
         closed_at=COALESCE(closed_at,now()),
         next_action=NULL, next_action_at=NULL,
         integration_sync_status='synced', last_integration_error=NULL,
         hubspot_sync_lease_until=NULL, updated_at=now()
       WHERE id=$1`,
      [id, REMOVED_IN_HUBSPOT],
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
         acknowledgement_source=COALESCE(acknowledgement_source,'hubspot_deal_removed'),
         task_completed_at=COALESCE(task_completed_at,now()), last_error=NULL
       WHERE deal_id=$1 AND task_completed_at IS NULL`,
      [id],
    );
    await client.query("UPDATE hubspot_lead_review SET released_at=COALESCE(released_at,now()),last_checked_at=now() WHERE deal_id=$1 AND released_at IS NULL", [id]);
    await client.query("DELETE FROM lead_hubspot_retry WHERE deal_id=$1", [id]);
    await client.query(
      `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value)
       VALUES ('deal',$1,'hubspot_deal_removed','integration','hubspot',$2::jsonb)`,
      [String(id), JSON.stringify({ hubspotDealId, closedLocally: wasOpen })],
    );
    return id;
  });
  await settleArchiveReview("deals", hubspotDealId);
  return dealId;
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
    if (row.object_type === "deals") await mirrorRemovedDeal(row.remote_id);
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
