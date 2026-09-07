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
 * Garden City was served but named in only some places, so the homepage
 * claimed eight cities while the quote pages claimed nine. These tests exist
 * so the lists can only ever be wrong together, never separately.
 */

test("all nine cities are named, Garden City included", () => {
  for (const city of [
    "Boise",
    "Meridian",
    "Eagle",
    "Nampa",
    "Kuna",
    "Star",
    "Middleton",
    "Caldwell",
    "Garden City",
  ]) {
    assert.ok((citiesServed as readonly string[]).includes(city), `${city} is missing`);
  }
  assert.equal(citiesServed.length, 9);
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
    assert.deepEqual(rule.disallow, ["/admin", "/portal", "/api/"]);
  }
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
