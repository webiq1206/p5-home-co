/**
 * Work in progress: earned revenue, and whether a job is over- or under-billed.
 *
 * This is the report a lender or CPA asks for first, and the one most often got
 * wrong. Percent complete is COST based - cost to date over projected final
 * cost - not "how finished it looks". Earned revenue is that percentage of the
 * revised contract.
 *
 * The two failure modes it exists to expose:
 *   * Overbilling: billed more than earned. That money is a liability, not
 *     profit, and spending it is how a job runs out of cash before it ends.
 *   * Underbilling: earned more than billed. P5 is financing the client.
 *
 * Pure, because these numbers go in front of lenders.
 */

import { roundMoney } from "./engines.ts";

export type WipInput = {
  revisedContract: number;
  costToDate: number;
  /** Estimate to complete. Projected final cost is costToDate + this. */
  estimateToComplete: number;
  billedToDate: number;
};

export type WipRow = {
  revisedContract: number;
  costToDate: number;
  projectedFinalCost: number;
  /** 0-1, cost based. Zero when there is no projected cost to divide by. */
  percentComplete: number;
  earnedRevenue: number;
  billedToDate: number;
  /** Billed beyond earned. A liability. */
  overbilled: number;
  /** Earned beyond billed. P5 is carrying it. */
  underbilled: number;
  projectedGrossProfit: number;
  projectedGrossMarginPct: number;
};

export function wipRow(input: WipInput): WipRow {
  const revisedContract = roundMoney(input.revisedContract);
  const costToDate = roundMoney(input.costToDate);
  const projectedFinalCost = roundMoney(costToDate + input.estimateToComplete);
  const billedToDate = roundMoney(input.billedToDate);

  // No projected cost means nothing has been spent and nothing is forecast, so
  // there is no basis to claim progress. Reporting 100% here - or dividing by
  // zero - would put a fictional earned figure in front of a lender.
  let percentComplete = 0;
  if (projectedFinalCost > 0) {
    percentComplete = costToDate / projectedFinalCost;
    // Costs can exceed the forecast; the job is still not more than finished.
    if (percentComplete > 1) percentComplete = 1;
  }

  const earnedRevenue = roundMoney(revisedContract * percentComplete);
  const difference = roundMoney(billedToDate - earnedRevenue);

  const projectedGrossProfit = roundMoney(revisedContract - projectedFinalCost);
  const projectedGrossMarginPct =
    revisedContract > 0
      ? Math.round((projectedGrossProfit / revisedContract) * 1000) / 10
      : 0;

  return {
    revisedContract,
    costToDate,
    projectedFinalCost,
    percentComplete: Math.round(percentComplete * 1000) / 1000,
    earnedRevenue,
    billedToDate,
    overbilled: difference > 0 ? difference : 0,
    underbilled: difference < 0 ? roundMoney(-difference) : 0,
    projectedGrossProfit,
    projectedGrossMarginPct,
  };
}

export type WipTotals = {
  revisedContract: number;
  costToDate: number;
  projectedFinalCost: number;
  earnedRevenue: number;
  billedToDate: number;
  overbilled: number;
  underbilled: number;
  projectedGrossProfit: number;
};

/**
 * Totals across jobs.
 *
 * Over- and under-billing are summed SEPARATELY and never netted. A portfolio
 * that is $50k overbilled on one job and $50k underbilled on another is not
 * balanced - it has a $50k liability and a $50k financing problem, and netting
 * them to zero hides both.
 */
export function wipTotals(rows: WipRow[]): WipTotals {
  const sum = (pick: (r: WipRow) => number): number =>
    roundMoney(rows.reduce((total, row) => total + pick(row), 0));

  return {
    revisedContract: sum((r) => r.revisedContract),
    costToDate: sum((r) => r.costToDate),
    projectedFinalCost: sum((r) => r.projectedFinalCost),
    earnedRevenue: sum((r) => r.earnedRevenue),
    billedToDate: sum((r) => r.billedToDate),
    overbilled: sum((r) => r.overbilled),
    underbilled: sum((r) => r.underbilled),
    projectedGrossProfit: sum((r) => r.projectedGrossProfit),
  };
}
