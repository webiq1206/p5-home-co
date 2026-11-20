/**
 * Sending the Google review request (owner decision, 20 November 2026).
 * The words and the pure rules are in reviewRequest.ts.
 *
 * When: the moment the platform records a job complete, which is the paid in
 * full path of stage alignment (`askForReviewWhenComplete()` in
 * stage-alignment.ts, beside `completeJobInHubSpot()`): the lead is Closed
 * Won and its website estimate is paid in full. That path runs again for
 * every later invoice or payment, so everything here is once per lead.
 *
 *   1. Queued: one `review_request_queued` audit row, due
 *      `REVIEW_REQUEST_DELAY_HOURS` later (default 24). With 0 it is sent on
 *      the spot.
 *   2. Sent by the five-minute watchdog (`settleReviewRequests()`) once due.
 *      Every rule is checked again first: a lead reopened, removed, merged or
 *      left without an address in the meantime is skipped, not emailed.
 *   3. Once per lead, whatever happens: a `review_request_sending` row is
 *      written under the lead's row lock before the email leaves, and a lead
 *      with one and no recorded outcome is never tried again (a crash between
 *      the two could otherwise send twice). A failed send is retried six
 *      hours apart, three tries at most. `review_request_sent` is the record.
 *
 * `REVIEW_REQUEST` must be "on": off (the default) means nothing is queued and
 * nothing is sent, including anything queued before it was turned off. A
 * request more than a fortnight overdue is skipped, not sent late. Nothing
 * here throws into a caller.
 */

import { query, queryOne, transaction } from "../db.ts";
import { activeTransport, type Transport } from "../notifications/transport.ts";
import { normalizeEmail } from "./normalize.ts";
import { reviewRequestBlocker, reviewRequestDelayHours, reviewRequestEmail, reviewRequestEnabled, type ReviewLead } from "./reviewRequest.ts";

export const REVIEW_QUEUED = "review_request_queued";
export const REVIEW_SENDING = "review_request_sending";
export const REVIEW_SENT = "review_request_sent";
export const REVIEW_FAILED = "review_request_failed";
export const REVIEW_SKIPPED = "review_request_skipped";

const MAX_ATTEMPTS = 3;
const RETRY_HOURS = 6;
const LATE_DAYS = 14;

type LeadRow = {
  stage: string | null; closed_lost_reason: string | null; brand: string | null; original_form: string | null;
  first_name: string | null; last_name: string | null; email: string | null; removed: boolean;
};

const REMOVAL_REASONS = ["Removed in HubSpot", "Merged into another deal in HubSpot", "Removed in QuickBooks"];

/** The lead as the rules see it. A won deal deleted or merged elsewhere stays won, so removal is read from its audit trail too. */
async function loadLead(dealId: number): Promise<(ReviewLead & { brand: string | null }) | null> {
  const row = await queryOne<LeadRow>(
    `SELECT d.stage, d.closed_lost_reason, d.brand, d.original_form, c.first_name, c.last_name, c.email,
            (d.closed_lost_reason = ANY($2::text[]) OR EXISTS (
               SELECT 1 FROM audit_log a WHERE a.record_type='deal' AND a.record_id=$3
                  AND (a.action IN ('hubspot_deal_removed','quickbooks_estimate_removed')
                       OR (a.action='hubspot_deal_merged' AND a.new_value->>'duplicate'='true')))) AS removed
       FROM deal d JOIN contact c ON c.id = d.contact_id WHERE d.id = $1`,
    [dealId, REMOVAL_REASONS, String(dealId)],
  );
  if (!row) return null;
  return {
    stage: row.stage, originalForm: row.original_form, firstName: row.first_name, lastName: row.last_name,
    email: row.email, removed: Boolean(row.removed), brand: row.brand,
  };
}

async function audit(dealId: number, action: string, detail: Record<string, unknown>, failure: string | null = null): Promise<void> {
  await query(
    `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value,succeeded,error)
     VALUES ('deal',$1,$2,'job','email',$3::jsonb,$4,$5)`,
    [String(dealId), action, JSON.stringify(detail), failure === null, failure?.slice(0, 300) ?? null],
  );
}

