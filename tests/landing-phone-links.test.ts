import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PUBLIC_PHONE_SMS, PUBLIC_PHONE_TEL } from "../app/publicIdentity.ts";

const root = new URL("..", import.meta.url);
const source = (file: string) => readFileSync(new URL(file, root), "utf8");

test("landing call and text controls use the configured P5 number", () => {
  assert.equal(PUBLIC_PHONE_TEL, "tel:+12084771169");
  assert.equal(PUBLIC_PHONE_SMS, "sms:+12084771169");
  const home = source("app/HomePageClient.tsx");

  assert.match(home, /<SiteChrome\b/);
  // The family header, menu, bar and footer take their call and text links from the brand config.
  assert.match(source("components/SiteChrome.tsx"), /<SiteHeader \/>/);
  assert.match(source("lib/familyBrand.ts"), /telHref: PUBLIC_PHONE_TEL, smsHref: PUBLIC_PHONE_SMS/);
  const quote = source("app/quote/QuoteLanding.tsx");
  assert.match(quote, /<SiteChrome\b/);
  assert.match(source("app/quote/TrackedPhoneLink.tsx"), /href="tel:\+12084771169"/);
  const bar = source("components/LandingContactBar.tsx");
  assert.match(bar, /PUBLIC_PHONE_TEL/);
  assert.match(bar, /PUBLIC_PHONE_SMS/);
  for (const file of ["app/estimate/p5-preview/page.tsx", "app/estimate/scope/page.tsx"]) {
    assert.match(source(file), /LandingContactBar/);
  }
});
