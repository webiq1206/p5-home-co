import assert from "node:assert/strict";
import test from "node:test";

import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";

test("only a first newly accepted inquiry qualifies for conversion", () => {
  assert.equal(isNewAcceptedInquiry(201, { accepted: true }, false), true);
  assert.equal(isNewAcceptedInquiry(201, { accepted: true }, true), false);
  assert.equal(isNewAcceptedInquiry(200, { accepted: false }, false), false);
  assert.equal(isNewAcceptedInquiry(200, { accepted: true }, false), false);
  assert.equal(isNewAcceptedInquiry(201, { accepted: false }, false), false);
  assert.equal(isNewAcceptedInquiry(422, { accepted: false }, false), false);
  assert.equal(isNewAcceptedInquiry(429, { accepted: false }, false), false);
  assert.equal(isNewAcceptedInquiry(500, { accepted: false }, false), false);
});