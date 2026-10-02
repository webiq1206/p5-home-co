import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditPricingState} from '../lib/p5/auditPricingState.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import {finishScopePricing,requestPricingAudit} from '../lib/p5/scopePricing.ts';
import {assumptionLedger,stampAdvisoryReview,resolveAdvisoryProvenance} from '../lib/p5/advisoryProvenance.ts';
const saved=JSON.parse(readFileSync(new URL('./fixtures/p5-main11-saved-failure.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(saved.internal_estimate);

test('exact saved .11 result reproduces a blocked $285 ledger with no full-door charge',()=>{
 const f=fixture(),a=f.scopePricing;
 const config={finance:f.financeSnapshot,costBooks:[{...f.costBookSnapshot,rules:[],assumptions:[]}]};
 const out=finishScopePricing(f.scope,config,new Date(f.evaluatedAt),a.originalResolution,a,f.scope.extraction);
 assert.equal(out.internal.directCost,285);assert.equal(out.customer.range,null);
 assert.equal(out.internal.lines.length,2);
 assert.ok(out.internal.lines.every((line:any)=>!line.evidence.reference.includes('PB-02-41-29')));
 assert.ok(out.internal.scopePricing.finalExplanation.advisoryDisposition.blockers.length>0);
});

test('exact saved .11 audit input distinguishes retained facts from all mapper histories in one existing call',async()=>{
 const f=fixture(),a=f.scopePricing,before=JSON.stringify(f);let calls=0;
 const original={answers:f.scope.answers,text:f.scope.text,extraction:f.scope.extraction};
 await requestPricingAudit(async(_instructions,input)=>{
  calls++;const p=input as any;
  assert.equal(p.currentPricing.lines.reduce((sum:number,line:any)=>sum+line.directCost,0),285);
  assert.deepEqual(p.currentPricing.lines.map((line:any)=>line.id),['scope-1','minor-work-allowance']);
  const labor=p.currentPricing.lines[0];assert.equal(labor.canonicalRate.code,'PB-08-71-01');assert.match(labor.description,/labor only; price materials separately/);
  assert.ok(p.tasks.every((task:any)=>!('notes' in task)&&!('additions' in task)));
  assert.ok(p.historicalContext.taskNotes.some((note:string)=>note.includes('PB-02-41-29')));
  assert.ok(p.assumptionLedger.some((entry:any)=>entry.origin==='pricing-history'&&entry.text.includes('embedded')));
  assert.ok(p.currentPricing.tasks.find((task:any)=>task.id==='required-contractor-consumables').retainedLineIds.includes('minor-work-allowance'));
  assert.equal(p.currentPricing.lines[1].policyAssignments.length,2);
  return {value:{coveredTaskIds:[],issues:['Unresolved coverage must still block.'],notes:[],resolvedIssues:[]},sourceUrls:[]};
 },{original,tasks:a.tasks,existingLines:[],additionalRules:a.originalResolution.rules,customerAssumptions:['Owner supplies replacement levers.'],pricingHistory:a.originalResolution.assumptions,priorPricingIssues:a.originalResolution.issues},()=>10000);
 assert.equal(calls,1);assert.equal(JSON.stringify(f),before);
});

test('mapper history cannot become an authenticated scope advisory, while real scope caveats survive',()=>{
 const lines=[{id:'labor',description:'Labor only',category:'field-labor',unit:'EA',quantity:3,unitCost:70}];
 const tasks=[{id:'install',description:'Install levers',existingLineIds:['labor']}];
 const ledger=assumptionLedger(['Confirm site access.'],[],['Mapping claims consumables are in labor.']);
 const review={assumptions:ledger.map(entry=>({id:entry.id,kind:'advisory' as const,basis:'scope-assumption' as const,message:entry.text,taskIds:['install'],lineIds:['labor'],retiredCodes:[]})),advisories:[],blockers:[]};
 const record=stampAdvisoryReview(ledger,review,lines,tasks,[],[]);
 const result=resolveAdvisoryProvenance([record],lines,tasks,new Set(['labor']),[]);
 assert.deepEqual(result.advisories.map(item=>item.message),['Confirm site access.']);
 assert.equal(result.invalid.length,1);assert.equal(result.superseded.length,0);
});

for(const change of ['zero quantity','zero price','wrong amount','wrong unit','wrong category','real whole-door removal','real material overlap'])test('retained state does not fabricate proof: '+change,()=>{
 const f=fixture(),lines=f.scopePricing.originalResolution.rules;
 if(change==='zero quantity')lines[0].quantity.fixed=0;
 if(change==='zero price')lines[0].unitCost=0;
 if(change==='wrong amount')lines[0].unitCost++;
 if(change==='wrong unit')lines[0].unit='HR';
 if(change==='wrong category')lines[0].category='materials';
 if(change==='real whole-door removal'||change==='real material overlap')lines.push({...structuredClone(lines[0]),id:'real-extra',description:'Additional retained work',category:change==='real whole-door removal'?'subcontractors':'materials',evidence:{reference:'Other retained source; unverified'}});
 const state=auditPricingState(lines,f.scopePricing.tasks,priceBookRates(f.scope.answers));
 if(change.startsWith('zero'))assert.ok(!state.lines.some(line=>line.id==='scope-1'));
 else if(change.startsWith('wrong'))assert.equal(state.lines.find(line=>line.id==='scope-1')!.canonicalRate,null);
 else assert.ok(state.lines.some(line=>line.id==='real-extra'),'never discard a real retained charge because its narrative conflicts');
});
