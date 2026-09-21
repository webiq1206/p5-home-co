import type {EstimatorConfiguration} from './costBook.ts';
import {MAX_PLANNING_RATES,type PlanningRate} from './planningBooks.ts';
import {RATE_CARD} from './rateCardData.ts';

/** The owner's Boise rate card, merged into the saved planning catalog.
 *
 * The catalog lives in each brand's own database, and a deployment's database
 * is not the workspace's, so a rate card loaded from a workspace shell never
 * reaches production. This merge closes that gap: the card ships with the
 * server (imported only by server code, so it is never in a browser bundle),
 * and pricing adds any of its codes the saved catalog does not have yet.
 *
 * It is strictly additive and idempotent. A code the owner already has keeps
 * the owner's amount, nothing is ever removed, and once every code is present
 * the merge does nothing at all. Set P5_RATE_CARD=off to disable it. */
export async function shippedRateCard():Promise<PlanningRate[]|null>{
  // The generated module is what a deployed server reads: the scripts directory is not traced
  // into the standalone build, so the JSON beside it is not there at runtime. The JSON stays the
  // source of truth, p5-build-rate-card.mjs regenerates the module, and a test pins them together.
  return Array.isArray(RATE_CARD)&&RATE_CARD.length?RATE_CARD:null;
}
/** Codes in the card that the saved catalog does not carry yet. */
export function missingRates(configuration:EstimatorConfiguration,card:PlanningRate[]):PlanningRate[]{
  const have=new Set((configuration.planningCatalog?.rates||[]).map(rate=>rate.code));
  return card.filter(rate=>!have.has(rate.code));
}
/** The configuration to price with. Returns the same object when nothing is missing. */
export function withRateCard(configuration:EstimatorConfiguration,card:PlanningRate[]):EstimatorConfiguration{
  const catalog=configuration.planningCatalog;
  if(!catalog||!Array.isArray(catalog.rates))return configuration;
  const missing=missingRates(configuration,card);
  // Never push the saved catalog past the ceiling its own validation enforces.
  const room=Math.max(0,MAX_PLANNING_RATES-catalog.rates.length);
  if(!missing.length||!room)return configuration;
  return {...configuration,planningCatalog:{...catalog,rates:[...catalog.rates,...missing.slice(0,room)]}};
}
