/**
 * Partial-completion tracking for the quote form: durable sessions and the
 * inactivity sweep that turns an abandoned one into a single staff email.
 * Policy and data rules are in docs/estimator-recovery.md; the brand sites run
 * the same policy over Drizzle, this is the raw-SQL twin for this codebase.
 */
import { isDatabaseConfigured, query, queryOne } from "../db.ts";
import { activeTransport } from "../notifications/transport.ts";
import { peopleWithRole } from "../notifications/dispatch.ts";

export const ENGAGEMENT_MIN_SECONDS = 20;
export const INACTIVITY_MS = 30 * 60 * 1000;
export const MAX_NOTIFY_ATTEMPTS = 5;
export const NOTIFY_LOCK_MS = 10 * 60 * 1000;
export const RETENTION_DAYS = 90;
export const SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const SESSION_ID_RE = /^[a-f0-9-]{16,64}$/i;
const STEP_RE = /^[a-z0-9_. -]{1,60}$/i;
const SELECTION_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/i;
const SENSITIVE_KEY_RE = /(name|email|phone|address|street|password|card|ssn|token)/i;
const SITE = "P5 Home Co";

export type Selections = Record<string, string | number | boolean | null>;

export interface ProgressReport {
  sessionId: string;
  flow: string;
  pagePath?: string;
  device?: string;
  startedAt?: number;
  currentStep?: string;
  currentStepIndex?: number;
  lastCompletedStep?: string;
  totalSteps?: number;
  selections?: Record<string, unknown>;
  validationErrors?: string[];
  exitMethod?: string;
  status?: "active" | "completed";
  recovery?: { shown?: boolean; call?: boolean; text?: boolean; dismissed?: boolean };
}

export interface SessionRow {
  id: string;
  flow: string;
  page_path: string;
  device: string;
  started_at: Date;
  last_activity_at: Date;
  current_step: string | null;
  current_step_index: number;
  last_completed_step: string | null;
  total_steps: number;
  completion_percent: number;
  time_spent_seconds: number;
  selections: Selections;
  validation_errors: string[];
  exit_method: string;
  prompt_shown: boolean;
  clicked_call: boolean;
  clicked_text: boolean;
  requested_callback: boolean;
  dismissed_prompt: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  callback_note: string | null;
  status: string;
}

/** Drops anything that is not an allow-listed, non-sensitive scalar. */
export function sanitizeSelections(input: Record<string, unknown> | undefined): Selections {
  const out: Selections = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(out).length >= 40) break;
    if (!SELECTION_KEY_RE.test(key) || SENSITIVE_KEY_RE.test(key)) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, 120);
  }
  return out;
}

/** Path only: query strings can carry attribution or contact data. */
export function sanitizePath(input: string | undefined): string {
  if (!input) return "/";
  try {
    return new URL(input, "https://placeholder.local").pathname.slice(0, 200) || "/";
  } catch {
    return "/";
  }
}

export function isEngaged(currentStepIndex: number, lastCompletedStep: string | null, timeSpentSeconds: number): boolean {
  return currentStepIndex >= 1 || Boolean(lastCompletedStep) || timeSpentSeconds >= ENGAGEMENT_MIN_SECONDS;
}

