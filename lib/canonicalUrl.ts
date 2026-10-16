import { siteUrl } from "../app/site.ts";

const UTM_PARAM = /^utm_/i;

/** Remove utm_* parameters. Other query parameters stay in place. */
export function stripUtmParams(url: URL): boolean {
  let removed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (!UTM_PARAM.test(key)) continue;
    url.searchParams.delete(key);
    removed = true;
  }
  return removed;
}

/**
 * Self-canonical for this site. Campaign parameters are not part of the
 * canonical URL, so https://p5homeco.com/?utm_... consolidates to the clean
 * origin. A value that already has no utm_* parameter is returned unchanged.
 */
export function selfCanonical(value: string): string {
  const url = new URL(value, siteUrl);
  const removed = stripUtmParams(url);
  url.hash = "";
  if (!removed) return value;
  if (url.origin !== new URL(siteUrl).origin) return `${url.origin}${url.pathname}${url.search}`;
  if (url.pathname === "/" && url.search === "") return siteUrl;
  return `${url.origin}${url.pathname}${url.search}`;
}

/**
 * Same-origin href with utm_* removed. Hash-only links inherit the current
 * query, so a homepage jump from /?utm_... is rewritten to /#... and is not
 * another indexable copy of the campaign URL. External, phone, and mail
 * links are left alone.
 */
export function internalHref(href: string, current = siteUrl): string {
  if (!href || /^(?:tel|sms|mailto|javascript):/i.test(href)) return href;
  let url: URL;
  try {
    url = new URL(href, current);
  } catch {
    return href;
  }
  if (url.origin !== new URL(siteUrl).origin) return href;
  if (!stripUtmParams(url)) return href;
  return `${url.pathname}${url.search}${url.hash}`;
}
