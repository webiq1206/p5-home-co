import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROOF_POINTS } from "../app/quote/proof.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import {
  BONDED_ANSWER,
  BONDED_SINCE_2020_ANSWER,
  ESTABLISHED_2020_LINE,
  HOMEPAGE_H1,
  HOMEPAGE_LEDE,
  SHOW_FOUNDING_YEAR,
  SHOW_UNPROVEN_TRUSTED,
  TRUSTED_H1,
  TRUSTED_LEDE,
  WORKING_HERE_SINCE_2020,
} from "../app/publicClaims.ts";
import { faqs } from "../app/site.ts";
import { homePageSchema, siteDescription, siteSchema, siteTitle } from "../app/structuredData.ts";

const BANNED_STRINGS = [
  "designed, built, and installed",
  "cabinet design, fabrication, and installation",
  "Design, fabrication, and installation",
  "design, fabrication, and installation",
  "Boise’s Trusted Home Specialists",
  "one trusted family",
  "Working here since 2020",
  "since 2020",
  "Est. 2020",
  "Established 2020",
  "foundingDate",
] as const;

function published(): string {
  const cabinet = QUOTE_SERVICES.find((service) => service.slug === "custom-cabinets");
  assert.equal(cabinet?.covers.includes("Design, sourcing, and installation"), true);
  assert.equal(cabinet?.covers.includes("Design, fabrication, and installation"), false);
  return [
    JSON.stringify(siteSchema),
    JSON.stringify(homePageSchema),
    readFileSync("public/llms.txt", "utf8"),
    readFileSync("public/llms-full.txt", "utf8"),
    JSON.stringify(PROOF_POINTS),
    siteTitle,
    siteDescription,
    HOMEPAGE_H1,
    HOMEPAGE_LEDE,
  ].join("\n");
}

/** Jared keeps the Terms of Service sentence. "builds" is not a "built" hit. */
function visibleHits(text: string): string[] {
  const terms = readFileSync("app/legal/terms/page.tsx", "utf8");
  const withoutTerms = text.replace(terms, "");
  const withoutBuiltIns = withoutTerms.replace(/built-ins/gi, "");
  return [...withoutBuiltIns.matchAll(/built|fabricat|2020/gi)].map((match) => {
    const start = Math.max(0, match.index! - 40);
    return withoutBuiltIns.slice(start, match.index! + match[0].length + 40).replace(/\s+/g, " ");
  });
}

test("banned claim strings stay in source and stay out of the published page", () => {
  assert.equal(SHOW_FOUNDING_YEAR, false);
  assert.equal(SHOW_UNPROVEN_TRUSTED, false);
  assert.equal(TRUSTED_H1, "Boise’s Trusted Home Specialists");
  assert.match(TRUSTED_LEDE, /one trusted family/);
  assert.match(BONDED_SINCE_2020_ANSWER, /since 2020/);
  assert.equal(
    BONDED_ANSWER,
    "Yes. The P5 companies are bonded and insured and handle permits in-house where a project requires them.",
  );
  assert.match(ESTABLISHED_2020_LINE, /Established 2020/);
  assert.equal(WORKING_HERE_SINCE_2020.label, "Working here since 2020");
  assert.equal(HOMEPAGE_H1, "Boise’s Home Specialists");
  assert.equal(HOMEPAGE_LEDE, TRUSTED_LEDE.replace(" trusted", ""));
  assert.equal(HOMEPAGE_LEDE.includes("trusted"), false);

  const bonded = faqs.find((item) => item.q === "Are the P5 companies bonded and insured?");
  assert.equal(bonded?.a, BONDED_ANSWER);
  assert.equal(PROOF_POINTS.some((point) => point.label === "Working here since 2020"), false);

  const page = published();
  for (const banned of BANNED_STRINGS) {
    assert.equal(page.includes(banned), false, banned);
  }
  const hits = visibleHits(page);
  assert.deepEqual(hits, []);
  const terms = readFileSync("app/legal/terms/page.tsx", "utf8");
  const trustedHits = [...page.replace(terms, "").matchAll(/trusted/gi)].map((match) => match[0]);
  assert.deepEqual(trustedHits, []);
});
