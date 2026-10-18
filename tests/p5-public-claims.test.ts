import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROOF_POINTS } from "../app/quote/proof.ts";
import {
  BONDED_ANSWER,
  BONDED_SINCE_2020_ANSWER,
  ESTABLISHED_2020_LINE,
  ESTABLISHED_LINE,
  HOMEPAGE_H1,
  HOMEPAGE_LEDE,
  SHOW_FOUNDING_YEAR,
  SHOW_UNPROVEN_TRUSTED,
  TRUSTED_H1,
  TRUSTED_LEDE,
  WORKING_HERE_SINCE_2020,
} from "../app/publicClaims.ts";
import { faqs } from "../app/site.ts";
import { serializeJsonLd, siteDescription, siteSchema, siteTitle } from "../app/structuredData.ts";

test("founding year and unproven trusted claims stay in source and off the published page", () => {
  assert.equal(SHOW_FOUNDING_YEAR, false);
  assert.equal(SHOW_UNPROVEN_TRUSTED, false);
  assert.equal(TRUSTED_H1, "Boise’s Trusted Home Specialists");
  assert.match(TRUSTED_LEDE, /one trusted family/);
  assert.match(BONDED_SINCE_2020_ANSWER, /since 2020/);
  assert.match(ESTABLISHED_2020_LINE, /Established 2020/);
  assert.equal(WORKING_HERE_SINCE_2020.label, "Working here since 2020");
  assert.equal(HOMEPAGE_H1, "Boise’s Home Specialists");
  assert.equal(HOMEPAGE_LEDE.includes("trusted"), false);
  assert.equal(ESTABLISHED_LINE.includes("2020"), false);

  const bonded = faqs.find((item) => item.q === "Are the P5 companies bonded and insured?");
  assert.equal(bonded?.a, BONDED_ANSWER);
  assert.equal(PROOF_POINTS.some((point) => point.label === "Working here since 2020"), false);
  assert.equal(serializeJsonLd(siteSchema).includes("foundingDate"), false);
  assert.equal(serializeJsonLd(siteSchema).includes("2020"), false);

  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(home, /SHOW_FOUNDING_YEAR \? <div><strong>Est\. 2020<\/strong>/);
  assert.match(home, /SHOW_UNPROVEN_TRUSTED \? TRUSTED_H1 : HOMEPAGE_H1/);
  assert.match(home, /SHOW_UNPROVEN_TRUSTED \? TRUSTED_LEDE : HOMEPAGE_LEDE/);

  const published = [
    siteTitle,
    siteDescription,
    readFileSync("app/layout.tsx", "utf8"),
    readFileSync("public/llms.txt", "utf8"),
    readFileSync("public/llms-full.txt", "utf8"),
    JSON.stringify(PROOF_POINTS),
    HOMEPAGE_H1,
    HOMEPAGE_LEDE,
    ESTABLISHED_LINE,
    BONDED_ANSWER,
  ].join("\n");
  assert.equal(/Est\. 2020|since 2020|foundingDate|trusted/i.test(published), false);
});
