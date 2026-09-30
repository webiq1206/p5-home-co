import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInput,projectHash,projectRecordIntegrity,acceptProjectRecord,validateProjectRecord,projectRecordChange,computedProjectQuantity,ProjectRecordError} from '../lib/p5/projectRecord.ts';
import {compileProjectPrices,projectPriceSelection,calculateProjectEstimate,projectReviewReceipt,projectPriceProposalFromWire,validateProjectReview} from '../lib/p5/projectPricing.ts';
import {interpretProjectRecord,priceProjectRecord} from '../lib/p5/projectWorkflow.ts';
import {PROJECT_RECORD_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,PROJECT_CATALOG_INSTRUCTIONS,PROJECT_COMPLETION_INSTRUCTIONS,projectProposalSchema,projectReviewSchema,type ProjectProposal,type ProjectQuantity,type ProjectPricingProposal} from '../lib/p5/projectRecordContracts.ts';
import {acceptProjectCompletion,type ProjectCompletionPlan} from '../lib/p5/projectCompletion.ts';
import {checkedProjectCandidates,projectCatalogIndex,projectConfiguration} from '../lib/p5/projectCatalog.ts';
import {openAiPricingRequestEnvelope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import {PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import {DEFAULT_FINANCE} from '../lib/p5/pricing.ts';
import type {EstimatorConfiguration} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {PGlite} from '@electric-sql/pglite';
import {publishProjectQualification,draftProjectScope} from '../lib/p5/projectRecordWork.ts';
import {saveProjectChange,readProjectConversation,activeProjectChanges} from '../lib/p5/projectConversation.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {randomUUID} from 'node:crypto';
import type {Draft} from '../lib/p5/store.ts';
import {verifiedReviewCatalog} from '../lib/p5/projectReviewEvidence.ts';

const now=new Date('2026-09-30T14:00:00Z');
const scope:ReviewedScope={text:'Replace exactly 3 passage handles with owner-supplied matching sets in Boise. Existing holes are sound. Include adjustment and testing. Owner handles cleanup. No painting or door replacement.',answers:{service:'handyman',location:'Boise'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]};
const config:EstimatorConfiguration={finance:DEFAULT_FINANCE,costBooks:[],planningCatalog:{version:PLANNING_MODEL_VERSION,source:'Approved owner book',authorizedBy:'Existing policy',importedAt:now.toISOString(),rates:priceBookRates(scope.answers)}};
function example(input=projectInput(scope)):ProjectProposal{
 const source=input.sources.find(s=>s.kind==='customer-text')!;
 return {summary:scope.text,service:'handyman',location:'Boise',evidence:[{id:'e1',sourceId:source.id,quote:source.text}],subjects:[{id:'handles',parentId:null,name:'Existing passage handles',kind:'fixture',existingCondition:'Existing holes sound',evidenceIds:['e1']}],quantities:[{id:'handle-count',subjectId:'handles',description:'Passage handles to replace',unit:'EA',basis:'stated',value:3,range:null,evidenceIds:['e1'],calculation:null,assumption:''}],requirements:[
 {id:'replace-handles',subjectId:'handles',description:'Replace passage handles, adjust and test',trade:'Windows & Doors',operation:'replace',component:'labor',status:'included',responsibility:'contractor',origin:'requested',requiredBy:[],reason:'',evidenceIds:['e1'],quantityId:'handle-count',specifications:['Use owner-supplied passage sets; existing holes sound']},
 {id:'handle-supply',subjectId:'handles',description:'Matching passage handle sets supplied by owner',trade:'Windows & Doors',operation:'supply',component:'material',status:'included',responsibility:'owner',origin:'requested',requiredBy:[],reason:'',evidenceIds:['e1'],quantityId:'handle-count',specifications:[]},
 {id:'paint',subjectId:'handles',description:'Painting excluded',trade:'Painting',operation:'finish',component:'labor',status:'excluded',responsibility:'unassigned',origin:'requested',requiredBy:[],reason:'',evidenceIds:['e1'],quantityId:null,specifications:[]},
 ],questions:[],sourceReviews:input.sources.map(s=>({sourceId:s.id,status:'reviewed',reason:''})),assumptions:[]};
}
const record=()=>acceptProjectRecord(example(),projectInput(scope),null,now);
const proposal=():ProjectPricingProposal=>({estimatingQuantities:[],lines:[{id:'install',rateId:'PB-08-71-01',quantityId:'handle-count',requirementIds:['replace-handles'],catalogQuote:config.planningCatalog!.rates.find(r=>r.code==='PB-08-71-01')!.description,coverageEvidence:'Owner-supplied sets require only replacement labor.',specificationChecks:[{requirementId:'replace-handles',specificationIndex:0,basis:'scope-condition',evidenceIds:['e1'],explanation:'The customer supplies matching sets and confirms the existing holes are sound.'}]}],gaps:[]});
const wireProposal=()=>({lines:proposal().lines.map(({quantityId,...line})=>({...line,quantity:{origin:'project',quantityId}})),gaps:[]});
const method=(input=projectInput(scope),operation:'install'|'remove'|'repair'='install',kind:'requested'|'decision-needed'='requested')=>({reviewedSourceIds:input.sources.map(source=>source.id),steps:[{id:'method-'+operation,subject:'Items specified by the customer',description:'Perform the '+operation+' operation',operation,kind,responsibility:'contractor' as const,evidence:[{sourceId:input.sources[0].id,quote:input.sources[0].text}],reason:'Explicit current source instruction.'}]});
const review=(r=record(),plan?:ProjectCompletionPlan)=>({reviewedRequirementIds:r.requirements.map(x=>x.id),reviewedSourceIds:r.sources.map(x=>x.id),reviewedQuestionIds:r.questions.map(q=>q.id),completionChecks:plan?plan.steps.map(step=>({stepId:step.id,outcome:'represented' as const,requirementIds:r.requirements.filter(requirement=>requirement.operation===step.operation).map(requirement=>requirement.id),questionIds:step.kind==='decision-needed'?r.questions.filter(question=>question.priority==='blocking').map(question=>question.id):[],reason:'Controlled test mapping to explicit operations.',evidenceIds:[]})):[],findings:[],notes:[]});
test('a product specification cannot disappear behind a generic catalog description or a favorable review',()=>{
 const p=example();p.requirements[0].specifications=['Requested finish and hardware not described in the planning rate'];
 const r=acceptProjectRecord(p,projectInput(scope),null,now),raw=proposal();raw.lines[0].specificationChecks=[];
 let selected=projectPriceSelection(r,config,raw);
 assert.ok(calculateProjectEstimate(r,selected,config,projectReviewReceipt(r,selected,review(r)),now).problems.some(p=>p.code==='specification-evidence'));
 raw.lines[0].specificationChecks=[{requirementId:'replace-handles',specificationIndex:0,basis:'catalog',catalogQuote:'Unstated specialty finish and hardware',explanation:'Claimed exact match.'}];
 assert.ok(compileProjectPrices(r,projectPriceSelection(r,config,raw),config,now).problems.some(p=>p.code==='specification-evidence'));
 const disclosure='Provisional planning allowance only. The requested finish and hardware are not established by this rate and require supplier confirmation.';
 raw.lines[0].specificationChecks=[{requirementId:'replace-handles',specificationIndex:0,basis:'allowance',disclosure,explanation:'Controlled test of disclosure propagation, not a validated supplier quote.'}];
 selected=projectPriceSelection(r,config,raw);const result=calculateProjectEstimate(r,selected,config,projectReviewReceipt(r,selected,review(r)),now);
 assert.equal(result.status,'estimated');assert.equal(result.compiled.lines[0].allowance,true);
 assert.ok(JSON.stringify(result.customer).includes(disclosure));
 raw.lines[0].specificationChecks.push(raw.lines[0].specificationChecks[0]);
 assert.ok(compileProjectPrices(r,projectPriceSelection(r,config,raw),config,now).problems.some(p=>p.code==='specification-evidence'));
});
test('all project provider contracts use their own strict schema instead of an unrelated audit response',()=>{
 for(const [instructions,key]of [[PROJECT_COMPLETION_INSTRUCTIONS,'steps'],[PROJECT_RECORD_INSTRUCTIONS,'requirements'],[PROJECT_CATALOG_INSTRUCTIONS,'requirements'],[PROJECT_PRICE_INSTRUCTIONS,'lines'],[PROJECT_REVIEW_INSTRUCTIONS,'findings']]){
  const body=openAiPricingRequestEnvelope(instructions,{},false).body as any;
  assert.equal(body.model,'gpt-4.1');assert.equal(body.text.format.strict,true);assert.ok(body.text.format.schema.properties[key]);
 }
});
test('dependency prose cannot substitute for the required structured parent link',()=>{
 const p=example();p.requirements.push({...p.requirements[0],id:'supporting',origin:'dependency',reason:'Necessary to complete replace-handles.',requiredBy:[]});
 assert.equal(projectProposalSchema.safeParse(p).success,false);
 p.requirements.at(-1)!.requiredBy=['replace-handles'];
 assert.equal(projectProposalSchema.safeParse(p).success,true);
 const body=openAiPricingRequestEnvelope(PROJECT_RECORD_INSTRUCTIONS,{},false).body as any;
 const branches=body.text.format.schema.properties.requirements.items.anyOf;
 const dependency=branches.find((b:any)=>b.properties.origin.const==='dependency');
 assert.equal(dependency.properties.requiredBy.minItems,1);
 assert.equal(dependency.properties.reason.minLength,1);
});
test('source blocks retain every typed character and quote identity',()=>{
 const text=('A distinct project instruction with measured quantities.\n').repeat(1000);
 const input=projectInput({...scope,text});
 assert.equal(input.sources.filter(s=>s.kind==='customer-text').map(s=>s.text).join(''),text);
 assert.equal(new Set(input.sources.map(s=>s.id)).size,input.sources.length);
 const bad=example();bad.evidence[0].quote='Invented dimensions and scope';
 assert.throws(()=>acceptProjectRecord(bad,projectInput(scope)),ProjectRecordError);
});
test('legacy reader-populated answers do not become customer-confirmed evidence',()=>{
 const draft={text:'Replace the handles.',answers:{fixtureCount:'3',sqft:'1800',otherDetails:'Untracked legacy description'},extraction:{summary:'Prior extraction',facts:[{field:'fixtureCount',value:'3',confidence:.9,source:'scope.pdf',evidence:'3'},{field:'sqft',value:'1800',confidence:.9,source:'scope.pdf',evidence:'1800'}],conflicts:[],missingInformation:[],reviewNotes:[]},wizard:{skipped:[],resolutions:{fixtureCount:'3'}},uploads:[],updatedAt:now.toISOString(),reviewed:null} as unknown as Draft;
 const input=projectInput(draftProjectScope(draft));
 assert.equal(input.sources.find(s=>s.text==='fixtureCount: 3')!.kind,'reviewed-answer');
 assert.equal(input.sources.find(s=>s.text==='sqft: 1800')!.kind,'reader-observation');
 assert.match(input.sources.find(s=>s.text==='otherDetails: Untracked legacy description')!.name,/unconfirmed origin/);
});
test('unknown, invented and redundant quantities cannot pass as reviewed facts',()=>{
 const invented=example();invented.quantities[0].value=33;
 assert.ok(validateProjectRecord(invented,projectInput(scope)).some(p=>p.code==='unstated-value'));
 const unknown=example();unknown.quantities[0].basis='unknown';
 assert.ok(validateProjectRecord(unknown,projectInput(scope)).some(p=>p.code==='invented-quantity'));
 const redundant=example();redundant.questions=[{id:'count-again',requirementIds:['replace-handles'],quantityIds:['handle-count'],kind:'quantity',prompt:'How many handles?',reason:'Need the count',options:[],priority:'blocking'}];
 assert.ok(validateProjectRecord(redundant,projectInput(scope)).some(p=>p.code==='redundant-question'));
});
test('an unknown physical measurement and unit can reach a reviewed clarification without being priced',async()=>{
 const incomplete={...scope,text:'Repair the damaged surface in Boise. Its material and size need to be established.'},input=projectInput(incomplete),p=example(input);
 p.summary=incomplete.text;p.subjects[0]={...p.subjects[0],name:'Damaged surface',kind:'surface',existingCondition:'Material and extent unresolved'};p.requirements=[{...p.requirements[0],description:'Repair damaged surface',operation:'repair',specifications:[]}];
 p.quantities[0]={...p.quantities[0],description:'Extent of damaged surface',basis:'unknown',unit:null,value:null};
 p.questions=[{id:'repair-extent',kind:'quantity',priority:'blocking',prompt:'What material is damaged and what are the damaged area’s dimensions?',reason:'The material and extent determine the repair method and quantity.',options:[],requirementIds:['replace-handles'],quantityIds:['handle-count']}];
 assert.equal(projectProposalSchema.safeParse(p).success,true);
 const invented=structuredClone(p);invented.quantities[0].value=3;
 assert.equal(projectProposalSchema.safeParse(invented).success,false);
 const request:PricingRequest=async(instructions,raw)=>{
  if(instructions===PROJECT_COMPLETION_INSTRUCTIONS)return {value:method(input,'repair','decision-needed'),sourceUrls:[]};
  if(instructions===PROJECT_RECORD_INSTRUCTIONS)return {value:p,sourceUrls:[]};
  assert.equal(instructions,PROJECT_REVIEW_INSTRUCTIONS);const data=raw as any;assert.equal(data.stage,'scope-with-questions');
  return {value:review(data.record,data.completionPlan),sourceUrls:[]};
 };
 const result=await interpretProjectRecord(incomplete,{request,now});assert.equal(result.status,'questions');assert.equal(result.record!.quantities[0].unit,null);
 const unchecked=review(result.record!);unchecked.reviewedQuestionIds=[];
 assert.ok(validateProjectReview(result.record!,unchecked).problems.some(p=>p.code==='review-question-coverage'));
 const priced=await priceProjectRecord(result.record!,config,{request:async()=>{throw Error('Pricing must not run before the blocking answer');},now});
 assert.equal(priced.status,'questions');
 assert.ok(compileProjectPrices(result.record!,projectPriceSelection(result.record!,config,proposal()),config,now).problems.some(p=>p.code==='unknown-priced-quantity'));
});
test('an undecided inclusion is retained as conditional work with a required clarification',()=>{
 const input=projectInput({...scope,text:'Whether to include the additional work is undecided.'}),p=example(input);
 p.requirements=[{...p.requirements[0],status:'conditional',quantityId:null}];p.quantities=[];
 assert.ok(validateProjectRecord(p,input).some(p=>p.code==='unresolved-condition'));
 p.questions=[{id:'include-work',kind:'scope',priority:'blocking',prompt:'Should the additional work be included?',reason:'This decision sets the work boundary.',options:['Include','Exclude'],requirementIds:['replace-handles'],quantityIds:[]}];
 const accepted=acceptProjectRecord(p,input,null,now);assert.equal(accepted.requirements[0].status,'conditional');
 assert.equal(accepted.questions.length,1);
});
test('missing quantities produce linked questions without adding excluded work',()=>{
 const incomplete=example();incomplete.quantities[0]={...incomplete.quantities[0],basis:'unknown',value:null};
 incomplete.questions=[{id:'count',requirementIds:['replace-handles'],quantityIds:['handle-count'],kind:'quantity',prompt:'How many passage handles should we replace?',reason:'The replacement labor is priced per handle.',options:[],priority:'blocking'}];
 assert.deepEqual(validateProjectRecord(incomplete,projectInput(scope)),[]);
 incomplete.questions[0].requirementIds=['paint'];
 assert.ok(validateProjectRecord(incomplete,projectInput(scope)).some(p=>p.code==='unrelated-question'));
});
test('unassigned and conditional work requires a question and cannot silently disappear from pricing',()=>{
 const p=example(),r=p.requirements[0];r.responsibility='unassigned';
 assert.ok(validateProjectRecord(p,projectInput(scope)).some(p=>p.code==='unknown-responsibility'));
 p.questions=[{id:'who-installs',requirementIds:[r.id],quantityIds:[],kind:'responsibility',prompt:'Should P5 install the handles or will someone else install them?',reason:'Installation labor is included only when P5 performs it.',options:['P5 installs','Someone else installs'],priority:'blocking'}];
 assert.deepEqual(validateProjectRecord(p,projectInput(scope)),[]);
 r.status='conditional';p.questions=[];
 assert.ok(validateProjectRecord(p,projectInput(scope)).some(p=>p.code==='unresolved-condition'));
 p.sourceReviews[0]={...p.sourceReviews[0],status:'conflicting',reason:'Two scope instructions disagree.'};
 assert.ok(validateProjectRecord(p,projectInput(scope)).some(p=>p.code==='unresolved-source'));
});
test('computed dimensions check units, arithmetic, cycles and unsupported factors',()=>{
 const q=(id:string,value:number,unit:string):ProjectQuantity=>({id,subjectId:'handles',description:id,unit,basis:'stated',value,range:null,evidenceIds:['e1'],calculation:null,assumption:''});
 const x=q('width',18,'in'),y=q('height',18,'in');
 const area:ProjectQuantity={...q('area',2.25,'SF'),basis:'calculated',calculation:{operation:'product',inputIds:['width','height'],factor:1}};
 assert.equal(computedProjectQuantity(area,[x,y,area]),2.25);
 assert.equal(computedProjectQuantity({...area,unit:'LF'},[x,y,area]),null);
 const cycle={...area,calculation:{...area.calculation!,inputIds:['area','height']}};
 assert.throws(()=>computedProjectQuantity(cycle,[x,y,cycle]),ProjectRecordError);
 const bad=example();bad.quantities.push({...area,value:3},x,y);
 assert.ok(validateProjectRecord(bad,projectInput(scope)).some(p=>p.code==='quantity-calculation'));
});
test('physical containment cycles are rejected and shared work dependencies remain bounded',()=>{
 const p=example();p.subjects.push({...p.subjects[0],id:'parent',parentId:'handles'});p.subjects[0].parentId='parent';
 assert.ok(validateProjectRecord(p,projectInput(scope)).some(p=>p.code==='subject-cycle'));
 p.subjects=p.subjects.slice(0,1);p.subjects[0].parentId=null;
 let previous=['replace-handles'];
 for(let level=0;level<35;level++){
  const current=[`left-${level}`,`right-${level}`];
  for(const id of current)p.requirements.push({...p.requirements[0],id,origin:'dependency',requiredBy:previous,reason:'Controlled shared-dependency graph for validation complexity.'});
  previous=current;
 }
 assert.deepEqual(validateProjectRecord(p,projectInput(scope)),[]);
 p.requirements[0].requiredBy=previous;
 assert.ok(validateProjectRecord(p,projectInput(scope)).some(p=>p.code==='dependency-cycle'));
});
test('missing pages and partial observations cannot be certified as a complete project',async()=>{
 const uploaded={...scope,uploads:[{id:'pdf',name:'plan.pdf',type:'application/pdf',size:20,sha256:'fixture',status:'stored' as const}]};
 const input=projectInput(uploaded);assert.ok(input.documentIssues.length);
 let calls=0;const result=await interpretProjectRecord(uploaded,{request:async()=>{calls++;throw new Error('must not call');}});
 assert.equal(result.status,'needs-resolution');assert.equal(calls,0);
 const omitted=example();omitted.sourceReviews.pop();assert.ok(validateProjectRecord(omitted,projectInput(scope)).some(p=>p.code==='source-coverage'));
});
test('the real owner rate prices only the requested contractor labor',()=>{
 const r=record(),selection=projectPriceSelection(r,config,proposal()),compiled=compileProjectPrices(r,selection,config,now);
 assert.deepEqual(compiled.problems,[]);assert.equal(compiled.lines.length,1);
 assert.equal(compiled.lines[0].quantity,3);assert.equal(compiled.lines[0].unitCost,70);assert.equal(compiled.lines[0].quantity*compiled.lines[0].unitCost,210);
 const result=calculateProjectEstimate(r,selection,config,projectReviewReceipt(r,selection,review(r)),now);
 assert.equal(result.status,'estimated',JSON.stringify(result));assert.ok('customer'in result&&result.customer.range);
 assert.ok(!JSON.stringify('customer'in result&&result.customer).includes('unitCost'));
});
test('the actual provider schema binds each price to a compatible existing quantity or a correctly unitized allowance',()=>{
 const r=record(),raw=wireProposal();
 assert.deepEqual(projectPriceProposalFromWire(r,config,raw),proposal());
 raw.lines[0].rateId='PB-01-74-10';
 assert.throws(()=>projectPriceProposalFromWire(r,config,raw),'An hourly rate cannot select the three-handle physical count.');
 const hourly={...raw,lines:[{...raw.lines[0],catalogQuote:config.planningCatalog!.rates.find(rate=>rate.code==='PB-01-74-10')!.description,quantity:{origin:'estimate',description:'Bounded supporting labor',unit:'hour',basis:'allowance',value:.5,range:{low:.25,high:.75},evidenceIds:['e1'],calculation:null,assumption:'Controlled unit-binding test, not a market productivity reference.',basedOnQuantityIds:['handle-count']}}]};
 const accepted=projectPriceProposalFromWire(r,config,hourly);
 assert.equal(accepted.estimatingQuantities[0].unit,'hour');assert.deepEqual(accepted.estimatingQuantities[0].requirementIds,['replace-handles']);
 assert.equal(accepted.lines[0].quantityId,accepted.estimatingQuantities[0].id);
 hourly.lines[0].quantity.unit='each';assert.throws(()=>projectPriceProposalFromWire(r,config,hourly));
 const body=openAiPricingRequestEnvelope(PROJECT_PRICE_INSTRUCTIONS,{record:r,catalog:config.planningCatalog!.rates},false).body as any;
 const branches=body.text.format.schema.properties.lines.items.anyOf;
 assert.ok(branches.length>1);assert.ok(branches.every((b:any)=>b.properties.rateId.pattern.startsWith('^(?:')));
 const hourlyBranch=branches.find((b:any)=>new RegExp(b.properties.rateId.pattern).test('PB-01-74-10'));
 assert.equal(hourlyBranch.properties.quantity.properties.unit.const,'hour');assert.equal(hourlyBranch.properties.quantity.properties.origin.const,'estimate');
});
test('bounded supporting effort is costed as a disclosed allowance without inventing a customer measurement',()=>{
 const s={...scope,text:scope.text.replace('Owner handles cleanup.','P5 handles small debris cleanup.')},input=projectInput(s),p=example(input);p.summary=s.text;
 p.subjects.push({id:'doors',parentId:null,name:'Existing door work area',kind:'assembly',existingCondition:'Doors remain in place',evidenceIds:['e1']});p.subjects[0].parentId='doors';
 p.requirements.push({...p.requirements[0],id:'cleanup',subjectId:'doors',description:'Small debris cleanup from the requested replacement work',operation:'clean',quantityId:null});
 const r=acceptProjectRecord(p,input,null,now);
 assert.equal(r.questions.length,0);
 const quantities=[{id:'cleanup-effort',description:'Cleanup effort for the known replacement work',unit:'HR',basis:'allowance' as const,value:.5,range:{low:.25,high:.75},evidenceIds:['e1'],calculation:null,assumption:'Budget 15 to 45 minutes for the small debris generated by the three replacements; this is estimated effort, not a measured site quantity.',requirementIds:['cleanup'],basedOnQuantityIds:['handle-count']}];
 const proposed={...proposal(),estimatingQuantities:quantities};
 proposed.lines.push({id:'cleanup-price',rateId:'PB-01-74-10',quantityId:'cleanup-effort',requirementIds:['cleanup'],catalogQuote:config.planningCatalog!.rates.find(rate=>rate.code==='PB-01-74-10')!.description,coverageEvidence:'Cleanup labor for the included work; no material purchase.',specificationChecks:[{requirementId:'cleanup',specificationIndex:0,basis:'scope-condition',evidenceIds:['e1'],explanation:'Controlled fixture carries the same known installation conditions.'}]});
 const selection=projectPriceSelection(r,config,proposed),compiled=compileProjectPrices(r,selection,config,now);
 assert.deepEqual(compiled.problems,[]);assert.equal(compiled.lines.reduce((sum,line)=>sum+line.quantity*line.unitCost,0),232.5);
 assert.equal(r.quantities.length,1);assert.equal(r.quantities[0].value,3);
 const result=calculateProjectEstimate(r,selection,config,projectReviewReceipt(r,selection,review(r)),now);
 assert.equal(result.status,'estimated');assert.ok('customer'in result&&result.customer.assumptions.some((a:string)=>a.includes('15 to 45 minutes')));
 const overwritten=structuredClone(proposed);overwritten.estimatingQuantities[0].id='handle-count';
 assert.ok(compileProjectPrices(r,projectPriceSelection(r,config,overwritten),config,now).problems.some(p=>p.code==='measurement-overwrite'));
 const ownerCharge=structuredClone(proposed);ownerCharge.estimatingQuantities[0].requirementIds=['handle-supply'];
 assert.ok(compileProjectPrices(r,projectPriceSelection(r,config,ownerCharge),config,now).problems.some(p=>p.code==='estimating-scope'));
 assert.throws(()=>projectPriceSelection(r,config,{...proposed,estimatingQuantities:[{...quantities[0],basis:'stated'}]}));
});
test('excluded work, owner-supplied material, wrong units and unquoted catalog coverage cannot be charged',()=>{
 for(const mutate of [(p:ReturnType<typeof proposal>)=>p.lines[0].requirementIds=['paint'],(p:ReturnType<typeof proposal>)=>p.lines[0].requirementIds=['handle-supply'],(p:ReturnType<typeof proposal>)=>p.lines[0].catalogQuote='Unstated full building coverage']){
  const p=proposal();mutate(p);assert.ok(compileProjectPrices(record(),projectPriceSelection(record(),config,p),config,now).problems.length);
 }
 const r=record();r.quantities[0].unit='LF';
 assert.ok(compileProjectPrices(r,projectPriceSelection(r,config,proposal()),config,now).problems.some(p=>p.code==='unit-mismatch'));
});
test('duplicate charges and uncovered requirements cannot produce an accepted total',()=>{
 const r=record(),p=proposal();p.lines.push({...p.lines[0],id:'repeat'});
 assert.ok(compileProjectPrices(r,projectPriceSelection(r,config,p),config,now).problems.some(p=>p.code==='duplicate-purchase'));
 const missing=projectPriceSelection(r,config,{estimatingQuantities:[],lines:[],gaps:[]});
 assert.ok(compileProjectPrices(r,missing,config,now).problems.some(p=>p.code==='unpriced-requirement'));
 const incompleteReview=review(r);incompleteReview.reviewedSourceIds=[];
 assert.equal(calculateProjectEstimate(r,projectPriceSelection(r,config,proposal()),config,projectReviewReceipt(r,projectPriceSelection(r,config,proposal()),incompleteReview),now).status,'needs-resolution');
});
test('changing stored facts, source text or catalog prices invalidates the prior estimate inputs',()=>{
 const original=record(),selection=projectPriceSelection(original,config,proposal());
 for(const mutate of [(r:typeof original)=>{r.quantities[0].value=2;},(r:typeof original)=>{r.sources[0].text='Replace 999 handles';}]){
  const changed=structuredClone(original);mutate(changed);
  assert.ok(compileProjectPrices(changed,selection,config,now).problems.some(p=>p.code==='record-integrity'));
 }
 const changedBook=structuredClone(config);changedBook.planningCatalog!.rates.find(r=>r.code==='PB-08-71-01')!.amount=80;
 assert.ok(compileProjectPrices(original,selection,changedBook,now).problems.some(p=>p.code==='stale-catalog'));
});
test('generating later estimates cannot refresh old or missing owner price evidence',()=>{
 const r=record(),selection=projectPriceSelection(r,config,proposal());
 const later=new Date(now.getTime()+100*86400000);
 const initial=compileProjectPrices(r,selection,config,now),aged=compileProjectPrices(r,selection,config,later);
 assert.deepEqual(aged.lines[0].evidence,initial.lines[0].evidence);
 assert.equal(aged.lines[0].evidence.validUntil,'2026-12-31T14:00:00.000Z');
 const estimate=calculateProjectEstimate(r,selection,config,projectReviewReceipt(r,selection,review(r)),later);
 assert.equal(estimate.status,'estimated','An overdue owner catalog remains a disclosed preliminary estimate under existing policy.');
 assert.ok(estimate.internal!.warnings.some(w=>w.code==='cost-evidence-expired'));
 assert.match(JSON.stringify(estimate.customer!.assumptions),/2026-09-30.*past its scheduled review/);
 for(const date of ['', 'not-a-date',later.toISOString()]){
  const invalid=structuredClone(config);invalid.planningCatalog!.importedAt=date;
  const rejected=compileProjectPrices(r,projectPriceSelection(r,invalid,proposal()),invalid,now);
  assert.ok(rejected.problems.some(p=>p.code==='catalog-date'));
  assert.notEqual(rejected.lines[0].evidence.verifiedAt,now.toISOString(),'Missing evidence is never replaced by the estimate creation date.');
 }
});
test('record and selection identity survives database JSON key reordering',()=>{
 const r=record();
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>b.localeCompare(a)).map(([k,value])=>[k,reorder(value)])):v;
 const stored=reorder(r);
 assert.equal(projectHash(stored),projectHash(r));assert.equal(projectRecordIntegrity(stored),true);
 const selection=projectPriceSelection(r,config,proposal());
 assert.deepEqual(compileProjectPrices(stored,reorder(selection),reorder(config),now).problems,[]);
});
test('saved completion recovers publication once and cannot overwrite a newer customer revision',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE p5_estimator_drafts(id text PRIMARY KEY, revision integer); CREATE TABLE p5_estimator_work(draft_id text, work_key text, payload jsonb, updated_at timestamptz DEFAULT now(), PRIMARY KEY(draft_id,work_key));');
  await db.query('INSERT INTO p5_estimator_drafts VALUES ($1,4)',['my-project']);
  const execute=async(statement:string,values:unknown[]=[])=> (await db.query(statement,values)).rows as Record<string,any>[];
  const result={status:'ready' as const,record:record(),problems:[],attempts:1};
  // A crash left the paid result in the work checkpoint, but no latest record.
  await db.query('INSERT INTO p5_estimator_work VALUES($1,$2,$3::jsonb,now())',['my-project','saved-work',JSON.stringify({result})]);
  const saved=(await execute('SELECT payload FROM p5_estimator_work WHERE work_key=$1',['saved-work']))[0].payload.result;
  await publishProjectQualification('my-project',4,saved,execute);
  await publishProjectQualification('my-project',4,saved,execute);
  const latest=await execute('SELECT payload FROM p5_estimator_work WHERE work_key=$1',['project-record-latest-v1']);
  assert.equal(latest.length,1);assert.equal(projectRecordIntegrity(latest[0].payload.record),true);
  await execute('UPDATE p5_estimator_drafts SET revision=5 WHERE id=$1',['my-project']);
  await assert.rejects(publishProjectQualification('my-project',4,saved,execute),/project changed/);
  await assert.rejects(publishProjectQualification('my-project',4,{status:'needs-resolution',record:null,problems:[],attempts:2},execute),/project changed/);
  assert.deepEqual(await execute('SELECT payload FROM p5_estimator_work WHERE work_key=$1',['project-record-latest-v1']),latest);
 }finally{await db.close();}
});
test('answers retain question context, support corrections, invalidate old scope and survive lost acknowledgements',async()=>{
 const db=new PGlite();
 try{
  await db.exec("CREATE TABLE p5_estimator_drafts(id text PRIMARY KEY, revision integer, status text, brand text, payload jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now()); CREATE TABLE p5_estimator_work(draft_id text, work_key text, payload jsonb, updated_at timestamptz DEFAULT now(), PRIMARY KEY(draft_id,work_key));");
  const execute=async(statement:string,values:unknown[]=[])=> (await db.query(statement,values)).rows as Record<string,any>[];
  const within=async<T>(run:(query:typeof execute)=>Promise<T>)=>db.transaction(tx=>run(async(statement,values=[])=> (await tx.query(statement,values)).rows as Record<string,any>[]));
  await execute('INSERT INTO p5_estimator_drafts(id,revision,status,brand) VALUES ($1,4,$2,$3)',['answer-project','draft',ESTIMATOR_BRAND.id]);
  const incompleteScope={...scope,text:scope.text.replace('exactly 3','the existing')},input=projectInput(incompleteScope),p=example(input);p.summary=incompleteScope.text;p.quantities[0]={...p.quantities[0],basis:'unknown',value:null};
  p.questions=[{id:'how-many',requirementIds:['replace-handles'],quantityIds:['handle-count'],kind:'quantity',prompt:'How many handles should P5 replace?',reason:'Labor is priced for each replaced handle.',options:[],priority:'blocking'}];
  const initial=acceptProjectRecord(p,input,null,now);
  await publishProjectQualification('answer-project',4,{status:'questions',record:initial,problems:[],attempts:1},execute);
  const request={requestId:randomUUID(),revision:4,recordHash:initial.recordHash,kind:'answer' as const,questionId:'how-many',response:'3'};
  const failAfterRevision=async<T>(run:(query:typeof execute)=>Promise<T>)=>db.transaction(tx=>run(async(statement,values=[])=>{if(statement.startsWith('INSERT INTO p5_estimator_work'))throw new Error('simulated interrupted answer write');return (await tx.query(statement,values)).rows as Record<string,any>[];}));
  await assert.rejects(saveProjectChange('answer-project',request,failAfterRevision),/interrupted answer write/);
  assert.equal((await execute('SELECT revision FROM p5_estimator_drafts WHERE id=$1',['answer-project']))[0].revision,4);
  assert.deepEqual(await readProjectConversation('answer-project',execute),[]);
  assert.deepEqual(await saveProjectChange('answer-project',request,within),{revision:5,savedRevision:5,reused:false});
  assert.deepEqual(await saveProjectChange('answer-project',request,within),{revision:5,savedRevision:5,reused:true});
  await assert.rejects(saveProjectChange('answer-project',{...request,response:'4'},within),/different changes/);
  await assert.rejects(saveProjectChange('answer-project',{...request,requestId:randomUUID()},within),/project changed/);
  let changes=await readProjectConversation('answer-project',execute);
  assert.equal(changes.length,1);assert.equal(changes[0].prompt,p.questions[0].prompt);
  const answeredInput=projectInput(incompleteScope,activeProjectChanges(changes)),answerSource=answeredInput.sources.find(s=>s.kind==='customer-clarification')!;
  assert.match(answerSource.text,/How many handles.*\nCustomer response: 3/);
  assert.notEqual(answeredInput.sourceHash,input.sourceHash);
  const answered=example(answeredInput);answered.summary=incompleteScope.text;answered.evidence.push({id:'answer-evidence',sourceId:answerSource.id,quote:'Customer response: 3'});answered.quantities[0].evidenceIds=['answer-evidence'];
  const current=acceptProjectRecord(answered,answeredInput,initial,now);
  await publishProjectQualification('answer-project',5,{status:'ready',record:current,problems:[],attempts:1},execute);
  // A resolved question can still be edited while its physical work remains.
  await saveProjectChange('answer-project',{...request,requestId:randomUUID(),revision:5,recordHash:current.recordHash,response:'2'},within);
  changes=await readProjectConversation('answer-project',execute);
  assert.equal(changes.length,2);assert.equal(activeProjectChanges(changes).length,1);assert.equal(activeProjectChanges(changes)[0].response,'2');
  const revisedInput=projectInput(incompleteScope,activeProjectChanges(changes));
  assert.ok(!revisedInput.sources.some(s=>s.kind==='customer-clarification'&&s.text.includes('Customer response: 3')));
  assert.notEqual(revisedInput.sourceHash,current.sourceHash);
  await assert.rejects(publishProjectQualification('answer-project',5,{status:'ready',record:current,problems:[],attempts:1},execute),/project changed/);
 }finally{await db.close();}
});
test('revisions invalidate old prices and review even when work-item identities remain stable',()=>{
 const old=record(),selection=projectPriceSelection(old,config,proposal()),receipt=projectReviewReceipt(old,selection,review(old));
 const revisedScope={...scope,text:scope.text.replace('exactly 3','exactly 2')},input=projectInput(revisedScope),p=example(input);p.quantities[0].value=2;p.summary=revisedScope.text;
 const current=acceptProjectRecord(p,input,old,now);
 assert.equal(current.revision,2);assert.equal(projectRecordChange(old,current).pricesInvalidated,true);
 assert.ok(compileProjectPrices(current,selection,config,now).problems.some(p=>p.code==='stale-pricing'));
 const repriced=projectPriceSelection(current,config,proposal());
 assert.ok(calculateProjectEstimate(current,repriced,config,receipt,now).problems.some(p=>p.code==='stale-review'));
 const fresh=calculateProjectEstimate(current,repriced,config,projectReviewReceipt(current,repriced,review(current)),now);
 assert.equal(fresh.status,'estimated');assert.equal(fresh.compiled.lines[0].quantity*fresh.compiled.lines[0].unitCost,140);
});
test('the workflow performs separate scope and pricing reviews with no legacy correction calls',async()=>{
 const calls:string[]=[];
 const request:PricingRequest=async(instructions,input)=>{
  calls.push(instructions);const data=input as any;
  if(instructions===PROJECT_COMPLETION_INSTRUCTIONS){assert.equal(data.record,undefined);assert.equal(data.catalog,undefined);return {value:method({sources:data.sources,sourceHash:'unused',documentIssues:[]}),sourceUrls:[]};}
  if(instructions===PROJECT_RECORD_INSTRUCTIONS){const value=example({sources:data.sources,sourceHash:'unused',documentIssues:[]});value.requirements[0].operation='install';return {value,sourceUrls:[]};}
  if(instructions===PROJECT_CATALOG_INSTRUCTIONS){assert.equal(data.catalogIndex.length,config.planningCatalog!.rates.length);return {value:{requirements:[{requirementId:'replace-handles',candidates:[{rateId:'PB-08-71-01',reason:'Specific replacement labor'}],unmatchedReason:''}]},sourceUrls:[]};}
  if(instructions===PROJECT_PRICE_INSTRUCTIONS){assert.deepEqual(data.catalog.map((rate:any)=>rate.code),['PB-08-71-01'],'The first costing attempt sees semantic matches without unrelated catalog descriptions.');return {value:wireProposal(),sourceUrls:[]};}
  assert.equal(instructions,PROJECT_REVIEW_INSTRUCTIONS);
  if(data.selectedPrices)assert.equal(data.catalog.length,config.planningCatalog!.rates.length,'Price review must see competing approved rates, not only the selected ones.');
  return {value:review(data.record,data.completionPlan||undefined),sourceUrls:[]};
 };
 const read=await interpretProjectRecord(scope,{request,now});assert.equal(read.status,'ready');
 const priced=await priceProjectRecord(read.record!,config,{request,now,completionPlan:read.completionPlan});assert.equal(priced.status,'estimated');
 assert.deepEqual(calls,[PROJECT_COMPLETION_INSTRUCTIONS,PROJECT_RECORD_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,PROJECT_CATALOG_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS]);
});
test('a favorable automated review cannot hide unrepresented operations from the source-first method',()=>{
 const input=projectInput(scope),raw=method(input,'remove');raw.steps.push({...method(input,'install').steps[0]});
 const plan=acceptProjectCompletion(raw,input),r=record(),unsupported={...review(r),completionChecks:plan.steps.map(step=>({stepId:step.id,outcome:'represented' as const,requirementIds:['replace-handles'],questionIds:[],reason:'Claiming the broad replacement includes every operation.',evidenceIds:[]}))};
 assert.equal(unsupported.findings.length,0);
 assert.equal(validateProjectReview(r,unsupported,plan).problems.filter(p=>p.code==='completion-operation').length,2);
 const p=example(input);p.requirements[0].operation='install';p.requirements.push({...p.requirements[0],id:'remove-existing',operation:'remove',description:'Remove existing passage hardware'});
 const complete=acceptProjectRecord(p,input,null,now);
 assert.deepEqual(validateProjectReview(complete,review(complete,plan),plan).problems,[]);
 const omitted=review(complete,plan);omitted.completionChecks.pop();
 assert.ok(validateProjectReview(complete,omitted,plan).problems.some(p=>p.code==='completion-review'));
 const forged=structuredClone(raw);forged.steps[0].evidence[0].quote='Unsupported demolition instructions';
 assert.throws(()=>acceptProjectCompletion(forged,input),ProjectRecordError);
 const changed=structuredClone(plan);changed.steps[0].description='Changed after review';
 assert.ok(validateProjectReview(complete,review(complete,changed),changed).problems.some(p=>p.code==='stale-completion'));
 const dismissed={...review(r),completionChecks:[{stepId:plan.steps[0].id,outcome:'not-required',requirementIds:[],questionIds:[],reason:'Assumed included in installed price.',evidenceIds:[]}]};
 assert.equal(projectReviewSchema.safeParse(dismissed).success,false);
});
test('catalog discovery accounts for all work, rejects invented codes and never filters the full index by task keywords',()=>{
 const r=record(),rates=config.planningCatalog!.rates;
 assert.deepEqual(projectCatalogIndex(rates).map(rate=>rate.code),rates.map(rate=>rate.code));
 const candidate={requirements:[{requirementId:'replace-handles',candidates:[{rateId:'PB-08-71-01',reason:'Matches replacement labor'}],unmatchedReason:''}]};
 assert.deepEqual(checkedProjectCandidates(r,rates,candidate),candidate);
 assert.throws(()=>checkedProjectCandidates(r,rates,{requirements:[]}),ProjectRecordError);
 candidate.requirements[0].candidates[0].rateId='invented';
 assert.throws(()=>checkedProjectCandidates(r,rates,candidate),ProjectRecordError);
 candidate.requirements[0].requirementId='handle-supply';
 assert.throws(()=>checkedProjectCandidates(r,rates,candidate),ProjectRecordError);
 const acknowledged={requirements:[{requirementId:'replace-handles',candidates:[{rateId:'PB-08-71-01',reason:'Matches replacement labor'}],unmatchedReason:''},{requirementId:'handle-supply',candidates:[],unmatchedReason:'Owner supplies; no charge.'}]};
 assert.deepEqual(checkedProjectCandidates(r,rates,acknowledged),acknowledged);
 acknowledged.requirements[1].candidates=[{rateId:'PB-08-71-01',reason:'Attempt to charge owner work'}];
 assert.throws(()=>checkedProjectCandidates(r,rates,acknowledged),ProjectRecordError);
});
test('accepted project classification determines cost-book context without changing saved owner rates',()=>{
 const empty={...config,planningCatalog:{...config.planningCatalog!,rates:[]}};
 const current={...record(),service:'bathroom'};
 const result=projectConfiguration(empty,current,'mid-range');
 const expected=priceBookRates({service:'bathroom',finish:'mid-range'});
 assert.deepEqual(result.planningCatalog!.rates,expected);
 assert.match(result.catalogVersion!,/:bathroom:mid$/);
 const saved={...empty,planningCatalog:{...empty.planningCatalog,rates:[{...expected[0],amount:1234}]}};
 assert.equal(projectConfiguration(saved,current).planningCatalog!.rates[0].amount,1234);
});
test('malformed pricing proposals receive their actual validation feedback on retry',async()=>{
 let attempts=0;const r=record();
 const request:PricingRequest=async(instructions,input)=>{
  const data=input as any;
  if(instructions===PROJECT_CATALOG_INSTRUCTIONS)return {value:{requirements:[{requirementId:'replace-handles',candidates:[],unmatchedReason:'No match proposed in this controlled test.'}]},sourceUrls:[]};
  if(instructions===PROJECT_PRICE_INSTRUCTIONS){
   if(++attempts===1){assert.equal(data.catalog.length,0);return {value:{lines:[{id:'malformed'}],gaps:[]},sourceUrls:[]};}
   assert.equal(data.catalog.length,config.planningCatalog!.rates.length,'A failed retrieved selection can recover from the complete book.');
   assert.deepEqual(data.previousProposal,{lines:[{id:'malformed'}],gaps:[]});assert.ok(data.correctionsRequired.some((p:any)=>p.code==='record-shape'&&p.message.includes('lines')));
   return {value:wireProposal(),sourceUrls:[]};
  }
  return {value:review(r),sourceUrls:[]};
 };
 assert.equal((await priceProjectRecord(r,config,{request,now})).status,'estimated');assert.equal(attempts,2);
});
test('a blocking review finding must state the required correction and cannot be waived through its wording',()=>{
 const r=record(),p=projectPriceSelection(r,config,proposal());
 const finding={id:'f1',code:'rate-fit',requirementIds:['replace-handles'],quantityIds:[],lineIds:['install'],evidenceIds:[],catalogEvidence:[{rateId:'PB-08-71-01',quote:config.planningCatalog!.rates.find(r=>r.code==='PB-08-71-01')!.description}],message:'No explicit defect; an alternative exists.'};
 assert.equal(projectReviewSchema.safeParse({...review(r),findings:[finding]}).success,false);
 const receipt=projectReviewReceipt(r,p,{...review(r),findings:[{...finding,requiredCorrection:'Resolve the disputed match against the approved catalog.'}]});
 const result=calculateProjectEstimate(r,p,config,receipt,now);
 assert.equal(result.status,'needs-resolution');assert.ok(result.problems.some(p=>p.code==='rate-fit'&&p.message.includes('Required correction:')));
});
test('actual abbreviated completion citations stay rejected and receive the exact original wording for repair',()=>{
 const cases=[
  ['replace 420 LF of baseboards and eight interior doors, paint 4,000 SF of walls and 1,800 SF of ceilings.','paint 1,800 SF of ceilings'],
  ['Supply 12 LF base cabinets and 8 LF wall cabinets, painted Shaker style with plywood boxes and soft-close hardware. The owner collects and installs the cabinets.','Supply ... 8 LF wall cabinets, painted Shaker style with plywood boxes and soft-close hardware.'],
 ];
 for(const [text,quote]of cases){
  const input=projectInput({...scope,text}),raw=method(input);raw.steps[0].evidence[0].quote=quote;
  assert.throws(()=>acceptProjectCompletion(raw,input),(error:unknown)=>error instanceof ProjectRecordError&&error.problems.some(p=>p.code==='completion-evidence'&&p.message.includes(JSON.stringify(text))&&p.message.includes(JSON.stringify(quote))));
  raw.steps[0].evidence[0].quote=text;assert.equal(acceptProjectCompletion(raw,input).steps[0].evidence[0].quote,text);
 }
});
test('an invented review alternative is repaired without redirecting the accepted price proposal',async()=>{
 const r=record();let priceCalls=0,reviewCalls=0;let firstSelection:unknown;
 const unsupported={...review(r),findings:[{id:'invented-alternative',code:'rate-fit',requirementIds:['replace-handles'],quantityIds:[],lineIds:['install'],evidenceIds:[],catalogEvidence:[{rateId:'PB-03-19-04-L',quote:'Door Hardware - Labor'}],message:'PB-03-19-04-L is a cheaper more specific alternative.',requiredCorrection:'Replace PB-08-71-01 with PB-03-19-04-L.'}]};
 assert.throws(()=>verifiedReviewCatalog(unsupported,config.planningCatalog!.rates),ProjectRecordError);
 const body=openAiPricingRequestEnvelope(PROJECT_REVIEW_INSTRUCTIONS,{catalog:config.planningCatalog!.rates},false).body as any;
 const pattern=body.text.format.schema.properties.findings.items.properties.catalogEvidence.items.properties.rateId.pattern;
 assert.equal(new RegExp(pattern).test('PB-03-19-04-L'),false);assert.equal(new RegExp(pattern).test('PB-08-71-01'),true);
 const request:PricingRequest=async(instructions,input)=>{
  const data=input as any;
  if(instructions===PROJECT_CATALOG_INSTRUCTIONS)return {value:{requirements:[{requirementId:'replace-handles',candidates:[{rateId:'PB-08-71-01',reason:'Actual task rate'}],unmatchedReason:''}]},sourceUrls:[]};
  if(instructions===PROJECT_PRICE_INSTRUCTIONS){priceCalls++;return {value:wireProposal(),sourceUrls:[]};}
  assert.equal(instructions,PROJECT_REVIEW_INSTRUCTIONS);reviewCalls++;
  if(reviewCalls===1){firstSelection=structuredClone(data.selectedPrices);return {value:unsupported,sourceUrls:[]};}
  assert.deepEqual(data.selectedPrices,firstSelection);assert.deepEqual(data.previousReview,unsupported);
  assert.ok(data.correctionsRequired.some((p:any)=>p.code==='review-catalog-evidence'));
  return {value:review(r),sourceUrls:[]};
 };
 const result=await priceProjectRecord(r,config,{request,now});assert.equal(result.status,'estimated');assert.equal(priceCalls,1);assert.equal(reviewCalls,2);
 assert.equal(result.status==='estimated'&&result.compiled.lines[0].unitCost,70);
 // Omitting a false rate from the structured references does not conceal it.
 unsupported.findings[0].catalogEvidence=[{rateId:'PB-08-71-01',quote:config.planningCatalog!.rates.find(rate=>rate.code==='PB-08-71-01')!.description}];
 assert.throws(()=>verifiedReviewCatalog(unsupported,config.planningCatalog!.rates),ProjectRecordError);
});
test('repeated invalid review evidence stops with the unchanged selection and never becomes a pricing instruction',async()=>{
 const r=record();let priceCalls=0,reviewCalls=0;
 const invalid={...review(r),findings:[{id:'false-rate',code:'rate-fit',requirementIds:['replace-handles'],quantityIds:[],lineIds:['install'],evidenceIds:[],catalogEvidence:[{rateId:'PB-08-71-01',quote:'Fabricated description supporting a different cost'}],message:'Wrong quoted catalog coverage.',requiredCorrection:'Reprice.'}]};
 const request:PricingRequest=async(instructions)=>{
  if(instructions===PROJECT_CATALOG_INSTRUCTIONS)return {value:{requirements:[{requirementId:'replace-handles',candidates:[{rateId:'PB-08-71-01',reason:'Actual task rate'}],unmatchedReason:''}]},sourceUrls:[]};
  if(instructions===PROJECT_PRICE_INSTRUCTIONS){priceCalls++;return {value:wireProposal(),sourceUrls:[]};}
  reviewCalls++;return {value:invalid,sourceUrls:[]};
 };
 const result=await priceProjectRecord(r,config,{request,now});assert.equal(result.status,'needs-resolution');assert.equal(priceCalls,1);assert.equal(reviewCalls,2);
 assert.ok(result.problems.some(p=>p.code==='review-catalog-evidence'));
});
test('a no-correction finding triggers review repair without repricing or automatic acceptance',async()=>{
 const r=record();let prices=0,reviews=0;
 const rate=config.planningCatalog!.rates.find(rate=>rate.code==='PB-08-71-01')!;
 const invalid={...review(r),findings:[{id:'confirmation',code:'rate-fit',requirementIds:['replace-handles'],quantityIds:[],lineIds:['install'],evidenceIds:[],catalogEvidence:[{rateId:rate.code,quote:rate.description}],message:'PB-08-71-01 is the most specific per-door rate.',requiredCorrection:'None required.'}]};
 const run=(repair:boolean)=>priceProjectRecord(r,config,{now,request:async(instructions,input)=>{
  if(instructions===PROJECT_CATALOG_INSTRUCTIONS)return {value:{requirements:[{requirementId:'replace-handles',candidates:[{rateId:rate.code,reason:'Actual task rate'}],unmatchedReason:''}]},sourceUrls:[]};
  if(instructions===PROJECT_PRICE_INSTRUCTIONS){prices++;return {value:wireProposal(),sourceUrls:[]};}
  reviews++;
  if(reviews===2)assert.ok((input as any).correctionsRequired.some((p:any)=>p.code==='review-nonactionable-finding'));
  return {value:repair&&reviews===2?review(r):invalid,sourceUrls:[]};
 }});
 assert.equal((await run(true)).status,'estimated');assert.equal(prices,1);assert.equal(reviews,2);
 prices=0;reviews=0;
 const blocked=await run(false);assert.equal(blocked.status,'needs-resolution');assert.equal(prices,1);assert.equal(reviews,2);
 assert.ok(blocked.problems.some(p=>p.code==='review-nonactionable-finding'));
});
