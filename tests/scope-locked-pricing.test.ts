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

test("a version priced on an earlier cost book keeps its saved prices", async () => {
  const version = priced("6f2f1435e32e");
  assert.equal(await lockedPricing(version), (version as { pricing: unknown }).pricing);
});

test("a version priced on the current cost book is not locked", async () => {
  assert.equal(await lockedPricing(priced(COST_BOOK_VERSION)), null);
});

test("a version with no pricing yet is not locked", async () => {
  assert.equal(await lockedPricing(null), null);
  assert.equal(await lockedPricing({ pricing: null } as never), null);
});

test("a version priced under another approved release keeps its saved prices, even on the same catalog", async () => {
  const { baselinePricing } = await import("../lib/p5/pricingReleaseScope.ts");
  const withRelease = (digest: string) => ({ pricing: { lines: [], totals: { price: 1 }, policy: { costBookVersion: COST_BOOK_VERSION, pricingRelease: { version: "P5-OLDER", digest, source: "published" } } } }) as never;
  const older = withRelease("a".repeat(64));
  assert.equal(await lockedPricing(older), (older as { pricing: unknown }).pricing);
  assert.equal(await lockedPricing(withRelease(baselinePricing().digest)), null);
});
