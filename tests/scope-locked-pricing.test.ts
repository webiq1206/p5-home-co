/**
 * Owner rule (Jared, 24 November 2026): prices on current jobs are locked in.
 * Cost book updates price new work only. A saved scope version priced on an
 * earlier cost book keeps its saved pricing on automatic re-pricing, on the
 * project page and when its QuickBooks estimate is created.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedPricing } from "../app/lib/scopes/engine.ts";
import { COST_BOOK_VERSION } from "../app/lib/scopes/costbook.ts";

const priced = (costBookVersion: string) => ({ pricing: { lines: [], totals: { price: 12345 }, policy: { costBookVersion } } }) as never;

test("a version priced on an earlier cost book keeps its saved prices", () => {
  const version = priced("6f2f1435e32e");
  assert.equal(lockedPricing(version), (version as { pricing: unknown }).pricing);
});

test("a version priced on the current cost book is not locked", () => {
  assert.equal(lockedPricing(priced(COST_BOOK_VERSION)), null);
});

test("a version with no pricing yet is not locked", () => {
  assert.equal(lockedPricing(null), null);
  assert.equal(lockedPricing({ pricing: null } as never), null);
});
