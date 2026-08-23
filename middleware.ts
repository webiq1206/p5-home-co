/**
 * Search-engine exclusion for everything private (S216).
 *
 * Next's `metadata.robots` writes a <meta> tag into the HTML document. That is
 * necessary but not sufficient, because a meta tag only exists inside HTML:
 *
 *   - JSON from /api/ has no <head> to put it in.
 *   - A PDF, CSV or any file response carries no meta tag.
 *   - A crawler that fetches without parsing sees nothing.
 *
 * The HTTP header covers all of those, because it travels with the response
 * rather than inside it. Both are kept: the meta tag for HTML, the header for
 * everything, and neither depends on the other being right.
 *
 * The other reason this lives in middleware rather than in each page is that a
 * page added tomorrow is protected without anybody remembering to protect it.
 * A rule that has to be re-applied by hand is a rule that eventually is not.
 *
 * The decision itself is in app/lib/privacy.ts, so it can be tested without
 * the Next runtime and so robots.txt reads from the same list.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ROBOTS_TAG, isPrivatePath } from "./app/lib/privacy.ts";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (isPrivatePath(request.nextUrl.pathname)) {
    response.headers.set("X-Robots-Tag", ROBOTS_TAG);
    // A private page cached by a shared proxy can be served to somebody who
    // never authenticated. This is about disclosure, not performance.
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  return response;
}

export const config = {
  // Static assets and the crawler-facing files are deliberately excluded:
  // robots.txt and sitemap.xml must stay fetchable and cacheable.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
