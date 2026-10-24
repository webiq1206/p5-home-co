import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { companies } from "../app/site.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { BASEBOARD_TRIM_FIT, FRAMING_FOOTHILLS, imageVariantFor } from "../app/imageVariants.ts";

const root = join(import.meta.dirname, "..");

const expected = {
  [FRAMING_FOOTHILLS.src]: "d8d000eaa3b0d65e1a2fdba675ed9cfe8aa660f5f5f63539277fef6321f4eda1",
  [BASEBOARD_TRIM_FIT.src]: "5f63a61e30116b8a31bef19a425bd37f1541528af7a159c642f47dc731111168",
} as const;

test("Sam r1 images match the staged sha256 and are served through srcset", () => {
  for (const variant of [FRAMING_FOOTHILLS, BASEBOARD_TRIM_FIT]) {
    const file = join(root, "public", variant.src);
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
    assert.equal(sha, expected[variant.src]);
    assert.equal(variant.srcSet, `${variant.src} ${variant.width}w`);
    assert.equal(imageVariantFor(variant.src), variant);
    assert.equal(/our work|projects|recent jobs/i.test(variant.alt), false);
    assert.equal(variant.alt.includes("("), false);
  }
  assert.equal(
    BASEBOARD_TRIM_FIT.alt,
    "New white baseboard with a loose piece, a hammer, a nail set and a coping saw on an oak floor",
  );
});

test("the old branded photos stay on disk and are not referenced", () => {
  assert.equal(readFileSync(join(root, "public/images/p5-construction-branded.webp")).length > 0, true);
  assert.equal(readFileSync(join(root, "public/images/p5-handyman-branded.webp")).length > 0, true);
  const sources = [
    "app/HomePageClient.tsx",
    "app/site.ts",
    "app/quote/services.ts",
    "app/quote/QuoteLanding.tsx",
    "app/imageVariants.ts",
  ];
  for (const file of sources) {
    const source = readFileSync(join(root, file), "utf8");
    assert.equal(source.includes("p5-construction-branded.webp"), false, file);
    assert.equal(source.includes("p5-handyman-branded.webp"), false, file);
    assert.equal(source.includes("figcaption"), false, file);
    assert.equal(/Representative imagery|disclaimer/i.test(source), false, file);
  }
  assert.match(readFileSync(join(root, "app/HomePageClient.tsx"), "utf8"), /srcSet: served\.srcSet/);
  assert.match(readFileSync(join(root, "app/quote/QuoteLanding.tsx"), "utf8"), /srcSet: heroVariant\.srcSet/);
  assert.equal(companies.find((company) => company.name === "Boise Construction Co")?.image, FRAMING_FOOTHILLS.src);
  assert.equal(companies.find((company) => company.name === "Boise Handyman Co")?.image, BASEBOARD_TRIM_FIT.src);
  assert.equal(QUOTE_SERVICES.find((service) => service.slug === "custom-home")?.image, FRAMING_FOOTHILLS.src);
  assert.equal(QUOTE_SERVICES.find((service) => service.slug === "custom-home")?.imageAlt, FRAMING_FOOTHILLS.alt);
  assert.equal(QUOTE_SERVICES.find((service) => service.slug === "handyman")?.image, BASEBOARD_TRIM_FIT.src);
  assert.equal(QUOTE_SERVICES.find((service) => service.slug === "handyman")?.imageAlt, BASEBOARD_TRIM_FIT.alt);
});
