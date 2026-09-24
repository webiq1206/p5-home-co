import {plainCustomerLine,customerSentence} from './customerCopy.ts';
/**
 * The one customer boundary for every brand. The estimator page, customer
 * email, customer PDF, public API responses and the customer copy inside the
 * CRM payload all pass through customerPresentation(); historical saved
 * results are re-projected on every read, so retained internal records and
 * provenance are never rewritten.
 *
 * This module is dependency-free on purpose: pricing, presentation, delivery
 * and endpoints may all import it without creating a cycle.
 *
 * Two rules, both structural:
 *  1. Structured fields are allowlisted. Unknown/private fields never cross.
 *  2. Prose is never a rate authority. Selling prices are carried only in the
 *     explicit numeric fields; cost-basis figures, unit rates, margin/overhead
 *     arithmetic and cost-book provenance are removed from prose while the
 *     surrounding scope, quantities, caveats and ordinary words ("overhead
 *     cabinets", "overhead garage door", "architect markup", "1/8-inch
 *     margin") are preserved.
 */
// Preserve original wording, numbers and exclusions. Never split decimal values or URLs.
export const scopeBullets=(s:string)=>s.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(x=>x.trim().replace(/^[•*]\s*/, '')).filter(Boolean);
/** The first group is the owner price book's own wording (priceBook.ts line descriptions and the
 * book's notes): how a line is priced, OH&P and remodel-premium notes, tier labels and internal
 * section names. Live, a kitchen line reached the customer email reading "complete assembly, do not
 * add its component lines ... GC OH&P (~25% on cost) removed from published pricing". */
const PRIVATE_PRICING_TEXT=/\bdirect[- ](?:materials?|labor|labour)(?:[- ](?:work[- ]package|planning))?[- ]allowance\b|(?:third-party market rate|cost to you if subcontracted|parts \/ materials extra|installed price, labor and material|labor (?:only|with consumables)|material only|price (?:materials|installation) separately|complete assembly|component lines|remodel premium|\bOH&P\b|published pricing|owner (?:price book|selection allowance)|contractor allowance|(?:Builder Grade|Mid-Range|High-End|Luxury) (?:finish|direct cost)|rental or service charge|trip, call, minimum|operator labor and equipment|removal labor with|Project Assemblies|Assemblies,)|\b(?:direct[- ](?:project[- ]|labor[- ]|material[- ])?(?:unit[- ]?)?(?:rates?|costs?|prices?)|direct[- ]costs?|catalog(?:ued)? (?:unit[- ]?)?(?:rate|cost|price)|(?:actual|net|loaded|landed) (?:unit[- ]?)?cost|unit[- ]costs?|cost basis|owner[- ]average cost|owner[- ]approved estimating schedule|cost[- ]book|risk[- ]adjusted (?:direct )?cost|overhead (?:allocation|recovery|cost|costs|expense|expenses|burden|rate|charge|percentage|factor)|profit|divisor|reconciliation|pricing formula|calculation trace|cost ceiling|salary|payroll burden)\b|\b(?:overhead|margin|allocations?|markup)\b\s*(?:(?:target|rate|ratio)\s*)?(?::|=|\bis\b|\bof\b|\bat\b|\bequals\b)?\s*(?:\$[\d,.]+|\d+(?:\.\d+)?\s*(?:%|percent\b))|(?:\$[\d,.]+|\d+(?:\.\d+)?\s*(?:%|percent))\s*(?:(?:for|in|as)\s+)?\b(?:overhead|margin|allocations?|markup)\b|\bcontingency(?:\s+rate)?\s*(?::|=|\bis\b|\bof\b|\bat\b)?\s*\d+(?:\.\d+)?\s*(?:%|percent\b)|\d+(?:\.\d+)?\s*(?:%|percent)\s*contingency\b|(?:\+|÷|\/)\s*(?:overhead|profit|margin|contingency)|\bdivid(?:e|ed|ing)\s+by\b|\bpercent(?:age)?\s+of\s+(?:cost|revenue)\b/i;
const NUM='\\d[\\d,]*(?:\\.\\d+)?';
// Pricing units only. Room, wall, building, fixture and similar nouns are
// scope, so "2 per room" and "5 nails per linear foot" remain untouched.
const PRICING_UNIT='(?:LF|SF|SQFT|SY|CY|EA|each|hours?|HR|days?|units?|packages?|lin(?:ear|eal)\\s+(?:foot|feet)|square\\s+(?:foot|feet|yards?)|cubic\\s+(?:foot|feet|yards?)|gallons?|gal|pounds?|lbs?|tons?)';
const MEASURE_UNIT='(?:LF|SF|SQFT|SY|CY|EA|linear feet|linear foot|square feet|square foot|gallons?|pounds?)';
// A connector that only introduced the removed figure goes with it.
const LEAD='(?:\\s*(?:\\b(?:at|of|using|is|was|are)\\b|[:=@]))?\\s*';
const RATE_FIGURES:[RegExp,string][]=[
 // "100 LF x 2.00 = 200.00" is pricing arithmetic; "2 x 4" and "10 x 12 feet" are dimensions.
 [new RegExp(`\\b(${NUM}\\s*${MEASURE_UNIT})\\s*(?:x|×|\\*)\\s*[$€£]?\\s*${NUM}\\s*=\\s*[$€£]?\\s*${NUM}`,'gi'),'$1'],
 // Generated source evidence states both bounds before one shared currency.
 [new RegExp(`${LEAD}\\b${NUM}\\s*(?:to|[-–])\\s*${NUM}\\s*(?:USD|dollars?)\\b(?:\\s*(?:\\/|per\\s+)\\s*[a-z²0-9]+)?`,'gi'),''],
 [new RegExp(`${LEAD}[$€£]\\s*${NUM}\\s*(?:to|[-–])\\s*[$€£]?\\s*${NUM}\\s*(?:\\/\\s*[a-z²0-9]+|per\\s+${PRICING_UNIT}\\b)`,'gi'),''],
 [new RegExp(`${LEAD}\\bUSD\\s*${NUM}\\s*(?:\\/|per\\s+)\\s*[a-z²0-9]+`,'gi'),''],
 [new RegExp(`${LEAD}\\b${NUM}\\s*(?:USD|dollars?)\\s*(?:\\/|per\\s+)\\s*[a-z²0-9]+`,'gi'),''],
 [new RegExp(`${LEAD}[$€£]\\s*${NUM}\\s*(?:\\/\\s*[a-z²0-9]+|per\\s+${PRICING_UNIT}\\b)`,'gi'),''],
 // Bare scalar per pricing unit, integer rates included. The number must sit
 // immediately before "per" or "/" so quantities stay scope, not prices.
 [new RegExp(`${LEAD}(?<![\\d/.$])\\b${NUM}\\s*(?:\\/|per\\s+)\\s*${PRICING_UNIT}\\b`,'gi'),''],
];
const tidy=(s:string)=>s.replace(/\(\s*\)/g,'').replace(/\s+/g,' ').replace(/\s+([,.;:!?])/g,'$1').replace(/([:;,])\s*(?=[.;!?])/g,'').replace(/^[\s,;:.!?-]+/,'').trim();
function stripRateFigures(sentence:string):string{
 let out=sentence;
 for(const [pattern,replacement] of RATE_FIGURES)out=out.replace(pattern,replacement);
 return out===sentence?sentence:tidy(out);
}
/**
 * Repair prose produced by pricing runs, including previously persisted ones,
 * before it reaches any customer presenter. Generated notes often combine
 * useful scope with a private cost clause, so the clause is removed rather
 * than the whole sentence, and a stated limitation is kept.
 */
