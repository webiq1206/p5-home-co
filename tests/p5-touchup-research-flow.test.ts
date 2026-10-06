import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {priceDetailedScope,type PricingReply,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {PRICE_BOOK} from '../lib/p5/priceBookData.ts';
import {priceBookRate} from '../lib/p5/priceBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const at='2026-10-06T12:00:00.000Z';
const required=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const bookRates=['12-32-01','12-39-02'].map(code=>priceBookRate(PRICE_BOOK.find(row=>row[0]===code)!,'mid',false));
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic integration fixture',authorizedBy:'Test only',importedAt:at,rates:[
 ...required.map(code=>({code,description:'Synthetic foundation component',type:code.endsWith('-M')?'Material' as const:'Labor' as const,unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic fixture',basis:'owner-average-cost' as const})),
 ...bookRates,
]};
const configuration=createPlanningConfiguration(catalog);
type Selection='selected'|'unselected'|'ambiguous';
type Phase='initial'|'repair';
type FixtureTask={id:string;description:string;evidence:string;existingLineIds:string[]};
type FixtureLine={id:string;description:string;quantity:number;unitCost:number};
type StageInput={taskBatch?:FixtureTask[];repairInstruction?:string;existingLines?:FixtureLine[];currentPricing?:Record<string,unknown>;[key:string]:unknown};
type FixtureRule={id:string;scopeTaskId?:string;unitCost:number;evidence:{reference:string;basis:string};minorWorkCoverage?:{taskId:string}[]};
type InternalResult={costBookSnapshot:{rules:FixtureRule[]};scopePricing:{tasks:FixtureTask[];issues:string[]}};
const description='Cabinet touch-up painting (factory-painted cabinets only; exterior painting excluded).';
const selectedEvidence={
 initial:'painting outside cabinet touch-up [excluded]',
 repair:"Scope states 'painting outside cabinet touch-up [excluded].' Scope limits touch-up to factory-painted cabinet doors, frames, edges, and minor color matching only. Not full cabinet spray painting.",
};
const key=(instructions:string,input:unknown,search:boolean)=>createHash('sha256').update(JSON.stringify([instructions,input,search])).digest('hex');

function fixture(selection:Selection,phase:Phase){
 const evidence=selection==='selected'?selectedEvidence[phase]:selection==='unselected'
  ?'Cabinet touch-up painting is not selected.'
  :'Optional cabinet touch-up painting included. Cabinet touch-up painting not selected.';
 const scope:ReviewedScope={text:'Supply and install ten linear feet of factory-painted base cabinets. Include minor touch-up of cabinet edges, seams and installation damage. Painting outside cabinet touch-up is excluded.',
  answers:{service:'remodel',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise',finish:'mid-range'},extraction:null,uploads:[],reviewedAt:at,corrections:[]};
 const main={id:'cabinet-install',description:'Supply and install 10 LF factory-painted base cabinets',evidence:'10 LF of new base cabinets',existingLineIds:[] as string[],additions:[{code:'PB-12-32-01',quantity:10,quantityEvidence:'10 LF explicitly requested'}],researchDescription:'',issues:[]};
 const touchup={id:'cabinet-touchup-paint',description,evidence,existingLineIds:[] as string[],additions:[{code:'PB-12-39-02',quantity:10,quantityEvidence:'10 LF of cabinetry receiving localized touch-up'}],researchDescription:'Minor edge, seam and installation-damage touch-up of factory-painted cabinets.',issues:[]};
 return {scope,main,touchup};
}

async function run(selection:Selection,phase:Phase,cache?:Map<string,PricingReply>){
 const {scope,main,touchup}=fixture(selection,phase);
 let searches=0,mappings=0,audits=0,shortlists=0,network=0;
 const calls:{stage:string;key:string;replayed:boolean;instructions:string;input:StageInput}[]=[];
 let shortlistKey='';
 const fetchBefore=globalThis.fetch,shortlistBefore=process.env.P5_BOOK_SHORTLIST_TEST;
 globalThis.fetch=async()=>{network++;throw Error('This fixture forbids every network request.');};
 process.env.P5_BOOK_SHORTLIST_TEST='1';
 const request:PricingRequest=async(instructions,input,search)=>{
  const data=input as StageInput;
  if(search){searches++;throw Error('A nonbillable or policy-covered touch-up must never enter research.');}
  const stage=data.taskBatch?'mapping':'priorPricingIssues' in data?'audit':'inventory';
  const fingerprint=key(instructions,input,search),saved=cache?.get(fingerprint);
  calls.push({stage,key:fingerprint,replayed:!!saved,instructions,input:structuredClone(data)});
  if(saved)return structuredClone(saved);
  let reply:PricingReply;
  if(stage==='mapping'){
   mappings++;
   const repair=Boolean(data.repairInstruction);
   reply={value:{tasks:data.taskBatch!.map(task=>{
    if(task.id===main.id)return repair?{...structuredClone(main),additions:[],existingLineIds:(data.existingLines||[]).filter(line=>line.description.startsWith(main.description+':')&&line.quantity*line.unitCost>0).map(line=>line.id)}:structuredClone(main);
    // The first pass can retain an unselected task without a gap. The audit's
    // corrective mapping supplies the gap that previously escaped the filter.
    return {...structuredClone(touchup),researchDescription:phase==='repair'&&!repair?'':touchup.researchDescription};
   }),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  }else if(stage==='audit'){
   audits++;
   reply={value:{coveredTaskIds:[main.id,...(selection==='selected'?[touchup.id]:[])],issues:phase==='repair'&&audits===1?['cabinet-install: Duplicated assembly pricing.']:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  }else reply={value:{tasks:[main,touchup].map(({id,description,evidence})=>({id,description,evidence})),issues:[],notes:[],dependencies:[]},sourceUrls:[]};
  cache?.set(fingerprint,structuredClone(reply));
  return reply;
 };
 try{
  const result=await priceDetailedScope(scope,configuration,request,new Date(at),Date.now()+60000,undefined,0,undefined,async(tasks,rates)=>{
   shortlistKey='shortlist:'+key('Synthetic cached shortlist',[tasks,rates],false);
   const saved=cache?.get(shortlistKey);
   if(saved)return new Map(saved.value as [string,string[]][]);
   shortlists++;
   const entries:[string,string[]][]=[[main.id,['PB-12-32-01']],[touchup.id,['PB-12-39-02']]];
   cache?.set(shortlistKey,{value:entries,sourceUrls:[]});
   return new Map(entries);
  });
  assert.equal(network,0,'pricing must use only the synthetic stage adapter');
  return {result,searches,mappings,audits,shortlists,shortlistKey,calls,main,touchup};
 }finally{
  globalThis.fetch=fetchBefore;
  if(shortlistBefore===undefined)delete process.env.P5_BOOK_SHORTLIST_TEST;else process.env.P5_BOOK_SHORTLIST_TEST=shortlistBefore;
 }
}

for(const phase of ['initial','repair'] as const)for(const selection of ['selected','unselected','ambiguous'] as const){
 test(`${phase} ${selection} cabinet touch-up retains its selection and never enters research`,async()=>{
  const {result,searches,audits,main,touchup}=await run(selection,phase);
  const internal=result.internal as unknown as InternalResult,rules=internal.costBookSnapshot.rules,trail=internal.scopePricing;
  assert.equal(searches,0,'selection and approved minor-work coverage must be reconciled before research');
  assert.ok(audits>=1,'the independent coverage audit still runs');
  if(phase==='repair')assert.equal(audits,2,'the changed ledger receives its own independent audit');
  const retained=trail.tasks.find(task=>task.id===touchup.id);
  assert.ok(retained,'excluded or unresolved task evidence remains in the internal record');
  assert.equal(retained.description,touchup.description);assert.equal(retained.evidence,touchup.evidence);
  assert.equal(rules.filter(rule=>rule.evidence.reference.includes('PB-12-32-01')).length,1,'main cabinetry remains priced exactly once');
  assert.ok(!rules.some(rule=>rule.evidence.reference.includes('PB-12-39-02')),'localized or unselected work cannot carry a full professional spray charge');
  if(selection==='selected'){
   assert.ok(result.customer.range,JSON.stringify(trail.issues));
   const pools=rules.filter(rule=>rule.id==='minor-work-allowance');assert.equal(pools.length,1);
   assert.ok(pools[0].unitCost>0);assert.equal(pools[0].evidence.basis,'owner-budget-allowance');
   assert.ok(pools[0].minorWorkCoverage?.some(item=>item.taskId===touchup.id));
   assert.ok(retained.existingLineIds.includes(pools[0].id),'selected touch-up has explicit positive coverage');
  }else{
   assert.ok(!rules.some(rule=>rule.id==='minor-work-allowance'||rule.scopeTaskId===touchup.id),'nonbillable touch-up is not charged');
   if(selection==='unselected')assert.ok(result.customer.range,JSON.stringify(trail.issues));
   else{
    assert.equal(result.customer.range,null,'a selection conflict never becomes a completed estimate');
    assert.ok(trail.issues.some((issue:string)=>issue.includes('alternative selection is ambiguous or conflicting')));
   }
  }
  assert.ok(trail.tasks.some(task=>task.id===main.id),'required main work remains in the complete task record');
 });
}

test('saved inventory, shortlist and mapping replay while a different audit ledger requires a fresh stage',async()=>{
 const cache=new Map<string,PricingReply>();
 const first=await run('selected','initial',cache);
 assert.equal(first.searches,0);assert.ok(first.result.customer.range);
 const stable=first.calls.filter(call=>call.stage!=='audit');
 const firstAudit=first.calls.find(call=>call.stage==='audit')!;
 // A saved audit for a different professional-spray ledger cannot answer the
 // new owner-budget coverage question, even with the same scope and task IDs.
 const oldAudit=structuredClone(firstAudit.input);
 oldAudit.currentPricing={...oldAudit.currentPricing,lines:[{id:'old-spray',description:bookRates[1].description,quantity:10,unitCost:bookRates[1].amount}]};
 const oldAuditKey=key(firstAudit.instructions,oldAudit,false);
 assert.notEqual(oldAuditKey,firstAudit.key);
 cache.set(oldAuditKey,{value:{coveredTaskIds:[],issues:['This audit covers the prior full-spray ledger.'],notes:[],resolvedIssues:[]},sourceUrls:[]});
 for(const call of first.calls.filter(call=>call.stage==='audit'))cache.delete(call.key);
 const second=await run('selected','initial',cache);
 assert.deepEqual(second.calls.filter(call=>call.stage!=='audit').map(call=>({stage:call.stage,key:call.key,input:call.input})),stable.map(call=>({stage:call.stage,key:call.key,input:call.input})));
 assert.ok(second.calls.filter(call=>call.stage!=='audit').every(call=>call.replayed));
 assert.equal(first.shortlists,1);assert.equal(second.shortlists,0);
 assert.equal(second.shortlistKey,first.shortlistKey,'the complete shortlist request retains the same identity');
 assert.equal(second.mappings,0,'unchanged saved mapping requires no additional stage response');
 assert.equal(second.audits,1,'the current corrected audit is the only missing stage');
 assert.equal(second.calls.find(call=>call.stage==='audit')?.replayed,false);
 assert.ok(cache.has(oldAuditKey),'the different saved audit is retained, never relabeled as current coverage');
 assert.deepEqual(second.result.customer.range,first.result.customer.range);
});
