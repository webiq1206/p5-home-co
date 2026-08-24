/**
 * The P5 financial engines: pure functions implementing the master spec's
 * formula register (S209-42). No database access, no dates from the clock -
 * callers pass "today" in - so every formula is deterministic and unit-tested.
 *
 * Formula sources:
 *   Safe Cash               S140    Funding status          S57
 *   Near-term funding       S55     Margin health           S50
 *   Recommended draw        S56     Forecast to complete    S48
 *   Tax reserve             S125    Distribution engine     S121
 *   Overhead forecast       S145    Backlog                 S194
 *
 * Double-counting guards the spec calls out explicitly:
 *   - commitments already included are never repeated inside ETC (S48)
 *   - inflows counted in Safe Cash are excluded from "required outflows not
 *     already reflected in cash" (S140)
 *   - contingency is a reserve, never an expense line (S28).
 */

import type { FinanceSettings } from "./settings.ts";

// ---------------------------------------------------------------------------
// Money helpers. All engine math runs in integer cents to avoid float drift;
// inputs and outputs are plain dollar numbers rounded to the cent.
// ---------------------------------------------------------------------------

const toCents = (n: number): number => Math.round(n * 100);
const toDollars = (c: number): number => c / 100;

export function roundMoney(n: number): number {
  return toDollars(toCents(n));
}

// ---------------------------------------------------------------------------
// S48: Forecast to complete
// ---------------------------------------------------------------------------

export type ForecastInput = {
  revisedContract: number;        // original contract + approved COs
  actualCost: number;
  /** Open commitment balances (PO/subcontract remaining) - not yet billed. */
  remainingCommitments: number;
  /** ETC beyond commitments. Must NOT re-include committed amounts (S48). */
  additionalEtc: number;
};

export type Forecast = {
  projectedFinalCost: number;
  projectedGrossProfit: number;
  projectedGpPct: number | null;  // null when contract is zero
};

export function forecastToComplete(input: ForecastInput): Forecast {
  const cost =
    toCents(input.actualCost) +
    toCents(input.remainingCommitments) +
    toCents(input.additionalEtc);
  const contract = toCents(input.revisedContract);
  const gp = contract - cost;
  return {
    projectedFinalCost: toDollars(cost),
    projectedGrossProfit: toDollars(gp),
    projectedGpPct: contract === 0 ? null : (gp / contract) * 100,
  };
}

// ---------------------------------------------------------------------------
// S50: margin health
// ---------------------------------------------------------------------------

export type MarginHealth = "green" | "yellow" | "red";

export function marginHealth(
  projectedGpPct: number | null,
  targetGpPct: number,
  settings: FinanceSettings,
  flags: { projectedLoss?: boolean; severeFundingShortage?: boolean } = {},
): MarginHealth {
  if (flags.projectedLoss || flags.severeFundingShortage) return "red";
  if (projectedGpPct === null) return "red";
  const below = targetGpPct - projectedGpPct;
  if (below > settings.marginBands.redBelow) return "red";
  if (below > settings.marginBands.yellowBelow) return "yellow";
  return "green";
}

// ---------------------------------------------------------------------------
// Project-management fee (owner policy).
//
// Every project must carry enough labor and supervision to cover the team that
// runs it. That is expressed as a project-management fee equal to a fraction of
// contract value. The QBO estimate is authored by hand, so this function is the
// single source of the required amount: the estimating rule quotes it, any
// report can show it, and a check can compare it against what an estimate
// actually includes.
// ---------------------------------------------------------------------------

export type PmFeeCheck = {
  /** Dollar amount the estimate should include for project management. */
  required: number;
  /** True/false once we know what the estimate included; null when unknown. */
  meetsRequirement: boolean | null;
  /** How far short, 0 when met or unknown. */
  shortfall: number;
};

export function projectManagementFee(
  contractValue: number,
  settings: FinanceSettings,
  includedPmAmount: number | null = null,
): PmFeeCheck {
  const raw = Math.max(0, contractValue) * settings.projectManagement.pctOfContract;
  const required = Math.round(raw * 100) / 100;
  if (includedPmAmount === null) {
    return { required, meetsRequirement: null, shortfall: 0 };
  }
  // A cent of tolerance so rounding never reports a met fee as short.
  const meets = includedPmAmount + 0.01 >= required;
  return {
    required,
    meetsRequirement: meets,
    shortfall: meets ? 0 : Math.round((required - includedPmAmount) * 100) / 100,
  };
}

/** S49: forecast freshness. */
export function forecastIsStale(
  etcUpdatedAt: Date | null,
  today: Date,
  settings: FinanceSettings,
): boolean {
  if (!etcUpdatedAt) return true;
  const ageDays = (today.getTime() - etcUpdatedAt.getTime()) / 86_400_000;
  return ageDays > settings.forecastStaleDays;
}

