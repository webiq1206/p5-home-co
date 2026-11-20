import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { GOOGLE_REVIEWS, GOOGLE_REVIEWS_URL } from "../app/reviews.ts";
import { P5_GBP_MAPS_URL } from "../app/publicIdentity.ts";

const root = join(import.meta.dirname, "..");

// The owner's two Google reviews, as written on the profile (20 November 2026).
const TONI_SENTENCES = [
  "Nick with P5 completed a full kitchen and home remodel at my home in the North End, and he was absolutely amazing!",
  "Nick was attentive, thoughtful, and dedicated to making sure every detail was just right.",
  "We couldn't be happier with the results and highly recommend him to anyone looking for an exceptional remodeling experience!",
];
const BEVERLY = "We had P5 remodel our bathroom and kitchen, and we couldn't be happier with the work! They do a little bit of everything. No job seems too big or too small. If you're looking for someone reliable who can handle a variety of projects, I highly recommend giving P5 a call. Definitely recommend!";

test("the two Google reviews are quoted verbatim, whole sentences only, with names as on Google", () => {
  assert.deepEqual(GOOGLE_REVIEWS.map((r) => r.name), ["Toni Knowles", "beverly van zandt"]);
  assert.equal(GOOGLE_REVIEWS[0].text, `${TONI_SENTENCES[0]} ... ${TONI_SENTENCES[1]} ${TONI_SENTENCES[2]}`);
  assert.equal(GOOGLE_REVIEWS[1].text, BEVERLY);
  for (const review of GOOGLE_REVIEWS) assert.doesNotMatch(review.text, /—/);
  assert.equal(GOOGLE_REVIEWS_URL, P5_GBP_MAPS_URL);
});

test("the homepage shows both reviews with a link to the profile, and no rating markup anywhere", () => {
  const home = readFileSync(join(root, "app/HomePageClient.tsx"), "utf8");
  assert.match(home, /GOOGLE_REVIEWS\.map/);
  assert.match(home, /Google review<\/span>/);
  assert.match(home, /href=\{GOOGLE_REVIEWS_URL\}/);
  assert.match(home, /See our Google reviews/);
  const files = ["app/structuredData.ts", "app/reviews.ts", "app/HomePageClient.tsx", "app/about/page.tsx", "app/contact/content.ts", "app/quote/schema.ts"];
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(source, /AggregateRating|"@type": "Review"|ratingValue|reviewCount/, file);
  }
  for (const name of readdirSync(join(root, "public")).filter((n) => n.startsWith("llms"))) {
    assert.doesNotMatch(readFileSync(join(root, "public", name), "utf8"), /ratingValue|5\.0 stars/, name);
  }
});
