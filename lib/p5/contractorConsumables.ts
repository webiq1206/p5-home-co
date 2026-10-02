import type {ReviewedScope} from './scope.ts';

// A labor-only request can still expressly include contractor-provided installation
// consumables. Match the priced component, not its parent task or catalog section.
const GROUPS=[/\b(?:nails?|screws?|fasteners?)\b|\bfastening\s+(?:materials?|supplies)\b/i,/\b(?:caulk|caulking)\b/i,/\bshims?\b|\bleveling\s+(?:materials?|supplies)\b/i,/\badhesives?\b|\bglue\b/i,/\bsealants?\b/i,/\b(?:underlayment|flooring pad)\b/i,/\bspacers?\b/i,/\b(?:consumables?|sundries|installation (?:materials|supplies))\b/i];
const CONSUMABLES=/\b(?:consumables?|sundries|installation (?:materials|supplies))\b/i;
/** Filling an old nail hole requires filler, not a new nail purchase. */
const withoutHoleNames=(value:string)=>value.replace(/\b(?:nail|screw)[ -]holes?\b/gi,'holes');
/** Original source ownership outranks a reader-generated incidental-supply claim. */
export function ownerSuppliesAllParts(scope:ReviewedScope):boolean{
  const original=[scope.text,scope.extraction?.sourceText,...(scope.corrections||[]).filter(c=>c.field==='ownerSupplied'||c.field==='installation').map(c=>c.value)].filter(Boolean).join('\n');
  return ownerSuppliesAllPartsText(original);
}
export function ownerSuppliesAllPartsText(original:string):boolean{
  const all=/\b(?:owner|customer|client)\b[^.;\n]{0,35}\b(?:suppl\w*|provid\w*|furnish\w*)\b[^.;\n]{0,20}\ball\s+(?:installation\s+)?(?:parts|materials|consumables)\b|\ball\s+(?:installation\s+)?(?:parts|materials|consumables)\b[^.;\n]{0,45}\b(?:by\s+(?:the\s+)?owner|owner[- ]provided)\b/i.test(original);
  const exception=/\bcontractor\s+(?:supplies|provides|furnishes)\b[^.;\n]{0,70}\b(?:screws?|nails?|shims?|caulk|supplies|consumables|parts)\b/i.test(original);
  return all&&!exception;
}
export function contractorConsumableIncluded(scope:ReviewedScope,description:string):boolean{
  if(ownerSuppliesAllParts(scope))return false;
  const parts=description.split(':');
  let component=parts.at(-1)!.replace(/^(?:provide|include|supply|carry)\s+(?:an?\s+)?(?:separate\s+)?(?:materials?\s+)?allowance\s+for\s+/i,'').split('(')[0].split(/\b(?:including|includes|with|for|using)\b/i)[0].trim();
  // A physical installation/repair task may mention its supporting supplies
  // later in the sentence. That does not turn the whole operation into a
  // material purchase or authorize deleting its labor component.
  if(/^(?:(?:provide|perform)\s+)?(?:install|replace|repair|remove)\b|^(?:provide|perform)\s+(?:installation|replacement|removal)\b|^(?:installation|replacement|removal)\s+of\b/i.test(component))return false;
  // The approved generic hardware label can serve a specifically mapped
  // mounting-consumables task. Product or decorative-hardware labels cannot.
  if(parts.length>1&&/^(?:cabinet\s*(?:\+|&|and)\s*vanity\s+)?hardware(?:\s*-\s*materials?)?$/i.test(component)){
    const purpose=parts.slice(0,-1).join(':').split(/\bfor\b/i)[0].trim();
    if(/^(?:supply|provide|furnish)\b/i.test(purpose))component=purpose;
  }
  // Removal/preparation work is not an adhesive or consumable purchase merely
  // because its title names the material being removed.
  if(/\b(?:floor\s+prep(?:aration)?|adhesive\s+removal|grind(?:ing)?|demolition)\b/i.test(component))return false;
  if(/\b(?:owner|customer|client)[ -](?:supplied|provided)\b/i.test(component))return false;
  const groups=GROUPS.filter(group=>group.test(withoutHoleNames(component)));
  if(!groups.length)return false;
  const source=[scope.text,scope.extraction?.sourceText,scope.answers.estimatingInstructions,scope.answers.ownerSupplied,scope.answers.installation,...(scope.extraction?.instructions?.responsibilities||[]),...(scope.extraction?.instructions?.inclusions||[])].filter(Boolean).join('\n');
  return withoutHoleNames(source).split(/;|\n|(?<=[.!?])\s+|\bbut\b/i).some(clause=>{
    if(/\b(?:no|not|exclude|excluding|without|owner supplies|owner provides|customer supplies)\b/i.test(clause))return false;
    const provided=/\bcontractor\s+(?:supplies|provides|furnishes)\b|\bcontractor[ -](?:supplied|provided)\b/i.test(clause);
    const requested=/\b(?:include|including)\b/i.test(clause)&&(CONSUMABLES.test(clause)||groups.some(group=>group.test(clause)));
    return (provided||requested)&&(CONSUMABLES.test(clause)||groups.some(group=>group.test(clause)));
  });
}