// ---------------------------------------------------------------------------
// S55-S57: project funding
// ---------------------------------------------------------------------------

export type FundingInput = {
  /** Cleared client payments assigned to the project. */
  clearedClientPayments: number;
  /** Cleared project cash outflows. */
  clearedProjectOutflows: number;
  /** Costs due within the horizon, NOT already paid, split so callers cannot
   *  double count: commitments due, planned uncommitted purchases, expected
   *  labor, other known outflows, and horizon-window ETC not in commitments. */
  commitmentsDueInHorizon: number;
  plannedUncommittedPurchases: number;
  expectedLabor: number;
  otherKnownOutflows: number;
  etcInHorizonNotCommitted: number;
  requiredProjectBuffer: number;
  /** Post-draw buffer target (project override or settings default). */
  desiredPostDrawBuffer: number;
  /** Contract ceiling: what the contract still permits P5 to invoice. */
  remainingContractBillable: number;
};

export type FundingResult = {
  projectCashHeld: number;
  nearTermRequirement: number;
  /** max(0, requirement + buffer - held), before the contract ceiling. */
  rawRecommendedDraw: number;
  /** Draw after applying the contract ceiling. Never overbill (S56). */
  recommendedDraw: number;
  /** True when need exceeds what the contract permits billing (S56). */
  contractStructureReview: boolean;
  status: "green" | "yellow" | "red";
};

export function projectFunding(input: FundingInput): FundingResult {
  const held =
    toCents(input.clearedClientPayments) - toCents(input.clearedProjectOutflows);

  const requirement =
    toCents(input.commitmentsDueInHorizon) +
    toCents(input.plannedUncommittedPurchases) +
    toCents(input.expectedLabor) +
    toCents(input.otherKnownOutflows) +
    toCents(input.etcInHorizonNotCommitted) +
    toCents(input.requiredProjectBuffer);

  const raw = Math.max(
    0,
    requirement + toCents(input.desiredPostDrawBuffer) - held,
  );
  const ceiling = Math.max(0, toCents(input.remainingContractBillable));
  const draw = Math.min(raw, ceiling);

  // S57: red when P5 is (or imminently will be) financing the project - the
  // held cash cannot cover the near-term requirement. Yellow when a shortage
  // approaches once the desired buffer is considered. Green otherwise.
  let status: FundingResult["status"] = "green";
  if (held < requirement) status = "red";
  else if (held < requirement + toCents(input.desiredPostDrawBuffer)) status = "yellow";

  return {
    projectCashHeld: toDollars(held),
    nearTermRequirement: toDollars(requirement),
    rawRecommendedDraw: toDollars(raw),
    recommendedDraw: toDollars(draw),
    contractStructureReview: raw > ceiling,
    status,
  };
}

// ---------------------------------------------------------------------------
// S140: Safe Cash
// ---------------------------------------------------------------------------

export type SafeCashInput = {
  unrestrictedClearedOperatingCash: number;
  /** Inflows expected before the next run that meet the high-confidence bar.
   *  Uncertain AR must never appear here (S139). */
  highConfidenceInflows: number;
  /** Approved outflows due before the next run NOT already reflected in the
   *  cleared cash balance (i.e. not yet withdrawn). */
  requiredOutflowsNotReflected: number;
  taxReserveRequirement: number;
  minimumOperatingReserve: number;
  approvedUnfundedProjectExposure: number;
  otherProtectedReserves: number;
};

export type SafeCash = {
  safeCashAvailable: number;
  components: SafeCashInput;
  /** True when a reserve input is still an unconfirmed owner/CPA decision. */
  provisional: boolean;
};

export function safeCash(
  input: SafeCashInput,
  opts: { provisional?: boolean } = {},
): SafeCash {
  const cents =
    toCents(input.unrestrictedClearedOperatingCash) +
    toCents(input.highConfidenceInflows) -
    toCents(input.requiredOutflowsNotReflected) -
    toCents(input.taxReserveRequirement) -
    toCents(input.minimumOperatingReserve) -
    toCents(input.approvedUnfundedProjectExposure) -
    toCents(input.otherProtectedReserves);
  return {
    safeCashAvailable: toDollars(cents),
    components: input,
    provisional: opts.provisional ?? false,
  };
}

// ---------------------------------------------------------------------------
// S125: tax reserve
// ---------------------------------------------------------------------------

export type TaxReserveInput = {
  /** CPA-methodology cumulative requirement, e.g. rate x YTD net income. */
  requiredCumulativeReserve: number;
  reserveAlreadyFunded: number;
  qualifyingEstimatedTaxesPaid: number;
};

