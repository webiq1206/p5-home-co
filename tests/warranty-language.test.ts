import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROOF_POINTS } from "../app/quote/proof.ts";
import { SHARED_FAQ } from "../app/quote/schema.ts";
import { SHOW_UNPROVEN_WARRANTY } from "../app/publicClaims.ts";

const flat = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");

const PUBLIC_FILES = [
  "app/about/AboutClient.tsx",
  "app/warranty/page.tsx",
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

test("workmanship coverage is one year from documented Final Completion, for our own team", () => {
  const about = flat("app/about/AboutClient.tsx");
  assert.match(about, /one year of workmanship coverage from documented Final Completion for work performed by our own team/);
  assert.match(about, /Work performed by subcontractors, such as licensed plumbing, electrical or HVAC, is covered by that subcontractor&apos;s own warranty/);
  assert.match(about, /At the end of every project we provide a complete list of the subcontractors who worked on it, with their contact information/);
  assert.match(about, /Manufacturer product warranties are separate/);
  assert.match(about, /href="\/warranty"/);
});

test("no public source says our workmanship coverage includes subcontractors (owner decision D1)", () => {
  for (const file of PUBLIC_FILES) {
    const text = flat(file);
    assert.doesNotMatch(text, /subcontractors we hire|crews? and (?:the )?subcontractors|covering our people|our people and the subcontractors/i, file);
    assert.doesNotMatch(text, /(?:warrant|coverage)[^.]{0,80}(?:includ|cover)[^.]{0,40}subcontractor/i, file);
  }
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

test("ADU links go to the P5 ADU request until a Boise ADU Co site exists (owner decision D5)", () => {
  const home = flat("app/HomePageClient.tsx");
  assert.match(home, /adu: \{[^}]*url: ADU_REQUEST_PATH/);
  assert.match(home, /url=\{ADU_REQUEST_PATH\}/);
  assert.match(flat("app/about/AboutClient.tsx"), /href: ADU_REQUEST_PATH/);
  const brand = flat("lib/familyBrand.ts");
  assert.match(brand, /href: ADU_REQUEST_PATH/);
  assert.match(flat("app/publicIdentity.ts"), /ADU_REQUEST_PATH = "\/quote\/adu"/);
  assert.match(flat("app/publicIdentity.ts"), /\{ label: "Boise ADU Co", href: "\/quote\/adu" \}/);
  for (const file of ["app/HomePageClient.tsx", "app/about/AboutClient.tsx", "lib/familyBrand.ts", "app/site.ts", ...PUBLIC_FILES]) {
    assert.doesNotMatch(flat(file), /ADU_CONSTRUCTION_URL|boiseadu\.co/i, file);
  }
});

test("the warranty page states the policy and a real help path (owner decision D8)", async () => {
  const page = flat("app/warranty/page.tsx");
  assert.match(page, /canonical: "\/warranty"/);
  assert.match(page, /one year of workmanship from documented Final Completion/);
  assert.match(page, /Final Completion means/);
  assert.match(page, /covered by that subcontractor&apos;s own warranty/);
  assert.match(page, /complete list of the subcontractors who worked on it, with their contact information/);
  assert.match(page, /manufacturer&apos;s own warranty terms/);
  assert.match(page, /Normal wear\./);
  assert.match(page, /Misuse\./);
  assert.match(page, /Work by others after completion\./);
  assert.match(page, /id="get-help"/);
  assert.match(page, /we can point you to the right subcontractor from the list/);
  assert.match(page, /signed agreement sets how formal warranty notice must be given/);
  assert.match(page, /immediate danger[^.]*call 911 or your utility first/);
  assert.match(page, /href=\{PUBLIC_PHONE_TEL\}/);
  assert.doesNotMatch(page, /within \d|business days?|guarantee/i);

  const { HELP_MAILTO } = await import("../app/warranty/help.ts");
  assert.ok(HELP_MAILTO.startsWith("mailto:hello@p5homeco.com?subject="));
  const body = decodeURIComponent(HELP_MAILTO.split("&body=")[1]);
  for (const field of ["Name:", "Project address:", "Affected item and location:", "When it started:", "Description:", "Photos"]) {
    assert.ok(body.includes(field), field);
  }

  const { ownPages } = await import("../app/siteUrls.ts");
  assert.ok(ownPages.some((p) => p.href === "/warranty" && p.changeFrequency));
  assert.match(flat("lib/familyBrand.ts"), /\{ label: 'Existing customer\? Get help', href: '\/warranty#get-help' \}/);
});
