/**
 * Consume a portal magic link: single-use token -> portal session cookie.
 * Invalid or expired links land on one generic message - the endpoint never
 * distinguishes "expired" from "never existed".
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { isDatabaseConfigured } from "../../../lib/db.ts";
import { consumeLoginToken, PORTAL_COOKIE } from "../../../lib/portal/auth.ts";
import { appUrl } from "../../../lib/public-url.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.redirect(appUrl(request, "/portal?error=1"));
  }
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(appUrl(request, "/portal?error=1"));

  const result = await consumeLoginToken(token, {
    userAgent: request.headers.get("user-agent"),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  if (!result) return NextResponse.redirect(appUrl(request, "/portal?error=1"));

  const store = await cookies();
  store.set(PORTAL_COOKIE, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 30 * 86_400,
    path: "/",
  });
  const home = result.contact.kind === "vendor" ? "/portal/vendor" : "/portal/client";
  return NextResponse.redirect(appUrl(request, home));
}
