import assert from "node:assert/strict";
import test from "node:test";

import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  validateIndexNowHostUrls,
  validateIndexNowUrls,
} from "../app/lib/indexnow.ts";

test("IndexNow ownership key is hosted at the canonical origin", () => {
  assert.equal(INDEXNOW_KEY_LOCATION, `https://p5homeco.com/${INDEXNOW_KEY}.txt`);
});

test("IndexNow accepts sitemap pages and removes duplicates", () => {
  assert.deepEqual(validateIndexNowUrls(["/", "https://p5homeco.com/"]), ["https://p5homeco.com/"]);
});

test("IndexNow rejects private, external, and unknown pages", () => {
  for (const url of ["/admin", "/portal/client", "/api/leads/intake", "https://example.com/", "/not-real"]) {
    assert.throws(() => validateIndexNowUrls([url]));
  }
});

test("removed pages can be validated against the public host without admitting private paths", () => {
  assert.deepEqual(validateIndexNowHostUrls(["/retired-page"]), ["https://p5homeco.com/retired-page"]);
  assert.throws(() => validateIndexNowHostUrls(["/portal/client"]));
});