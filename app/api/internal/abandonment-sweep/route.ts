import { NextResponse } from "next/server";
import { sweepAbandonedSessions } from "../../../lib/leads/estimatorSessions.ts";

export const dynamic = "force-dynamic";

/**
 * Manual or scheduled sweep of abandoned quote-form sessions. The five-minute
 * watchdog already runs it; this exists for an operator or a separate
 * schedule. Same secret as the watchdog; refuses to run unauthenticated.
 */
function authorized(request: Request): boolean {
  const secret = process.env.WATCHDOG_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : request.headers.get("x-watchdog-secret")?.trim() ?? "";
  return token.length > 0 && token === secret;
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sweepAbandonedSessions({ limit: 50 })) });
  } catch (error) {
    console.error("[abandonment-sweep] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "sweep_failed" }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