let ensured: Promise<void> | null = null;
/** The migration creates this at boot; this covers a deploy that skipped it. */
export function ensureEstimatorSessionsTable(): Promise<void> {
  if (!isDatabaseConfigured()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`CREATE TABLE IF NOT EXISTS estimator_sessions (
      id varchar(64) PRIMARY KEY, site text NOT NULL, flow text NOT NULL,
      page_path text NOT NULL DEFAULT '/', device text NOT NULL DEFAULT 'unknown',
      started_at timestamptz NOT NULL DEFAULT now(), last_activity_at timestamptz NOT NULL DEFAULT now(),
      current_step text, current_step_index integer NOT NULL DEFAULT 0, last_completed_step text,
      total_steps integer NOT NULL DEFAULT 0, completion_percent integer NOT NULL DEFAULT 0,
      time_spent_seconds integer NOT NULL DEFAULT 0, selections jsonb NOT NULL DEFAULT '{}'::jsonb,
      validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb, exit_method text NOT NULL DEFAULT 'unknown',
      engaged boolean NOT NULL DEFAULT false, prompt_shown boolean NOT NULL DEFAULT false,
      clicked_call boolean NOT NULL DEFAULT false, clicked_text boolean NOT NULL DEFAULT false,
      requested_callback boolean NOT NULL DEFAULT false, dismissed_prompt boolean NOT NULL DEFAULT false,
      contact_name text, contact_phone text, contact_email text, callback_note text,
      callback_requested_at timestamptz, callback_notified_at timestamptz,
      status text NOT NULL DEFAULT 'active', notified_at timestamptz,
      notify_attempt_count integer NOT NULL DEFAULT 0, notify_last_error text, notify_locked_at timestamptz,
      completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => query(`CREATE INDEX IF NOT EXISTS estimator_sessions_status_activity_idx ON estimator_sessions (status, last_activity_at)`))
      .then(() => undefined)
      .catch((error) => { ensured = null; throw error; });
  }
  return ensured;
}

export async function recordProgress(report: ProgressReport, now = new Date()): Promise<{ stored: boolean }> {
  if (!isDatabaseConfigured()) return { stored: false };
  await ensureEstimatorSessionsTable();
  const flow = STEP_RE.test(report.flow) ? report.flow : "unknown";
  const currentStep = report.currentStep && STEP_RE.test(report.currentStep) ? report.currentStep : null;
  const lastCompletedStep = report.lastCompletedStep && STEP_RE.test(report.lastCompletedStep) ? report.lastCompletedStep : null;
  const totalSteps = Math.max(0, Math.min(50, Math.floor(Number(report.totalSteps) || 0)));
  const currentStepIndex = Math.max(0, Math.min(50, Math.floor(Number(report.currentStepIndex) || 0)));
  const completion = report.status === "completed" ? 100 : totalSteps > 0 ? Math.round((Math.min(currentStepIndex, totalSteps) / totalSteps) * 100) : 0;
  const startedAt = report.startedAt && Number.isFinite(report.startedAt) ? new Date(Math.min(report.startedAt, now.getTime())) : now;
  const timeSpent = Math.max(0, Math.min(6 * 3600, Math.round((now.getTime() - startedAt.getTime()) / 1000)));
  const engaged = isEngaged(currentStepIndex, lastCompletedStep, timeSpent);
  const selections = sanitizeSelections(report.selections);
  const validationErrors = (report.validationErrors ?? []).filter((e) => typeof e === "string").map((e) => e.slice(0, 80)).slice(0, 20);
  const exitMethod = report.exitMethod && STEP_RE.test(report.exitMethod) ? report.exitMethod : "unknown";
  const device = report.device && /^(phone|tablet|desktop)$/.test(report.device) ? report.device : "unknown";
  const completed = report.status === "completed";
  const r = report.recovery ?? {};
  await query(
    `INSERT INTO estimator_sessions (id, site, flow, page_path, device, started_at, last_activity_at, current_step,
       current_step_index, last_completed_step, total_steps, completion_percent, time_spent_seconds, selections,
       validation_errors, exit_method, engaged, prompt_shown, clicked_call, clicked_text, dismissed_prompt,
       status, completed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23,$7)
     ON CONFLICT (id) DO UPDATE SET
       flow = EXCLUDED.flow, page_path = EXCLUDED.page_path, device = EXCLUDED.device,
       last_activity_at = GREATEST(estimator_sessions.last_activity_at, EXCLUDED.last_activity_at),
       current_step = EXCLUDED.current_step, current_step_index = EXCLUDED.current_step_index,
       last_completed_step = COALESCE(EXCLUDED.last_completed_step, estimator_sessions.last_completed_step),
       total_steps = EXCLUDED.total_steps, completion_percent = EXCLUDED.completion_percent,
       time_spent_seconds = GREATEST(estimator_sessions.time_spent_seconds, EXCLUDED.time_spent_seconds),
       selections = EXCLUDED.selections, validation_errors = EXCLUDED.validation_errors,
       exit_method = CASE WHEN EXCLUDED.exit_method = 'unknown' THEN estimator_sessions.exit_method ELSE EXCLUDED.exit_method END,
       engaged = estimator_sessions.engaged OR EXCLUDED.engaged,
       prompt_shown = estimator_sessions.prompt_shown OR EXCLUDED.prompt_shown,
       clicked_call = estimator_sessions.clicked_call OR EXCLUDED.clicked_call,
       clicked_text = estimator_sessions.clicked_text OR EXCLUDED.clicked_text,
       dismissed_prompt = estimator_sessions.dismissed_prompt OR EXCLUDED.dismissed_prompt,
       status = CASE WHEN $22 = 'completed' THEN (CASE WHEN estimator_sessions.status = 'notified' THEN 'recovered' ELSE 'completed' END)
                     ELSE estimator_sessions.status END,
       completed_at = CASE WHEN $22 = 'completed' THEN COALESCE(estimator_sessions.completed_at, EXCLUDED.completed_at) ELSE estimator_sessions.completed_at END,
       updated_at = EXCLUDED.updated_at`,
    [report.sessionId, SITE, flow, sanitizePath(report.pagePath), device, startedAt, now, currentStep, currentStepIndex,
      lastCompletedStep, totalSteps, completion, timeSpent, JSON.stringify(selections), JSON.stringify(validationErrors),
      exitMethod, engaged, Boolean(r.shown), Boolean(r.call), Boolean(r.text), Boolean(r.dismissed),
      completed ? "completed" : "active", completed ? now : null],
  );
  return { stored: true };
}

export interface CallbackRequest { sessionId: string; flow: string; phone: string; name?: string; note?: string; pagePath?: string; device?: string }

export async function recordCallbackRequest(req: CallbackRequest, now = new Date()): Promise<{ stored: boolean; notified: boolean; error?: string }> {
  if (!isDatabaseConfigured()) return { stored: false, notified: false, error: "persistence_unavailable" };
  await ensureEstimatorSessionsTable();
  const phone = req.phone.replace(/\D/g, "").slice(-10);
  const name = req.name?.trim().slice(0, 80) || null;
  const note = req.note?.trim().slice(0, 500) || null;
  await query(
    `INSERT INTO estimator_sessions (id, site, flow, page_path, device, last_activity_at, engaged, prompt_shown, requested_callback,
       contact_name, contact_phone, callback_note, callback_requested_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,true,true,$7,$8,$9,$6,$6)
     ON CONFLICT (id) DO UPDATE SET last_activity_at = $6, engaged = true, prompt_shown = true, requested_callback = true,
       contact_name = COALESCE($7, estimator_sessions.contact_name), contact_phone = $8,
       callback_note = COALESCE($9, estimator_sessions.callback_note),
       callback_requested_at = COALESCE(estimator_sessions.callback_requested_at, $6), updated_at = $6`,
    [req.sessionId, SITE, STEP_RE.test(req.flow) ? req.flow : "unknown", sanitizePath(req.pagePath),
      req.device && /^(phone|tablet|desktop)$/.test(req.device) ? req.device : "unknown", now, name, phone, note],
  );
  const claimed = await queryOne<SessionRow>(
    `UPDATE estimator_sessions SET callback_notified_at = $2 WHERE id = $1 AND callback_notified_at IS NULL RETURNING *`,
    [req.sessionId, now],
  );
  if (!claimed) return { stored: true, notified: false };
  try {
    await sendToStaff(buildCallbackMessage(claimed));
    return { stored: true, notified: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(`UPDATE estimator_sessions SET callback_notified_at = NULL, notify_last_error = $2, updated_at = now() WHERE id = $1`, [req.sessionId, `callback: ${message}`.slice(0, 500)]);
    console.error("[estimator-recovery] callback notification failed", { sessionId: req.sessionId, message });
    return { stored: true, notified: false, error: message };
  }
}

type Sender = (to: string, message: { subject: string; text: string; html: string }) => Promise<void>;
let senderOverride: Sender | null = null;
/** Test seam: capture emails instead of sending. */
export function installEstimatorSessionsSender(sender: Sender | null): void { senderOverride = sender; }

async function sendToStaff(message: { subject: string; text: string; html: string }): Promise<void> {
  const people = [...(await peopleWithRole(["manager"])), ...(await peopleWithRole(["administrator"]))];
  const emails = [...new Set(people.map((p) => p.email.toLowerCase()))];
  if (emails.length === 0) throw new Error("no active manager or administrator to notify");
  const transport = activeTransport();
  for (const to of emails) {
    if (senderOverride) { await senderOverride(to, message); continue; }
    const result = await transport.send(to, message);
    if (!result.ok) throw new Error(result.error);
  }
}

export interface SweepResult { considered: number; sent: number; failed: number; purged: number; skipped: boolean }
let lastSweepAt = 0;
let sweepInFlight: Promise<SweepResult> | null = null;

export function sweepIfDue(now = new Date()): Promise<SweepResult> {
  if (sweepInFlight) return sweepInFlight;
  if (now.getTime() - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return Promise.resolve({ considered: 0, sent: 0, failed: 0, purged: 0, skipped: true });
  lastSweepAt = now.getTime();
  sweepInFlight = sweepAbandonedSessions({ now, limit: 10 }).finally(() => { sweepInFlight = null; });
  return sweepInFlight;
}

export async function sweepAbandonedSessions(opts: { now?: Date; limit?: number } = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const result: SweepResult = { considered: 0, sent: 0, failed: 0, purged: 0, skipped: false };
  if (!isDatabaseConfigured()) return { ...result, skipped: true };
  await ensureEstimatorSessionsTable();
  const idleBefore = new Date(now.getTime() - INACTIVITY_MS);
  const lockExpired = new Date(now.getTime() - NOTIFY_LOCK_MS);
  const candidates = await query<{ id: string }>(
    `SELECT id FROM estimator_sessions
      WHERE status = 'active' AND engaged AND NOT requested_callback AND last_activity_at < $1
        AND notify_attempt_count < $2 AND (notify_locked_at IS NULL OR notify_locked_at < $3)
      LIMIT $4`,
    [idleBefore, MAX_NOTIFY_ATTEMPTS, lockExpired, limit],
  );
  result.considered = candidates.length;
  for (const { id } of candidates) {
    const claimed = await queryOne<SessionRow>(
      `UPDATE estimator_sessions SET notify_locked_at = $2, notify_attempt_count = notify_attempt_count + 1, updated_at = $2
        WHERE id = $1 AND status = 'active' AND NOT requested_callback AND last_activity_at < $3
          AND (notify_locked_at IS NULL OR notify_locked_at < $4)
        RETURNING *`,
      [id, now, idleBefore, lockExpired],
    );
    if (!claimed) continue;
    try {
      await sendToStaff(buildAbandonmentMessage(claimed));
      await query(`UPDATE estimator_sessions SET status = CASE WHEN status = 'active' THEN 'notified' ELSE status END, notified_at = $2, notify_locked_at = NULL, notify_last_error = NULL, updated_at = $2 WHERE id = $1`, [id, now]);
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await query(`UPDATE estimator_sessions SET notify_last_error = $2, notify_locked_at = NULL, updated_at = $3 WHERE id = $1`, [id, message.slice(0, 500), now]);
      console.error("[estimator-recovery] abandonment email failed", { sessionId: id, message });
      result.failed += 1;
    }
  }
  const purged = await query<{ id: string }>(`DELETE FROM estimator_sessions WHERE created_at < $1 RETURNING id`, [new Date(now.getTime() - RETENTION_DAYS * 86400 * 1000)]);
  result.purged = purged.length;
  await query(`UPDATE estimator_sessions SET status = 'expired', updated_at = $2 WHERE status = 'active' AND NOT engaged AND last_activity_at < $1`, [new Date(now.getTime() - 7 * 86400 * 1000), now]);
  return result;
}

/* ─── Email content ─────────────────────────────────────────────────────── */

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Boise" }).format(d) : "n/a";
}
function pretty(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : phone ?? "";
}
function yes(v: boolean): string { return v ? "Yes" : "No"; }

export function sessionFacts(s: SessionRow): Array<[string, string]> {
  const base = (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
  return [
    ["Website", `${SITE} (p5homeco.com)`],
    ["Form", s.flow === "quote" ? "Quote form" : s.flow],
    ["Page", `${base}${s.page_path}`],
    ["Started", fmt(s.started_at)],
    ["Last activity", fmt(s.last_activity_at)],
    ["Device", s.device],
    ["Session id", s.id],
    ["Current step", s.current_step ?? "n/a"],
    ["Last completed step", s.last_completed_step ?? "none"],
    ["Progress", `${s.completion_percent}% (step ${s.current_step_index + 1} of ${s.total_steps || "?"})`],
    ["Time in form", `${s.time_spent_seconds}s`],
    ["Validation errors", s.validation_errors?.length ? s.validation_errors.join(", ") : "None"],
    ["Exit method", s.exit_method === "unknown" ? "Unknown" : s.exit_method.replace(/_/g, " ")],
    ["Recovery prompt shown", yes(s.prompt_shown)],
    ["Clicked to call", yes(s.clicked_call)],
    ["Clicked to text", yes(s.clicked_text)],
    ["Requested a callback", yes(s.requested_callback)],
    ["Dismissed the prompt", yes(s.dismissed_prompt)],
  ];
}

function contactLines(s: SessionRow): Array<[string, string]> {
  if (!s.contact_phone && !s.contact_email && !s.contact_name) return [["Contact", "No contact information was provided (anonymous partial completion)"]];
  const rows: Array<[string, string]> = [];
  if (s.contact_name) rows.push(["Name", s.contact_name]);
  if (s.contact_phone) rows.push(["Phone", pretty(s.contact_phone)]);
  if (s.contact_email) rows.push(["Email", s.contact_email]);
  if (s.callback_note) rows.push(["Note", s.callback_note]);
  return rows;
}

function render(title: string, intro: string, s: SessionRow): { subject: string; text: string; html: string } {
  const sections: Array<[string, Array<[string, string]>]> = [
    ["Contact", contactLines(s)],
    ["Session", sessionFacts(s)],
    ["Selections so far", Object.keys(s.selections ?? {}).length ? Object.entries(s.selections).map(([k, v]) => [k.replace(/_/g, " "), v === null ? "n/a" : String(v)] as [string, string]) : [["Selections", "None recorded"]]],
  ];
  const text = [title, "", intro, "", ...sections.flatMap(([h, rows]) => [h.toUpperCase(), ...rows.map(([k, v]) => `${k}: ${v}`), ""]), "A call or text click shows intent only; it does not confirm a conversation. Exit method is unknown when the browser gave no signal."].join("\n");
  const html = `<div style="font-family:Manrope,Arial,sans-serif;max-width:600px;margin:0 auto;color:#20231f;">
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 12px;">${esc(title)}</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 20px;">${esc(intro)}</p>
    ${sections.map(([h, rows]) => `<h2 style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin:20px 0 8px;color:#6c756e;">${esc(h)}</h2>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">${rows.map(([k, v]) => `<tr><td style="padding:5px 12px 5px 0;color:#6c756e;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;">${esc(v)}</td></tr>`).join("")}</table>`).join("")}
    <p style="font-size:12px;color:#6c756e;margin-top:22px;">A call or text click shows intent only; it does not confirm a conversation. Exit method is unknown when the browser gave no signal.</p>
  </div>`;
  return { subject: title, text, html };
}

export function buildAbandonmentMessage(s: SessionRow): { subject: string; text: string; html: string } {
  const anonymous = !s.contact_phone && !s.contact_email;
  return render(
    `[Partial] ${anonymous ? "Anonymous" : "Identified"} quote form drop-off at ${s.current_step ?? "unknown step"} (${s.completion_percent}%)`,
    `A visitor started the P5 Home Co quote form and stopped without submitting. This is a partial completion, not a lead. One summary is sent per session.`,
    s,
  );
}

export function buildCallbackMessage(s: SessionRow): { subject: string; text: string; html: string } {
  return render(
    `Callback requested: ${s.contact_name ? `${s.contact_name}, ` : ""}${pretty(s.contact_phone)} (quote form)`,
    `A visitor who was leaving the quote form asked for a call back instead. Call them at the number below; they were told to expect a call within one business day.`,
    s,
  );
}
