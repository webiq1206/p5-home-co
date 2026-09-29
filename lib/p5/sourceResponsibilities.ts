import type {ScopeAnswers,ScopeExtraction} from './scope.ts';
import {emptyInstructions} from './instructions.ts';

const items=[{label:'appliances',pattern:/\bappliances?\b/i},{label:'decorative lighting',pattern:/\b(?:decorative\s+(?:lighting|fixtures)|lighting)\b/i}];
const owner=/\b(?:owner|homeowner|client|customer)\b/i;
const installation=/\b(?:install\w*|hookups?)\b/i;
const clauses=(text:string)=>text.split(/(?<=[.;!?])\s+|\n+/).map(clause=>clause.trim()).filter(Boolean);
const cabinetFamilies=[
 {name:/^(?:base|lower) cabinets?\.?$/i,subject:/\b(?:base|lower) cabinets?\b/i},
 {name:/^(?:upper|wall) cabinets?\.?$/i,subject:/\b(?:upper|wall) cabinets?\b/i},
 {name:/^(?:tall|pantry) cabinets?\.?$/i,subject:/\b(?:tall|pantry) cabinets?\b/i},
];
/** A page that does not mention a cabinet run cannot exclude that run from
 * the entire project. Only remove a bare reader-generated exclusion when
 * native source text is available and no explicit source restriction supports
 * it. Never remove qualified or location-specific exclusions by guesswork. */
export function groundCabinetExclusions(extraction:ScopeExtraction,nativeText:string|undefined,typedText:string,previous:ScopeAnswers):ScopeExtraction{
 if(!nativeText)return extraction;
 const sources=clauses([nativeText,typedText,previous.estimatingInstructions,previous.exclusions].filter(Boolean).join('\n'));
 const unsupported=(value:string)=>{
  const family=cabinetFamilies.find(f=>f.name.test(value.trim()));
  if(!family)return false;
  return !sources.some(source=>family.subject.test(source)&&/\b(?:no|none|zero|without|exclud\w*|omit\w*|not included|do not include)\b/i.test(source)
   || /\b(?:no|zero|without|exclude|excluding|omit)\s+(?:any |all )?cabinets?(?:\s|[.,;]|$)/i.test(source)&&!/\bcabinets?\s+(?:products?|supply|purchase|materials?)\b/i.test(source));
 };
 const instructions=extraction.instructions;
 const facts=extraction.facts.flatMap(fact=>{
  if(fact.field!=='exclusions')return [fact];
  const value=fact.value.split(/[;\n]+|,\s*/).filter(part=>!unsupported(part)).join('; ');
  return value?[{...fact,value}]:[];
 });
 return {...extraction,facts,...(instructions?{instructions:{...instructions,exclusions:instructions.exclusions.filter(value=>!unsupported(value))}}:{})};
}
/** Selecting products or separating product allowances from ancillary costs
 * does not make the owner responsible for installation. Ask when unsupported. */
export function groundSourceResponsibilities(extraction:ScopeExtraction,nativeText:string|undefined,typedText:string,previous:ScopeAnswers):ScopeExtraction{
 if(!nativeText)return extraction;
 extraction=groundCabinetExclusions(extraction,nativeText,typedText,previous);
 const direct=[typedText,previous.estimatingInstructions,previous.installation,previous.ownerSupplied,previous.exclusions].filter(Boolean).join('\n');
 const sourceClauses=clauses(nativeText+'\n'+direct);
 const affected=items.filter(item=>{
  const supported=sourceClauses.some(clause=>item.pattern.test(clause)&&installation.test(clause)&&!/\b(?:not|no|without)\b/i.test(clause)&&(/\b(?:I|we)\s+(?:will|shall|can)\s+install\b/i.test(clause)||owner.test(clause)&&! /\b(?:select\w*|allowance|exclud\w*)\b/i.test(clause)));
  if(supported)return false;
  return [...extraction.facts.map(fact=>fact.value),...(extraction.instructions?.responsibilities||[])].some(value=>clauses(value).some(clause=>owner.test(clause)&&installation.test(clause)&&item.pattern.test(clause)));
 });
 const allowanceBoundary=/\bproduct(?:[- ]only| allowance)\b/i.test(nativeText)&&/\bancillary costs\b.{0,80}\bseparately\b/i.test(nativeText);
 const retainedResetItems=items.filter(item=>sourceClauses.some((clause,index)=>item.pattern.test(clause)
   && /\b(?:existing|remain|retain|keep)\b/i.test(clause)
   && /\b(?:detach|disconnect)\b.{0,35}\b(?:reset|reconnect)\b/i.test(clause+' '+(sourceClauses[index+1]||''))));
 if(!affected.length&&!allowanceBoundary&&!retainedResetItems.length)return extraction;
 const unsupportedOwner=(clause:string)=>owner.test(clause)&&installation.test(clause)&&affected.some(item=>item.pattern.test(clause));
 const explicitOwnerSupply=(item:typeof items[number])=>Boolean(previous.ownerSupplied&&item.pattern.test(previous.ownerSupplied)&&!/\b(?:no|not|none)\b/i.test(previous.ownerSupplied))||sourceClauses.some(clause=>item.pattern.test(clause)&&(owner.test(clause)||/\b(?:I|we)\b/i.test(clause))&&/\b(?:suppl\w*|purchas\w*|furnish\w*|provid\w*|have|own)\b/i.test(clause)&&!/\b(?:select\w*|allowance|no|not|none|without)\b/i.test(clause));
 const globalAllowanceExclusion=(clause:string)=>allowanceBoundary&&items.some(item=>item.pattern.test(clause)&&!clauses(direct).some(user=>item.pattern.test(user)&&/\bexclud\w*\b/i.test(user)))&&/\b(?:install\w*|shipping|tax|delivery|hookups?)\b/i.test(clause)&&!/\b(?:allowance|product[- ]only)\b/i.test(clause);
 const facts=extraction.facts.flatMap(fact=>{
  if(fact.field==='ownerSupplied'&&allowanceBoundary&&items.some(item=>item.pattern.test(fact.value)&&!explicitOwnerSupply(item)))return [];
  const value=clauses(fact.value).filter(clause=>!unsupportedOwner(clause)&&!(fact.field==='exclusions'&&globalAllowanceExclusion(clause))).join(' ');
  return value?[{...fact,value}]:[];
 });
 const instructions=extraction.instructions||emptyInstructions();
 const questions=instructions.questions.filter(question=>!retainedResetItems.some(item=>question===`Who should install the ${item.label}?`));
 for(const item of affected){
  // Retaining an existing appliance and explicitly detaching/resetting it
  // is a specified task, not an unanswered new-appliance installation.
  // Remove the model's unsupported owner assignment above, but do not ask
  // the customer to repeat this already supplied scope.
  if(retainedResetItems.includes(item))continue;
  const question=`Who should install the ${item.label}?`;if(!questions.includes(question))questions.push(question);
 }
 return {...extraction,facts,instructions:{...instructions,responsibilities:instructions.responsibilities.filter(value=>!unsupportedOwner(value)),exclusions:instructions.exclusions.filter(value=>!globalAllowanceExclusion(value)),questions}};
}
