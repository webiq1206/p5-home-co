/**
 * Retry pass for estimator deliveries that did not finish (a restart between
 * the response and the delivery, mail or HubSpot briefly down). Same bearer
 * secret as the other scheduled routes.
 */

import { timingSafeEqual } from "node:crypto";

import { deliverEstimate } from "../../../lib/estimator/deliver.ts";
import { flowById } from "../../../lib/estimator/flows.ts";
import { unfinishedDeliveries } from "../../../lib/estimator/store.ts";
import { publicOrigin } from "../../../lib/public-url.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return Response.json({ ok: false, error: "Scheduler is not configured." }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const origin = publicOrigin(request);
  const results: { id: number; ok: boolean }[] = [];
  for (const row of await unfinishedDeliveries()) {
    try {
      await deliverEstimate({ id: row.id, origin, service: flowById(row.project)?.service });
      results.push({ id: row.id, ok: true });
    } catch (error) {
      console.error("[estimator] retry failed:", (error as Error).message);
      results.push({ id: row.id, ok: false });
    }
  }
  return Response.json({ ok: true, results });
}
