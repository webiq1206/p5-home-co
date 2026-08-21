/**
 * Finish Google Workspace sign-in.
 *
 * Exchanges the code server-to-server, checks the identity, confirms the
 * person is a known active user, and only then issues a session.
 *
 * Access requires both an approved domain and an existing app_user row. The
 * second is deliberate: without it, anyone with a company address could grant
 * themselves an account merely by signing in, which is not the same as having
 * been given access.
 */

import { NextResponse } from "next/server";

import { createSession, SESSION_COOKIE } from "../../../../lib/auth.ts";
import { isDatabaseConfigured, query } from "../../../../lib/db.ts";
import {
  checkIdentity,
  decodeIdToken,
  GOOGLE_TOKEN_URL,
  isGoogleConfigured,
  isRejection,
  redirectUriFor,
} from "../../../../lib/google-auth.ts";
import type { Role } from "../../../../lib/leads/types.ts";
import { OAUTH_NONCE_COOKIE, OAUTH_STATE_COOKIE } from "../route.ts";

export const dynamic = "force-dynamic";

function back(request: Request, error: string): NextResponse {
  const url = new URL("/admin/login", request.url);
  url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  // Whatever happened, the one-shot cookies are spent.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_NONCE_COOKIE);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isGoogleConfigured() || !isDatabaseConfigured()) {
    return back(request, "unconfigured");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  // Google reports its own refusals here, such as the user cancelling.
  if (url.searchParams.get("error")) return back(request, "cancelled");
  if (!code || !returnedState) return back(request, "invalid");

  const expectedState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.split("=")[1];

  // Constant-time comparison is unnecessary here: the state is single-use and
  // useless once spent. What matters is that it matches at all.
  if (!expectedState || expectedState !== returnedState) {
    return back(request, "state");
  }

  let identityToken: string;
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        redirect_uri: redirectUriFor(request),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      console.error("[auth] token exchange failed:", tokenResponse.status);
      return back(request, "exchange");
    }
    const payload = (await tokenResponse.json()) as { id_token?: string };
    if (!payload.id_token) return back(request, "exchange");
    identityToken = payload.id_token;
  } catch (error) {
    console.error("[auth] token exchange error:", (error as Error).message);
    return back(request, "exchange");
  }

  const identity = decodeIdToken(identityToken);
  if (isRejection(identity)) return back(request, "identity");

  const problem = checkIdentity(identity);
  if (problem) return back(request, "domain");

  // The allowlist. Matching on the stored email means access is granted by
  // adding someone to app_user, not by them owning a company address.
  const rows = await query<{ id: string; is_active: boolean; role: Role }>(
    "SELECT id, is_active, role FROM app_user WHERE lower(email) = $1",
    [identity.email],
  );
  const account = rows[0];
  if (!account) return back(request, "notinvited");
  if (!account.is_active) return back(request, "disabled");

  const { token, expiresAt } = await createSession(Number(account.id), {
    userAgent: request.headers.get("user-agent"),
    ip: request.headers.get("x-forwarded-for"),
  });

  await query(
    `INSERT INTO audit_log (user_id, record_type, record_id, action, action_source, integration_source)
     VALUES ($1,'app_user',$2,'signed_in','admin_ui','google')`,
    [Number(account.id), String(account.id)],
  ).catch(() => undefined);

  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    expires: expiresAt,
  });
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_NONCE_COOKIE);
  return response;
}