export function recommendedTaxReserveContribution(input: TaxReserveInput): number {
  return toDollars(
    Math.max(
      0,
      toCents(input.requiredCumulativeReserve) -
        toCents(input.reserveAlreadyFunded) -
        toCents(input.qualifyingEstimatedTaxesPaid),
    ),
  );
}

/** Convenience: requirement from the CPA-controlled rate (S125). */
export function taxReserveRequirement(
  ytdNetIncome: number,
  settings: FinanceSettings,
): number {
  if (ytdNetIncome <= 0) return 0;
  return roundMoney(ytdNetIncome * settings.taxReserve.rate);
}

// ---------------------------------------------------------------------------
// S121-S122: distribution engine
// ---------------------------------------------------------------------------

export type DistributionInput = {
  finalRevenue: number;
  finalDirectCost: number;
  /** Additional policy holdbacks beyond the percentage policies. */
  pendingObligations: number;
  debtRequirements: number;
  /** min() partner: company-level Safe Cash eligible for distribution. */
  safeCashEligible: number;
};

export type DistributionResult = {
  finalGrossProfit: number;
  warrantyReserve: number;
  overheadContribution: number;
  retainedEarnings: number;
  eligiblePool: number;
  /** min(eligible pool, safe cash) - the actual recommendation (S121). */
  recommendedDistribution: number;
};

export function distributionRecommendation(
  input: DistributionInput,
  settings: FinanceSettings,
): DistributionResult {
  const gp = toCents(input.finalRevenue) - toCents(input.finalDirectCost);
  const warranty = Math.round(
    toCents(input.finalRevenue) * settings.distributionPolicy.warrantyReservePctOfRevenue,
  );
  const overhead = Math.max(
    0,
    Math.round(gp * settings.distributionPolicy.overheadContributionPctOfGp),
  );
  const retained = Math.max(
    0,
    Math.round(gp * settings.distributionPolicy.retainedEarningsPctOfGp),
  );
  const pool = Math.max(
    0,
    gp -
      warranty -
      overhead -
      retained -
      toCents(input.pendingObligations) -
      toCents(input.debtRequirements),
  );
  const recommended = Math.min(pool, Math.max(0, toCents(input.safeCashEligible)));
  return {
    finalGrossProfit: toDollars(gp),
    warrantyReserve: toDollars(warranty),
    overheadContribution: toDollars(overhead),
    retainedEarnings: toDollars(retained),
    eligiblePool: toDollars(pool),
    recommendedDistribution: toDollars(recommended),
  };
}

/** Split a distribution across owners by distribution percentage (S112). */
export function splitByOwners(
  amount: number,
  owners: { id: number; distributionPct: number }[],
): { id: number; amount: number }[] {
  const totalPct = owners.reduce((sum, o) => sum + o.distributionPct, 0);
  if (totalPct <= 0) return owners.map((o) => ({ id: o.id, amount: 0 }));
  const cents = toCents(amount);
  let allocated = 0;
  const out = owners.map((o, i) => {
    // Last owner takes the rounding remainder so the split always sums exactly.
    const share =
      i === owners.length - 1
        ? cents - allocated
        : Math.round((cents * o.distributionPct) / totalPct);
    allocated += share;
    return { id: o.id, amount: toDollars(share) };
  });
  return out;
}

// ---------------------------------------------------------------------------
// S145: overhead forecast
// ---------------------------------------------------------------------------

export type OverheadInput = {
  /** Weekly owner compensation total; annualized at 52 weeks (S145). */
  weeklyOwnerCompensation: number;
  monthlyFixedOther: number;      // software, insurance, debt service, retainers...
  avgMonthlyVariable: number;
};

export type OverheadForecast = {
  monthlyFixedOverhead: number;
  monthlyBurn: number;
  ninetyDayBurn: number;
  annualizedOverhead: number;
};

export function overheadForecast(input: OverheadInput): OverheadForecast {
  const ownerMonthly = (toCents(input.weeklyOwnerCompensation) * 52) / 12;
  const fixed = ownerMonthly + toCents(input.monthlyFixedOther);
  const burn = fixed + toCents(input.avgMonthlyVariable);
  return {
    monthlyFixedOverhead: toDollars(Math.round(fixed)),
    monthlyBurn: toDollars(Math.round(burn)),
    ninetyDayBurn: toDollars(Math.round(burn * 3)),
    annualizedOverhead: toDollars(Math.round(burn * 12)),
  };
}

// ---------------------------------------------------------------------------
// S194: backlog - signed contract value not yet earned. Operational, not AR.
// ---------------------------------------------------------------------------

export function backlog(
  projects: { revisedContract: number; earnedToDate: number }[],
): number {
  return toDollars(
    projects.reduce(
      (sum, p) =>
        sum + Math.max(0, toCents(p.revisedContract) - toCents(p.earnedToDate)),
      0,
    ),
  );
}
