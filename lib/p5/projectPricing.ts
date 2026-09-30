import type {EstimatorConfiguration} from './costBook.ts';
import {calculateP5Estimate,customerEstimate,customerSafeProjection,COST_CATEGORIES,SERVICE_MATRIX,type DirectCostLine,type PricingInput,type Service} from './pricing.ts';
import {unitKey} from './unitRates.ts';
import {projectHash,projectRecordIntegrity,validateProjectQuantities,type ProjectRecord,type RecordProblem} from './projectRecord.ts';
import {projectPricingProposalSchema,projectPricingWireSchema,projectPricingWireFor,projectReviewSchema,type ProjectPricingProposal,type ProjectReview} from './projectRecordContracts.ts';
import {completionReviewProblems,type ProjectCompletionPlan} from './projectCompletion.ts';

export const PROJECT_PRICE_COMPILER_VERSION='p5-project-price-compiler-v2';
export interface ProjectPriceSelection {recordHash:string;catalogHash:string;proposal:ProjectPricingProposal}
export function projectPriceProposalFromWire(record:ProjectRecord,configuration:EstimatorConfiguration,raw:unknown):ProjectPricingProposal{
 const wire=projectPricingWireSchema.parse(projectPricingWireFor(record,configuration.planningCatalog?.rates||[]).parse(raw));
 const estimatingQuantities:ProjectPricingProposal['estimatingQuantities']=[];
 const lines=wire.lines.map(({quantity,...line})=>{
  if(quantity.origin==='project')return {...line,quantityId:quantity.quantityId};
  const {origin:_origin,...value}=quantity;void _origin;
  const id='estimate-'+projectHash({line:line.id}).slice(0,20);
  estimatingQuantities.push({...value,id,requirementIds:line.requirementIds});
  return {...line,quantityId:id};
 });
 return projectPricingProposalSchema.parse({lines,estimatingQuantities,gaps:wire.gaps});
}
export interface ProjectReviewReceipt {recordHash:string;selectionHash:string|null;completionPlanHash:string|null;review:ProjectReview}
export const projectReviewReceipt=(record:ProjectRecord,selection:ProjectPriceSelection|null,raw:unknown,completionPlan?:ProjectCompletionPlan):ProjectReviewReceipt=>({recordHash:record.recordHash,selectionHash:selection?projectHash(selection):null,completionPlanHash:completionPlan?.planHash||null,review:projectReviewSchema.parse(raw)});
export const projectCatalogHash=(configuration:EstimatorConfiguration)=>projectHash({catalog:configuration.planningCatalog,catalogVersion:configuration.catalogVersion});
export const projectPriceSelection=(record:ProjectRecord,configuration:EstimatorConfiguration,raw:unknown):ProjectPriceSelection=>({recordHash:record.recordHash,catalogHash:projectCatalogHash(configuration),proposal:projectPricingProposalSchema.parse(raw)});
export function validateProjectReview(record:ProjectRecord,raw:unknown,completionPlan?:ProjectCompletionPlan):{review:ProjectReview;problems:RecordProblem[]}{
 const review=projectReviewSchema.parse(raw),problems:RecordProblem[]=[];
 for(const item of record.requirements)if(!review.reviewedRequirementIds.includes(item.id))problems.push({code:'review-coverage',ids:[item.id],message:'Independent review did not cover this requirement.'});
 for(const source of record.sources)if(!review.reviewedSourceIds.includes(source.id))problems.push({code:'review-source-coverage',ids:[source.id],message:'Independent review did not cover this source.'});
 for(const question of record.questions)if(!review.reviewedQuestionIds.includes(question.id))problems.push({code:'review-question-coverage',ids:[question.id],message:'The scope review must check this question and the uncertainty it resolves.'});
 if(completionPlan)problems.push(...completionReviewProblems(record,review,completionPlan));
 else if(review.completionChecks.length)problems.push({code:'completion-review',ids:[],message:'Completion claims require their original source-linked method plan.'});
 for(const finding of review.findings)problems.push({code:finding.code,ids:[...finding.requirementIds,...finding.quantityIds,...finding.lineIds],message:finding.message+' Required correction: '+finding.requiredCorrection});
 return {review,problems};
}
export function compileProjectPrices(record:ProjectRecord,selection:ProjectPriceSelection,configuration:EstimatorConfiguration,now=new Date()){
 const problems:RecordProblem[]=[],lines:DirectCostLine[]=[];
 const fail=(code:string,ids:string[],message:string)=>problems.push({code,ids,message});
 if(!projectRecordIntegrity(record))fail('record-integrity',[],'The saved project record changed without a new accepted revision.');
 if(selection.recordHash!==record.recordHash)fail('stale-pricing',[],'The project changed after these prices were selected.');
 if(selection.catalogHash!==projectCatalogHash(configuration))fail('stale-catalog',[],'The price book changed after these prices were selected.');
 const importedAt=configuration.planningCatalog?.importedAt||'',importedTime=Date.parse(importedAt);
 // Keep the existing owner catalog's 92-day review interval. Generating an
 // estimate neither verifies its rates nor starts a new validity period.
 const reviewDue=Number.isFinite(importedTime)?new Date(importedTime+92*86400000).toISOString():'';
 if(!Number.isFinite(importedTime)||importedTime>now.getTime())fail('catalog-date',[],'The owner catalog needs its actual recorded import/review date; a missing or future date cannot establish price evidence.');
 const requirements=new Map(record.requirements.map(r=>[r.id,r]));
 const estimatingQuantities=selection.proposal.estimatingQuantities;
 const allQuantities=[...record.quantities,...estimatingQuantities.map(({requirementIds:_work,basedOnQuantityIds:_basis,...quantity})=>{void _work;void _basis;return quantity;})];
 const quantities=new Map(allQuantities.map(q=>[q.id,q]));
 problems.push(...validateProjectQuantities(allQuantities,record.evidence));
 for(const quantity of estimatingQuantities){
  if(record.quantities.some(q=>q.id===quantity.id))fail('measurement-overwrite',[quantity.id],'Costing cannot replace a physical project quantity.');
  if(!quantity.basedOnQuantityIds.length&&!quantity.evidenceIds.length)fail('estimating-basis',[quantity.id],'An estimating quantity needs physical scope references or source evidence.');
  for(const id of quantity.basedOnQuantityIds)if(!record.quantities.some(q=>q.id===id&&q.basis!=='unknown'))fail('estimating-basis',[quantity.id,id],'An estimating quantity must refer to a known physical scope quantity.');
  for(const id of quantity.requirementIds){const requirement=requirements.get(id);if(!requirement||requirement.status!=='included'||requirement.responsibility!=='contractor')fail('estimating-scope',[quantity.id,id],'An estimating quantity must explicitly identify the included contractor work it prices.');}
 }
 const rates=new Map((configuration.planningCatalog?.rates||[]).map(r=>[r.code,r]));
 const coverage=new Map<string,string[]>(),lineIds=new Set<string>(),purchases=new Set<string>();
 for(const proposed of selection.proposal.lines){
  if(lineIds.has(proposed.id)){fail('duplicate-line',[proposed.id],'A charged line ID occurs twice.');continue;}lineIds.add(proposed.id);
  const rate=rates.get(proposed.rateId),quantity=quantities.get(proposed.quantityId);
  if(!rate){fail('unknown-rate',[proposed.id,proposed.rateId],'The selected price does not exist in the supplied approved catalog.');continue;}
  const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(proposed.catalogQuote.trim().length<6||!normalize(rate.description).includes(normalize(proposed.catalogQuote))){fail('catalog-evidence',[proposed.id,rate.code],'Catalog coverage evidence must quote the selected rate verbatim.');continue;}
  if(!Number.isFinite(rate.amount)||rate.amount<=0){fail('invalid-price',[proposed.id,rate.code],'The approved rate must be positive and finite.');continue;}
  if(!quantity||quantity.basis==='unknown'||!quantity.unit||quantity.value===null||quantity.value<=0){fail('unknown-priced-quantity',[proposed.id,proposed.quantityId],'The selected quantity is missing or unresolved.');continue;}
  if(unitKey(rate.unit)!==unitKey(quantity.unit)){fail('unit-mismatch',[proposed.id,quantity.id],'The catalog and quantity units differ; create a supported converted quantity before pricing.');continue;}
  const covered=proposed.requirementIds.map(id=>requirements.get(id));
  if(!covered.length||covered.some(r=>!r||r.status!=='included'||r.responsibility!=='contractor')){fail('out-of-scope-charge',[proposed.id,...proposed.requirementIds],'Charges may only cover included contractor requirements.');continue;}
  if(new Set(proposed.requirementIds).size!==proposed.requirementIds.length){fail('duplicate-coverage',[proposed.id],'A requirement is referenced twice on this price line.');continue;}
  const derived=estimatingQuantities.find(q=>q.id===quantity.id);
  const linked=derived?proposed.requirementIds.every(id=>derived.requirementIds.includes(id)):covered.some(r=>r!.quantityId===quantity.id);
  if(!linked){fail('unrelated-quantity',[proposed.id,quantity.id],'The priced quantity must belong to the covered work, either as its physical quantity or an explicitly linked estimating quantity.');continue;}
  const responsibilityCompatible=rate.type==='Material'?covered.every(r=>r!.component==='material')
    :rate.type==='Labor'?covered.every(r=>r!.component==='labor')
    :rate.type==='Equipment'?covered.every(r=>r!.component==='equipment'):true;
  if(!responsibilityCompatible){fail('rate-responsibility',[proposed.id],'A material, labor or equipment-only rate cannot establish another component’s coverage.');continue;}
  const purchase=rate.code+':'+quantity.id;
  if(purchases.has(purchase)){fail('duplicate-purchase',[proposed.id,rate.code,quantity.id],'The same catalog item and physical quantity cannot be charged twice.');continue;}purchases.add(purchase);
  for(const requirementId of proposed.requirementIds)coverage.set(requirementId,[...(coverage.get(requirementId)||[]),proposed.id]);
  const category:DirectCostLine['category']=rate.type==='Material'?'materials':rate.type==='Labor'?'field-labor':rate.type==='Equipment'?'equipment-rentals':rate.type==='Subcontractor'?'subcontractors':'other-direct';
  const references=quantity.evidenceIds.map(id=>record.evidence.find(e=>e.id===id)).filter(Boolean).map(e=>`${e!.sourceId}: ${e!.quote}`);
  lines.push({id:proposed.id,description:covered.map(r=>r!.description).join('; '),trade:covered[0]!.trade,quantity:quantity.value,unit:rate.unit,unitCost:rate.amount,category,priceBasis:'direct-cost',estimatingBasis:rate.basis,allowance:quantity.basis==='allowance',...(quantity.range?{quantityRange:quantity.range}:{}),quantitySource:[quantity.description,...references,quantity.assumption].filter(Boolean).join(' | '),evidence:{basis:'owner-estimating-schedule',reference:`${rate.source}; ${rate.code}; ${rate.description}`,verifiedAt:importedAt,validUntil:reviewDue}});
 }
 for(const requirement of record.requirements){
  if(requirement.status!=='included'||requirement.responsibility!=='contractor')continue;
  const owners=coverage.get(requirement.id)||[];
  if(!owners.length)fail('unpriced-requirement',[requirement.id],'Included work has no supported price coverage: '+requirement.description);
  if(owners.length>1)fail('duplicate-charge',[requirement.id,...owners],'More than one charged line covers the same requirement.');
 }
 for(const gap of selection.proposal.gaps)fail('pricing-gap',gap.requirementIds,gap.reason);
 const used=new Set(selection.proposal.lines.map(line=>line.quantityId));
 const includeInputs=(id:string)=>{for(const inputId of quantities.get(id)?.calculation?.inputIds||[])if(!used.has(inputId)){used.add(inputId);includeInputs(inputId);}};
 for(const id of [...used])includeInputs(id);
 for(const quantity of estimatingQuantities)if(!used.has(quantity.id))fail('unused-estimating-quantity',[quantity.id],'A costing assumption must contribute to a selected price line.');
 return {lines,quantities:allQuantities,coverage:Object.fromEntries(coverage),problems};
}

