import type {ReviewedScope} from './scope.ts';

// A labor-only request can still expressly include contractor-provided installation
// consumables. Match the priced component, not its parent task or catalog section.
const GROUPS=[/\b(?:nails?|screws?|fasteners?|fastening)\b/i,/\b(?:caulk|caulking)\b/i,/\bshims?\b|\bleveling\b/i,/\badhesives?\b|\bglue\b/i,/\bsealants?\b/i,/\b(?:consumables?|sundries)\b/i];
const CONSUMABLES=/\b(?:consumables?|sundries)\b/i;
export function contractorConsumableIncluded(scope:ReviewedScope,description:string):boolean{
  const parts=description.split(':');
  let component=parts.at(-1)!.split('(')[0].split(/\b(?:including|includes|with|for)\b/i)[0].trim();
  // The approved generic hardware label can serve a specifically mapped
  // mounting-consumables task. Product or decorative-hardware labels cannot.
  if(parts.length>1&&/^(?:cabinet\s*(?:\+|&|and)\s*vanity\s+)?hardware(?:\s*-\s*materials?)?$/i.test(component)){
    const purpose=parts.slice(0,-1).join(':').split(/\bfor\b/i)[0].trim();
    if(/^(?:supply|provide|furnish)\b/i.test(purpose))component=purpose;
  }
  if(/\b(?:owner|customer|client)[ -](?:supplied|provided)\b/i.test(component))return false;
  const groups=GROUPS.filter(group=>group.test(component));
  if(!groups.length)return false;
  const source=[scope.text,scope.answers.estimatingInstructions,scope.answers.ownerSupplied,scope.answers.installation,...(scope.extraction?.instructions?.responsibilities||[]),...(scope.extraction?.instructions?.inclusions||[])].filter(Boolean).join('\n');
  return source.split(/;|\n|(?<=[.!?])\s+|\bbut\b/i).some(clause=>{
    if(/\b(?:no|not|exclude|excluding|without|owner supplies|owner provides|customer supplies)\b/i.test(clause))return false;
    const provided=/\bcontractor\s+(?:supplies|provides|furnishes)\b|\bcontractor[ -](?:supplied|provided)\b/i.test(clause);
    const requested=/\b(?:include|including)\b/i.test(clause)&&CONSUMABLES.test(clause);
    return (provided||requested)&&(CONSUMABLES.test(clause)||groups.some(group=>group.test(clause)));
  });
}
