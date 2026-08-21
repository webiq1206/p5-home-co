/**
 * Start Google Workspace sign-in.
 *
 * Generates a state and nonce, parks them in short-lived httpOnly cookies, and
 * hands the browser to Google. The state is what makes the callback safe: a
 * response that does not carry back the value we issued did not come from a
 * flow this browser started.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import {
  buildAuthorizeUrl,
  isGoogleConfigured,
  redirectUriFor,
} from "../../../lib/google-auth.ts";

export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "p5_oauth_state";
export const OAUTH_NONCE_COOKIE = "p5_oauth_nonce";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isGoogleConfigured()) {
    // The login page already says this; anyone reaching the route directly
    // deserves the same answer rather than a stack trace.
    return NextResponse.redirect(new URL("/admin/login?error=unconfigured", request.url));
  }

  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");

  const target = buildAuthorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID as string,
    redirectUri: redirectUriFor(request.url),
    state,
    nonce,
  });

  const response = NextResponse.redirect(target);
  const secure = new URL(request.url).protocol === "https:";
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 600, // ten minutes is plenty to complete a sign-in
  };
  response.cookies.set(OAUTH_STATE_COOKIE, state, options);
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, options);
  return response;
}
