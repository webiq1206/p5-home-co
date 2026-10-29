import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { BUSINESS_HOURS, BUSINESS_HOURS_LABEL, officeOpeningHours } from "../lib/businessHours.ts";
import { LLMS_CONTACT } from "../app/publicIdentity.ts";
import { siteSchema } from "../app/structuredData.ts";

const root = new URL("..", import.meta.url).pathname;

test("office hours come from one source", () => {
  const organization = siteSchema["@graph"][0];
  assert.deepEqual(organization.openingHoursSpecification, officeOpeningHours());
  const specs = officeOpeningHours();
  const byDay = Object.fromEntries(specs.map((spec) => [spec.dayOfWeek, spec]));
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
    assert.equal(byDay[day].opens, "09:00", day);
    assert.equal(byDay[day].closes, "18:00", day);
  }
  assert.equal(byDay.Saturday.opens, "09:00");
  assert.equal(byDay.Saturday.closes, "16:00");
  assert.equal(byDay.Sunday, undefined);
  assert.equal(BUSINESS_HOURS.sunday, "Closed");
  const identity = readFileSync(join(root, "components/PublicIdentity.tsx"), "utf8");
  assert.match(identity, /\{BUSINESS_HOURS_LABEL\}/);
  const weekdayHours = "9:00 AM - " + "6:00 PM";
  const literals = walk(root).filter((file) => readFileSync(file, "utf8").includes(weekdayHours));
  assert.deepEqual(literals.map((file) => file.slice(root.length)), ["lib/businessHours.ts"]);
});

test("the vCard NOTE and llms.txt use the confirmed hours", () => {
  const card = readFileSync(join(root, "lib/vcard.ts"), "utf8");
  assert.match(card, /Meridian, ID 83646/);
  assert.match(card, /buildBusinessVCard/);
  assert.match(readFileSync(join(root, "app/contact.vcf/route.ts"), "utf8"), /text\/vcard/);
  const llms = readFileSync(join(root, "public/llms.txt"), "utf8").replace(/\s+/g, " ");
  const full = readFileSync(join(root, "public/llms-full.txt"), "utf8").replace(/\s+/g, " ");
  assert.ok(llms.includes(LLMS_CONTACT));
  assert.ok(full.includes(LLMS_CONTACT));
  assert.ok(LLMS_CONTACT.includes(BUSINESS_HOURS_LABEL));
});

test("no stale weekday 7-to-6 or Saturday 8-to-4 office hours remain", () => {
  const stale = [
    new RegExp("7:00 AM - " + "6:00 PM"),
    new RegExp("8:00 AM - " + "4:00 PM"),
    new RegExp("7\\s*am\\s*[–-]\\s*" + "6\\s*pm", "i"),
    new RegExp("8\\s*am\\s*[–-]\\s*" + "4\\s*pm", "i"),
    new RegExp("Mon[-–]Fri " + "7[-–]6"),
    new RegExp("Sat " + "8[-–]4"),
  ];
  const hits: string[] = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of stale) {
      if (pattern.test(text)) hits.push(`${file.slice(root.length)} ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(ts|tsx|js|mjs|mts|md|txt|json|html|css|vcf)$/.test(name)) found.push(path);
  }
  return found;
}
