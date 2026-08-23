/**
 * Scheduler entry point for the daily finance job (S143).
 *
 * Same authentication contract as the watchdog: a shared secret, because the
 * caller is a cron scheduler. Reuses WATCHDOG_SECRET so operators configure
 * one scheduler credential, not two.
 */

import { NextResponse } from "next/server";

import { secretsMatch } from "../../../lib/auth.ts";
import { isDatabaseConfigured } from "../../../lib/db.ts";
import { runFinanceDaily } from "../../../lib/finance/jobs.ts";

export const dynamic = "force-dynamic";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return request.headers.get("x-watchdog-secret");
}

async function handle(request: Request): Promise<NextResponse> {
  const expected = process.env.WATCHDOG_SECRET;
  if (!expected) {
    console.error("[finance-job] WATCHDOG_SECRET is not set; refusing to run.");
    return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  }
  if (!secretsMatch(bearer(request), expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured." }, { status: 503 });
  }

  const summary = await runFinanceDaily("daily");
  return NextResponse.json(
    { ok: summary.status !== "failed", ...summary },
    { status: summary.status === "failed" ? 500 : 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
