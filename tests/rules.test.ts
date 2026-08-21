import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateDeal, type DealSnapshot } from "../app/lib/leads/rules.ts";
import { DEFAULT_SETTINGS } from "../app/lib/leads/settings.ts";
import { fromZonedParts } from "../app/lib/leads/time.ts";

const S = DEFAULT_SETTINGS;
const TZ = S.calendar.timeZone;

function boise(y: number, mo: number, d: number, h: number, mi = 0): Date {
  return fromZonedParts({ year: y, month: mo, day: d, hour: h, minute: mi }, TZ);
}

/** Friday 2026-08-21, mid-morning: comfortably inside business hours. */
const FRIDAY_10AM = boise(2026, 8, 21, 10);

function deal(overrides: Partial<DealSnapshot> = {}): DealSnapshot {
  return {
    id: 1,
    stage: "New Lead",
    ownerUserId: 7,
    receivedAt: FRIDAY_10AM,
    firstAttemptAt: null,
    firstTwoWayAt: null,
    nextAction: "Call the homeowner",
    nextActionAt: boise(2026, 8, 21, 11),
    appointmentAt: null,
    snoozedUntil: null,
    closedLostReason: null,
    lastActivityAt: FRIDAY_10AM,
    ...overrides,
  };
}

function at(minutesLater: number): Date {
  return new Date(FRIDAY_10AM.getTime() + minutesLater * 60_000);
}

// --- The response SLA -------------------------------------------------------

test("a brand-new lead inside business hours is on track, not yet alarming", () => {
  const e = evaluateDeal(deal(), S, at(1));
  assert.equal(e.slaStatus, "on_track");
  assert.equal(e.escalationTier, "none");
  assert.equal(e.findings.length, 0);
});

test("escalation climbs 5 -> 15 -> 30 -> 60 business minutes with no contact", () => {
  assert.equal(evaluateDeal(deal(), S, at(4)).escalationTier, "none");
  assert.equal(evaluateDeal(deal(), S, at(6)).escalationTier, "owner");
  assert.equal(evaluateDeal(deal(), S, at(16)).escalationTier, "owner_manager");
  assert.equal(evaluateDeal(deal(), S, at(31)).escalationTier, "critical");
  assert.equal(evaluateDeal(deal(), S, at(61)).escalationTier, "administrator");
});

test("passing the deadline with no contact raises exactly one sla_breach finding", () => {
  const e = evaluateDeal(deal(), S, at(6));
  const breaches = e.findings.filter((f) => f.kind === "sla_breach");
  assert.equal(breaches.length, 1);
  assert.equal(e.slaStatus, "breached");
  assert.match(breaches[0].reason, /No one has contacted this lead yet/);
});

test("at 30 business minutes the lead is Critical on the board", () => {
  assert.equal(evaluateDeal(deal(), S, at(31)).bucket, "critical");
});

test("a contact attempt inside the target marks the SLA met and stops the clock", () => {
  const e = evaluateDeal(deal({ firstAttemptAt: at(3) }), S, at(90));
  assert.equal(e.slaStatus, "met");
  assert.equal(e.responseMinutes, 3);
  assert.equal(e.findings.filter((f) => f.kind === "sla_breach").length, 0);
});

test("a late contact attempt is recorded as breached, not quietly forgiven", () => {
  const e = evaluateDeal(deal({ firstAttemptAt: at(45) }), S, at(200));
  assert.equal(e.slaStatus, "breached");
  assert.equal(e.responseMinutes, 45);
});

// --- After hours ------------------------------------------------------------

test("an after-hours lead is scheduled, not overdue, and does not escalate", () => {
  const sundayNoon = boise(2026, 8, 23, 12);
  const e = evaluateDeal(
    deal({ receivedAt: sundayNoon, lastActivityAt: sundayNoon, nextActionAt: null, nextAction: null }),
    S,
    new Date(sundayNoon.getTime() + 3 * 60 * 60_000),
  );
  assert.equal(e.slaStatus, "after_hours");
  assert.equal(e.escalationTier, "none");
  assert.equal(e.bucket, "upcoming");
  assert.equal(e.findings.filter((f) => f.kind === "sla_breach").length, 0);
});

test("an after-hours lead becomes due once business hours resume", () => {
  const saturdayEvening = boise(2026, 8, 22, 20);
  // Monday 7:10am: ten business minutes have elapsed since opening.
  const mondayMorning = boise(2026, 8, 24, 7, 10);
  const e = evaluateDeal(
    deal({ receivedAt: saturdayEvening, lastActivityAt: saturdayEvening }),
    S,
    mondayMorning,
  );
  assert.equal(e.slaStatus, "breached");
  assert.equal(e.escalationTier, "owner");
});

// --- Ownership and next actions --------------------------------------------