/** A skip is noted once per reason, however often the paid path notices the lead again. */
async function noteSkipped(dealId: number, reason: string): Promise<void> {
  const last = await queryOne<{ reason: string | null }>(
    `SELECT new_value->>'reason' AS reason FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action=$2 ORDER BY id DESC LIMIT 1`,
    [String(dealId), REVIEW_SKIPPED],
  );
  if (last?.reason === reason) return;
  await audit(dealId, REVIEW_SKIPPED, { reason });
}

async function hasRow(dealId: number, actions: string[]): Promise<boolean> {
  return Boolean(await queryOne(
    "SELECT 1 FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action = ANY($2::text[]) LIMIT 1",
    [String(dealId), actions],
  ));
}

export type ScheduleOutcome = "off" | "already" | "skipped" | "queued" | SendOutcome;

/**
 * The job is complete: queue the lead's review request, once. Called by the
 * paid in full path only after it has confirmed the lead is Closed Won and
 * paid. `now` and `transport` are for tests.
 */
export async function scheduleReviewRequest(
  dealId: number,
  detail: Record<string, unknown> = {},
  options: { now?: Date; transport?: Transport } = {},
): Promise<ScheduleOutcome> {
  try {
    if (!reviewRequestEnabled()) return "off";
    if (await hasRow(dealId, [REVIEW_QUEUED, REVIEW_SENDING, REVIEW_SENT])) return "already";
    const lead = await loadLead(dealId);
    const blocker = lead ? reviewRequestBlocker(lead) : "The lead was not found.";
    if (blocker) {
      if (lead) await noteSkipped(dealId, blocker);
      return "skipped";
    }
    const now = options.now ?? new Date();
    const delayHours = reviewRequestDelayHours();
    const dueAt = new Date(now.getTime() + delayHours * 3_600_000);
    const queued = await transaction(async (client) => {
      await client.query("SELECT id FROM deal WHERE id = $1 FOR UPDATE", [dealId]);
      const exists = await client.query(
        "SELECT 1 FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action = ANY($2::text[]) LIMIT 1",
        [String(dealId), [REVIEW_QUEUED, REVIEW_SENDING, REVIEW_SENT]],
      );
      if (exists.rows.length) return false;
      await client.query(
        `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value)
         VALUES ('deal',$1,$2,'job','email',$3::jsonb)`,
        [String(dealId), REVIEW_QUEUED, JSON.stringify({ dueAt: dueAt.toISOString(), delayHours, brand: lead?.brand ?? null, ...detail })],
      );
      return true;
    });
    if (!queued) return "already";
    if (delayHours === 0) return await sendReviewRequest(dealId, options);
    return "queued";
  } catch (error) {
    console.error("[review-request] not queued:", (error as Error).message);
    return "skipped";
  }
}

export type SendOutcome = "off" | "sent" | "failed" | "already" | "skipped";

/**
 * Send one lead's review request now, if every rule still holds and it has
 * never been sent. Claims the send under the lead's row lock first.
 */
