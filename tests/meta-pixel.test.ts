import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { trackAcceptedInquiry, trackMetaEvent } from "../app/analytics.ts";
import { META_PIXEL_SCRIPT_URL, metaPixelAllowedOn, metaPixelSnippet, readMetaPixelId } from "../app/lib/metaPixel.ts";
import { PRIVATE_PREFIXES } from "../app/lib/privacy.ts";

// The Meta (Facebook) pixel on the public site. Owner decision, 13 November
// 2026. Browser pixel only: no Conversions API, and nothing to do with the
// Meta lead-ads webhook (tests/meta-leadgen.test.ts, tests/meta-admin.test.ts).

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = "123456789012345";

function browser(options: { hostname?: string; pathname?: string; webdriver?: boolean; disabled?: boolean } = {}) {
  const nodes: Record<string, unknown>[] = [];
  const window: Record<string, unknown> = { location: { hostname: options.hostname ?? "p5homeco.com", pathname: options.pathname ?? "/quote" } };
  const context = vm.createContext({
    window,
    navigator: { webdriver: options.webdriver === true },
    sessionStorage: { getItem: (key: string) => (options.disabled && key === "p5_analytics_disabled" ? "1" : null) },
    document: { createElement: () => ({}), head: { appendChild: (node: Record<string, unknown>) => nodes.push(node) } },
  });
  return { nodes, window, context };
}

function queued(window: Record<string, unknown>): unknown[][] {
  const fbq = window.fbq as { queue: ArrayLike<unknown>[] } | undefined;
  // Copied into this realm: the queue and its arguments belong to the vm context.
  return fbq ? Array.from(fbq.queue, (args) => Array.from(args)) : [];
}

test("there is no pixel without NEXT_PUBLIC_META_PIXEL_ID, and no default id", () => {
  assert.equal(readMetaPixelId(undefined), "");
  assert.equal(readMetaPixelId(""), "");
  assert.equal(readMetaPixelId("   "), "");
  assert.equal(readMetaPixelId(` ${ID} `), ID);
  // Only a plain number is an id: nothing else can reach the inline script.
  for (const bad of ["abc", "12 34", "123');alert(1);//", "</script>", "G-K4PK6PMZP9"]) assert.equal(readMetaPixelId(bad), "", bad);
  assert.equal(metaPixelSnippet({ id: "", hostname: "p5homeco.com" }), "");

  const site = read("app/site.ts");
  assert.match(site, /export const metaPixelId = readMetaPixelId\(process\.env\.NEXT_PUBLIC_META_PIXEL_ID\);/);
  // No literal dataset id anywhere in the pixel code, the sister sites' ids least of all.
  for (const file of ["app/site.ts", "app/MetaPixel.tsx", "app/lib/metaPixel.ts", "app/analytics.ts"]) {
    const source = read(file);
    assert.equal(/NEXT_PUBLIC_META_PIXEL_ID\s*(\?\?|\|\|)/.test(source), false, file);
    assert.equal(source.includes("925837669911613"), false, file);
    assert.equal(source.includes("2461987544292871"), false, file);
  }

  const loader = read("app/MetaPixel.tsx");
  // Without the id nothing is allowed, so no listener is armed and nothing is rendered.
  assert.match(loader, /const allowed = metaPixelId !== "" && metaPixelAllowedOn\(pathname\);/);
  assert.match(loader, /if \(!allowed \|\| interacted\) return;/);
  assert.match(loader, /if \(!allowed \|\| !interacted\) return null;/);
});

test("the loader is production only and waits for the first interaction", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /\{process\.env\.NODE_ENV === "production" && <MetaPixel \/>\}/);
  assert.equal((layout.match(/<MetaPixel \/>/g) ?? []).length, 1);

  const loader = read("app/MetaPixel.tsx");
  for (const name of ["pointerdown", "keydown", "scroll", "touchstart"]) assert.match(loader, new RegExp(`"${name}"`));
  const fallback = Number(loader.match(/IDLE_FALLBACK_MS = (\d+)/)?.[1]);
  assert.ok(fallback >= 5000, `fallback is ${fallback} ms`);
  assert.match(loader, /strategy="lazyOnload"/);
  assert.doesNotMatch(loader, /strategy="(afterInteractive|beforeInteractive)"/);
  // The vendor file is requested by the gated snippet and from nowhere else.
  assert.equal(loader.includes("connect.facebook.net"), false);
  assert.equal(layout.includes("connect.facebook.net"), false);
  assert.equal(META_PIXEL_SCRIPT_URL, "https://connect.facebook.net/en_US/fbevents.js");
});

test("the pixel runs on public paths only, never on a private path or in the framed estimator", () => {
  for (const path of ["/", "/quote", "/quote/adu", "/estimator", "/legal/privacy", "/about", "/warranty"]) assert.equal(metaPixelAllowedOn(path), true, path);
  for (const prefix of PRIVATE_PREFIXES) {
    assert.equal(metaPixelAllowedOn(prefix), false, prefix);
    assert.equal(metaPixelAllowedOn(`${prefix}/anything`), false, prefix);
  }
  for (const path of ["/admin", "/admin/lead/1", "/portal", "/portal/vendor/x", "/scopes/12", "/estimate/qa-saved", "/estimator/e/token", "/estimator/embed", "/estimator/embed/x"]) {
    assert.equal(metaPixelAllowedOn(path), false, path);
  }
  // The snippet repeats the same rule, so a late start on a private page sends nothing.
  for (const path of ["/", "/quote", "/estimator", "/admin/lead/1", "/portal/vendor/x", "/scopes", "/estimator/e/token", "/estimator/embed", "/estimate/qa-saved"]) {
    const b = browser({ pathname: path });
    vm.runInContext(metaPixelSnippet({ id: ID, hostname: "p5homeco.com" }), b.context);
    assert.equal(typeof b.window.fbq === "function", metaPixelAllowedOn(path), path);
  }
});

