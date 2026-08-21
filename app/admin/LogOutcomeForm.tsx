"use client";

/**
 * The form an employee actually uses after contacting a lead.
 *
 * Fields appear only when the chosen outcome needs them, so the common case --
 * "I left a voicemail, I'll try again Tuesday" -- is two choices and a date,
 * not a wall of inputs. The stage and next action pre-fill from the outcome,
 * because the right answer is usually the obvious one and typing on a phone is
 * the slowest part of the job.
 */

import { useActionState, useState } from "react";

import { logOutcomeAction, type ActionResult } from "./actions.ts";
import { effectOf } from "../lib/leads/outcomes.ts";
import { DEAL_STAGES, OUTCOMES, isClosed, type DealStage, type Outcome } from "../lib/leads/types.ts";

/** Format a Date for a datetime-local input in the viewer's own timezone. */
function toLocalInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

export function LogOutcomeForm({
  dealId,
  currentStage,
  lostReasons,
}: {
  dealId: number;
  currentStage: DealStage;
  lostReasons: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    logOutcomeAction,
    null,
  );

  const [outcome, setOutcome] = useState<Outcome>("Left Voicemail");
  const effect = effectOf(outcome);

  // The employee can override the suggestion, but it starts where the outcome
  // implies, so the common path is one tap.
  const [stage, setStage] = useState<DealStage>(effect.suggestedStage ?? currentStage);
  const closing = isClosed(stage);

  function chooseOutcome(next: Outcome) {
    setOutcome(next);
    const suggestion = effectOf(next).suggestedStage;
    if (suggestion) setStage(suggestion);
  }

  const errorFor = (field: string) =>
    state && !state.ok ? state.errors.find((e) => e.field === field)?.message : undefined;

  return (
    <form action={formAction} className="lead-form">
      <input type="hidden" name="dealId" value={dealId} />

      <label className="lead-field">
        <span>What happened?</span>
        <select name="outcome" value={outcome} onChange={(e) => chooseOutcome(e.target.value as Outcome)}>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {errorFor("outcome") && <em className="lead-error">{errorFor("outcome")}</em>}
      </label>

      <label className="lead-field">
        <span>Notes <small>optional</small></span>
        <textarea name="note" rows={2} placeholder="Anything worth remembering" />
      </label>

      <label className="lead-field">
        <span>Stage</span>
        <select name="stage" value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {errorFor("stage") && <em className="lead-error">{errorFor("stage")}</em>}
      </label>

      {effect.requiresAppointment && (
        <label className="lead-field">
          <span>Appointment</span>
          <input type="datetime-local" name="appointmentAt" defaultValue={tomorrowMorning()} />
          {errorFor("appointmentAt") && <em className="lead-error">{errorFor("appointmentAt")}</em>}
        </label>
      )}

      {stage === "Closed Lost" && (
        <label className="lead-field">
          <span>Why was it lost?</span>
          <select name="closedLostReason" defaultValue="">
            <option value="" disabled>Choose a reason</option>
            {lostReasons.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {errorFor("closedLostReason") && <em className="lead-error">{errorFor("closedLostReason")}</em>}
        </label>
      )}

      {!closing && (
        <>
          <label className="lead-field">
            <span>What happens next?</span>
            <input
              type="text"
              name="nextAction"
              key={outcome}
              defaultValue={effect.defaultNextAction ?? ""}
              placeholder="Call again, send the quote…"
            />
            {errorFor("nextAction") && <em className="lead-error">{errorFor("nextAction")}</em>}
          </label>

          <label className="lead-field">
            <span>When?</span>
            <input type="datetime-local" name="nextActionAt" defaultValue={tomorrowMorning()} />
            {errorFor("nextActionAt") && <em className="lead-error">{errorFor("nextActionAt")}</em>}
          </label>
        </>
      )}

      {closing && (
        <p className="lead-note">
          Closing this deal, so no next action is needed.
        </p>
      )}

      {errorFor("auth") && <p className="lead-error lead-error-block">{errorFor("auth")}</p>}
      {state?.ok && <p className="lead-ok">{state.message}</p>}

      <button type="submit" className="lead-action lead-action-primary" disabled={pending}>
        {pending ? "Saving…" : "Save outcome"}
      </button>
    </form>
  );
}