/** The existing financial calculator is retained. No legacy scope defaults,
 * keyword correction or prose-based issue waiver can alter this input. */
export function calculateProjectEstimate(record:ProjectRecord,selection:ProjectPriceSelection,configuration:EstimatorConfiguration,receipt:ProjectReviewReceipt,now=new Date(),completionPlan?:ProjectCompletionPlan){
 const review=receipt.review;
 const compiled=compileProjectPrices(record,selection,configuration,now);
 const checked=validateProjectReview(record,review,completionPlan);
 const problems=[...compiled.problems,...checked.problems];
 if(receipt.recordHash!==record.recordHash||receipt.selectionHash!==projectHash(selection))problems.push({code:'stale-review',ids:[],message:'Independent review must cover this exact project record and price selection.'});
 if(receipt.completionPlanHash!==(completionPlan?.planHash||null))problems.push({code:'stale-completion-review',ids:[],message:'The pricing review must cover the same source-linked work method.'});
 for(const question of record.questions.filter(q=>q.priority==='blocking'))problems.push({code:'customer-question',ids:[question.id],message:question.prompt});
 for(const source of record.sourceReviews.filter(s=>s.status!=='reviewed'&&s.status!=='resolved-by-customer'))problems.push({code:'unresolved-source',ids:[source.sourceId],message:source.reason});
 if(!Object.hasOwn(SERVICE_MATRIX,record.service))problems.push({code:'project-classification',ids:[],message:'A supported project classification is required.'});
 if(problems.length||!compiled.lines.length)return {status:'needs-resolution' as const,problems,record,selection,review,compiled};
 const assumptions=[...new Set([...record.assumptions,...compiled.quantities.filter(q=>q.basis==='allowance').map(q=>`${q.description}: ${q.value} ${q.unit}, allowance range ${q.range!.low} to ${q.range!.high}. ${q.assumption}`),...review.notes])];
 if(compiled.lines.some(line=>Date.parse(line.evidence.validUntil)<now.getTime()))assumptions.push(`Pricing uses the owner planning catalog recorded ${configuration.planningCatalog!.importedAt.slice(0,10)}, which is past its scheduled review. Current supplier and trade pricing must be confirmed before a firm proposal.`);
 const exclusions=record.requirements.filter(r=>r.status==='excluded').map(r=>r.description);
 const input:PricingInput={estimatePurpose:'preliminary',firmPrice:record.service==='re10',bookPriced:true,service:record.service as Service,revision:projectHash({record:record.recordHash,selection,finance:configuration.finance}),scopeSummary:record.summary,lines:compiled.lines,coverage:COST_CATEGORIES.map(category=>({category,status:compiled.lines.some(line=>line.category===category)?'included':'not-applicable',reason:'Coverage is recorded against individual project requirements.'})),risks:[],assumptions,exclusions,missingInformation:[],allowances:[],uncertainty:compiled.quantities.some(q=>q.basis==='allowance')?'high':'medium',locationProvided:Boolean(record.location)};
 const estimate=calculateP5Estimate(input,configuration.finance,[],now);
 for(const warning of estimate.warnings.filter(w=>w.severity==='block'))problems.push({code:warning.code,ids:[],message:warning.message});
 const customer=customerSafeProjection({...customerEstimate(estimate,record.summary),scopeTasks:record.requirements.map(r=>({id:r.id,description:r.description,category:r.trade,status:r.status,origin:r.origin,basis:r.reason})),verificationItems:record.questions.filter(q=>q.priority==='budget-choice').map(q=>q.prompt),projectRecordRevision:record.revision});
 return {status:estimate.publishable?'estimated' as const:'needs-resolution' as const,problems,record,selection,review,compiled,internal:{...estimate,projectRecord:record,projectPrices:selection,projectReview:review,projectCompletion:completionPlan||null},customer};
}