export function publicPricingText(value:unknown):string{
 const text=typeof value==='string'?value.trim():'';
 if(!text)return '';
 const repairSentence=(sentence:string):string[]=>{
   // A private material/labor amount can have its bounds in a later clause.
   // Redact all monetary figures in that sentence before retaining safe scope.
   if(/\bdirect[- ](?:materials?|labor|labour)\b/i.test(sentence)&&/[$€£]\s*\d/.test(sentence))sentence=sentence.split(/(?<=[,;])\s+/).filter(clause=>!/[$€£]\s*\d/.test(clause)||PRIVATE_PRICING_TEXT.test(clause)||/\bcustomer\s+(?:selling\s+)?(?:total|price)\b/i.test(clause)).join(' ');
   let safe=stripRateFigures(sentence
    .replace(/\s*\(([^)]*)\)/g,(whole,body)=>PRIVATE_PRICING_TEXT.test(body)?'':whole)
    .replace(/:\s*(?:mapped to|catalog(?:ued)? as)\s+[^.]+/gi,''));
  if(!PRIVATE_PRICING_TEXT.test(safe)){
   safe=safe.replace(/\s+/g,' ').replace(/\s+([,.;:])/g,'$1').trim();
   return /[A-Za-z0-9]/.test(safe)?[safe]:[];
  }
  const clauses=safe.split(/(?<=[,;])\s+|\s+(?=(?:and|but)\s+)/i).flatMap(clause=>{
   let part=clause.trim().replace(/[,;]\s*$/,'');
   if(!PRIVATE_PRICING_TEXT.test(part))return part?[part]:[];
   // Retain the useful scope before a private basis/rate appended to it.
   const introduced=part.match(/^(.+?)\s+(?:at|using|from|based on|with)\s+.+$/i);
   if(introduced&&!PRIVATE_PRICING_TEXT.test(introduced[1])&&!/^(?:the )?(?:rate|cost|price|pricing|formula|calculation)\b/i.test(introduced[1].trim()))return [introduced[1].trim()];
   // A private evidence sentence may also state a useful limitation. Keep that
   // limitation rather than treating the whole sentence as disposable.
   const limitation=part.match(/\b((?:(?:the )?(?:source|evidence|rate) date|effective date)[^.;]*(?:not stated|not supplied|unknown|unavailable|expired|out of date)[^.;]*)/i);
   return limitation?[limitation[1].trim()]:[];
  });
  safe=clauses.join(', ').replace(/\s+/g,' ').replace(/\s+([,.;:])/g,'$1').replace(/[,;:]\s*$/,'').trim();
  if(!/[A-Za-z0-9]/.test(safe))return [];
  if(/[.!?]$/.test(sentence)&&!/[.!?]$/.test(safe))safe+='.';
  return [safe];
 };
 // Removing a private figure can leave its connector behind ("allowance based on; confirm ...").
 const mend=(line:string)=>line.replace(/\s+(?:based on|at|using|from|with|of)\s*(?=[,;:.!?]|$)/gi,'').replace(/\s*[;,:]\s*(?=[.!?]?$)/,'').replace(/\s+([,;:.!?])/g,'$1').trim();
 return text.split('\n').map(line=>mend(scopeBullets(plainCustomerLine(line)).flatMap(repairSentence).flatMap(sentence=>{const safe=customerSentence(sentence);return safe?[safe]:[];}).join(' '))).filter(Boolean).join('\n');
}
const publicTextList=(value:unknown):string[]=>Array.isArray(value)?value.map(publicPricingText).filter(Boolean):[];
const finiteRange=(r:any)=>r&&Number.isFinite(r.low)&&Number.isFinite(r.high)?{low:Number(r.low),high:Number(r.high)}:null;
export interface CustomerProjectionOptions{
 /**
  * Omit per-unit selling rates and rate provenance from the customer copy.
  * Totals, quantities and descriptions are unaffected.
  */
 hideUnitRates?:boolean;
}
/**
 * Allowlisted customer projection used for current and previously persisted
 * results. Unknown/private fields never cross this presentation boundary. The
 * input is never mutated, and projecting a projection is a no-op.
 */
