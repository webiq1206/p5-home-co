import {scopeAssumptions,deriveScopeAnswers} from "./adaptive.ts";
import { createHash } from "node:crypto";
import { calculateP5Estimate,customerEstimate,customerSafeProjection,DEFAULT_FINANCE,POLICY_VERSION,COST_CATEGORIES,SERVICE_MATRIX,type FinancePolicy,type DirectCostLine,type ScopeCoverage,type PricingInput,type Service,type RiskFactor } from "./pricing.ts";
import { scopeText,blockingReviewNote,type ReviewedScope,type ScopeField } from "./scope.ts";
export { blockingReviewNote };
import {materializePlanningBook,type PlanningCatalog} from './planningBooks.ts';
export interface UnitRateContext {currency:'USD';basis:'material-purchase'|'trade-labor'|'subcontractor-installed';includes:string;excludes:string;assumptions:string[]}
export interface CostRule extends Omit<DirectCostLine,"quantity"|"quantitySource"> {unitRateContext?:UnitRateContext;
  scopeTaskId?:string;
  quantity: { field?: ScopeField; factor: number; fixed?: number };
  when?: {field:ScopeField;equals:string};
}
export interface ServiceCostBook {service:Service;mode?:'owner-planning';rules:CostRule[];coverage:ScopeCoverage[];assumptions:string[];exclusions:string[];verifiedScope:string;reviewedAt:string}
export interface EstimatorConfiguration { finance:FinancePolicy;costBooks:ServiceCostBook[];planningCatalog?:PlanningCatalog;regionalRates?:CostRule[];
  /** The exact catalog an estimate was priced from (saved catalog version plus price book content hash and tier), snapshotted into its audit trail. */
  catalogVersion?:string }
export const EMPTY_CONFIGURATION:EstimatorConfiguration={finance:DEFAULT_FINANCE,costBooks:[]};
export interface ScopePriceResolution { rules:CostRule[]; assumptions:string[]; issues:string[];removeLineIds?:string[];removeExclusions?:string[];addExclusions?:string[];completeScopeVerified?:boolean;replaceBase?:boolean }
/** Every customer projection leaving the cost book, including the early
 * review-required results that quote book notes verbatim, passes the same
 * customer-safe boundary. Internal records are returned unchanged. */
