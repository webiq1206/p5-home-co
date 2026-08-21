/**
 * The five-minute watchdog.
 *
 * Runs on a schedule, stays silent unless something needs action, and is safe
 * to run twice: alerts are deduplicated by a partial unique index, and every
 * write is an idempotent upsert. A job that merely ran is not a success, so
 * each pass records what it actually processed.
 */

import { randomUUID } from "node:crypto";

import { isUniqueViolation, query, transaction } from "../db.ts";
import { dispatchNotifications } from "../notifications/dispatch.ts";
import { syncPendingDeals } from "../integrations/hubspot.ts";
import { evaluateDeal, type DealEvaluation, type DealSnapshot } from "./rules.ts";
import { loadSettings, type LeadManagerSettings } from "./settings.ts";
import type { DealStage } from "./types.ts";

export type WatchdogSummary = {
  jobRunId: number | null;
  status: "succeeded" | "failed" | "skipped_locked";
  dealsProcessed: number;
  alertsRaised: number;
  alertsResolved: number;
  slaUpdates: number;
  /** HubSpot deals pushed this pass. Zero when the integration is off. */
  hubspotSynced: number;
  hubspotFailed: number;
  /** Alert emails sent this pass. */
  notificationsSent: number;
  notificationsFailed: number;
  error?: string;
};

const JOB_NAME = "watchdog";
/** Long enough to cover a slow pass, short enough that a crash self-heals. */
const LOCK_TTL_MS = 4 * 60 * 1000;

/**
 * Take the job lock.
 *
 * A single conditional upsert, so two instances starting at the same instant
 * cannot both win. An expired lock is reclaimed, which means a crashed run
 * never wedges the schedule permanently.
 */
async function acquireLock(owner: string): Promise<boolean> {
  const rows = await query<{ locked_by: string }>(
    `INSERT INTO job_lock (job_name, locked_by, expires_at)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)
     ON CONFLICT (job_name) DO UPDATE
       SET locked_by = EXCLUDED.locked_by,
           locked_at = now(),
           expires_at = EXCLUDED.expires_at
     WHERE job_lock.expires_at <= now()
     RETURNING locked_by`,
    [JOB_NAME, owner, String(LOCK_TTL_MS)],
  );
  return rows.length > 0 && rows[0].locked_by === owner;
}

async function releaseLock(owner: string): Promise<void> {
  await query("DELETE FROM job_lock WHERE job_name = $1 AND locked_by = $2", [JOB_NAME, owner]);
}

type DealRow = {
  id: string;
  stage: DealStage;
  owner_user_id: string | null;
  received_at: string;
  first_attempt_at: string | null;
  first_two_way_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  appointment_at: string | null;
  snoozed_until: string | null;
  closed_lost_reason: string | null;
  last_activity_at: string | null;
  client_waiting_since: string | null;
  sla_status: string;
  escalation_tier: string;
};

function toSnapshot(row: DealRow): DealSnapshot {
  const date = (v: string | null) => (v ? new Date(v) : null);
  return {
    id: Number(row.id),
    stage: row.stage,
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    receivedAt: new Date(row.received_at),
    firstAttemptAt: date(row.first_attempt_at),
    firstTwoWayAt: date(row.first_two_way_at),
    nextAction: row.next_action,
    nextActionAt: date(row.next_action_at),
    appointmentAt: date(row.appointment_at),
    snoozedUntil: date(row.snoozed_until),
    closedLostReason: row.closed_lost_reason,
    lastActivityAt: date(row.last_activity_at),
    clientWaitingSince: date(row.client_waiting_since),
  };
}

/**
 * Load open deals plus recently closed ones.
 *
 * Closed deals are included briefly so a Closed Lost missing its reason is
 * still caught, and so alerts on a deal that just closed get resolved.
 */
