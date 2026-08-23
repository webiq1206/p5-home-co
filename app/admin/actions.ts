"use server";

/**
 * Server actions for the lead manager.
 *
 * Every action re-checks permission on the server. The UI hides controls a
 * role cannot use, but hiding is presentation; this is the enforcement.
 *
 * All of them take FormData so the forms work without JavaScript. Most of this
 * happens on a phone with one bar of signal, and a lead that cannot be updated
 * because a bundle did not load is a lead that silently goes overdue.
 */

import { revalidatePath } from "next/cache";

import { getSessionUser, type SessionUser } from "../lib/auth.ts";
import { transaction } from "../lib/db.ts";
import { can, type Permission } from "../lib/leads/permissions.ts";
import {
  effectOf,
  validateOutcome,
  validateSnooze,
  type OutcomeError,
} from "../lib/leads/outcomes.ts";
import { DEAL_STAGES, OUTCOMES, isClosed, type DealStage, type Outcome } from "../lib/leads/types.ts";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: OutcomeError[] };

function fail(field: string, message: string): ActionResult {
  return { ok: false, errors: [{ field, message }] };
}

/** Resolve the caller and confirm the permission, or explain why not. */
async function authorize(
  permission: Permission,
): Promise<{ user: SessionUser } | { error: ActionResult }> {
  const user = await getSessionUser();
  if (!user) return { error: fail("auth", "Your session has expired. Sign in again.") };
  if (!can(user.role, permission)) {
    return { error: fail("auth", "You do not have permission to do that.") };
  }
  return { user };
}