export async function sendReviewRequest(dealId: number, options: { now?: Date; transport?: Transport } = {}): Promise<SendOutcome> {
  try {
    if (!reviewRequestEnabled()) return "off";
    const lead = await loadLead(dealId);
    const blocker = lead ? reviewRequestBlocker(lead) : "The lead was not found.";
    if (blocker || !lead) {
      if (lead && blocker) await noteSkipped(dealId, blocker);
      return "skipped";
    }
    const email = normalizeEmail(lead.email);
    if (!email) return "skipped";
    const message = reviewRequestEmail({ firstName: lead.firstName, brandName: lead.brand });

    const claim = await transaction(async (client) => {
      await client.query("SELECT id FROM deal WHERE id = $1 FOR UPDATE", [dealId]);
      const counts = await client.query<{ action: string; n: number }>(
        `SELECT action, count(*)::int AS n FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action = ANY($2::text[]) GROUP BY action`,
        [String(dealId), [REVIEW_SENT, REVIEW_SENDING, REVIEW_FAILED]],
      );
      const n = (action: string) => counts.rows.find((row) => row.action === action)?.n ?? 0;
      if (n(REVIEW_SENT) > 0) return "already" as const;
      // An attempt with no recorded outcome may have reached the customer: never risk a second email.
      if (n(REVIEW_SENDING) > n(REVIEW_FAILED)) return "already" as const;
      if (n(REVIEW_FAILED) >= MAX_ATTEMPTS) return "skipped" as const;
      await client.query(
        `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value)
         VALUES ('deal',$1,$2,'job','email',$3::jsonb)`,
        [String(dealId), REVIEW_SENDING, JSON.stringify({ attempt: n(REVIEW_SENDING) + 1 })],
      );
      return "claimed" as const;
    });
    if (claim !== "claimed") return claim;

    const transport = options.transport ?? activeTransport();
    let sent: Awaited<ReturnType<Transport["send"]>>;
    try {
      sent = await transport.send(email, message);
    } catch (error) {
      sent = { ok: false, error: (error as Error).message };
    }
    if (!sent.ok) {
      await audit(dealId, REVIEW_FAILED, { subject: message.subject, transport: transport.name }, sent.error || "The email was not sent.");
      return "failed";
    }
    await audit(dealId, REVIEW_SENT, { subject: message.subject, brand: lead.brand, transport: transport.name });
    return "sent";
  } catch (error) {
    console.error("[review-request] not sent:", (error as Error).message);
    return "failed";
  }
}

/**
 * The watchdog's pass: send every queued request that is due and not yet
 * sent, a few per pass. A failure waits six hours; one overdue by more than a
 * fortnight (the switch was off, mail was down) is skipped, not sent late.
 */
export async function settleReviewRequests(options: { limit?: number; now?: Date; transport?: Transport } = {}): Promise<{ attempted: number; sent: number }> {
  if (!reviewRequestEnabled()) return { attempted: 0, sent: 0 };
  const now = options.now ?? new Date();
  const rows = await query<{ deal_id: string; due_at: string }>(
    `WITH due AS (
       SELECT q.record_id, min(q.new_value->>'dueAt') AS due_at, min(q.occurred_at) AS queued_at
         FROM audit_log q
        WHERE q.record_type='deal' AND q.action=$1 AND (q.new_value->>'dueAt')::timestamptz <= $2::timestamptz
        GROUP BY q.record_id
     ), tally AS (
       SELECT d.record_id, d.due_at,
              count(*) FILTER (WHERE a.action=$3) AS sent,
              count(*) FILTER (WHERE a.action=$4 AND a.occurred_at >= d.queued_at) AS skipped,
              count(*) FILTER (WHERE a.action=$5) AS sending,
              count(*) FILTER (WHERE a.action=$6) AS failed,
              max(a.occurred_at) FILTER (WHERE a.action=$6) AS failed_at
         FROM due d LEFT JOIN audit_log a ON a.record_type='deal' AND a.record_id=d.record_id AND a.action IN ($3,$4,$5,$6)
        GROUP BY d.record_id, d.due_at
     )
     SELECT record_id AS deal_id, due_at FROM tally
      WHERE sent = 0 AND skipped = 0 AND sending <= failed AND failed < $7
        AND (failed_at IS NULL OR failed_at <= $2::timestamptz - make_interval(hours => $8::int))
      ORDER BY due_at LIMIT $9`,
    [REVIEW_QUEUED, now.toISOString(), REVIEW_SENT, REVIEW_SKIPPED, REVIEW_SENDING, REVIEW_FAILED, MAX_ATTEMPTS, RETRY_HOURS, options.limit ?? 10],
  );
  let attempted = 0;
  let sent = 0;
  for (const row of rows) {
    const dealId = Number(row.deal_id);
    if (now.getTime() - new Date(row.due_at).getTime() > LATE_DAYS * 86_400_000) {
      await noteSkipped(dealId, "The request was more than a fortnight overdue, so it was not sent late.").catch(() => undefined);
      continue;
    }
    attempted++;
    if ((await sendReviewRequest(dealId, { now, transport: options.transport })) === "sent") sent++;
  }
  return { attempted, sent };
}
