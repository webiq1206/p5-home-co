import { PRIVATE_PREFIXES } from "./privacy.ts";

/**
 * The Meta (Facebook) pixel for the public site (owner decision, 13 November
 * 2026), so Meta campaigns for the instant estimate can optimise for leads.
 *
 * Everything that decides whether the pixel may run is here, apart from React,
 * so it can be tested without the Next runtime. app/MetaPixel.tsx renders it.
 * This is the browser pixel only. There is no server-side Conversions API
 * route, and the Meta lead-ads webhook under app/api/meta is unrelated.
 */

export const META_PIXEL_SCRIPT_URL = "https://connect.facebook.net/en_US/fbevents.js";

/**
 * The dataset id from NEXT_PUBLIC_META_PIXEL_ID. There is deliberately no
 * default: no P5 Home Co dataset existed when this was written, and a default
 * would send this site's visitors to some other company's dataset. Unset, or
 * anything that is not a plain number, means no pixel at all.
 */
export function readMetaPixelId(value: string | undefined): string {
  const id = (value ?? "").trim();
  return /^\d{5,20}$/.test(id) ? id : "";
}

// HubSpotScript's test for these two is a bare startsWith, so it is kept as it is.
const BARE_PREFIXES = ["/admin", "/portal"] as const;
// Every private path (app/lib/privacy.ts), plus the framed estimator.
const EXACT_PREFIXES = [...PRIVATE_PREFIXES, "/estimator/embed"] as const;

/**
 * Whether the pixel may run on a path. The public site only: never the admin,
 * the portals or any other private path (the same test HubSpot uses), and
 * never the framed estimator, which is shown inside a brand site's page. That
 * site measures its own visitors and counts its own leads.
 */
export function metaPixelAllowedOn(pathname: string): boolean {
  if (BARE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return !EXACT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The inline script that starts the pixel: the fbq queue, the dataset, one
 * PageView and the request for fbevents.js. It repeats the Google tag's gates
 * (lib/analyticsBootstrap.ts): the real host only, never an automated browser,
 * never a visit with analytics switched off. It also repeats the path rule,
 * because next/script may run it a moment after the visitor has moved on to a
 * private page.
 *
 * autoConfig is turned off before init, so the pixel does not record button
 * clicks or page metadata by itself, and init is given no visitor details.
 * disablePushState stops the pixel sending a PageView for every in-app
 * navigation on its own. app/MetaPixel.tsx sends those, for public paths only.
 */
export function metaPixelSnippet(options: { id: string; hostname: string }): string {
  const id = readMetaPixelId(options.id);
  if (!id) return "";
  const config = JSON.stringify({ id, hostname: options.hostname, src: META_PIXEL_SCRIPT_URL, bare: BARE_PREFIXES, exact: EXACT_PREFIXES }).replace(/</g, "\\u003c");
  return `(function () {
  var config = ${config};
  var host = window.location.hostname.toLowerCase();
  if (host !== config.hostname && host !== 'www.' + config.hostname) return;
  if (navigator.webdriver === true) return;
  var path = window.location.pathname || '';
  var i;
  for (i = 0; i < config.bare.length; i++) if (path.indexOf(config.bare[i]) === 0) return;
  for (i = 0; i < config.exact.length; i++) if (path === config.exact[i] || path.indexOf(config.exact[i] + '/') === 0) return;
  try { if (sessionStorage.getItem('p5_analytics_disabled') === '1') return; } catch (e) {}
  if (window.fbq) return;
  var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!window._fbq) window._fbq = n;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  n.disablePushState = true;
  window.fbq('set', 'autoConfig', false, config.id);
  window.fbq('init', config.id);
  window.fbq('track', 'PageView');
  var tag = document.createElement('script');
  tag.async = true;
  tag.src = config.src;
  document.head.appendChild(tag);
})();`;
}
