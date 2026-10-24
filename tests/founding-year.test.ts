import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  BONDED_ANSWER,
  BONDED_SINCE_2020_ANSWER,
  ESTABLISHED_2020_LINE,
  FOUNDING_PHRASES,
  SHOW_FOUNDING_YEAR,
  visibleFoundingBadges,
} from "../app/foundingYear.ts";
import { PROOF_POINTS, WORKING_HERE_SINCE_2020 } from "../app/quote/proof.ts";
import { faqs } from "../app/site.ts";
import { siteSchema } from "../app/structuredData.ts";

test("the 2020 founding claim stays in source and is hidden by default", () => {
  assert.equal(SHOW_FOUNDING_YEAR, false);
  assert.deepEqual(FOUNDING_PHRASES, [
    "Est. 2020",
    "Established 2020",
    "founded in 2020",
    "since 2020",
    "Working here since 2020",
  ]);
  assert.deepEqual(visibleFoundingBadges(), []);
  assert.match(
    readFileSync("app/foundingYear.ts", "utf8"),
    /SHOW_FOUNDING_YEAR \? \["Est\. 2020"\] : \[\]/,
  );
  assert.equal(
    ESTABLISHED_2020_LINE,
    "Established 2020. Bonded and insured. Serving Ada and Canyon counties.",
  );
  assert.match(BONDED_SINCE_2020_ANSWER, /since 2020/);
  assert.equal(WORKING_HERE_SINCE_2020.label, "Working here since 2020");

  const answer = faqs.find((item) => item.q === "Are the P5 companies bonded and insured?")?.a ?? "";
  assert.equal(answer, BONDED_ANSWER);
  assert.equal(answer.includes("2020"), false);
  assert.equal(PROOF_POINTS.some((point) => /2020/.test(`${point.label} ${point.detail}`)), false);
  const schema = JSON.stringify(siteSchema);
  assert.equal(schema.includes("foundingDate"), false);
  assert.equal(schema.includes("2020"), false);

  for (const file of ["public/llms.txt", "public/llms-full.txt"]) {
    const text = readFileSync(file, "utf8");
    assert.equal(/Established 2020|since 2020|founded in 2020|Est\. 2020/.test(text), false, file);
  }

  assert.match(readFileSync("app/HomePageClient.tsx", "utf8"), /visibleFoundingBadges\(\)/);
  assert.match(readFileSync("app/structuredData.ts", "utf8"), /foundingDate: "2020"/);
  assert.match(readFileSync("app/quote/proof.ts", "utf8"), /Working here since 2020/);
  assert.equal(readFileSync("app/quote/proof.ts", "utf8").includes("SHOW_FOUNDING_YEAR"), false);

  const facts = readFileSync("docs/p5-public-facts.md", "utf8");
  assert.match(facts, /leave blank until documented/);
  assert.equal(/Est\. 2020|Founded in 2017|Opening date: 2017|Year founded \| 2017/.test(facts), false);
  for (const file of [
    "public/images/p5-construction-branded.webp",
    "public/images/p5-handyman-branded.webp",
  ]) {
    assert.equal(existsSync(file), true, file);
  }
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(home, /image=\{FRAMING_FOOTHILLS.src\}/);
  assert.match(home, /image=\{BASEBOARD_TRIM_FIT.src\}/);
});
