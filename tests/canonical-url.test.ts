import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { withBrandPageMetadata } from "../lib/brand-page-metadata.ts";
import { internalHref, selfCanonical } from "../lib/canonicalUrl.ts";

const campaignHome = "https://p5homeco.com/?utm_source=google&utm_medium=cpc&utm_campaign=treasure";

test("the self-canonical drops utm parameters and keeps the clean origin", () => {
  assert.equal(selfCanonical(campaignHome), "https://p5homeco.com");
  assert.equal(
    selfCanonical("https://p5homeco.com/quote?project=kitchen&utm_source=newsletter&utm_medium=email"),
    "https://p5homeco.com/quote?project=kitchen",
  );
  assert.equal(selfCanonical("https://p5homeco.com"), "https://p5homeco.com");
  assert.equal(selfCanonical("/quote"), "/quote");
});

test("brand metadata does not publish a campaign URL as its canonical", () => {
  const result = withBrandPageMetadata(
    { title: "Home", alternates: { canonical: campaignHome } },
    "/",
  );
  assert.equal(result.alternates?.canonical, "https://p5homeco.com");
});

test("internal links do not keep utm parameters", () => {
  assert.equal(internalHref("#service-area", campaignHome), "/#service-area");
  assert.equal(internalHref("/estimate?utm_source=facebook&utm_medium=referral", campaignHome), "/estimate");
  assert.equal(
    internalHref("/quote?project=kitchen&utm_campaign=spring", "https://p5homeco.com/quote?utm_campaign=spring"),
    "/quote?project=kitchen",
  );
  assert.equal(internalHref("tel:+12084771169", campaignHome), "tel:+12084771169");
  assert.equal(internalHref("https://boiseconstruction.co/?utm_source=p5", campaignHome), "https://boiseconstruction.co/?utm_source=p5");
});

test("homepage links do not resolve back to a utm homepage URL", () => {
  const home = readFileSync(new URL("../app/HomePageClient.tsx", import.meta.url), "utf8");
  const hrefs = [...home.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) {
    if (/^(?:tel|mailto):/i.test(href)) continue;
    const url = new URL(href, campaignHome);
    if (url.origin !== "https://p5homeco.com") continue;
    for (const key of url.searchParams.keys()) {
      assert.equal(/^utm_/i.test(key), false, `${href} keeps ${key}`);
    }
  }
});
