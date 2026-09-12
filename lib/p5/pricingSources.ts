import type {ReviewedScope} from './scope.ts';
/** Every character is covered. Overlap preserves sentences across boundaries;
 * inventory and the final audit reconcile repeated descriptions, not quantities.
 */
export function pricingSourceParts(scope:ReviewedScope){
  const original={text:scope.text,answers:scope.answers,extraction:scope.extraction};
  const serialized=JSON.stringify(original);
  if(serialized.length<=40000)return [original];
  const parts:Record<string,unknown>[]=[];
  for(let start=0;start<serialized.length;start+=36000)parts.push({
    section:parts.length+1,sourceStart:start,sourceEnd:Math.min(start+40000,serialized.length),
    sourceText:serialized.slice(start,start+40000),
    boundary:{service:scope.answers.service,location:scope.answers.location,instructions:scope.extraction?.instructions,estimatingInstructions:scope.answers.estimatingInstructions,customerExclusions:scope.answers.exclusions,ownerSupplied:scope.answers.ownerSupplied},
    notice:'This is a complete-coverage source section, with overlapping context at its edges. Other sections are independently inventoried and audited. Do not count repeated edge content twice.',
  });
  return parts;
}