async function loadDeals(): Promise<DealRow[]> {
  return query<DealRow>(
    `SELECT d.id, d.stage, d.owner_user_id, d.received_at, d.first_attempt_at,
            d.first_two_way_at, d.next_action, d.next_action_at, d.appointment_at,
            d.snoozed_until, d.closed_lost_reason, d.sla_status, d.escalation_tier,
            (SELECT max(a.occurred_at) FROM activity a WHERE a.deal_id = d.id) AS last_activity_at,
            (SELECT CASE WHEN a.direction = 'inbound' THEN a.occurred_at END
               FROM activity a
              WHERE a.deal_id = d.id AND a.direction IS NOT NULL
              ORDER BY a.occurred_at DESC LIMIT 1) AS client_waiting_since
       FROM deal d
      WHERE d.stage NOT IN ('Closed Won','Closed Lost')
         OR d.closed_at > now() - interval '7 days'`,
  );
}

/**
 * Reconcile stored state with the evaluation.
 *
 * Raises alerts that are newly true, resolves alerts whose condition has
 * cleared, and updates the deal's SLA columns. Returns counters describing
 * what genuinely changed, which is what makes "the job ran" distinguishable
 * from "the job did something".
 */
async function applyEvaluation(
  evaluation: DealEvaluation,
  stored: { slaStatus: string; escalationTier: string },
  settings: LeadManagerSettings,
): Promise<{ raised: number; resolved: number; slaUpdated: number }> {
  let raised = 0;
  let resolved = 0;
  let slaUpdated = 0;

  await transaction(async (client) => {
    // Deferred integrations must never contribute an alert while their flags
    // are off. Findings are filtered defensively as well as at the source.
    const activeKinds = new Set(
      evaluation.findings
        .filter((f) => !/^(handoff|quickbooks)_/.test(f.kind))
        .map((f) => f.kind),
    );

    for (const finding of evaluation.findings) {
      if (!activeKinds.has(finding.kind)) continue;
      try {
        const { rowCount } = await client.query(
          `INSERT INTO alert (deal_id, kind, tier, reason)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (deal_id, kind, tier) WHERE resolved_at IS NULL DO NOTHING`,
          [evaluation.dealId, finding.kind, finding.tier, finding.reason],
        );
        if (rowCount) raised += rowCount;
      } catch (error) {
        // Concurrent pass won the race; the alert exists, which is the goal.
        if (!isUniqueViolation(error)) throw error;
      }
    }

    // Resolve open alerts whose condition no longer holds. Escalation to a new
    // tier resolves the lower tier, so the board shows one current severity.
    const { rows: openAlerts } = await client.query<{ id: string; kind: string; tier: string }>(
      "SELECT id, kind, tier FROM alert WHERE deal_id = $1 AND resolved_at IS NULL",
      [evaluation.dealId],
    );
    for (const open of openAlerts) {
      const stillTrue = evaluation.findings.some(
        (f) => f.kind === open.kind && f.tier === open.tier,
      );
      if (!stillTrue) {
        await client.query("UPDATE alert SET resolved_at = now() WHERE id = $1", [open.id]);
        resolved += 1;
      }
    }

    if (
      stored.slaStatus !== evaluation.slaStatus ||
      stored.escalationTier !== evaluation.escalationTier
    ) {
      await client.query(
        "UPDATE deal SET sla_status = $2, escalation_tier = $3, updated_at = now() WHERE id = $1",
        [evaluation.dealId, evaluation.slaStatus, evaluation.escalationTier],
      );
      slaUpdated = 1;

      await client.query(
        `INSERT INTO audit_log
           (record_type, record_id, action, previous_value, new_value, action_source)
         VALUES ('deal',$1,'sla_state_changed',$2::jsonb,$3::jsonb,'rules_engine')`,
        [
          String(evaluation.dealId),
          JSON.stringify(stored),
          JSON.stringify({
            slaStatus: evaluation.slaStatus,
            escalationTier: evaluation.escalationTier,
            responseMinutes: evaluation.responseMinutes,
          }),
        ],
      );
    }

    void settings;
  });

  return { raised, resolved, slaUpdated };
}

