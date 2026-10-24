import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  IDAHO_DOPL_LICENSE_SEARCH,
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
  assert.equal(PUBLIC_REGISTRATION, "Idaho Registered Contractor #8381215");
  assert.equal(PUBLIC_REGISTRATION.includes("("), false);
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

test("the registration line is linked in the footer and plain text on funnel pages", () => {
  const identity = readFileSync("components/PublicIdentity.tsx", "utf8");
  assert.equal(IDAHO_DOPL_LICENSE_SEARCH, "https://edopl.idaho.gov/OnlineServices/?link=PubSearch");
  assert.match(identity, /href=\{IDAHO_DOPL_LICENSE_SEARCH\}/);
  assert.match(identity, /target="_blank"/);
  assert.match(identity, /rel="noopener noreferrer"/);
  assert.match(identity, /title="Look up registration 8381215 on Idaho DOPL"/);
  assert.match(identity, /aria-label="Verify with Idaho DOPL: look up registration 8381215, opens in a new tab"/);
  assert.equal(identity.includes("process.env"), false);
  assert.match(identity, /\{PUBLIC_REGISTRATION\}/);
  assert.equal(identity.includes("Idaho contractor registration"), false);
  const plain = [
    "app/estimate/p5-preview/page.tsx",
    "app/estimate/scope/page.tsx",
  ];
  for (const file of plain) {
    assert.match(readFileSync(file, "utf8"), /linkRegistration=\{false\}/, file);
  }
  assert.match(readFileSync("app/estimate/page.tsx", "utf8"), /from "\.\/p5-preview\/page"/);
  for (const file of ["app/HomePageClient.tsx", "app/sitemap/page.tsx", "app/legal/layout.tsx", "app/quote/QuoteLanding.tsx", "app/quote/thanks/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<PublicIdentity\b/, file);
    assert.equal(source.includes("linkRegistration={false}"), false, file);
    assert.equal(source.includes("edopl.idaho.gov"), false, file);
  }
  const schema = readFileSync("app/structuredData.ts", "utf8");
  assert.match(schema, /credentialCategory: "registration"/);
  assert.match(schema, /identifier: CONTRACTOR_REGISTRATION/);
  assert.match(schema, /name: "Idaho Registered Contractor"/);
  assert.match(schema, /"@type": "GovernmentOrganization"/);
  assert.match(schema, /name: "Idaho Division of Occupational and Professional Licenses"/);
  assert.match(schema, /url: "https:\/\/dopl\.idaho\.gov\/con\/"/);
  assert.equal(schema.includes('credentialCategory: "license"'), false);
  const proof = readFileSync("app/quote/proof.ts", "utf8");
  assert.match(proof, /Idaho Registered Contractor #8381215, carried across all five companies\./);
  assert.equal(proof.includes("Idaho contractor registration"), false);
  for (const file of ["app/site.ts", "app/HomePageClient.tsx", "public/llms.txt", "public/llms-full.txt"]) {
    assert.equal(/licen[cs]e/i.test(readFileSync(file, "utf8")), false, file);
  }
});

test("homepage keeps the existing claims and adds the location subhead", () => {
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(home, /Boise’s Trusted Home Specialists/);
  assert.match(home, /Serving Boise, Meridian and the Treasure Valley/);
  assert.match(home, /Est\. 2020/);
  assert.match(home, /100\+ projects/);
  assert.match(home, /Bonded and insured/);
  assert.equal(home.includes("Jared"), false);
});
