/**
 * QuickBooks OAuth callback. Verifies the state cookie, exchanges the code,
 * stores encrypted tokens, and kicks off an initial sync so the read model
 * is populated the moment the connection completes.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getSessionUser } from "../../../lib/auth.ts";
import { completeConnection } from "../../../lib/finance/qbo/oauth.ts";
import { runQboSync } from "../../../lib/finance/qbo/sync.ts";
import { appUrl } from "../../../lib/public-url.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user || user.role !== "administrator") {
    return NextResponse.json({ ok: false, error: "Administrator only." }, { status: 403 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get("qbo_oauth_state")?.value;
  store.delete("qbo_oauth_state");

  if (!code || !realmId) {
    return NextResponse.redirect(appUrl(request, "/admin/finance/health?qbo=denied"));
  }
  if (!expectedState || state !== expectedState) {
    return NextResponse.json({ ok: false, error: "OAuth state mismatch." }, { status: 400 });
  }

  await completeConnection(code, realmId, appUrl(request, "/api/qbo/callback"), user.id);

  // First pull; a failure here is visible in health rather than fatal.
  try {
    await runQboSync("manual");
  } catch (error) {
    console.error("[qbo] initial sync failed:", (error as Error).message);
  }

  return NextResponse.redirect(appUrl(request, "/admin/finance/health?qbo=connected"));
}