/**
 * Run one watchdog pass.
 *
 * Returns a summary rather than throwing, so the scheduler always gets a
 * response it can record. Failures are written to job_run and surfaced on the
 * integration-health screen.
 */
export async function runWatchdog(now: Date = new Date()): Promise<WatchdogSummary> {
  const owner = randomUUID();

  if (!(await acquireLock(owner))) {
    return {
      jobRunId: null,
      status: "skipped_locked",
      dealsProcessed: 0,
      alertsRaised: 0,
      alertsResolved: 0,
      slaUpdates: 0,
      hubspotSynced: 0,
      hubspotFailed: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    };
  }

  const started = await query<{ id: string }>(
    "INSERT INTO job_run (job_name) VALUES ($1) RETURNING id",
    [JOB_NAME],
  );
  const jobRunId = Number(started[0].id);

  let dealsProcessed = 0;
  let alertsRaised = 0;
  let alertsResolved = 0;
  let slaUpdates = 0;

  try {
    const settings = await loadSettings();
    const rows = await loadDeals();

    for (const row of rows) {
      const evaluation = evaluateDeal(toSnapshot(row), settings, now);
      const counts = await applyEvaluation(
        evaluation,
        { slaStatus: row.sla_status, escalationTier: row.escalation_tier },
        settings,
      );
      dealsProcessed += 1;
      alertsRaised += counts.raised;
      alertsResolved += counts.resolved;
      slaUpdates += counts.slaUpdated;
    }

    // Push anything pending or previously failed. Deliberately after the
    // rules pass, so a HubSpot outage can never delay alerting -- and
    // deliberately inside the try, so its failures land in job_run too.
    // syncPendingDeals is a no-op while the flag is off or the token absent.
    const hubspot = await syncPendingDeals();

    // Tell people. Last, because raising the alert correctly matters more
    // than delivering it quickly, and a mail outage must not stop the rules
    // engine from doing its job.
    const notified = await dispatchNotifications(now);

    await query(
      `UPDATE job_run
          SET finished_at = now(), status = 'succeeded',
              records_processed = $2, alerts_raised = $3, alerts_resolved = $4
        WHERE id = $1`,
      [jobRunId, dealsProcessed, alertsRaised, alertsResolved],
    );

    await query(
      `INSERT INTO integration_health (name, state, last_success_at, last_attempt_at, records_processed)
       VALUES ('watchdog','connected',now(),now(),$1)
       ON CONFLICT (name) DO UPDATE
         SET state='connected', last_success_at=now(), last_attempt_at=now(),
             records_processed=EXCLUDED.records_processed, last_error=NULL, updated_at=now()`,
      [dealsProcessed],
    );

    return {
      jobRunId,
      status: "succeeded",
      dealsProcessed,
      alertsRaised,
      alertsResolved,
      slaUpdates,
      hubspotSynced: hubspot.synced,
      hubspotFailed: hubspot.failed,
      notificationsSent: notified.sent,
      notificationsFailed: notified.failed,
    };
  } catch (error) {
    const message = (error as Error).message;
    await query(
      "UPDATE job_run SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1",
      [jobRunId, message],
    ).catch(() => undefined);
    await query(
      `INSERT INTO integration_health (name, state, last_attempt_at, last_error)
       VALUES ('watchdog','failed',now(),$1)
       ON CONFLICT (name) DO UPDATE
         SET state='failed', last_attempt_at=now(), last_error=EXCLUDED.last_error, updated_at=now()`,
      [message],
    ).catch(() => undefined);

    return {
      jobRunId,
      status: "failed",
      dealsProcessed,
      alertsRaised,
      alertsResolved,
      slaUpdates,
      hubspotSynced: 0,
      hubspotFailed: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
      error: message,
    };
  } finally {
    await releaseLock(owner).catch(() => undefined);
  }
}
