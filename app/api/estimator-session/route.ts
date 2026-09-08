import { NextResponse } from "next/server";
import { SESSION_ID_RE, recordProgress, sweepIfDue } from "../../lib/leads/estimatorSessions.ts";

export const dynamic = "force-dynamic";

const buckets = new Map<string, { count: number; resetAt: number }>();
function allow(ip: string, limit = 120, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) { buckets.set(ip, { count: 1, resetAt: now + windowMs }); return true; }
  b.count += 1;
  return b.count <= limit;
}
function ip(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

/** Progress beacon for the quote form; see docs/estimator-recovery.md. */
export async function POST(request: Request) {
  if (!allow(ip(request))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  let raw: unknown;
  try { raw = JSON.parse(await request.text()); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || !SESSION_ID_RE.test(r.sessionId) || typeof r.flow !== "string" || r.flow.length > 40) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : undefined);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  try {
    const { stored } = await recordProgress({
      sessionId: r.sessionId,
      flow: r.flow,
      pagePath: str(r.pagePath, 400),
      device: str(r.device, 10),
      startedAt: typeof r.startedAt === "number" ? r.startedAt : undefined,
      currentStep: str(r.currentStep, 60),
      currentStepIndex: num(r.currentStepIndex, 50),
      lastCompletedStep: str(r.lastCompletedStep, 60),
      totalSteps: num(r.totalSteps, 50),
      selections: typeof r.selections === "object" && r.selections ? (r.selections as Record<string, unknown>) : undefined,
      validationErrors: Array.isArray(r.validationErrors) ? r.validationErrors.filter((e): e is string => typeof e === "string").slice(0, 20) : undefined,
      exitMethod: str(r.exitMethod, 40),
      status: r.status === "completed" ? "completed" : "active",
      recovery: typeof r.recovery === "object" && r.recovery ? (r.recovery as { shown?: boolean; call?: boolean; text?: boolean; dismissed?: boolean }) : undefined,
    });
    const sweep = await sweepIfDue();
    return NextResponse.json({ ok: true, stored, sweep: sweep.skipped ? "skipped" : `sent ${sweep.sent}` });
  } catch (error) {
    console.error("[estimator-session] record failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "persistence_failed" }, { status: 503 });
  }
}
