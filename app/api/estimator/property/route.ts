/**
 * Public property record for an address the customer picked. Returns
 * { property: null } whenever nothing reliable is available; the estimator
 * carries on without it.
 */

import { after } from "next/server";

import { allowIntakeRequest } from "../../leads/intake/abuse.ts";
import { refreshCountyRecordsIfStale } from "../../../lib/estimator/county-records.ts";
import { isPropertyLookupConfigured, lookupProperty } from "../../../lib/estimator/property.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isPropertyLookupConfigured() || address.trim().length < 8) return Response.json({ ok: true, property: null });
  try {
    if (!(await allowIntakeRequest(request, new Date(), { name: "estimator-property", max: 30 }))) return Response.json({ ok: true, property: null });
    // Keeps our copy of the county file current without a scheduler. It runs after the reply.
    after(() => refreshCountyRecordsIfStale().then(() => undefined));
    return Response.json({ ok: true, property: await lookupProperty(address) });
  } catch {
    return Response.json({ ok: true, property: null });
  }
}
