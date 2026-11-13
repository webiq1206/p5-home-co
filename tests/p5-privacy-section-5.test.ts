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
});

// Owner decision, 13 November 2026: the Meta pixel is on the public site, so
// the policy says so. This used to assert that Meta was not mentioned at all.
test("privacy section 5 discloses the Meta pixel, what it receives and how to opt out", () => {
  const text = section.replace(/\s+/g, " ");
  assert.ok(text.includes("We also use the Meta Pixel to measure visits and inquiries that come from our Facebook and Instagram ads."));
  assert.ok(text.includes("The pixel loads after you first interact with a page, for example by scrolling, tapping or typing, or shortly after the page has finished loading."));
  assert.ok(text.includes("It sets cookies and sends Meta a page view, which includes the page address, your IP address and your browser details."));
  assert.ok(text.includes("When we accept an inquiry or an instant estimate request you send from this site, the pixel also sends Meta a Lead event. That event carries a category only, such as the form you used."));
  assert.ok(text.includes("We do not send Meta your name, email, phone number, address or project details."));
  assert.ok(text.includes("The pixel does not load on the portals."));
  assert.match(text, /href="https:\/\/www\.facebook\.com\/privacy\/policy"/);
  assert.match(text, /<a href="https:\/\/www\.facebook\.com\/adpreferences\/ad_settings">Meta ad settings<\/a>/);
  // The Google paragraphs come first and are unchanged; Meta closes the section.
  assert.ok(text.indexOf("We also use the Meta Pixel") > text.indexOf("Google Ads conversion tracking receives a conversion event"));
  // No Conversions API, no hashed contact details: the sister sites' wording for those does not apply here.
  assert.equal(/Conversions API|hashed/i.test(text), false);
});

test("privacy section 5 keeps both Google opt-out links", () => {
  assert.match(section, /href="https:\/\/tools\.google\.com\/dlpage\/gaoptout"/);
  assert.match(section, /href="https:\/\/adssettings\.google\.com"/);
  assert.match(section, /Google Analytics opt-out browser add-on/);
  assert.match(section, /Google Ads Settings/);
});

test("the privacy policy date moves with this disclosure", () => {
  assert.match(page, /Last updated 13 November 2026/);
  assert.equal(page.includes("Last updated 17 October 2026"), false);
  assert.equal(page.includes("Last updated 23 August 2026"), false);
});

 test("newer call and attribution disclosures remain alongside remarketing", () => {
  assert.match(section, /If your call goes through a Google forwarding number/);
  assert.match(section, /calling number and call length/);
  assert.match(section, /we keep them with your inquiry in our/);
  assert.match(section, /On some of/);
  assert.match(page, /We share limited\s+information with Google and Meta to measure our ads, as described in\s+section\s+5/);
 });
