import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/legal/privacy/page.tsx", "utf8");

const section = page.slice(page.indexOf("<h2>5. Cookies and analytics</h2>"), page.indexOf("<h2>6. How long we keep it</h2>"));

test("privacy section 5 states enhanced conversions are off and remarketing is on", () => {
  assert.ok(section.includes("<h2>5. Cookies and analytics</h2>"));
  assert.match(section, /The public website uses analytics and marketing cookies/);
  assert.match(section, /The portals use a strictly necessary cookie to keep you signed in/);
  assert.ok(section.includes("We do not currently send your name, email, phone number or project details to Google.{\" \"}"));
  assert.ok(section.includes("Google's tag also adds visitors to remarketing lists, and Google may use this data to show you relevant ads on other websites (remarketing).\"}{\" \"}"));
  assert.equal(section.includes("Google may also use information collected by its tags to personalise ads."), false);
  assert.equal(/meta|facebook|pixel/i.test(section), false);
});

test("privacy section 5 keeps both Google opt-out links", () => {
  assert.match(section, /href="https:\/\/tools\.google\.com\/dlpage\/gaoptout"/);
  assert.match(section, /href="https:\/\/adssettings\.google\.com"/);
  assert.match(section, /Google Analytics opt-out browser add-on/);
  assert.match(section, /Google Ads Settings/);
});

test("the privacy policy date moves with this disclosure", () => {
  assert.match(page, /Last updated 17 October 2026/);
  assert.equal(page.includes("Last updated 23 August 2026"), false);
});

 test("newer call and attribution disclosures remain alongside remarketing", () => {
  assert.match(section, /If your call goes through a Google forwarding number/);
  assert.match(section, /calling number and call length/);
  assert.match(section, /we keep them with your inquiry in our/);
  assert.match(section, /On some of/);
  assert.match(page, /We share limited\s+information with Google to measure our ads, as described in section\s+5/);
 });
