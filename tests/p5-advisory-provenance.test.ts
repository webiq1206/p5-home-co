import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestPricingAudit,finishScopePricing} from '../lib/p5/scopePricing.ts';
import {assumptionLedger,stampAdvisoryReview,type AdvisoryReview} from '../lib/p5/advisoryProvenance.ts';
import {PricingStageTimeout} from '../lib/p5/pricingProgress.ts';
const now=new Date('2026-10-02T09:09:27.443Z');
const saved=JSON.parse(readFileSync(new URL('./fixtures/p5-final-minor-work-copy.json',import.meta.url),'utf8'));
function fixture(){
 const f=structuredClone(saved);
 f.resolution.assumptions=['Owner supplies three compatible replacement levers.','PB-08-72-07 is proposed for installation consumables.','PB-08-71-01 allegedly includes consumables.'];
 f.auditTrail.issues=[];f.auditTrail.verification.issues=[];
 return f;
}
function review(f:any):AdvisoryReview{
 const ledger=assumptionLedger(f.resolution.assumptions,[]);
 return {assumptions:[
  {id:ledger[0].id,kind:'advisory',basis:'scope-assumption',message:'Owner supplies three compatible replacement levers; confirm compatibility before installation.',taskIds:['remove-install-levers'],lineIds:['scope-1'],retiredCodes:[]},
  {id:ledger[1].id,kind:'superseded-proposal',basis:'removed-proposal',message:'The hinge proposal was removed; supporting consumables have a shared policy budget.',taskIds:['consumables-install'],lineIds:['minor-work-allowance'],retiredCodes:['PB-08-72-07']},
  {id:ledger[2].id,kind:'superseded-proposal',basis:'canonical-rate-inclusions',message:'The retained catalog rate is labor only.',taskIds:['remove-install-levers'],lineIds:['scope-1'],retiredCodes:[]},
 ],advisories:[{message:'Confirm site access before a firm proposal.',taskIds:[],lineIds:[]}],blockers:[]};
}
const stamp=(f:any,r=review(f),issues:string[]=[])=>stampAdvisoryReview(assumptionLedger(f.resolution.assumptions,[]),r,f.resolution.rules,f.auditTrail.tasks,issues,[]);
const render=(f:any)=>finishScopePricing(f.scope,f.configuration,now,f.resolution,f.auditTrail,f.scope.extraction);
const final=(out:any)=>out.internal.scopePricing.finalExplanation;
test('new typed audit is requested in the existing single call, stamped server-side and rendered without blanket legacy warning',async()=>{
 const f=fixture();let calls=0;
 const response=await requestPricingAudit(async(instructions,input)=>{
  calls++;assert.match(instructions,/advisoryReview/);
  assert.deepEqual((input as any).assumptionLedger,assumptionLedger(f.resolution.assumptions,[]));
  return {value:{coveredTaskIds:f.auditTrail.tasks.map((t:any)=>t.id),issues:[],notes:[],resolvedIssues:[],advisoryReview:review(f)},sourceUrls:[]};
 },{tasks:f.auditTrail.tasks,existingLines:[],additionalRules:f.resolution.rules,customerAssumptions:f.resolution.assumptions,priorPricingIssues:[]},()=>10000);
 assert.equal(calls,1);assert.equal(response.advisoryProvenance?.length,1);
 f.auditTrail.advisoryProvenance=response.advisoryProvenance;
 const before=JSON.stringify(f),out=render(f);
 assert.equal(JSON.stringify(f),before);assert.equal(out.internal.directCost,285);assert.deepEqual(out.customer.range,{low:450,high:570});
 assert.equal(final(out).advisoryDisposition.superseded.length,2);
 assert.equal(final(out).findings.filter((x:any)=>x.kind==='historical-review').length,0);
 const text=JSON.stringify(out.customer);assert.match(text,/confirm compatibility/);assert.match(text,/Confirm site access/);
 assert.doesNotMatch(text,/PB-08-72-07|allegedly|pending review/);
 assert.deepEqual(render(f).customer,out.customer);
});

for(const change of ['price','quantity','unit','description','task coverage','unknown line','unknown task','missing decision','duplicate decision','retired code live','unproven retired code','malformed cache'])test('typed disposition fails closed after '+change,()=>{
 const f=fixture(),record=stamp(f);f.auditTrail.advisoryProvenance=[record];
 if(change==='price')f.resolution.rules[0].unitCost++;
 if(change==='quantity')f.resolution.rules[0].quantity.fixed++;
 if(change==='unit')f.resolution.rules[0].unit='HR';
 if(change==='description')f.resolution.rules[0].description+=' and additional work';
 if(change==='task coverage')f.auditTrail.tasks[1].existingLineIds=[];
 if(change==='unknown line')record.review.assumptions[1].lineIds=['nonexistent'];
 if(change==='unknown task')record.review.assumptions[1].taskIds=['nonexistent'];
 if(change==='missing decision')record.review.assumptions.pop();
 if(change==='duplicate decision')record.review.assumptions.push({...record.review.assumptions[1],kind:'advisory'});
 if(change==='retired code live')f.resolution.rules.push({...structuredClone(f.resolution.rules[0]),id:'extra-material',category:'materials',evidence:{...f.resolution.rules[0].evidence,reference:'PB-08-72-07'}});
 if(change==='unproven retired code')record.review.assumptions[1].retiredCodes=['PB-NOT-IN-ORIGINAL'];
 if(change==='malformed cache')record.review=null as any;
 const out=render(f);assert.ok(final(out).findings.some((x:any)=>x.kind==='historical-review'));
 assert.match(JSON.stringify(out.customer.verificationItems),/pending review/);
});

