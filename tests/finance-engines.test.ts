import { test } from "node:test";
import assert from "node:assert/strict";

import {
  backlog,
  distributionRecommendation,
  forecastIsStale,
  forecastToComplete,
  marginHealth,
  overheadForecast,
  projectManagementFee,
  projectFunding,
  recommendedTaxReserveContribution,
  safeCash,
  splitByOwners,
  taxReserveRequirement,
} from "../app/lib/finance/engines.ts";
import { DEFAULT_FINANCE_SETTINGS, approversForAmount, mergeFinanceSettings } from "../app/lib/finance/settings.ts";

const S = DEFAULT_FINANCE_SETTINGS;

// ---------------------------------------------------------------------------
// S48: forecast to complete
// ---------------------------------------------------------------------------

test("forecast: cost = actual + remaining commitments + additional ETC, never double counted", () => {
  const f = forecastToComplete({
    revisedContract: 100_000,
    actualCost: 40_000,
    remainingCommitments: 25_000,
    additionalEtc: 10_000,
  });
  assert.equal(f.projectedFinalCost, 75_000);
  assert.equal(f.projectedGrossProfit, 25_000);
  assert.equal(f.projectedGpPct, 25);
});

test("forecast: zero contract yields null GP% rather than dividing by zero", () => {
  const f = forecastToComplete({
    revisedContract: 0,
    actualCost: 100,
    remainingCommitments: 0,
    additionalEtc: 0,
  });
  assert.equal(f.projectedGpPct, null);
});

test("forecast: cent-level inputs do not drift", () => {
  const f = forecastToComplete({
    revisedContract: 18_125.0,
    actualCost: 9_500.1,
    remainingCommitments: 0.2,
    additionalEtc: 0.7,
  });
  assert.equal(f.projectedFinalCost, 9_501.0);
  assert.equal(f.projectedGrossProfit, 8_624.0);
});

// ---------------------------------------------------------------------------
// S50: margin health bands
// ---------------------------------------------------------------------------

test("margin health: green within 2 points, yellow 2-5 points below, red beyond", () => {
  assert.equal(marginHealth(44, 45, S), "green");
  assert.equal(marginHealth(42, 45, S), "yellow");
  assert.equal(marginHealth(39, 45, S), "red");
});

test("margin health: projected loss or severe funding shortage force red", () => {
  assert.equal(marginHealth(46, 45, S, { projectedLoss: true }), "red");
  assert.equal(marginHealth(46, 45, S, { severeFundingShortage: true }), "red");
  assert.equal(marginHealth(null, 45, S), "red");
});

// ---------------------------------------------------------------------------
// S49: forecast freshness
// ---------------------------------------------------------------------------

test("forecast freshness: missing or old ETC is stale, recent is not", () => {
  const today = new Date(2026, 7, 22);
  assert.equal(forecastIsStale(null, today, S), true);
  assert.equal(forecastIsStale(new Date(2026, 5, 1), today, S), true);
  assert.equal(forecastIsStale(new Date(2026, 7, 1), today, S), false);
});

// ---------------------------------------------------------------------------
// S55-S57: funding + recommended draw
// ---------------------------------------------------------------------------

const FUNDING_BASE = {
  clearedClientPayments: 50_000,
  clearedProjectOutflows: 30_000,
  commitmentsDueInHorizon: 15_000,
  plannedUncommittedPurchases: 5_000,
  expectedLabor: 4_000,
  otherKnownOutflows: 1_000,
  etcInHorizonNotCommitted: 2_000,
  requiredProjectBuffer: 3_000,
  desiredPostDrawBuffer: 5_000,
  remainingContractBillable: 100_000,
};

test("funding: held cash, requirement, and draw follow the S56 formula", () => {
  const r = projectFunding(FUNDING_BASE);
  assert.equal(r.projectCashHeld, 20_000);
  assert.equal(r.nearTermRequirement, 30_000);
  // max(0, 30000 + 5000 - 20000) = 15000
  assert.equal(r.rawRecommendedDraw, 15_000);
  assert.equal(r.recommendedDraw, 15_000);
  assert.equal(r.contractStructureReview, false);
  assert.equal(r.status, "red"); // held < requirement: P5 is financing the job
});

