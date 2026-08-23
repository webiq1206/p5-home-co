/**
 * Which paths are private, and what to tell crawlers about them (S216).
 *
 * Kept apart from middleware.ts so the rule can be tested without pulling in
 * the Next runtime - the same split used for every other decision in this
 * codebase. Both middleware.ts and app/robots.ts read from here, so the header
 * and robots.txt cannot drift apart.
 */

/**
 * Everything that must never appear in a search result.
 *
 * `/admin` covers the Knowledge Center and every finance page beneath it.
 * `/portal` is the client and vendor portals - each page addresses a named
 * customer or subcontractor, so indexing one would reveal who P5 works with
 * before a crawler ever reached the login.
 */
export const PRIVATE_PREFIXES = ["/admin", "/portal", "/api"] as const;

/**
 * noindex stops it being listed. nofollow stops links inside it being crawled
 * onward. noarchive stops a cached copy outliving the page, which matters most
 * here: a cached admin page would survive long after access was revoked.
 */
export const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet";

/**
 * Whether a path is private.
 *
 * Matches the prefix or the prefix followed by a slash - never a bare
 * startsWith, which would deindex a public page like "/administration-services"
 * or "/portal-homes" the day somebody writes one.
 */
export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
