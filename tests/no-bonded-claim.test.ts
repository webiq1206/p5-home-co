import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { PROOF_POINTS, WORKING_HERE_SINCE_2020 } from "../app/quote/proof.ts";
import { citiesServed, faqs } from "../app/site.ts";
import { siteDescription, siteSchema } from "../app/structuredData.ts";

const root = join(import.meta.dirname, "..");

function bondedHits(): string[] {
  const hits: string[] = [];
  for (const dir of ["app", "public"]) {
    const walk = (current: string) => {
      for (const name of readdirSync(current)) {
        const path = join(current, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        const text = readFileSync(path, "utf8");
        const lines = text.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          if (/bonded/i.test(lines[index] ?? "")) hits.push(`${relative(root, path)}:${index + 1}:${lines[index]}`);
        }
      }
    };
    walk(join(root, dir));
  }
  return hits;
}

test("bonded does not appear under app or public", () => {
  assert.deepEqual(bondedHits(), []);
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
  const question = faqs.find((item) => item.q === "Are the P5 companies registered and insured?");
  assert.equal(question?.a, "Yes. P5 Home Co LLC, Idaho Registered Contractor #8381215. Insured; certificate on request.");
});
