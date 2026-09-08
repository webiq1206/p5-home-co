/**
 * Client side of partial-completion tracking.
 *
 * A pseudonymous session id lives in sessionStorage for the life of the tab.
 * Wizards call `reportEstimatorProgress` whenever their step or selections
 * change; reports are coalesced so the server sees at most one every few
 * seconds, and a final report goes out with sendBeacon when the page is hidden
 * or unloaded. Nothing here identifies the visitor: selections are allow-listed
 * on the server and contact fields are never sent from this module.
 */
export type EstimatorFlow = "estimate" | "re10" | "plans" | "consultation" | "quote";

export interface EstimatorProgress {
  flow: EstimatorFlow;
  currentStep: string;
  currentStepIndex: number;
  totalSteps: number;
  lastCompletedStep?: string;
  selections?: Record<string, string | number | boolean | null | undefined>;
  validationErrors?: string[];
  status?: "active" | "completed";
  exitMethod?: string;
}

const SESSION_KEY = "p5_estimator_session";
const STARTED_KEY = "p5_estimator_started_at";
const ENDPOINT = "/api/estimator-session";
const COALESCE_MS = 4000;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
  }
}

export function getEstimatorSessionId(): string {
  const s = storage();
  const existing = s?.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = uuid();
  try {
    s?.setItem(SESSION_KEY, id);
    s?.setItem(STARTED_KEY, String(Date.now()));
  } catch {
    /* private mode: a per-page id is still fine for one visit */
  }
  return id;
}

function startedAt(): number {
  const raw = storage()?.getItem(STARTED_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}

export function deviceCategory(): "phone" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (w < 768 && coarse) return "phone";
  if (w < 1100 && coarse) return "tablet";
  return "desktop";
}

let pending: Record<string, unknown> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
let listenersInstalled = false;

function buildPayload(progress: EstimatorProgress, recovery?: RecoveryFlags): Record<string, unknown> {
  const selections: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(progress.selections ?? {})) {
    if (v === undefined) continue;
    selections[k] = v;
  }
  return {
    sessionId: getEstimatorSessionId(),
    flow: progress.flow,
    pagePath: window.location.pathname,
    device: deviceCategory(),
    startedAt: startedAt(),
    currentStep: progress.currentStep,
    currentStepIndex: progress.currentStepIndex,
    lastCompletedStep: progress.lastCompletedStep,
    totalSteps: progress.totalSteps,
    selections,
    validationErrors: progress.validationErrors ?? [],
    status: progress.status ?? "active",
    exitMethod: progress.exitMethod,
    recovery,
  };
}

function send(payload: Record<string, unknown>, useBeacon = false): void {
  const body = JSON.stringify(payload);
  if (body === lastSent && !useBeacon) return;
  lastSent = body;
  try {
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
      return;
    }
    void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* tracking must never break the estimator */
  }
}

function flush(useBeacon = false): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!pending) return;
  const p = pending;
  pending = null;
  send(p, useBeacon);
}

function installListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  const hide = () => { if (document.visibilityState === "hidden") flush(true); };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", () => flush(true));
}

export interface RecoveryFlags { shown?: boolean; call?: boolean; text?: boolean; dismissed?: boolean }

let lastProgress: EstimatorProgress | null = null;

/** Queue a progress report. Step changes and completions send immediately. */
export function reportEstimatorProgress(progress: EstimatorProgress, opts: { immediate?: boolean; recovery?: RecoveryFlags } = {}): void {
  if (typeof window === "undefined") return;
  installListeners();
  const stepChanged = !lastProgress || lastProgress.currentStep !== progress.currentStep || lastProgress.status !== progress.status;
  lastProgress = progress;
  pending = buildPayload(progress, opts.recovery);
  if (opts.immediate || stepChanged || progress.status === "completed") {
    flush(false);
    return;
  }
  if (!timer) timer = setTimeout(() => flush(false), COALESCE_MS);
}

/** Mark the current flow completed; cancels any pending abandonment summary. */
export function markEstimatorCompleted(flow: EstimatorFlow): void {
  const base = lastProgress && lastProgress.flow === flow ? lastProgress : { flow, currentStep: "submitted", currentStepIndex: 0, totalSteps: 0 };
  reportEstimatorProgress({ ...base, status: "completed" }, { immediate: true });
}

/** Record a recovery-prompt interaction on the session (fire and forget). */
export function recordRecoveryAction(flow: EstimatorFlow, flags: RecoveryFlags, exitMethod?: string): void {
  const base = lastProgress && lastProgress.flow === flow ? lastProgress : { flow, currentStep: "unknown", currentStepIndex: 0, totalSteps: 0 };
  reportEstimatorProgress({ ...base, exitMethod: exitMethod ?? base.exitMethod }, { immediate: true, recovery: flags });
}

export function currentEstimatorProgress(): EstimatorProgress | null {
  return lastProgress;
}
