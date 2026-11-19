import assert from "node:assert/strict";
import test from "node:test";

import { FEATURED_BOISE_EXTERIOR } from "../app/imageVariants.ts";
import { quotePhotos } from "../app/quote/photos.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";

const pages = [{ slug: "(all services)", hero: FEATURED_BOISE_EXTERIOR.src }, ...QUOTE_SERVICES.map((s) => ({ slug: s.slug, hero: s.image }))];

for (const page of pages) {
  test(`quote page ${page.slug} shows no photograph twice`, () => {
    const photos = quotePhotos(page.hero);
    const shown = [page.hero, ...photos.row.map((i) => i.src), photos.band.src, photos.besideQuestions.src];
    assert.equal(photos.row.length, 4);
    assert.equal(new Set(shown).size, shown.length, shown.join("\n"));
    for (const image of [...photos.row, photos.band, photos.besideQuestions]) {
      assert.match(image.alt, / in [A-Z][a-z]+, Idaho: /, image.alt);
    }
  });
}
