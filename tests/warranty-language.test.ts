import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROOF_POINTS } from "../app/quote/proof.ts";
import { SHARED_FAQ } from "../app/quote/schema.ts";
import { SHOW_UNPROVEN_WARRANTY } from "../app/publicClaims.ts";

const flat = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");

const PUBLIC_FILES = [
  "app/about/AboutClient.tsx",
  "app/HomePageClient.tsx",
  "app/site.ts",
  "app/structuredData.ts",
  "app/quote/QuoteLanding.tsx",
  "app/quote/proof.ts",
  "app/quote/schema.ts",
  "app/quote/services.ts",
  "components/CompanyFinder.tsx",
  "public/llms.txt",
  "public/llms-full.txt",
];

test("workmanship coverage is one year from documented Final Completion", () => {
  const about = flat("app/about/AboutClient.tsx");
  assert.match(about, /one year of workmanship coverage from documented Final Completion/);
  assert.match(about, /subcontractors/);
  assert.match(about, /Manufacturer product warranties are separate/);
});

test("no public source claims a two-year or lifetime workmanship warranty", () => {
  for (const file of PUBLIC_FILES) {
    const text = flat(file);
    assert.doesNotMatch(text, /\b(?:two|2)[\s-]+years?\b[^.]{0,60}(?:warrant|coverage|remodel|cabinet)/i, file);
    assert.doesNotMatch(text, /(?:warrant|coverage)[^.]{0,60}\b(?:two|2)[\s-]+years?\b/i, file);
    assert.doesNotMatch(text, /substantial completion|from installation|after we finish/i, file);
  }
  assert.equal(SHOW_UNPROVEN_WARRANTY, false);
});

test("free first conversation is kept apart from paid planning work", () => {
  const free = PROOF_POINTS.find((point) => point.label === "Free to ask");
  assert.ok(free);
  assert.match(free.detail, /first conversation and project review are free/);
  assert.match(free.detail, /approve its scope and price in writing/);
  const cost = SHARED_FAQ.find((faq) => faq.q === "How much does a quote cost?");
  assert.ok(cost);
  assert.match(cost.a, /approve its scope and price in writing/);
  for (const file of PUBLIC_FILES) {
    assert.doesNotMatch(flat(file), /site visits? (?:cost nothing|are free|is free)|not charged for a site visit/i, file);
  }
});

test("the finder sends ADU to the working P5 ADU entry", () => {
  const finder = flat("components/CompanyFinder.tsx");
  assert.match(finder, /adu: \{[^}]*url: "\/quote\/adu"/);
  assert.doesNotMatch(finder, /boiseadu\.co|ADU_CONSTRUCTION_URL/i);
});
