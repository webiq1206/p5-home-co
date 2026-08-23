import { test } from "node:test";
import assert from "node:assert/strict";

import { wipRow, wipTotals } from "../app/lib/finance/wip.ts";

test("percent complete is cost based, and earned revenue follows it", () => {
  const row = wipRow({
    revisedContract: 100_000,
    costToDate: 30_000,
    estimateToComplete: 45_000,
    billedToDate: 40_000,
  });
  assert.equal(row.projectedFinalCost, 75_000);
  assert.equal(row.percentComplete, 0.4);          // 30k / 75k
  assert.equal(row.earnedRevenue, 40_000);         // 40% of 100k
  assert.equal(row.projectedGrossProfit, 25_000);
  assert.equal(row.projectedGrossMarginPct, 25);
});

test("billing beyond earned is a liability, not profit", () => {
  const row = wipRow({
    revisedContract: 100_000,
    costToDate: 25_000,
    estimateToComplete: 75_000,
    billedToDate: 40_000,
  });
  assert.equal(row.earnedRevenue, 25_000);
  assert.equal(row.overbilled, 15_000);
  assert.equal(row.underbilled, 0);
});

test("earning beyond billed means P5 is financing the job", () => {
  const row = wipRow({
    revisedContract: 100_000,
    costToDate: 60_000,
    estimateToComplete: 20_000,
    billedToDate: 50_000,
  });
  assert.equal(row.percentComplete, 0.75);
  assert.equal(row.earnedRevenue, 75_000);
  assert.equal(row.underbilled, 25_000);
  assert.equal(row.overbilled, 0);
});

test("a job with no cost and no forecast earns nothing rather than everything", () => {
  // Dividing by zero, or defaulting to complete, would put a fictional earned
  // figure in front of a lender.
  const row = wipRow({
    revisedContract: 100_000,
    costToDate: 0,
    estimateToComplete: 0,
    billedToDate: 0,
  });
  assert.equal(row.percentComplete, 0);
  assert.equal(row.earnedRevenue, 0);
  assert.ok(Number.isFinite(row.projectedGrossMarginPct));
});

test("a job cannot be more than finished, even when costs overrun", () => {
  const row = wipRow({
    revisedContract: 100_000,
    costToDate: 120_000,
    estimateToComplete: 0,
    billedToDate: 100_000,
  });
  assert.equal(row.percentComplete, 1);
  assert.equal(row.earnedRevenue, 100_000);
  // The overrun shows up as a loss, which is the honest place for it.
  assert.equal(row.projectedGrossProfit, -20_000);
  assert.equal(row.projectedGrossMarginPct, -20);
});

test("a zero contract does not produce a nonsense margin", () => {
  const row = wipRow({
    revisedContract: 0,
    costToDate: 5_000,
    estimateToComplete: 0,
    billedToDate: 0,
  });
  assert.equal(row.projectedGrossMarginPct, 0);
  assert.equal(row.earnedRevenue, 0);
});

test("over- and under-billing are never netted against each other", () => {
  // A portfolio 50k overbilled on one job and 50k underbilled on another is
  // not balanced: it has a liability AND a financing problem.
  const over = wipRow({
    revisedContract: 100_000,
    costToDate: 25_000,
    estimateToComplete: 75_000,
    billedToDate: 75_000,
  });
  const under = wipRow({
    revisedContract: 100_000,
    costToDate: 75_000,
    estimateToComplete: 25_000,
    billedToDate: 25_000,
  });
  const totals = wipTotals([over, under]);

  assert.equal(totals.overbilled, 50_000);
  assert.equal(totals.underbilled, 50_000);
  assert.equal(totals.revisedContract, 200_000);
  assert.equal(totals.earnedRevenue, 100_000);
});

test("totals of an empty schedule are zero, not NaN", () => {
  const totals = wipTotals([]);
  assert.equal(totals.revisedContract, 0);
  assert.equal(totals.overbilled, 0);
  assert.equal(totals.projectedGrossProfit, 0);
});
