import { test } from "node:test";
import assert from "node:assert/strict";

import {
  effectOf,
  validateOutcome,
  validateSnooze,
  type OutcomeSubmission,
} from "../app/lib/leads/outcomes.ts";
import { OUTCOMES, type Outcome } from "../app/lib/leads/types.ts";

const NOW = new Date("2026-08-21T16:00:00Z");
const LATER = new Date("2026-08-22T16:00:00Z");
const EARLIER = new Date("2026-08-20T16:00:00Z");

// --- The rule that clears the SLA ------------------------------------------

test("every outcome counts as a human attempt, including the ones nobody answered", () => {
  // This is what stops the response clock. If any outcome returned false here,
  // that lead would escalate forever despite someone having tried.
  for (const outcome of OUTCOMES) {
    assert.equal(effectOf(outcome).isHumanAttempt, true, `${outcome} must count as an attempt`);
  }
});

test("only outcomes where we actually reached the person are two-way", () => {
  const twoWay = OUTCOMES.filter((o) => effectOf(o).isTwoWay);
  assert.deepEqual(twoWay.sort(), [
    "Appointment Scheduled", "Connected", "Follow-Up Required", "Not Ready", "Not a Fit",
  ]);
});

test("a voicemail is an attempt but not a conversation", () => {
  const e = effectOf("Left Voicemail");
  assert.equal(e.isHumanAttempt, true);
  assert.equal(e.isTwoWay, false);
});

test("a wrong number reached someone, but not the lead, so it is not two-way", () => {
  assert.equal(effectOf("Wrong Number").isTwoWay, false);
});

test("an unknown outcome throws rather than silently doing nothing", () => {
  assert.throws(() => effectOf("Invented" as Outcome), /Unknown outcome/);
});

// --- Stage suggestions ------------------------------------------------------

test("contact attempts move a new lead into Contacting", () => {
  for (const o of ["Connected", "Left Voicemail", "No Answer", "Sent Email", "Sent Text"] as const) {
    assert.equal(effectOf(o).suggestedStage, "Contacting");
  }
});

test("Not Ready does not close the deal, because later is not lost", () => {
  assert.equal(effectOf("Not Ready").suggestedStage, null);
  assert.equal(effectOf("Not Ready").requiresNextAction, true);
});

test("Not a Fit and Wrong Number suggest Closed Lost and demand a reason", () => {
  for (const o of ["Not a Fit", "Wrong Number"] as const) {
    assert.equal(effectOf(o).suggestedStage, "Closed Lost");
    assert.equal(effectOf(o).requiresLostReason, true);
    assert.equal(effectOf(o).requiresNextAction, false);
  }
});

// --- Validation: the "cannot finish without saying what's next" rule --------

function sub(overrides: Partial<OutcomeSubmission> = {}): OutcomeSubmission {
  return {
    outcome: "Left Voicemail",
    note: "Rang twice.",
    stage: "Contacting",
    nextAction: "Try calling again",
    nextActionAt: LATER,
    appointmentAt: null,
    closedLostReason: null,
    ...overrides,
  };
}

test("a complete submission validates", () => {
  assert.deepEqual(validateOutcome(sub(), NOW), []);
});

test("an outcome cannot be logged without saying what happens next", () => {
  const errors = validateOutcome(sub({ nextAction: null }), NOW);
  assert.ok(errors.some((e) => e.field === "nextAction"));
});

test("an outcome cannot be logged without a date for the next action", () => {
  const errors = validateOutcome(sub({ nextActionAt: null }), NOW);
  assert.ok(errors.some((e) => e.field === "nextActionAt"));
});

test("the next action must be in the future, not quietly already overdue", () => {
  const errors = validateOutcome(sub({ nextActionAt: EARLIER }), NOW);
  assert.ok(errors.some((e) => e.field === "nextActionAt" && /future/.test(e.message)));
});

test("whitespace does not count as a next action", () => {
  assert.ok(validateOutcome(sub({ nextAction: "   " }), NOW).some((e) => e.field === "nextAction"));
});

test("closing the deal is the one way out of requiring a next action", () => {
  const errors = validateOutcome(
    sub({ outcome: "Connected", stage: "Closed Won", nextAction: null, nextActionAt: null }),
    NOW,
  );
  assert.deepEqual(errors, []);
});

test("Closed Lost still demands a reason", () => {
  const errors = validateOutcome(
    sub({ outcome: "Not a Fit", stage: "Closed Lost", nextAction: null, nextActionAt: null }),
    NOW,
  );
  assert.ok(errors.some((e) => e.field === "closedLostReason"));
});

test("Closed Lost with a reason is accepted", () => {
  const errors = validateOutcome(
    sub({
      outcome: "Not a Fit", stage: "Closed Lost",
      nextAction: null, nextActionAt: null, closedLostReason: "Outside service area",
    }),
    NOW,
  );
  assert.deepEqual(errors, []);
});

test("scheduling an appointment requires the appointment date", () => {
  const errors = validateOutcome(
    sub({ outcome: "Appointment Scheduled", appointmentAt: null }),
    NOW,
  );
  assert.ok(errors.some((e) => e.field === "appointmentAt"));
});

test("an appointment cannot be booked in the past", () => {
  const errors = validateOutcome(
    sub({ outcome: "Appointment Scheduled", appointmentAt: EARLIER }),
    NOW,
  );
  assert.ok(errors.some((e) => e.field === "appointmentAt" && /future/.test(e.message)));
});

// --- Snooze -----------------------------------------------------------------

test("a snooze needs both a reason and a future date", () => {
  assert.deepEqual(validateSnooze("Customer away until Monday", LATER, NOW), []);
  assert.ok(validateSnooze(null, LATER, NOW).some((e) => e.field === "snoozeReason"));
  assert.ok(validateSnooze("  ", LATER, NOW).some((e) => e.field === "snoozeReason"));
  assert.ok(validateSnooze("Away", null, NOW).some((e) => e.field === "snoozedUntil"));
  assert.ok(validateSnooze("Away", EARLIER, NOW).some((e) => e.field === "snoozedUntil"));
});

// --- Coverage ---------------------------------------------------------------

test("every outcome in the vocabulary has an effect defined", () => {
  for (const outcome of OUTCOMES) {
    const e = effectOf(outcome);
    assert.ok(e.activityKind, `${outcome} needs an activity kind`);
    if (e.requiresNextAction) {
      assert.ok(e.defaultNextAction, `${outcome} should suggest a default next action`);
    }
  }
});
