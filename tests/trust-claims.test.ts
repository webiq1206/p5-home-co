import { BASEBOARD_TRIM_FIT, FRAMING_FOOTHILLS } from "../app/imageVariants.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROOF_POINTS } from "../app/quote/proof.ts";
import {
  BONDED_SINCE_2020_ANSWER,
  CABINET_FINISH_COUNT,
  CABINET_WARRANTY,
  CREW_AND_TRADES,
  ESTABLISHED_2020_LINE,
  SELF_PERFORM_FAQ,
  SHOW_FAKE_STAFF_IMAGES,
  SHOW_FOUNDING_YEAR,
  SHOW_UNPROVEN_FINISH_COUNT,
  SHOW_UNPROVEN_PROJECT_COUNT,
  SHOW_UNPROVEN_SATISFACTION_GUARANTEE,
  SHOW_UNPROVEN_SELF_PERFORM,
  SHOW_UNPROVEN_TOP_RATED,
  SHOW_UNPROVEN_TRUSTED,
  SHOW_UNPROVEN_WARRANTY,
  SPECIALTY_FAQ,
  SATISFACTION_GUARANTEED_PHRASE,
  TOP_RATED_PHRASE,
  cabinetProof,
  constructionImage,
  handymanImage,
} from "../app/publicClaims.ts";
import { faqs } from "../app/site.ts";
import { siteSchema } from "../app/structuredData.ts";

test("unproven claims stay in source and are hidden by default", () => {
  assert.equal(SHOW_UNPROVEN_FINISH_COUNT, false);
  assert.equal(SHOW_UNPROVEN_WARRANTY, false);
  assert.equal(SHOW_UNPROVEN_PROJECT_COUNT, false);
  assert.equal(SHOW_FOUNDING_YEAR, false);
  assert.equal(SHOW_UNPROVEN_SELF_PERFORM, false);
  assert.equal(SHOW_UNPROVEN_TRUSTED, false);
  assert.equal(SHOW_FAKE_STAFF_IMAGES, false);
  assert.equal(CABINET_FINISH_COUNT, "299 finishes");
  assert.equal(CABINET_WARRANTY, "Lifetime workmanship warranty");
  assert.equal(cabinetProof, "");
  assert.equal(ESTABLISHED_2020_LINE.startsWith("Established 2020"), true);
  assert.match(SELF_PERFORM_FAQ, /does the work itself/);
  assert.equal(SHOW_UNPROVEN_TOP_RATED, false);
  assert.equal(SHOW_UNPROVEN_SATISFACTION_GUARANTEE, false);
  assert.equal(
    CREW_AND_TRADES,
    "Cabinets sourced and installed by our own crew, with trade partners where needed.",
  );
  assert.equal(SPECIALTY_FAQ.endsWith(CREW_AND_TRADES), true);
  assert.equal(constructionImage, FRAMING_FOOTHILLS.src);
  assert.equal(handymanImage, BASEBOARD_TRIM_FIT.src);
  assert.match(readFileSync("app/publicClaims.ts", "utf8"), /p5-construction-branded\.webp/);
  assert.match(readFileSync("app/publicClaims.ts", "utf8"), /p5-handyman-branded\.webp/);

  const family = faqs.find((item) => item.q === "Is P5 Home Co a contractor or a referral service?")?.a ?? "";
  assert.equal(family, SPECIALTY_FAQ);
  assert.equal(family.includes("does the work itself"), false);
  const bonded = faqs.find((item) => item.q === "Are the P5 companies bonded and insured?")?.a ?? "";
  assert.equal(bonded, "Yes. The P5 companies are bonded and insured and handle permits in-house where a project requires them.");
  assert.equal(bonded.includes("2020"), false);
  assert.match(BONDED_SINCE_2020_ANSWER, /since 2020/);
  assert.equal(PROOF_POINTS.some((point) => /2020|own craft|Five specialist/.test(`${point.label} ${point.detail}`)), false);
  const schema = JSON.stringify(siteSchema);
  assert.equal(schema.includes("foundingDate"), false);
  assert.equal(schema.includes("p5-construction-branded"), false);
  assert.equal(schema.includes("p5-handyman-branded"), false);
  assert.match(readFileSync("app/structuredData.ts", "utf8"), /foundingDate: "2020"/);
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(home, /import \{[\s\S]*SHOW_UNPROVEN_SELF_PERFORM[\s\S]*\} from "\.\/publicClaims"/);
  assert.match(home, /Who you are hiring/);
  assert.match(home, /PUBLIC_REGISTRATION/);

  const claimsSource = readFileSync("app/publicClaims.ts", "utf8");
  assert.match(claimsSource, /TOP_RATED_PHRASE = "top-rated"/);
  assert.match(claimsSource, /SATISFACTION_GUARANTEED_PHRASE = "satisfaction guaranteed"/);
  const published = [
    "app/HomePageClient.tsx",
    "app/site.ts",
    "app/structuredData.ts",
    "app/quote/QuoteLanding.tsx",
    "app/quote/proof.ts",
    "app/quote/services.ts",
    "public/llms.txt",
    "public/llms-full.txt",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(/top[ -]?rated/i.test(published), false);
  assert.equal(/satisfaction guarante/i.test(published), false);
  assert.equal(SHOW_UNPROVEN_TOP_RATED ? TOP_RATED_PHRASE : "", "");
  assert.equal(SHOW_UNPROVEN_SATISFACTION_GUARANTEE ? SATISFACTION_GUARANTEED_PHRASE : "", "");
});