test("the snippet starts one pixel, with automatic collection off and no visitor details", () => {
  const b = browser();
  const snippet = metaPixelSnippet({ id: ID, hostname: "p5homeco.com" });
  vm.runInContext(snippet, b.context);
  vm.runInContext(snippet, b.context);
  assert.deepEqual(queued(b.window), [
    ["set", "autoConfig", false, ID],
    ["init", ID],
    ["track", "PageView"],
  ]);
  assert.deepEqual(b.nodes.map((node) => node.src), [META_PIXEL_SCRIPT_URL]);
  // In-app navigations are reported by app/MetaPixel.tsx, for public paths only.
  assert.equal((b.window.fbq as unknown as { disablePushState: boolean }).disablePushState, true);
  assert.match(read("app/MetaPixel.tsx"), /if \(!first\) trackMetaEvent\("PageView"\);/);
});

test("the snippet stays off away from the live host, for automated browsers and when analytics is disabled", () => {
  const snippet = metaPixelSnippet({ id: ID, hostname: "p5homeco.com" });
  for (const options of [{ hostname: "localhost" }, { hostname: "p5-home-co.replit.app" }, { webdriver: true }, { disabled: true }]) {
    const b = browser(options);
    vm.runInContext(snippet, b.context);
    assert.equal(b.window.fbq, undefined, JSON.stringify(options));
    assert.equal(b.nodes.length, 0, JSON.stringify(options));
  }
  const www = browser({ hostname: "www.p5homeco.com" });
  vm.runInContext(snippet, www.context);
  assert.equal(typeof www.window.fbq, "function");
});

test("an accepted inquiry sends one Meta Lead with a category and nothing else", () => {
  const meta: unknown[][] = [];
  const google: unknown[][] = [];
  Object.assign(globalThis, { window: { dataLayer: google, fbq: (...args: unknown[]) => void meta.push(args) } });
  try {
    trackAcceptedInquiry();
    assert.deepEqual(meta, [["track", "Lead", { content_category: "quote_landing_page" }]]);
    // The Google events are unchanged by the pixel.
    assert.deepEqual(google.map((call) => call[1]), ["generate_lead", "conversion"]);
    meta.length = 0;
    trackAcceptedInquiry("instant_estimator");
    assert.deepEqual(meta, [["track", "Lead", { content_category: "instant_estimator" }]]);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("every Meta helper is a safe no-op when the pixel is absent", () => {
  // No window at all (server render).
  assert.doesNotThrow(() => trackMetaEvent("Lead", { content_category: "quote_landing_page" }));
  const google: unknown[][] = [];
  const window: Record<string, unknown> = { dataLayer: google };
  Object.assign(globalThis, { window });
  try {
    assert.doesNotThrow(() => trackMetaEvent("PageView"));
    assert.doesNotThrow(() => trackAcceptedInquiry());
    // The helper never creates fbq by itself: only the gated loader does.
    assert.equal(window.fbq, undefined);
    assert.equal(google.length, 2);
    // A pixel that throws does not break the form that reported the lead.
    window.fbq = () => {
      throw new Error("blocked");
    };
    assert.doesNotThrow(() => trackAcceptedInquiry());
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a Meta Lead is sent from trackAcceptedInquiry only, and never from the framed estimator", () => {
  const analytics = read("app/analytics.ts");
  assert.equal((analytics.match(/trackMetaEvent\("Lead"/g) ?? []).length, 1);
  const accepted = analytics.slice(analytics.indexOf("export function trackAcceptedInquiry"));
  assert.match(accepted, /trackMetaEvent\("Lead", \{ content_category: form \}\);/);
  // The only value the helper accepts beside the event name is a category.
  assert.match(analytics, /export function trackMetaEvent\(event: "Lead" \| "PageView", params\?: \{ content_category: string \}\)/);

  // Nothing else in the site talks to fbq or sends a Lead.
  const estimator = read("components/estimator/GuidedEstimator.tsx");
  for (const file of ["components/estimator/GuidedEstimator.tsx", "app/estimator/embed/page.tsx", "app/estimator/embed/EmbedBridge.tsx", "app/quote/QuoteForm.tsx", "components/SiteChat.tsx", "components/ShortRequestForm.tsx", "components/P5Estimator.tsx", "lib/googleAdsConversion.ts"]) {
    const source = read(file);
    assert.equal(/\bfbq\b|trackMetaEvent/.test(source), false, file);
  }
  // A framed estimator leaves the lead to the brand site that frames it.
  assert.match(estimator, /if \(!embedded\) trackAcceptedInquiry\("instant_estimator"\)/);
  assert.equal((estimator.match(/trackAcceptedInquiry\(/g) ?? []).length, 1);
  assert.match(read("app/estimator/embed/page.tsx"), /<GuidedEstimator[^>]* embedded \/>/);
  // And the pixel is never started inside the frame, so fbq does not exist there.
  assert.equal(metaPixelAllowedOn("/estimator/embed"), false);
});

test("this is the browser pixel only: no Conversions API route or token", () => {
  for (const file of ["app/analytics.ts", "app/MetaPixel.tsx", "app/lib/metaPixel.ts"]) {
    const source = read(file);
    assert.equal(/meta-capi|graph\.facebook\.com|ACCESS_TOKEN|fetch\(/.test(source), false, file);
  }
});
