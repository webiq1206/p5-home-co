/**
 * Scheduler entry point for the five-minute watchdog.
 *
 * Authenticated with a shared secret rather than a session, because the caller
 * is a cron scheduler and not a signed-in person. Without WATCHDOG_SECRET set,
 * the endpoint refuses rather than running unauthenticated.
 */

import { NextResponse } from "next/server";

import { secretsMatch } from "../../../lib/auth.ts";
import { isDatabaseConfigured } from "../../../lib/db.ts";
import { runWatchdog } from "../../../lib/leads/watchdog.ts";

export const dynamic = "force-dynamic";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return request.headers.get("x-watchdog-secret");
}

async function handle(request: Request): Promise<NextResponse> {
  const expected = process.env.WATCHDOG_SECRET;
  if (!expected) {
    console.error("[watchdog] WATCHDOG_SECRET is not set; refusing to run.");
    return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  }
  if (!secretsMatch(bearer(request), expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured." }, { status: 503 });
  }

  const summary = await runWatchdog();
  // A skipped-because-locked tick is a normal outcome, not a failure.
  const status = summary.status === "failed" ? 500 : 200;
  return NextResponse.json({ ok: summary.status !== "failed", ...summary }, { status });
}

export const POST = handle;
export const GET = handle;