test("an unassigned lead is flagged and pulled into Needs Response", () => {
  const e = evaluateDeal(deal({ ownerUserId: null }), S, at(1));
  assert.ok(e.findings.some((f) => f.kind === "missing_owner"));
  assert.equal(e.bucket, "needs_response");
});

test("an open deal with no next action is flagged", () => {
  const e = evaluateDeal(deal({ nextAction: null, nextActionAt: null }), S, at(1));
  assert.ok(e.findings.some((f) => f.kind === "missing_next_action"));
});

test("an overdue next action is flagged and surfaces the action text", () => {
  const e = evaluateDeal(
    deal({ firstAttemptAt: at(1), nextActionAt: at(30), stage: "Contacting" }),
    S,
    at(120),
  );
  const finding = e.findings.find((f) => f.kind === "next_action_overdue");
  assert.ok(finding, "expected an overdue finding");
  assert.match(finding.reason, /Call the homeowner/);
  assert.equal(e.bucket, "needs_response");
});

test("a next action due later today lands in Due Today", () => {
  const e = evaluateDeal(
    deal({ firstAttemptAt: at(1), stage: "Contacting", nextActionAt: boise(2026, 8, 21, 16) }),
    S,
    boise(2026, 8, 21, 12),
  );
  assert.equal(e.bucket, "due_today");
});

// --- Snooze -----------------------------------------------------------------

test("a snooze parks a deal that is otherwise fine", () => {
  const e = evaluateDeal(
    deal({ firstAttemptAt: at(1), stage: "Contacting", snoozedUntil: at(60 * 24) }),
    S,
    at(120),
  );
  assert.equal(e.bucket, "upcoming");
});

test("a snooze cannot hide an unanswered lead past its response deadline", () => {
  const e = evaluateDeal(deal({ snoozedUntil: at(60 * 24) }), S, at(31));
  assert.equal(e.slaStatus, "breached");
  assert.equal(e.bucket, "critical", "a snooze must not buy out the response promise");
});

// --- Stage rules ------------------------------------------------------------

test("Appointment Scheduled without a date is flagged", () => {
  const e = evaluateDeal(
    deal({ stage: "Appointment Scheduled", firstAttemptAt: at(1), appointmentAt: null }),
    S,
    at(60),
  );
  assert.ok(e.findings.some((f) => f.kind === "appointment_unconfirmed"));
});

test("an estimate sent with no follow-up past the stale window is flagged", () => {
  const sent = boise(2026, 8, 17, 9);
  const e = evaluateDeal(
    deal({ stage: "Estimate Sent", firstAttemptAt: sent, receivedAt: sent, lastActivityAt: sent }),
    S,
    boise(2026, 8, 21, 9),
  );
  assert.ok(e.findings.some((f) => f.kind === "estimate_awaiting_followup"));
});

test("a healthy Estimate Sent deal is Waiting on Customer, not nagging anyone", () => {
  const e = evaluateDeal(
    deal({
      stage: "Estimate Sent",
      firstAttemptAt: at(1),
      nextActionAt: boise(2026, 8, 28, 9),
      lastActivityAt: at(-30),
    }),
    S,
    at(60),
  );
  assert.equal(e.bucket, "waiting_on_customer");
  assert.equal(e.findings.length, 0);
});

// --- Closed deals -----------------------------------------------------------

test("Closed Won is complete and raises nothing", () => {
  const e = evaluateDeal(deal({ stage: "Closed Won" }), S, at(500));
  assert.equal(e.bucket, "recently_completed");
  assert.equal(e.findings.length, 0);
  assert.equal(e.slaStatus, "not_applicable");
});

test("Closed Lost without a reason is flagged", () => {
  const e = evaluateDeal(deal({ stage: "Closed Lost", closedLostReason: null }), S, at(500));
  assert.ok(e.findings.some((f) => f.kind === "closed_lost_missing_reason"));
});

test("Closed Lost with a reason is complete", () => {
  const e = evaluateDeal(deal({ stage: "Closed Lost", closedLostReason: "Price" }), S, at(500));
  assert.equal(e.findings.length, 0);
  assert.equal(e.bucket, "recently_completed");
});

// --- Determinism ------------------------------------------------------------

test("evaluating the same deal twice yields an identical result", () => {
  const d = deal();
  const now = at(31);
  assert.deepEqual(evaluateDeal(d, S, now), evaluateDeal(d, S, now));
});

test("the deferred integrations never produce a finding", () => {
  const e = evaluateDeal(deal({ firstAttemptAt: at(1), stage: "Estimate in Progress" }), S, at(60));
  const kinds = e.findings.map((f) => f.kind).join(",");
  assert.ok(!/handoff|quickbooks/i.test(kinds), `unexpected deferred-integration finding: ${kinds}`);
  assert.equal(S.featureFlags.handoffIntegrationEnabled, false);
  assert.equal(S.featureFlags.quickBooksIntegrationEnabled, false);
});
