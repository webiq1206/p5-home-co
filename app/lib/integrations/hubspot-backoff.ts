import { query } from "../db.ts";

export function hubspotRetryDelaySeconds(attempt: number): number {
  return Math.min(6 * 60 * 60, 60 * 2 ** Math.min(12, Math.max(0, attempt - 1)));
}
export async function hubspotRetryDue(dealId: number): Promise<boolean> {
  const rows = await query<{ due: boolean }>(
    "SELECT next_attempt_at <= now() AS due FROM lead_hubspot_retry WHERE deal_id=$1", [dealId],
  );
  return !rows.length || rows[0].due;
}
export async function recordHubspotFailure(dealId: number): Promise<void> {
  await query(
    `INSERT INTO lead_hubspot_retry (deal_id,attempts,next_attempt_at,last_category)
     VALUES ($1,1,now()+interval '1 minute','HubSpot sync failed')
     ON CONFLICT (deal_id) DO UPDATE SET attempts=lead_hubspot_retry.attempts+1,
       next_attempt_at=now()+make_interval(secs => LEAST(21600,60*power(2,LEAST(12,lead_hubspot_retry.attempts)))::int),
       last_category='HubSpot sync failed',updated_at=now()`, [dealId],
  );
}
export async function clearHubspotBackoff(dealId: number): Promise<void> {
  await query("DELETE FROM lead_hubspot_retry WHERE deal_id=$1", [dealId]);
}
