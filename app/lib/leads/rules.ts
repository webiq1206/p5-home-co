/**
 * The always-on rules engine.
 *
 * Deterministic by design. AI is never asked whether a deadline has passed;
 * every judgement here is arithmetic over stored timestamps, so the same deal
 * evaluated twice yields the same answer, and a watchdog pass that runs twice
 * changes nothing the second time.
 *
 * Pure functions only. The runner that reads and writes the database lives
 * elsewhere, which is what makes these rules testable without a database.
 */

import {
  addBusinessMinutes,
  businessMinutesBetween,
  escalationTierFor,
  isWithinBusinessHours,
  nextBusinessOpening,
  type EscalationTier,
} from "./time.ts";
import type { LeadManagerSettings } from "./settings.ts";
import { isClosed, type DealStage, type SlaStatus } from "./types.ts";

/** The minimum a rule needs to know about a deal. */
export type DealSnapshot = {
  id: number;
  stage: DealStage;
  ownerUserId: number | null;
  receivedAt: Date;
  firstAttemptAt: Date | null;
  firstTwoWayAt: Date | null;
  nextAction: string | null;
  nextActionAt: Date | null;
  appointmentAt: Date | null;
  snoozedUntil: Date | null;
  closedLostReason: string | null;
  lastActivityAt: Date | null;
};

/** Where a lead appears on the Needs Your Attention screen. */
export type AttentionBucket =
  | "critical"
  | "needs_response"
  | "due_today"
  | "waiting_on_customer"
  | "upcoming"
  | "recently_completed"
  | "none";

/** One thing that is true about a deal and may warrant an alert. */
export type RuleFinding = {
  /** Stable identifier; also the alert dedup key. */
  kind: string;
  tier: EscalationTier;
  /** A sentence an employee can act on without training. */
  reason: string;
};

export type DealEvaluation = {
  dealId: number;
  slaStatus: SlaStatus;
  slaDeadline: Date | null;
  escalationTier: EscalationTier;
  /** Business minutes waited for the first human attempt. */
  responseMinutes: number;
  bucket: AttentionBucket;
  findings: RuleFinding[];
  /** The single clearest reason this deal needs attention, for the card. */
  headline: string | null;
};

const HOUR_MS = 3_600_000;

/** True when the deal is snoozed past `now`. */
function isSnoozed(deal: DealSnapshot, now: Date): boolean {
  return deal.snoozedUntil !== null && deal.snoozedUntil.getTime() > now.getTime();
}

/** Local calendar day equality, evaluated in the business timezone. */
function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(a) === fmt.format(b);
}

/**
 * The response SLA deadline for a lead.
 *
 * Measured in business minutes from arrival, so a lead that lands at 9pm on a
 * Saturday is due shortly after Monday's opening rather than overnight.
 */
export function slaDeadlineFor(deal: DealSnapshot, settings: LeadManagerSettings): Date {
  return addBusinessMinutes(
    deal.receivedAt,
    settings.firstResponseTargetMinutes,
    settings.calendar,
  );
}

/**
 * Evaluate one deal against every rule.
 *
 * Returns the complete picture rather than a boolean, because the admin panel,
 * the alerting path, and the management reviews all need different slices of
 * the same evaluation and must never disagree with each other.
 */