test("funding: draw is capped at what the contract permits - never overbill", () => {
  const r = projectFunding({ ...FUNDING_BASE, remainingContractBillable: 10_000 });
  assert.equal(r.rawRecommendedDraw, 15_000);
  assert.equal(r.recommendedDraw, 10_000);
  assert.equal(r.contractStructureReview, true); // S56 review flag
});

test("funding: overfunded project needs no draw and reads green", () => {
  const r = projectFunding({
    ...FUNDING_BASE,
    clearedClientPayments: 100_000,
  });
  assert.equal(r.projectCashHeld, 70_000);
  assert.equal(r.recommendedDraw, 0);
  assert.equal(r.status, "green");
});

test("funding: covered requirement but thin buffer reads yellow", () => {
  const r = projectFunding({
    ...FUNDING_BASE,
    clearedClientPayments: 62_000, // held 32k: > 30k requirement, < 35k with buffer
  });
  assert.equal(r.status, "yellow");
});

// ---------------------------------------------------------------------------
// S140: Safe Cash
// ---------------------------------------------------------------------------

test("safe cash: subtracts every protected bucket from cash plus confident inflows", () => {
  const r = safeCash({
    unrestrictedClearedOperatingCash: 80_000,
    highConfidenceInflows: 10_000,
    requiredOutflowsNotReflected: 25_000,
    taxReserveRequirement: 12_000,
    minimumOperatingReserve: 20_000,
    approvedUnfundedProjectExposure: 5_000,
    otherProtectedReserves: 3_000,
  });
  assert.equal(r.safeCashAvailable, 25_000);
  assert.equal(r.provisional, false);
});

test("safe cash: can be negative - a shortfall is reported, not clamped", () => {
  const r = safeCash({
    unrestrictedClearedOperatingCash: 10_000,
    highConfidenceInflows: 0,
    requiredOutflowsNotReflected: 25_000,
    taxReserveRequirement: 0,
    minimumOperatingReserve: 0,
    approvedUnfundedProjectExposure: 0,
    otherProtectedReserves: 0,
  });
  assert.equal(r.safeCashAvailable, -15_000);
});

// ---------------------------------------------------------------------------
// S125: tax reserve
// ---------------------------------------------------------------------------

test("tax reserve: contribution = required - funded - estimates paid, floored at zero", () => {
  assert.equal(
    recommendedTaxReserveContribution({
      requiredCumulativeReserve: 30_000,
      reserveAlreadyFunded: 12_000,
      qualifyingEstimatedTaxesPaid: 8_000,
    }),
    10_000,
  );
  assert.equal(
    recommendedTaxReserveContribution({
      requiredCumulativeReserve: 10_000,
      reserveAlreadyFunded: 12_000,
      qualifyingEstimatedTaxesPaid: 0,
    }),
    0,
  );
});

test("tax reserve requirement: rate x positive income; zero on losses", () => {
  assert.equal(taxReserveRequirement(100_000, S), 30_000);
  assert.equal(taxReserveRequirement(-50_000, S), 0);
});

// ---------------------------------------------------------------------------
// S121: distribution engine
// ---------------------------------------------------------------------------

test("distribution: pool applies policy holdbacks then caps at safe cash", () => {
  const r = distributionRecommendation(
    {
      finalRevenue: 200_000,
      finalDirectCost: 140_000, // GP 60k
      pendingObligations: 5_000,
      debtRequirements: 0,
      safeCashEligible: 25_000,
    },
    S,
  );
  assert.equal(r.finalGrossProfit, 60_000);
  assert.equal(r.warrantyReserve, 2_000);        // 1% of revenue
  assert.equal(r.overheadContribution, 6_000);   // 10% of GP
  assert.equal(r.retainedEarnings, 6_000);       // 10% of GP
  assert.equal(r.eligiblePool, 41_000);
  assert.equal(r.recommendedDistribution, 25_000); // min(pool, safe cash)
});

