/**
 * Address suggestions for the public estimator (?q=) and the full address for
 * a picked suggestion (?placeId=). The Google key stays on the server.
 */

import { allowIntakeRequest } from "../../leads/intake/abuse.ts";
import { isAddressLookupConfigured, resolve, suggest } from "../../../lib/scopes/address.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // Without a Google key the field is a plain text box and the address is typed by hand.
  if (!isAddressLookupConfigured()) return Response.json({ ok: true, configured: false, suggestions: [] });
  const params = new URL(request.url).searchParams;
  const session = (params.get("session") ?? "").slice(0, 64);
  try {
    if (!(await allowIntakeRequest(request, new Date(), { name: "estimator-address", max: 300 }))) {
      return Response.json({ ok: true, configured: false, suggestions: [] });
    }
    const placeId = params.get("placeId");
    if (placeId) return Response.json({ ok: true, configured: true, address: await resolve(placeId.slice(0, 300), session) });
    return Response.json({ ok: true, configured: true, suggestions: await suggest((params.get("q") ?? "").slice(0, 120), session) });
  } catch {
    // Typing the address by hand always works.
    return Response.json({ ok: true, configured: false, suggestions: [] });
  }
}
