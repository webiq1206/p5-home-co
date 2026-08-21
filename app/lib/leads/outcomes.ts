/**
 * What logging an outcome means.
 *
 * Pure, so the consequences of an outcome are testable without a database and
 * identical everywhere they are applied. The server action does the writing;
 * this decides what should be written.
 *
 * The single most important rule lives here: every outcome is a human contact
 * *attempt*, which stops the response clock even when nobody picked up. Until
 * an outcome is logged, first_attempt_at stays null and the watchdog keeps
 * escalating -- correctly, because as far as the system knows, nobody replied.
 */

import { isClosed, type DealStage, type Outcome } from "./types.ts";

export type OutcomeEffect = {
  /** Timeline entry type. */
  activityKind: "call" | "email" | "text" | "note" | "appointment";
  /**
   * Always true. Logging any outcome means a person did something, which is
   * what clears the response SLA. A voicemail counts; an auto-reply never
   * reaches this function.
   */
  isHumanAttempt: true;
  /** True only when we actually reached the person. */
  isTwoWay: boolean;
  /** Stage this outcome implies, or null to leave the stage alone. */
  suggestedStage: DealStage | null;
  /** Whether the employee must confirm a next action and date. */
  requiresNextAction: boolean;
  /** Whether an appointment date must accompany this outcome. */
  requiresAppointment: boolean;
  /** Whether a closed-lost reason must accompany this outcome. */
  requiresLostReason: boolean;
  /** Plain-language default the UI can pre-fill. */
  defaultNextAction: string | null;
};

const EFFECTS: Record<Outcome, OutcomeEffect> = {
  Connected: {
    activityKind: "call",
    isHumanAttempt: true,
    isTwoWay: true,
    suggestedStage: "Contacting",
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Follow up on the conversation",
  },
  "Left Voicemail": {
    activityKind: "call",
    isHumanAttempt: true,
    isTwoWay: false,
    suggestedStage: "Contacting",
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Try calling again",
  },
  "No Answer": {
    activityKind: "call",
    isHumanAttempt: true,
    isTwoWay: false,
    suggestedStage: "Contacting",
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Try calling again",
  },
  "Sent Email": {
    activityKind: "email",
    isHumanAttempt: true,
    isTwoWay: false,
    suggestedStage: "Contacting",
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Follow up if no reply",
  },
  "Sent Text": {
    activityKind: "text",
    isHumanAttempt: true,
    isTwoWay: false,
    suggestedStage: "Contacting",
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Follow up if no reply",
  },
  "Appointment Scheduled": {
    activityKind: "appointment",
    isHumanAttempt: true,
    isTwoWay: true,
    suggestedStage: "Appointment Scheduled",
    requiresNextAction: true,
    requiresAppointment: true,
    requiresLostReason: false,
    defaultNextAction: "Confirm the appointment the day before",
  },
  "Not Ready": {
    activityKind: "note",
    isHumanAttempt: true,
    isTwoWay: true,
    // Deliberately no stage change: not ready now is not the same as lost.
    suggestedStage: null,
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Check back in",
  },
  "Not a Fit": {
    activityKind: "note",
    isHumanAttempt: true,
    isTwoWay: true,
    suggestedStage: "Closed Lost",
    requiresNextAction: false,
    requiresAppointment: false,
    requiresLostReason: true,
    defaultNextAction: null,
  },
  "Wrong Number": {
    activityKind: "note",
    isHumanAttempt: true,
    // We reached *someone*, but not the person, so this is not two-way contact
    // with the lead.
    isTwoWay: false,
    suggestedStage: "Closed Lost",
    requiresNextAction: false,
    requiresAppointment: false,
    requiresLostReason: true,
    defaultNextAction: null,
  },
  "Follow-Up Required": {
    activityKind: "note",
    isHumanAttempt: true,
    isTwoWay: true,
    suggestedStage: null,
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Follow up",
  },
  Other: {
    activityKind: "note",
    isHumanAttempt: true,
    isTwoWay: false,
    suggestedStage: null,
    requiresNextAction: true,
    requiresAppointment: false,
    requiresLostReason: false,
    defaultNextAction: "Decide the next step",
  },
};

export function effectOf(outcome: Outcome): OutcomeEffect {
  const effect = EFFECTS[outcome];
  if (!effect) throw new Error(`Unknown outcome: ${outcome}`);
  return effect;
}

/** A problem that must be fixed before the outcome can be logged. */
export type OutcomeError = { field: string; message: string };

export type OutcomeSubmission = {
  outcome: Outcome;
  note: string | null;
  /** Stage the employee chose, which may differ from the suggestion. */
  stage: DealStage;
  nextAction: string | null;
  nextActionAt: Date | null;
  appointmentAt: Date | null;
  closedLostReason: string | null;
};

/**
 * Validate an outcome submission.
 *
 * This is the rule the brief is most insistent about: a lead cannot be marked
 * done without logging what happened and confirming what happens next. The
 * only escape is closing the deal, which is itself a decision with a reason.
 */
export function validateOutcome(
  submission: OutcomeSubmission,
  now: Date,
): OutcomeError[] {
  const effect = effectOf(submission.outcome);
  const errors: OutcomeError[] = [];
  const closing = isClosed(submission.stage);

  if (effect.requiresNextAction && !closing) {
    if (!submission.nextAction?.trim()) {
      errors.push({ field: "nextAction", message: "Say what happens next." });
    }
    if (!submission.nextActionAt) {
      errors.push({ field: "nextActionAt", message: "Set a date for the next action." });
    } else if (submission.nextActionAt.getTime() <= now.getTime()) {
      errors.push({
        field: "nextActionAt",
        message: "The next action has to be in the future.",
      });
    }
  }

  if (effect.requiresAppointment && !submission.appointmentAt) {
    errors.push({
      field: "appointmentAt",
      message: "Add the appointment date and time.",
    });
  }
  if (
    submission.appointmentAt &&
    submission.appointmentAt.getTime() <= now.getTime()
  ) {
    errors.push({
      field: "appointmentAt",
      message: "The appointment has to be in the future.",
    });
  }

  // A lost deal without a reason is the reporting gap the rules engine flags,
  // so refuse to create one in the first place.
  if (submission.stage === "Closed Lost" && !submission.closedLostReason?.trim()) {
    errors.push({
      field: "closedLostReason",
      message: "Choose why this was lost.",
    });
  }

  return errors;
}

/** A snooze needs a reason and a future date; it is a decision, not a dismissal. */
export function validateSnooze(
  reason: string | null,
  until: Date | null,
  now: Date,
): OutcomeError[] {
  const errors: OutcomeError[] = [];
  if (!reason?.trim()) {
    errors.push({ field: "snoozeReason", message: "Say why you are snoozing this." });
  }
  if (!until) {
    errors.push({ field: "snoozedUntil", message: "Choose when to bring it back." });
  } else if (until.getTime() <= now.getTime()) {
    errors.push({ field: "snoozedUntil", message: "Pick a time in the future." });
  }
  return errors;
}