test("distribution: a losing project distributes nothing", () => {
  const r = distributionRecommendation(
    {
      finalRevenue: 100_000,
      finalDirectCost: 120_000,
      pendingObligations: 0,
      debtRequirements: 0,
      safeCashEligible: 50_000,
    },
    S,
  );
  assert.equal(r.eligiblePool, 0);
  assert.equal(r.recommendedDistribution, 0);
});

test("owner split: sums exactly to the distributed amount despite rounding", () => {
  const split = splitByOwners(1_000.01, [
    { id: 1, distributionPct: 33.33 },
    { id: 2, distributionPct: 66.67 },
  ]);
  const total = split.reduce((s, o) => s + o.amount, 0);
  assert.equal(Math.round(total * 100), 100_001);
});

// ---------------------------------------------------------------------------
// S145: overhead forecast
// ---------------------------------------------------------------------------

test("overhead: weekly compensation annualizes at 52 weeks", () => {
  const r = overheadForecast({
    weeklyOwnerCompensation: 2_000, // both owners combined
    monthlyFixedOther: 5_000,
    avgMonthlyVariable: 3_000,
  });
  // 2000 * 52 / 12 = 8666.67 owner monthly
  assert.equal(r.monthlyFixedOverhead, 13_666.67);
  assert.equal(r.monthlyBurn, 16_666.67);
  // Rounding happens once at output: 16,666.666... x 12 = exactly 200,000.
  assert.equal(r.annualizedOverhead, 200_000);
});

// ---------------------------------------------------------------------------
// S194: backlog
// ---------------------------------------------------------------------------

test("backlog: signed value not yet earned; overearned projects contribute zero", () => {
  assert.equal(
    backlog([
      { revisedContract: 100_000, earnedToDate: 40_000 },
      { revisedContract: 50_000, earnedToDate: 60_000 },
    ]),
    60_000,
  );
});

// ---------------------------------------------------------------------------
// S106: approval matrix
// ---------------------------------------------------------------------------

test("approval matrix: resolves the correct tier and fails closed above the top tier", () => {
  assert.deepEqual(approversForAmount(S.billApprovalTiers, 2_000), ["project_manager"]);
  assert.deepEqual(approversForAmount(S.billApprovalTiers, 2_500), ["project_manager"]);
  assert.deepEqual(approversForAmount(S.billApprovalTiers, 9_999), ["project_manager", "manager"]);
  assert.deepEqual(approversForAmount(S.billApprovalTiers, 50_001), ["administrator"]);
  assert.deepEqual(approversForAmount([], 1), ["administrator"]);
});

test("settings merge: overrides one nested field without losing siblings", () => {
  const merged = mergeFinanceSettings(S, { taxReserve: { rate: 0.25 } });
  assert.equal(merged.taxReserve.rate, 0.25);
  assert.equal(merged.taxReserve.rateConfirmedByCpa, false);
  assert.equal(merged.marginBands.yellowBelow, 2);
});

// ---------------------------------------------------------------------------
// Project-management fee (owner policy): 15% of contract by default
// ---------------------------------------------------------------------------

test("PM fee: required amount is the configured percentage of contract", () => {
  const fee = projectManagementFee(200_000, S);
  assert.equal(fee.required, 30_000); // 15% of 200k
  assert.equal(fee.meetsRequirement, null); // unknown until we see the estimate
  assert.equal(fee.shortfall, 0);
});

test("PM fee: an estimate that includes enough meets the requirement", () => {
  const fee = projectManagementFee(200_000, S, 30_000);
  assert.equal(fee.meetsRequirement, true);
  assert.equal(fee.shortfall, 0);
});

test("PM fee: an estimate that includes too little reports the shortfall", () => {
  const fee = projectManagementFee(200_000, S, 18_000);
  assert.equal(fee.meetsRequirement, false);
  assert.equal(fee.shortfall, 12_000);
});

test("PM fee: percentage is configurable and a zero/negative contract is safe", () => {
  const at20 = mergeFinanceSettings(S, { projectManagement: { pctOfContract: 0.2 } });
  assert.equal(projectManagementFee(100_000, at20).required, 20_000);
  assert.equal(projectManagementFee(0, S).required, 0);
  assert.equal(projectManagementFee(-5000, S).required, 0);
});