export function priceReviewedScope(scope:ReviewedScope,configuration:EstimatorConfiguration,now=new Date(),resolution?:ScopePriceResolution) {
  const priced=priceReviewedScopeInternal(scope,configuration,now,resolution);
  return {...priced,customer:customerSafeProjection(priced.customer)};
}
function priceReviewedScopeInternal(scope:ReviewedScope,configuration:EstimatorConfiguration,now:Date,resolution?:ScopePriceResolution) {
  scope={...scope,answers:deriveScopeAnswers(scope.answers)};
  const service=scope.answers.service as Service;
  if(!Object.hasOwn(SERVICE_MATRIX,service))throw new Error("Choose a valid project type.");
  let book=configuration.costBooks.find(book=>book.service===service);
  const summary=scopeText(scope);
  const explicitExclusions=[...new Set([...(scope.extraction?.instructions?.exclusions||[]),...(scope.answers.exclusions?[scope.answers.exclusions]:[])].filter(Boolean))];
  const revision=createHash("sha256").update(JSON.stringify({policyVersion:POLICY_VERSION,scope,configuration,resolution})).digest("hex");
  if(!book)return {
    internal:{revision,scope,missingInformation:["A current, approved direct-cost book is required for this service."],pricingWarnings:["cost-book-missing"],financeSnapshot:configuration.finance},
    customer:{status:"review-required",range:null,summary,includedCategories:[],categoryRanges:[],lineItems:[],allowances:[],assumptions:[],exclusions:explicitExclusions,factors:[],nextStep:SERVICE_MATRIX[service].method,message:"We have your project details. A specialist needs to confirm current costs before we can provide a reliable planning range.",disclaimer:"Preliminary project information only. This is not a bid, quote, offer or guaranteed price."},
  };
  const preliminaryModel=book.mode==='owner-planning';
  const missingInformation=[...(scope.extraction?.missingInformation||[])];
  if(resolution?.replaceBase)book={...book,rules:[],exclusions:[],assumptions:[],coverage:COST_CATEGORIES.map(category=>({category,status:'not-applicable' as const,reason:'Only the explicitly requested scope is priced; see itemized scope.'}))};
  else if(book.mode==='owner-planning'){
    if(!configuration.planningCatalog)throw new Error('The owner planning catalog has not been imported.');
    const modeled=materializePlanningBook(book,configuration.planningCatalog,scope,now);book=modeled.book;missingInformation.push(...(resolution?.completeScopeVerified?[]:modeled.missing));
  }
  const lines:DirectCostLine[]=[];
  if(resolution){
    book={...book,rules:[...book.rules.filter(r=>!resolution.removeLineIds?.includes(r.id)),...resolution.rules],exclusions:book.exclusions.filter(e=>!resolution.removeExclusions?.includes(e)),assumptions:[...book.assumptions,...resolution.assumptions],coverage:book.coverage.map(c=>resolution.rules.some(r=>r.category===c.category)?{...c,status:'included' as const,reason:'Itemized scope pricing includes this category.'}:c)};
    missingInformation.push(...resolution.issues);
  }
  for(const rule of book.rules){
    if(rule.when){
      const answer=scope.answers[rule.when.field];
      if(!answer?.trim()){missingInformation.push(`Missing cost condition: ${rule.when.field} for ${rule.description}`);continue;}
      if(answer!==rule.when.equals)continue;
    }
    const value=rule.quantity.field?scope.answers[rule.quantity.field]:undefined;
    if(rule.quantity.field&&!value?.trim()){missingInformation.push(`Missing quantity: ${rule.quantity.field} for ${rule.description}`);continue;}
    const quantity=(rule.quantity.field?Number(value!.replaceAll(",","")):rule.quantity.fixed??NaN)*rule.quantity.factor;
    if(!Number.isFinite(quantity)||quantity<0)throw new Error("Invalid cost-book quantity rule");
    if(quantity===0){missingInformation.push(`Missing quantity: ${rule.description} has a zero quantity; confirm exclusion or provide an allowance.`);continue;}
    const {when,quantity:quantityRule,...cost}=rule;
    lines.push({...cost,quantity,quantitySource:rule.quantity.field?`Reviewed ${rule.quantity.field}: ${value}; quantity factor ${rule.quantity.factor}`:`Approved fixed scope: ${book.verifiedScope}; ${rule.description}`});
  }
  if(!lines.length)return {internal:{revision,scope,missingInformation,pricingWarnings:[resolution?.issues.length?'scope-pricing-incomplete':'quantities-missing'],costBookSnapshot:book},customer:{status:'review-required',range:null,summary,includedCategories:[],categoryRanges:[],lineItems:[],allowances:[],assumptions:book.assumptions,exclusions:[...new Set([...book.exclusions,...explicitExclusions,...(resolution?.addExclusions||[])])],factors:[],nextStep:SERVICE_MATRIX[service].method,message:resolution?.issues.length?'Your scope is saved. Pricing is not complete yet. Review the items listed below, then try again.':'We have your scope. Confirm the missing quantities to calculate the planning range.',disclaimer:'Preliminary project information only. This is not a bid, quote, offer or guaranteed price.'}};
  const risks:RiskFactor[]=[];
  if(!scope.answers.utilities&&["new-construction","addition","adu"].includes(service))risks.push("unknown-utilities");
  if(!scope.answers.site&&["new-construction","addition","adu"].includes(service))risks.push("soil-slope");
  if(scope.extraction?.reviewNotes.length)risks.push("incomplete-plans");
  const allowancePriced=lines.some(line=>line.evidence?.basis==='regional-planning-average'||line.evidence?.basis==='sourced-market-average');
  const preliminaryPurpose=preliminaryModel||allowancePriced;
  const input:PricingInput={service,revision,scopeSummary:summary,lines,coverage:book.coverage,risks,estimatePurpose:preliminaryPurpose?'preliminary':undefined,
    locationProvided:Boolean(scope.answers.location||scope.answers.address),urgency:scope.answers.urgency as PricingInput["urgency"],complexity:scope.answers.complexity as PricingInput["complexity"],
    uncertainty:missingInformation.length||scope.extraction?.reviewNotes.length?"high":"medium",
    assumptions:[...book.assumptions,...scopeAssumptions(scope.answers,scope.uncertainFields,scope.extraction,scope.text),...(scope.extraction?.reviewNotes||[]).filter(note=>!blockingReviewNote(note)).map(note=>/^to confirm:/i.test(note)?note:`To confirm: ${note}`)],exclusions:[...new Set([...book.exclusions,...explicitExclusions,...(resolution?.addExclusions||[])])],
    missingInformation,allowances:[],
  };
  const estimate=calculateP5Estimate(input,configuration.finance,[],now);
  if(resolution?.issues.length){
    estimate.publishable=false;estimate.warnings.push({code:'scope-pricing-incomplete',severity:'block',message:'Every requested task must have supported pricing before a total can be shown.'});
  }
  const missingRate=missingInformation.some(x=>x.startsWith('Missing cost rate:'));const catalogReviewDue=missingInformation.some(x=>x.includes('catalog quarterly review'));if(missingRate||(catalogReviewDue&&!preliminaryModel)){estimate.publishable=false;estimate.warnings.push({code:'planning-catalog-incomplete',severity:'block',message:'The planning catalog needs the recorded missing rate or scheduled review.'});}else if(catalogReviewDue){/* Under the preliminary planning model a catalog past its quarterly review is disclosed with its date, not a reason to withhold the range. */estimate.warnings.push({code:'planning-catalog-review-due',severity:'review',message:`The owner planning catalog is past its quarterly review (imported ${String(configuration.planningCatalog?.importedAt||'').slice(0,10)||'earlier'}); its rates are disclosed as preliminary.`});}
  if(scope.uploads.length&&!scope.extraction){estimate.publishable=false;estimate.warnings.push({code:"uploads-unreviewed",severity:"block",message:"Supporting uploads have not been analyzed. Review them before publishing a price."});}
  if(scope.extraction?.reviewNotes.some(blockingReviewNote)){estimate.publishable=false;estimate.warnings.push({code:"scope-review-required",severity:"block",message:"Resolve document and scope review notes, including unsupported uploads, before publishing a price."});}
  if(missingInformation.some(x=>x.startsWith("Missing quantity:")||x.startsWith("Missing cost condition:"))){
    estimate.publishable=false;estimate.warnings.push({code:"quantity-missing",severity:"block",message:"One or more cost-book quantities or scope conditions are missing."});
  }
  if(scope.answers.allowances&&!resolution?.completeScopeVerified){
    estimate.publishable=false;estimate.warnings.push({code:"allowance-review-required",severity:"block",message:"Convert the submitted allowances into itemized, linked cost allowances before publishing a price."});
  }
  return {internal:{...estimate,scope,costBookSnapshot:book},customer:customerEstimate(estimate,summary)};
}