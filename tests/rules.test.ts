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

test("a weekend lead left until Monday hits the wall-clock ceiling, not a mild tier", () => {
  // This is the case business hours alone get wrong. Saturday 8pm to Monday
  // 7:10am is only ten business minutes, which would read as barely late --
  // but it is 35 real hours, and the customer has been waiting all of them.
  const saturdayEvening = boise(2026, 8, 22, 20);
  const mondayMorning = boise(2026, 8, 24, 7, 10);
  const e = evaluateDeal(
    deal({ receivedAt: saturdayEvening, lastActivityAt: saturdayEvening }),
    S,
    mondayMorning,
  );
  assert.equal(e.slaStatus, "breached");
  assert.equal(e.escalationTier, "administrator", "35 hours unanswered is not an owner-level nudge");
  assert.ok(e.findings.some((f) => f.kind === "response_ceiling_breached"));
  assert.equal(e.bucket, "critical");
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

// --- The accountability rules ----------------------------------------------

test("nothing goes unanswered past the wall-clock ceiling, whatever the calendar says", () => {
  const sundayMorning = boise(2026, 8, 23, 8); // Sunday: zero business minutes
  const eightHoursLater = new Date(sundayMorning.getTime() + 8 * 60 * 60_000);
  const e = evaluateDeal(
    deal({ receivedAt: sundayMorning, lastActivityAt: sundayMorning, nextActionAt: null, nextAction: null }),
    S,
    eightHoursLater,
  );
  // Business hours alone would call this "after hours" and stay silent.
  assert.ok(
    e.findings.some((f) => f.kind === "response_ceiling_breached"),
    "eight real hours unanswered must raise the ceiling alert even on a Sunday",
  );
  assert.equal(e.escalationTier, "administrator");
  assert.equal(e.bucket, "critical");
});

test("just under the ceiling stays quiet, so the alarm means something", () => {
  const sundayMorning = boise(2026, 8, 23, 8);
  const almost = new Date(sundayMorning.getTime() + 7.5 * 60 * 60_000);
  const e = evaluateDeal(
    deal({ receivedAt: sundayMorning, lastActivityAt: sundayMorning, nextActionAt: null, nextAction: null }),
    S,
    almost,
  );
  assert.ok(!e.findings.some((f) => f.kind === "response_ceiling_breached"));
});

test("the ceiling stops applying once somebody has actually responded", () => {
  const friday = boise(2026, 8, 21, 8);
  const answered = new Date(friday.getTime() + 4 * 60_000);
  const muchLater = new Date(friday.getTime() + 30 * 60 * 60_000);
  const e = evaluateDeal(
    deal({ receivedAt: friday, firstAttemptAt: answered, stage: "Contacting", lastActivityAt: answered,
           nextActionAt: new Date(muchLater.getTime() + 60 * 60_000) }),
    S,
    muchLater,
  );
  assert.ok(!e.findings.some((f) => f.kind === "response_ceiling_breached"),
    "the ceiling is about first response, not about the deal forever");
});

test("a broken promise escalates instead of sitting silently as a flag", () => {
  const friday10 = boise(2026, 8, 21, 10);
  const promised = boise(2026, 8, 21, 11);
  const base = deal({ receivedAt: friday10, firstAttemptAt: friday10, stage: "Contacting",
                      lastActivityAt: friday10, nextAction: "Call Maria back", nextActionAt: promised });

  // An hour late: the owner hears about it.
  let e = evaluateDeal(base, S, boise(2026, 8, 21, 12));
  const f = e.findings.find((x) => x.kind === "next_action_overdue");
  assert.equal(f?.tier, "owner");
  assert.match(f?.reason ?? "", /Call Maria back/);

  // Four hours late: the manager does too.
  e = evaluateDeal(base, S, boise(2026, 8, 21, 15));
  assert.equal(e.findings.find((x) => x.kind === "next_action_overdue")?.tier, "owner_manager");

  // Eight business hours late: Critical, and it reaches the top of the board.
  e = evaluateDeal(base, S, boise(2026, 8, 22, 12));
  assert.equal(e.findings.find((x) => x.kind === "next_action_overdue")?.tier, "critical");
  assert.equal(e.bucket, "critical", "a badly broken promise belongs with the emergencies");
});

test("a promise that came due overnight is not counted as hours late", () => {
  // Committed for 5:55pm Friday, now 7:05am Saturday. Only ten business
  // minutes have passed; nobody was at fault for the hours in between.
  const e = evaluateDeal(
    deal({
      receivedAt: boise(2026, 8, 21, 10), firstAttemptAt: boise(2026, 8, 21, 10),
      stage: "Contacting", lastActivityAt: boise(2026, 8, 21, 10),
      nextAction: "Send the quote", nextActionAt: boise(2026, 8, 21, 17, 55),
    }),
    S,
    boise(2026, 8, 22, 7, 5),
  );
  const f = e.findings.find((x) => x.kind === "next_action_overdue");
  assert.equal(f?.tier, "none", "ten business minutes late is not an escalation");
});

test("the ceiling headline outranks everything, so the worst case reads first", () => {
  const sunday = boise(2026, 8, 23, 8);
  const e = evaluateDeal(
    deal({ receivedAt: sunday, lastActivityAt: sunday, ownerUserId: null, nextAction: null, nextActionAt: null }),
    S,
    new Date(sunday.getTime() + 10 * 60 * 60_000),
  );
  assert.match(e.headline ?? "", /past the 8-hour limit/);
});
