import type {ReviewedScope} from './scope.ts';
import {retainedPricingScopeProjection} from './retainedClarification.ts';
/**
 * Clarification history is retained for recovery/audit, not a second billable
 * scope. Only canonical current facts and takeoffs go to pricing providers.
 * Original page coverage and evidence on active items remain intact.
 */
export function activePricingSource(scope:ReviewedScope){
  const active=retainedPricingScopeProjection(scope);
  return {text:active.text,answers:active.answers,extraction:active.extraction,...(active.extraction?.sourceText?{sourceNotice:'sourceText is original native document evidence. Reconcile all scope details and responsibilities against it. The visitor’s selections and exclusions define the requested subset; unselected alternatives remain excluded. Missing numbers are unknown.'}:{})};
}
/** Every character is covered. Overlap preserves sentences across boundaries;
 * inventory and the final audit reconcile repeated descriptions, not quantities.
 */
export function pricingSourceParts(scope:ReviewedScope){
  const original=activePricingSource(scope);
  const serialized=JSON.stringify(original);
  if(serialized.length<=40000)return [original];
  const parts:Record<string,unknown>[]=[];
  for(let start=0;start<serialized.length;start+=36000)parts.push({
    section:parts.length+1,sourceStart:start,sourceEnd:Math.min(start+40000,serialized.length),
    sourceText:serialized.slice(start,start+40000),
    boundary:{service:original.answers.service,location:original.answers.location,instructions:original.extraction?.instructions,estimatingInstructions:original.answers.estimatingInstructions,customerExclusions:original.answers.exclusions,ownerSupplied:original.answers.ownerSupplied,laborCoverage:original.extraction?.laborCoverage},
    notice:'This is a complete-coverage source section, with overlapping context at its edges. Other sections are independently inventoried and audited. Do not count repeated edge content twice.',
  });
  return parts;
}
