import type {EstimatorConfiguration} from './costBook.ts';
import {MAX_PLANNING_RATES,type PlanningRate} from './planningBooks.ts';

/** Shipped rates merged into the saved planning catalog for one project.
 *
 * The saved catalog lives in each brand's own database, and a deployment's
 * database is not the workspace's, so rates loaded from a workspace shell never
 * reach production. The owner's master price book instead ships with the server
 * (imported only by server code, so it is never in a browser bundle) and is
 * resolved per project by lib/p5/priceBook.ts; this adds its lines to whatever
 * the saved catalog holds.
 *
 * It is strictly additive and idempotent. A code the owner has saved keeps the
 * owner's amount, nothing is ever removed, and the catalog's own ceiling is
 * respected. Price-book codes carry a PB- prefix, so they never collide with the
 * saved schedule's codes the whole-home model is built on. */
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
