/**
 * Start the QuickBooks OAuth flow. Administrator-only (S169: least privilege;
 * connecting accounting is the highest-trust action in the system).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getSessionUser } from "../../../lib/auth.ts";
import { isTokenKeyConfigured } from "../../../lib/finance/crypto.ts";
import { buildAuthorizeUrl, isQboConfigured } from "../../../lib/finance/qbo/oauth.ts";
import { appUrl } from "../../../lib/public-url.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user || user.role !== "administrator") {
    return NextResponse.json({ ok: false, error: "Administrator only." }, { status: 403 });
  }
  if (!isQboConfigured()) {
    return NextResponse.json(
      { ok: false, error: "QBO_CLIENT_ID / QBO_CLIENT_SECRET are not configured." },
      { status: 503 },
    );
  }
  if (!isTokenKeyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "QBO_TOKEN_KEY is not configured; refusing to store tokens unencrypted." },
      { status: 503 },
    );
  }

  const redirectUri = appUrl(request, "/api/qbo/callback");
  const { url, state } = await buildAuthorizeUrl(redirectUri);

  const store = await cookies();
  store.set("qbo_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 600,
    path: "/api/qbo",
  });
  return NextResponse.redirect(url);
}
