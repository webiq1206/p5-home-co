import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { DRIVE_DINING_ROOM, DRIVE_KITCHEN, DRIVE_PRIMARY_BATH, imageVariants } from "../app/imageVariants.ts";
import { localAlt } from "../app/localAlt.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";

// Owner, 19 November 2026: every image names the work and the place, with no
// qualifier in or beside the description.
const QUALIFIER = /\b(idea|ideas|concept|representative|inspiration|possibilit\w*|rendering|render)\b/i;
const LOCAL = /^[A-Z][^:]* in [A-Z][a-z]+, Idaho: \S/;
const root = join(import.meta.dirname, "..");

test("a local alt names the work, the city and Idaho, then the picture", () => {
  assert.equal(
    localAlt("White kitchen with an oak island", { subject: "kitchen remodeling", city: "Meridian" }),
    "Kitchen remodeling in Meridian, Idaho: white kitchen with an oak island",
  );
  assert.equal(localAlt("A hammer on a drop cloth."), "Home remodeling in Boise, Idaho: a hammer on a drop cloth");
  assert.equal(localAlt("Single-story ADU with a cedar door", { subject: "ADU construction" }), "ADU construction in Boise, Idaho: single-story ADU with a cedar door");
  // Already names its own place: left exactly as written.
  assert.equal(localAlt("Nick Perkins at a pumpkin patch in Meridian, Idaho"), "Nick Perkins at a pumpkin patch in Meridian, Idaho");
  assert.equal(localAlt(""), "");
});

test("every served photograph and quote page photograph has a local alt", () => {
  const alts = [
    ...Object.values(imageVariants).map((variant) => variant.alt),
    DRIVE_DINING_ROOM.alt,
    DRIVE_KITCHEN.alt,
    DRIVE_PRIMARY_BATH.alt,
    ...QUOTE_SERVICES.map((service) => service.imageAlt),
  ];
  for (const alt of alts) {
    assert.match(alt, LOCAL, alt);
    assert.equal(QUALIFIER.test(alt), false, alt);
  }
});

test("public page sources carry no empty content alt and no qualifier label beside a photograph", () => {
  for (const file of ["app/HomePageClient.tsx", "app/quote/QuoteLanding.tsx", "app/about/AboutClient.tsx"]) {
    const source = readFileSync(join(root, file), "utf8");
    // The only empty alts left are brand marks, which sit beside their written name.
    for (const tag of source.match(/<img\b[^>]*alt=""[^>]*>/g) ?? []) assert.match(tag, /brand-logo|logo/, `${file}: ${tag}`);
    assert.equal(/className="eyebrow">[^<]*(Ideas|Inspiration|Possibilities|Concept)/i.test(source), false, file);
  }
});
