import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  LLMS_CONTACT,
  PUBLIC_NAP,
  PUBLIC_REGISTRATION,
  SISTER_LINE,
} from "../app/publicIdentity.ts";

const pages = [
  "app/HomePageClient.tsx",
  "app/quote/QuoteLanding.tsx",
  "app/quote/thanks/page.tsx",
  "app/sitemap/page.tsx",
  "app/legal/layout.tsx",
  "app/estimate/p5-preview/page.tsx",
  "app/estimate/scope/page.tsx",
];

test("the approved NAP and sister row are the audit strings", () => {
  assert.equal(
    PUBLIC_NAP,
    "Public representative: Nick Perkins · 4031 W Wapoot St, Meridian, ID 83646 · Service-area business, not a staffed storefront. · (208) 477-1169 · hello@p5homeco.com",
  );
  assert.equal(
    SISTER_LINE,
    "Part of P5 Home Co: Boise Construction Co · Boise Remodeling Co · Boise Handyman Co · Boise Cabinet Co · Boise ADU Co (launching soon)",
  );
  assert.equal(PUBLIC_REGISTRATION, "Idaho contractor registration 8381215.");
  assert.match(LLMS_CONTACT, /Nick Perkins/);
  assert.match(LLMS_CONTACT, /4031 W Wapoot St, Meridian, ID 83646/);
  assert.match(LLMS_CONTACT, /hello@p5homeco\.com/);
  assert.equal(PUBLIC_NAP.includes("Jared") || SISTER_LINE.includes("Jared") || LLMS_CONTACT.includes("Jared"), false);
});

test("every public page renders the shared identity block", () => {
  for (const file of pages) {
    assert.match(readFileSync(file, "utf8"), /<PublicIdentity\b/, file);
  }
});

test("homepage keeps the existing claims and adds the location subhead", () => {
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(home, /Boise’s Trusted Home Specialists/);
  assert.match(home, /Serving Boise, Meridian and the Treasure Valley/);
  assert.match(home, /visibleFoundingBadges\(\)/);
  assert.match(home, /100\+ projects/);
  assert.match(home, /Bonded and insured/);
  assert.equal(home.includes("Jared"), false);
});
