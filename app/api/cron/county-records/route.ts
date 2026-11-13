/**
 * Refresh our copy of the county assessor's building records now. The
 * estimator also refreshes it by itself when it is old; this is for the first
 * load after a deploy, or to force one. Same bearer secret as the other
 * scheduled routes.
 */

import { timingSafeEqual } from "node:crypto";

import { importAdaResidences } from "../../../lib/estimator/county-records.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return Response.json({ ok: false, error: "Scheduler is not configured." }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await importAdaResidences();
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    console.error("[estimator] county records import failed:", (error as Error).message);
    return Response.json({ ok: false, error: "Import failed." }, { status: 502 });
  }
}
