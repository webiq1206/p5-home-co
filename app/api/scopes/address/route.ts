/**
 * Address suggestions while typing (?q=) and the full address for a picked
 * suggestion (?placeId=). Signed-in people only; the Google key stays here.
 */

import { isAddressLookupConfigured, resolve, suggest } from "../../../lib/scopes/address.ts";
import { fail, ok, requireEmployee } from "../../../lib/scopes/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  // Not an error: the field simply works as a plain text box until a key is added.
  if (!isAddressLookupConfigured()) return ok({ configured: false, suggestions: [] });
  const params = new URL(request.url).searchParams;
  const session = params.get("session") ?? "";
  try {
    const placeId = params.get("placeId");
    if (placeId) return ok({ configured: true, address: await resolve(placeId, session) });
    return ok({ configured: true, suggestions: await suggest(params.get("q") ?? "", session) });
  } catch (error) {
    return fail(error, 502);
  }
}
