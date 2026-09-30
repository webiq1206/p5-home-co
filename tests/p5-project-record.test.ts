import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInput,acceptProjectRecord,validateProjectRecord,projectRecordChange,computedProjectQuantity,ProjectRecordError} from '../lib/p5/projectRecord.ts';
import {compileProjectPrices,projectPriceSelection,calculateProjectEstimate,projectReviewReceipt} from '../lib/p5/projectPricing.ts';
import {interpretProjectRecord,priceProjectRecord} from '../lib/p5/projectWorkflow.ts';
import {PROJECT_RECORD_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,type ProjectProposal,type ProjectQuantity} from '../lib/p5/projectRecordContracts.ts';
import {openAiPricingRequestEnvelope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import {PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import {DEFAULT_FINANCE} from '../lib/p5/pricing.ts';
import type {EstimatorConfiguration} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

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
const proposal=()=>({lines:[{id:'install',rateId:'PB-08-71-01',quantityId:'handle-count',requirementIds:['replace-handles'],catalogQuote:config.planningCatalog!.rates.find(r=>r.code==='PB-08-71-01')!.description,coverageEvidence:'Owner-supplied sets require only replacement labor.'}],gaps:[]});
const review=(r=record())=>({reviewedRequirementIds:r.requirements.map(x=>x.id),reviewedSourceIds:r.sources.map(x=>x.id),findings:[],notes:[]});
test('all three provider contracts use their own strict schema instead of an unrelated audit response',()=>{
 for(const [instructions,key]of [[PROJECT_RECORD_INSTRUCTIONS,'requirements'],[PROJECT_PRICE_INSTRUCTIONS,'lines'],[PROJECT_REVIEW_INSTRUCTIONS,'findings']]){
  const body=openAiPricingRequestEnvelope(instructions,{},false).body as any;
  assert.equal(body.model,'gpt-4.1');assert.equal(body.text.format.strict,true);assert.ok(body.text.format.schema.properties[key]);
 }
});
test('source blocks retain every typed character and quote identity',()=>{
 const text=('A distinct project instruction with measured quantities.\n').repeat(1000);
 const input=projectInput({...scope,text});
 assert.equal(input.sources.filter(s=>s.kind==='customer-text').map(s=>s.text).join(''),text);
 assert.equal(new Set(input.sources.map(s=>s.id)).size,input.sources.length);
 const bad=example();bad.evidence[0].quote='Invented dimensions and scope';
 assert.throws(()=>acceptProjectRecord(bad,projectInput(scope)),ProjectRecordError);
});
test('unknown, invented and redundant quantities cannot pass as reviewed facts',()=>{
 const invented=example();invented.quantities[0].value=33;
 assert.ok(validateProjectRecord(invented,projectInput(scope)).some(p=>p.code==='unstated-value'));
 const unknown=example();unknown.quantities[0].basis='unknown';
 assert.ok(validateProjectRecord(unknown,projectInput(scope)).some(p=>p.code==='invented-quantity'));
 const redundant=example();redundant.questions=[{id:'count-again',requirementIds:['replace-handles'],quantityIds:['handle-count'],kind:'quantity',prompt:'How many handles?',reason:'Need the count',options:[],priority:'blocking'}];
 assert.ok(validateProjectRecord(redundant,projectInput(scope)).some(p=>p.code==='redundant-question'));
});
test('missing quantities produce linked questions without adding excluded work',()=>{
 const incomplete=example();incomplete.quantities[0]={...incomplete.quantities[0],basis:'unknown',value:null};
 incomplete.questions=[{id:'count',requirementIds:['replace-handles'],quantityIds:['handle-count'],kind:'quantity',prompt:'How many passage handles should we replace?',reason:'The replacement labor is priced per handle.',options:[],priority:'blocking'}];
 assert.deepEqual(validateProjectRecord(incomplete,projectInput(scope)),[]);
 incomplete.questions[0].requirementIds=['paint'];
 assert.ok(validateProjectRecord(incomplete,projectInput(scope)).some(p=>p.code==='unrelated-question'));
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
 const missing=projectPriceSelection(r,config,{lines:[],gaps:[]});
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
  if(instructions===PROJECT_RECORD_INSTRUCTIONS)return {value:example({sources:data.sources,sourceHash:'unused',documentIssues:[]}),sourceUrls:[]};
  if(instructions===PROJECT_PRICE_INSTRUCTIONS)return {value:proposal(),sourceUrls:[]};
  assert.equal(instructions,PROJECT_REVIEW_INSTRUCTIONS);return {value:review(data.record),sourceUrls:[]};
 };
 const read=await interpretProjectRecord(scope,{request,now});assert.equal(read.status,'ready');
 const priced=await priceProjectRecord(read.record!,config,{request,now});assert.equal(priced.status,'estimated');
 assert.deepEqual(calls,[PROJECT_RECORD_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS]);
});