export function evaluateDeal(
  deal: DealSnapshot,
  settings: LeadManagerSettings,
  now: Date,
): DealEvaluation {
  const findings: RuleFinding[] = [];
  const { calendar } = settings;

  // ---- Closed deals ------------------------------------------------------
  if (isClosed(deal.stage)) {
    if (deal.stage === "Closed Lost" && !deal.closedLostReason) {
      findings.push({
        kind: "closed_lost_missing_reason",
        tier: "none",
        reason: "Closed Lost with no reason recorded.",
      });
    }
    return {
      dealId: deal.id,
      slaStatus: "not_applicable",
      slaDeadline: null,
      escalationTier: "none",
      responseMinutes: 0,
      bucket: findings.length ? "needs_response" : "recently_completed",
      findings,
      headline: findings[0]?.reason ?? null,
    };
  }

  // ---- Response SLA ------------------------------------------------------
  const slaDeadline = slaDeadlineFor(deal, settings);
  const answeredAt = deal.firstAttemptAt;

  let slaStatus: SlaStatus;
  let responseMinutes: number;
  let escalationTier: EscalationTier = "none";

  if (answeredAt) {
    responseMinutes = businessMinutesBetween(deal.receivedAt, answeredAt, calendar);
    slaStatus = answeredAt.getTime() <= slaDeadline.getTime() ? "met" : "breached";
  } else {
    responseMinutes = businessMinutesBetween(deal.receivedAt, now, calendar);
    escalationTier = escalationTierFor(responseMinutes, settings.escalation);

    if (!isWithinBusinessHours(now, calendar) && responseMinutes === 0) {
      // Arrived outside business hours and no business time has elapsed. The
      // response is scheduled, not late; an automatic acknowledgment would not
      // count as a human answer even if one were enabled.
      slaStatus = "after_hours";
      escalationTier = "none";
    } else if (now.getTime() > slaDeadline.getTime()) {
      slaStatus = "breached";
    } else if (responseMinutes >= settings.firstResponseTargetMinutes * 0.6) {
      slaStatus = "due_soon";
    } else {
      slaStatus = "on_track";
    }

    if (slaStatus === "breached") {
      findings.push({
        kind: "sla_breach",
        tier: escalationTier,
        reason:
          `No one has contacted this lead yet. ${responseMinutes} business ` +
          `${responseMinutes === 1 ? "minute" : "minutes"} since it arrived.`,
      });
    }
  }

  // ---- Ownership ---------------------------------------------------------
  if (deal.ownerUserId === null) {
    findings.push({
      kind: "missing_owner",
      tier: "owner_manager",
      reason: "No one owns this lead yet. Assign it.",
    });
  }

  // ---- Next action -------------------------------------------------------
  if (!deal.nextAction || !deal.nextActionAt) {
    findings.push({
      kind: "missing_next_action",
      tier: "none",
      reason: "This deal has no next action. Set one.",
    });
  } else if (deal.nextActionAt.getTime() < now.getTime()) {
    findings.push({
      kind: "next_action_overdue",
      tier: "none",
      reason: `Next action is overdue: ${deal.nextAction}.`,
    });
  }

  // ---- Stage-specific rules ---------------------------------------------
  if (deal.stage === "Appointment Scheduled" && !deal.appointmentAt) {
    findings.push({
      kind: "appointment_unconfirmed",
      tier: "none",
      reason: "Stage says an appointment is scheduled but no date is set.",
    });
  }

  if (deal.stage === "Estimate Sent" && deal.lastActivityAt) {
    const idleHours = (now.getTime() - deal.lastActivityAt.getTime()) / HOUR_MS;
    if (idleHours >= settings.staleDealAfterHours) {
      findings.push({
        kind: "estimate_awaiting_followup",
        tier: "none",
        reason: "An estimate was sent and there has been no follow-up.",
      });
    }
  }

  if (deal.stage === "Decision Pending" && deal.lastActivityAt) {
    const idleHours = (now.getTime() - deal.lastActivityAt.getTime()) / HOUR_MS;
    if (idleHours >= settings.staleDealAfterHours) {
      findings.push({
        kind: "decision_pending_idle",
        tier: "none",
        reason: "A decision has been pending with no contact.",
      });
    }
  }

  // ---- Staleness ---------------------------------------------------------
  const referenceActivity = deal.lastActivityAt ?? deal.receivedAt;
  const staleHours = (now.getTime() - referenceActivity.getTime()) / HOUR_MS;
  if (staleHours >= settings.staleDealAfterHours) {
    findings.push({
      kind: "stale_deal",
      tier: "none",
      reason: "No activity on this deal recently.",
    });
  }

  // ---- Bucket ------------------------------------------------------------
  const bucket = bucketFor(deal, { slaStatus, escalationTier, findings }, settings, now);

  return {
    dealId: deal.id,
    slaStatus,
    slaDeadline,
    escalationTier,
    responseMinutes,
    bucket,
    findings,
    headline: headlineFor(findings, slaStatus, bucket),
  };
}

function bucketFor(
  deal: DealSnapshot,
  state: { slaStatus: SlaStatus; escalationTier: EscalationTier; findings: RuleFinding[] },
  settings: LeadManagerSettings,
  now: Date,
): AttentionBucket {
  // A snoozed deal is deliberately parked, but a snooze never hides a
  // breached response SLA -- that is the one promise a snooze cannot buy out.
  if (isSnoozed(deal, now) && state.slaStatus !== "breached") {
    return "upcoming";
  }

  if (state.escalationTier === "critical" || state.escalationTier === "administrator") {
    return "critical";
  }
  if (state.slaStatus === "breached" || state.slaStatus === "due_soon") {
    return "needs_response";
  }
  if (deal.ownerUserId === null) {
    return "needs_response";
  }
  if (state.slaStatus === "after_hours") {
    return "upcoming";
  }

  const tz = settings.calendar.timeZone;
  if (deal.nextActionAt) {
    if (deal.nextActionAt.getTime() < now.getTime()) return "needs_response";
    if (isSameLocalDay(deal.nextActionAt, now, tz)) return "due_today";
  }
  if (deal.appointmentAt && isSameLocalDay(deal.appointmentAt, now, tz)) {
    return "due_today";
  }

  if (deal.stage === "Estimate Sent" || deal.stage === "Decision Pending") {
    return state.findings.length ? "needs_response" : "waiting_on_customer";
  }
  if (state.findings.length) return "needs_response";

  return "upcoming";
}

/** The one line an employee reads on the card. Most urgent finding wins. */
function headlineFor(
  findings: RuleFinding[],
  slaStatus: SlaStatus,
  bucket: AttentionBucket,
): string | null {
  const priority = [
    "sla_breach",
    "missing_owner",
    "next_action_overdue",
    "missing_next_action",
    "appointment_unconfirmed",
    "estimate_awaiting_followup",
    "decision_pending_idle",
    "closed_lost_missing_reason",
    "stale_deal",
  ];
  for (const kind of priority) {
    const hit = findings.find((f) => f.kind === kind);
    if (hit) return hit.reason;
  }
  if (slaStatus === "after_hours") return "Arrived after hours. Respond at opening.";
  if (bucket === "waiting_on_customer") return "Waiting on the customer.";
  return null;
}

/**
 * When the next watchdog pass should reconsider a deal.
 *
 * Lets the runner skip deals that provably cannot change state yet, which is
 * what keeps a five-minute job silent and cheap most of the time.
 */
export function nextEvaluationAt(
  deal: DealSnapshot,
  settings: LeadManagerSettings,
  now: Date,
): Date {
  if (isClosed(deal.stage)) return new Date(now.getTime() + 24 * HOUR_MS);
  if (isSnoozed(deal, now)) return deal.snoozedUntil as Date;
  if (!deal.firstAttemptAt) return nextBusinessOpening(now, settings.calendar);
  if (deal.nextActionAt && deal.nextActionAt.getTime() > now.getTime()) return deal.nextActionAt;
  return new Date(now.getTime() + HOUR_MS);
}