export function customerPresentation(result:any,options:CustomerProjectionOptions={}):any{
 const source=result&&typeof result==='object'?result:{};
 const range=finiteRange(source.range);
 const categoryRanges=Array.isArray(source.categoryRanges)?source.categoryRanges.filter((x:any)=>x&&typeof x.category==='string'&&Number.isFinite(x.low)&&Number.isFinite(x.high)).map((x:any)=>({category:publicPricingText(x.category),low:Number(x.low),high:Number(x.high)})).filter((x:any)=>x.category):[];
 const lineItems=Array.isArray(source.lineItems)?source.lineItems.map((x:any,index:number)=>{
  const category=publicPricingText(x?.category)||'Other scope';
  const description=publicPricingText(x?.description)||`Priced scope item${category==='Other scope'?'':` - ${category}`}`;
  const quantityRange=finiteRange(x?.quantityRange);
  return {
   id:String(x?.id||`priced-line-${index+1}`),category,description,
   quantity:Number(x?.quantity),unit:String(x?.unit||''),low:Number(x?.low),high:Number(x?.high),
   ...(options.hideUnitRates?{}:{unitLow:Number(x?.unitLow),unitHigh:Number(x?.unitHigh)}),
   ...(x?.building?{building:publicPricingText(x.building)}:{}),...(x?.floor?{floor:publicPricingText(x.floor)}:{}),
   ...(quantityRange?{quantityRange}:{}),
   ...(x?.pricingStatus?{pricingStatus:String(x.pricingStatus)}:{}),...(publicPricingText(x?.verification)?{verification:publicPricingText(x.verification)}:{}),
   ...(!options.hideUnitRates&&publicPricingText(x?.rateLocation)?{rateLocation:publicPricingText(x.rateLocation)}:{}),...(!options.hideUnitRates&&x?.rateDate?{rateDate:String(x.rateDate).slice(0,10)}:{})
  };
 }).filter((x:any)=>Number.isFinite(x.quantity)&&Number.isFinite(x.low)&&Number.isFinite(x.high)):[];
 const allowances=Array.isArray(source.allowances)?source.allowances.map((x:any)=>typeof x==='string'?publicPricingText(x):{
  description:publicPricingText(x?.description),...(x?.amount!=null&&Number.isFinite(Number(x.amount))?{amount:Number(x.amount)}:{}),includes:publicTextList(x?.includes),
  taxIncluded:Boolean(x?.taxIncluded),freightIncluded:Boolean(x?.freightIncluded),deliveryIncluded:Boolean(x?.deliveryIncluded),installationIncluded:Boolean(x?.installationIncluded),wasteIncluded:Boolean(x?.wasteIncluded),
  selectionDeadline:String(x?.selectionDeadline||''),adjustment:publicPricingText(x?.adjustment)
 }).filter((x:any)=>typeof x==='string'?Boolean(x):Boolean(x.description)):[];
 const instructions=source.instructions&&typeof source.instructions==='object'?{
  inclusions:publicTextList(source.instructions.inclusions),exclusions:publicTextList(source.instructions.exclusions),responsibilities:publicTextList(source.instructions.responsibilities),
  floors:publicTextList(source.instructions.floors),buildings:publicTextList(source.instructions.buildings),questions:publicTextList(source.instructions.questions),
  laborOnly:Boolean(source.instructions.laborOnly),materialsOnly:Boolean(source.instructions.materialsOnly)
 }:undefined;
 const documentCoverage=source.documentCoverage&&typeof source.documentCoverage==='object'?{
  expectedPages:Number(source.documentCoverage.expectedPages)||0,complete:Boolean(source.documentCoverage.complete),
  pages:Array.isArray(source.documentCoverage.pages)?source.documentCoverage.pages.map((p:any)=>({source:publicPricingText(p?.source),page:Number(p?.page)||0,...(p?.sheet?{sheet:publicPricingText(p.sheet)}:{}),status:String(p?.status||''),notes:publicTextList(p?.notes)})):[]
 }:undefined;
 const scopeTasks=Array.isArray(source.scopeTasks)?source.scopeTasks.map((x:any)=>{
  const quantityRange=finiteRange(x?.quantityRange);
  return {
   ...(x?.id!=null&&x.id!==''?{id:String(x.id)}:{}),description:publicPricingText(x?.description),category:publicPricingText(x?.category),
   ...(x?.building?{building:publicPricingText(x.building)}:{}),...(x?.floor?{floor:publicPricingText(x.floor)}:{}),
   ...(Number.isFinite(x?.quantity)?{quantity:Number(x.quantity)}:{}),...(typeof x?.unit==='string'&&x.unit?{unit:x.unit}:{}),
   ...(quantityRange?{quantityRange}:{}),...(typeof x?.status==='string'&&x.status?{status:x.status}:{}),
   ...(x?.origin==='required'?{origin:'required',basis:publicPricingText(x?.basis)}:{})
  };
 }).filter((x:any)=>x.description):[];
 return {
  status:String(source.status||''),range,summary:publicPricingText(source.summary),includedCategories:publicTextList(source.includedCategories),categoryRanges,lineItems,allowances,
  assumptions:publicTextList(source.assumptions),exclusions:publicTextList(source.exclusions),factors:publicTextList(source.factors),
  nextStep:publicPricingText(source.nextStep),message:publicPricingText(source.message),disclaimer:publicPricingText(source.disclaimer),
  verificationItems:publicTextList(source.verificationItems),
  // What changed from the prior version of a revised estimate (estimateRevisions.changeSummary).
  ...(Array.isArray(source.revisionSummary)?{revisionSummary:publicTextList(source.revisionSummary)}:{}),
  ...(Number.isInteger(source.revisionOf)?{revisionOf:Number(source.revisionOf)}:{}),
  scopeTasks,
  ...(instructions?{instructions}:{}),...(documentCoverage?{documentCoverage}:{})
 };
}
/** Name used by pricing, scope pricing and the CRM payload; the same single projection. */
export function projectCustomerEstimate<T>(input:T,options:CustomerProjectionOptions={}):T{return customerPresentation(input,options) as T;}
/** Prose-only entry points kept for callers that redact one string or an arbitrary customer value. */
export const customerText=(value:string):string=>publicPricingText(value);
export const customerSafeText=(value:string):string=>publicPricingText(value);
/** Defense in depth for values that are not a whole estimate: every string is repaired, emptied list entries are dropped. */
export function customerSafeValue<T>(value:T):T{
 if(typeof value==='string')return publicPricingText(value) as T;
 if(Array.isArray(value))return value.map(item=>customerSafeValue(item)).filter((item,index)=>!(item===''&&value[index]!=='')) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,customerSafeValue(item)])) as T;
 return value;
}
