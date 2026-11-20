import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { citiesServed, faqs } from "../app/site.ts";
import { QUOTE_CITIES } from "../app/quote/options.ts";
import robots, { CRAWLER_ALLOWLIST } from "../app/robots.ts";

const root = join(import.meta.dirname, "..");
const llms = readFileSync(join(root, "public", "llms.txt"), "utf8");

/**
 * The published town list is the Google Business Profile list, in that order.
 * Middleton and Garden City pages stay where they already exist. They are not
 * in this list. The lists can only be wrong together, never separately.
 */

test("the seven service-area towns are named in profile order", () => {
  assert.deepEqual([...citiesServed], [
    "Boise",
    "Meridian",
    "Nampa",
    "Eagle",
    "Kuna",
    "Caldwell",
    "Star",
  ]);
});

test("llms.txt names every city the site claims", () => {
  for (const city of citiesServed) {
    // llms.txt is hard-wrapped, so a city can legitimately span a line break.
    const flat = llms.replace(/\s+/g, " ");
    assert.ok(flat.includes(city), `llms.txt does not mention ${city}`);
  }
});

test("the service-area FAQ answer names every city", () => {
  const answer = faqs.find((f) => f.q === "Which areas do the P5 companies serve?")?.a ?? "";
  assert.ok(answer.length > 0, "the service-area question has gone missing");
  for (const city of citiesServed) {
    assert.ok(answer.includes(city), `the FAQ answer omits ${city}`);
  }
});

test("the quote form offers every city the site serves", () => {
  for (const city of citiesServed) {
    assert.ok(
      (QUOTE_CITIES as readonly string[]).includes(city),
      `the quote form cannot accept ${city}`,
    );
  }
  assert.ok(
    QUOTE_CITIES.some((c) => c.startsWith("Somewhere else")),
    "someone just outside the list must still be able to ask",
  );
});

// --- robots.txt --------------------------------------------------------------

test("every crawler is allowed the public site and refused the private areas", () => {
  const { rules } = robots();
  assert.ok(Array.isArray(rules));
  for (const rule of rules) {
    assert.equal(rule.allow, "/");
    assert.deepEqual(rule.disallow, ["/admin", "/portal", "/scopes", "/api/", "/estimate/qa-saved", "/estimator/e/"]);
  }
  // The saved-estimate rule must not also block the framed estimator.
  const wildcard = (rules as { userAgent: string; disallow: string[] }[]).find((r) => r.userAgent === "*")!;
  const blocked = (path: string) => wildcard.disallow.some((prefix) => path.startsWith(prefix));
  assert.equal(blocked("/estimator/embed"), false);
  assert.equal(blocked("/estimator"), false);
  assert.equal(blocked("/estimator/e/abc123"), true);
});

test("the wildcard rule is present, so an unnamed crawler is still allowed", () => {
  const { rules } = robots();
  assert.ok(
    (rules as { userAgent: string }[]).some((r) => r.userAgent === "*"),
    "removing the wildcard would silently exclude every crawler not named",
  );
});

test("the major search engines and AI answer engines are named explicitly", () => {
  const named = new Set(
    (robots().rules as { userAgent: string }[]).map((r) => r.userAgent),
  );
  for (const bot of [
    "Googlebot",
    "Bingbot",
    "DuckDuckBot",
    "Applebot",
    "GPTBot",
    "OAI-SearchBot",
    "ClaudeBot",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
    "meta-externalagent",
  ]) {
    assert.ok(named.has(bot), `${bot} is no longer named in robots.txt`);
  }
});

test("no crawler is listed twice, which would make the rules ambiguous", () => {
  const all = [...CRAWLER_ALLOWLIST.searchCrawlers, ...CRAWLER_ALLOWLIST.aiCrawlers];
  assert.equal(new Set(all).size, all.length, "duplicate user agent");
});

test("robots.txt still declares the sitemap", () => {
  assert.equal(robots().sitemap, "https://p5homeco.com/sitemap.xml");
});
