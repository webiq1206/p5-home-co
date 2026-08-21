/**
 * Sign out. POST only, so a stray link or prefetch cannot end a session.
 */

import { NextResponse } from "next/server";

import { destroySession, SESSION_COOKIE } from "../../../lib/auth.ts";
import { appUrl } from "../../../lib/public-url.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  await destroySession().catch(() => undefined);
  const response = NextResponse.redirect(appUrl(request, "/admin/login"), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