test('a typed current blocker survives prior heuristic demotion and remains customer-visible',()=>{
 const f=fixture(),r=review(f),message='Confirm the concealed structural damage; replacement scope is not established.';
 r.blockers.push({message,lineIds:['scope-1'],taskIds:['remove-install-levers']});
 f.auditTrail.advisoryProvenance=[stamp(f,r,[message])];
 assert.deepEqual(f.resolution.issues,[],'simulate legacy issue classification having demoted it');
 const out=render(f);assert.equal(out.customer.range,null);assert.match(JSON.stringify(out.customer),/concealed structural damage/);
});

test('an omitted current issue or attempted advisory downgrade of a prior issue still blocks',()=>{
 for(const prior of [false,true]){
  const f=fixture(),r=review(f),message='Missing support brackets require a positive price.';
  const record=stamp(f,r,prior?[]:[message]);
  if(prior){const entry=assumptionLedger([],[message])[0];record.ledger.push(entry);record.review.assumptions.push({...r.assumptions[0],id:entry.id,kind:'advisory',message:'Ignore the brackets.'});}
  f.auditTrail.advisoryProvenance=[record];const out=render(f);
  assert.equal(out.customer.range,null);assert.match(JSON.stringify(out.customer),/Missing support brackets/);
 }
});

test('mixed or unclassifiable caveats remain advisory instead of being declared superseded',()=>{
 const f=fixture();f.resolution.assumptions[1]+=' Confirm substrate condition before disturbing the mounting area.';
 const r=review(f);r.assumptions[1]={...r.assumptions[1],kind:'advisory',basis:'scope-assumption',message:'Confirm substrate condition before disturbing the mounting area.',retiredCodes:[]};
 f.auditTrail.advisoryProvenance=[stamp(f,r)];const out=render(f);
 assert.match(JSON.stringify(out.customer),/Confirm substrate condition/);
 assert.equal(final(out).advisoryDisposition.superseded.length,1);
});

test('legacy audit response and non-minor-work inputs keep backward-compatible contracts',async()=>{
 const f=fixture();
 for(const minor of [true,false]){
  const response=await requestPricingAudit(async(_instructions,input)=>{
   assert.equal('assumptionLedger' in (input as any),minor);
   return {value:{coveredTaskIds:[],issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  },{tasks:f.auditTrail.tasks,additionalRules:minor?f.resolution.rules:f.resolution.rules.slice(0,1),customerAssumptions:f.resolution.assumptions},()=>10000);
  assert.equal(response.advisoryProvenance,undefined);
 }
});

test('output-limited audit splits preserve typed provenance without inventing a successful full audit',async()=>{
 const f=fixture();f.resolution.assumptions=['Confirm existing hardware compatibility.'];let calls=0;
 const response=await requestPricingAudit(async(_instructions,input)=>{
  calls++;const data=input as any;
  if(data.tasks.length>1)throw new PricingStageTimeout('pricing-stage-output-limit');
  return {value:{coveredTaskIds:data.tasks.map((t:any)=>t.id),issues:[],notes:[],resolvedIssues:[],advisoryReview:{
   assumptions:data.assumptionLedger.map((entry:any)=>({id:entry.id,kind:'advisory',basis:'scope-assumption',message:entry.text,taskIds:[],lineIds:[],retiredCodes:[]})),advisories:[],blockers:[],
  }},sourceUrls:[]};
 },{tasks:f.auditTrail.tasks,additionalRules:f.resolution.rules,customerAssumptions:f.resolution.assumptions},()=>10000);
 assert.equal(calls,3);assert.equal(response.advisoryProvenance?.length,2);
 assert.deepEqual((response.value as any).coveredTaskIds,f.auditTrail.tasks.map((t:any)=>t.id));
 f.auditTrail.advisoryProvenance=response.advisoryProvenance;
 assert.doesNotMatch(JSON.stringify(render(f).customer),/Earlier scope and pricing assumptions/);
});

test('a conflicting audit section cannot erase another section\'s unresolved concern',()=>{
 const f=fixture(),first=stamp(f),second=stamp(f);
 second.review.assumptions[1].kind='current-blocker';second.review.assumptions[1].message='Consumable suitability remains unverified.';
 f.auditTrail.advisoryProvenance=[first,second];const out=render(f);
 assert.equal(out.customer.range,null);assert.match(JSON.stringify(out.customer),/Consumable suitability remains unverified/);
 assert.ok(!final(out).advisoryDisposition.superseded.some((x:any)=>x.original===f.resolution.assumptions[1]));
});