function str(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function date(form: FormData, key: string): Date | null {
  const raw = str(form, key);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dealIdFrom(form: FormData): number | null {
  const raw = str(form, "dealId");
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Record what happened, and what happens next.
 *
 * This is the action that clears the response SLA. Until an outcome is logged,
 * first_attempt_at is null and the watchdog keeps escalating -- correctly,
 * because nothing has told it a person responded. Setting it here is the whole
 * point of the screen.
 */
export async function logOutcomeAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const auth = await authorize("log_outcome");
  if ("error" in auth) return auth.error;

  const dealId = dealIdFrom(form);
  if (!dealId) return fail("dealId", "Missing lead.");

  const outcome = str(form, "outcome") as Outcome | null;
  if (!outcome || !OUTCOMES.includes(outcome)) {
    return fail("outcome", "Choose what happened.");
  }

  const stage = (str(form, "stage") ?? "") as DealStage;
  if (!DEAL_STAGES.includes(stage)) return fail("stage", "Choose a valid stage.");

  const submission = {
    outcome,
    note: str(form, "note"),
    stage,
    nextAction: str(form, "nextAction"),
    nextActionAt: date(form, "nextActionAt"),
    appointmentAt: date(form, "appointmentAt"),
    closedLostReason: str(form, "closedLostReason"),
  };

  const now = new Date();
  const errors = validateOutcome(submission, now);
  if (errors.length) return { ok: false, errors };

  const effect = effectOf(outcome);
  const closing = isClosed(stage);

  await transaction(async (client) => {
    const before = await client.query(
      "SELECT stage, first_attempt_at, first_two_way_at FROM deal WHERE id = $1",
      [dealId],
    );
    const prev = before.rows[0] as
      | { stage: string; first_attempt_at: string | null; first_two_way_at: string | null }
      | undefined;
    if (!prev) throw new Error(`Deal ${dealId} not found`);

    await client.query(
      `INSERT INTO activity (deal_id, user_id, kind, outcome, body, is_human_attempt, is_two_way, occurred_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7)`,
      [dealId, auth.user.id, effect.activityKind, outcome, submission.note, effect.isTwoWay, now],
    );

    await client.query(
      `UPDATE deal SET
         stage = $2,
         -- COALESCE so a later outcome never overwrites the first attempt:
         -- the response time is measured from the first one, not the latest.
         first_attempt_at = COALESCE(first_attempt_at, $3),
         first_two_way_at = CASE WHEN $4 THEN COALESCE(first_two_way_at, $3) ELSE first_two_way_at END,
         next_action = $5,
         next_action_at = $6,
         appointment_at = COALESCE($7, appointment_at),
         closed_lost_reason = COALESCE($8, closed_lost_reason),
         closed_at = CASE WHEN $9 THEN COALESCE(closed_at, now()) ELSE NULL END,
         -- Logging an outcome answers the lead, so any snooze is spent.
         snoozed_until = NULL,
         snooze_reason = NULL,
         integration_sync_status = 'pending',
         updated_at = now()
       WHERE id = $1`,
      [
        dealId,
        stage,
        now,
        effect.isTwoWay,
        closing ? null : submission.nextAction,
        closing ? null : submission.nextActionAt,
        submission.appointmentAt,
        submission.closedLostReason,
        closing,
      ],
    );

    // Close the open first-contact task, so the board stops asking for
    // something that has now happened.
    await client.query(
      `UPDATE task SET completed_at = now()
        WHERE deal_id = $1 AND completed_at IS NULL AND rule_key = 'first_contact'`,
      [dealId],
    );

    await client.query(
      `INSERT INTO audit_log
         (user_id, record_type, record_id, action, previous_value, new_value, action_source)
       VALUES ($1,'deal',$2,'outcome_logged',$3::jsonb,$4::jsonb,'admin_ui')`,
      [
        auth.user.id,
        String(dealId),
        JSON.stringify({ stage: prev.stage, firstAttemptAt: prev.first_attempt_at }),
        JSON.stringify({ outcome, stage, nextAction: submission.nextAction, isTwoWay: effect.isTwoWay }),
      ],
    );
  });

  revalidatePath("/admin");
  revalidatePath("/admin/lead-manager");
  revalidatePath(`/admin/lead/${dealId}`);
  return { ok: true, message: `Logged: ${outcome}.` };
}

/** Assign or reassign the lead's owner. */
export async function assignLeadAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const auth = await authorize("assign_lead");
  if ("error" in auth) return auth.error;

  const dealId = dealIdFrom(form);
  if (!dealId) return fail("dealId", "Missing lead.");

  const raw = str(form, "ownerUserId");
  const ownerUserId = raw === null || raw === "" ? null : Number(raw);
  if (ownerUserId !== null && !Number.isInteger(ownerUserId)) {
    return fail("ownerUserId", "Choose a valid person.");
  }

  await transaction(async (client) => {
    const before = await client.query("SELECT owner_user_id FROM deal WHERE id = $1", [dealId]);
    const prev = before.rows[0]?.owner_user_id ?? null;

    await client.query(
      "UPDATE deal SET owner_user_id = $2, integration_sync_status = 'pending', updated_at = now() WHERE id = $1",
      [dealId, ownerUserId],
    );
    // Move any open task with the deal, so work and ownership never drift apart.
    await client.query(
      "UPDATE task SET assigned_to = $2 WHERE deal_id = $1 AND completed_at IS NULL",
      [dealId, ownerUserId],
    );
    await client.query(
      `INSERT INTO audit_log
         (user_id, record_type, record_id, action, previous_value, new_value, action_source)
       VALUES ($1,'deal',$2,'owner_changed',$3::jsonb,$4::jsonb,'admin_ui')`,
      [auth.user.id, String(dealId), JSON.stringify({ ownerUserId: prev }), JSON.stringify({ ownerUserId })],
    );
  });

  revalidatePath("/admin");
  revalidatePath("/admin/lead-manager");
  revalidatePath(`/admin/lead/${dealId}`);
  return { ok: true, message: ownerUserId ? "Reassigned." : "Unassigned." };
}

/** Set or change the next action without logging a contact attempt. */
export async function setNextActionAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const auth = await authorize("set_next_action");
  if ("error" in auth) return auth.error;

  const dealId = dealIdFrom(form);
  if (!dealId) return fail("dealId", "Missing lead.");

  const nextAction = str(form, "nextAction");
  const nextActionAt = date(form, "nextActionAt");
  const now = new Date();

  if (!nextAction) return fail("nextAction", "Say what happens next.");
  if (!nextActionAt) return fail("nextActionAt", "Set a date for the next action.");
  if (nextActionAt.getTime() <= now.getTime()) {
    return fail("nextActionAt", "The next action has to be in the future.");
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE deal SET next_action = $2, next_action_at = $3,
              integration_sync_status = 'pending', updated_at = now()
        WHERE id = $1`,
      [dealId, nextAction, nextActionAt],
    );
    await client.query(
      `INSERT INTO audit_log (user_id, record_type, record_id, action, new_value, action_source)
       VALUES ($1,'deal',$2,'next_action_set',$3::jsonb,'admin_ui')`,
      [auth.user.id, String(dealId), JSON.stringify({ nextAction, nextActionAt })],
    );
  });

  revalidatePath("/admin");
  revalidatePath("/admin/lead-manager");
  revalidatePath(`/admin/lead/${dealId}`);
  return { ok: true, message: "Next action set." };
}

/**
 * Park a lead until a stated date.
 *
 * Requires a reason and a future date, and the rules engine still refuses to
 * let a snooze hide a lead past its response deadline.
 */
export async function snoozeLeadAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const auth = await authorize("set_next_action");
  if ("error" in auth) return auth.error;

  const dealId = dealIdFrom(form);
  if (!dealId) return fail("dealId", "Missing lead.");

  const reason = str(form, "snoozeReason");
  const until = date(form, "snoozedUntil");
  const errors = validateSnooze(reason, until, new Date());
  if (errors.length) return { ok: false, errors };

  await transaction(async (client) => {
    await client.query(
      "UPDATE deal SET snoozed_until = $2, snooze_reason = $3, updated_at = now() WHERE id = $1",
      [dealId, until, reason],
    );
    await client.query(
      `INSERT INTO audit_log (user_id, record_type, record_id, action, new_value, action_source)
       VALUES ($1,'deal',$2,'snoozed',$3::jsonb,'admin_ui')`,
      [auth.user.id, String(dealId), JSON.stringify({ until, reason })],
    );
  });

  revalidatePath("/admin");
  revalidatePath("/admin/lead-manager");
  revalidatePath(`/admin/lead/${dealId}`);
  return { ok: true, message: "Snoozed." };
}
