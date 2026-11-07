import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

import { INSURED_ANSWER } from "../app/publicClaims.ts";
import { PROOF_POINTS, WORKING_HERE_SINCE_2020 } from "../app/quote/proof.ts";
import { citiesServed, faqs } from "../app/site.ts";
import { siteDescription, siteSchema } from "../app/structuredData.ts";

/**
 * PR #203 owns the registration FAQ. Until it lands, these are the only
 * allowed "bonded" hits under app/ and public/.
 */
const PENDING_FAQ_FILES = new Set(["app/site.ts"]);

function bondedHits(): string[] {
  try {
    const stdout = execFileSync("rg", ["-i", "-n", "bonded", "app", "public"], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    if (failed.status === 1) return [];
    throw error;
  }
}

test("bonded stays out of app and public except the registration FAQ PR 203 owns", () => {
  const unexpected: string[] = [];
  for (const hit of bondedHits()) {
    const file = hit.split(":")[0] ?? "";
    if (PENDING_FAQ_FILES.has(file)) continue;
    if (file === "public/llms-full.txt" && /are the p5 companies bonded and insured|bonded and insured and handle permits/i.test(hit)) {
      continue;
    }
    unexpected.push(hit);
  }
  assert.deepEqual(unexpected, []);
});

const COVERAGE = "Insured. Serving Ada, Canyon and Gem counties.";
const WEBSITE_DESCRIPTION =
  "Parent company of Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co, Boise Handyman Co and Boise ADU Co in Idaho's Treasure Valley.";

test("the insured coverage line and Gem County entries match the copy lead spec", () => {
  assert.equal(siteDescription, WEBSITE_DESCRIPTION);
  const website = siteSchema["@graph"][1];
  assert.equal(website["@type"], "WebSite");
  assert.equal(website.description, siteDescription);
  const organization = siteSchema["@graph"][0];
  assert.equal(organization.description, siteDescription);
  const areas = organization.areaServed;
  assert.equal(areas.find((entry) => entry.name === "Gem County, Idaho")?.["@type"], "AdministrativeArea");
  assert.equal(areas.find((entry) => entry.name === "Emmett")?.["@type"], "City");
  assert.equal(citiesServed.includes("Emmett" as (typeof citiesServed)[number]), false);
  assert.equal(PROOF_POINTS[0]?.label, COVERAGE);
  assert.match(PROOF_POINTS[0]?.detail ?? "", /#8381215/);
  assert.match(WORKING_HERE_SINCE_2020.detail, /Ada, Canyon and Gem counties/);
  assert.match(PROOF_POINTS.find((point) => point.label === "Permits handled in-house")?.detail ?? "", /Ada, Canyon and Gem counties/);
  const question = faqs.find((item) => item.q === "Are the P5 companies bonded and insured?");
  assert.equal(question?.a, INSURED_ANSWER);
  assert.equal(/bonded/i.test(question?.a ?? ""), false);
});
