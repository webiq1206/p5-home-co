import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {priceDetailedScope,requestPricingAudit} from '../lib/p5/scopePricing.ts';
import {pricingActivity} from '../lib/p5/processingStatus.ts';
import {auditPricingState} from '../lib/p5/auditPricingState.ts';
import {finalMinorWorkExplanation} from '../lib/p5/finalMinorWorkExplanation.ts';
import {assumptionLedger,stampAdvisoryReview} from '../lib/p5/advisoryProvenance.ts';

const bytes=readFileSync(new URL('./fixtures/p5-main12-saved-failure.json',import.meta.url));
const saved=JSON.parse(bytes.toString());
const rows=saved.find((row:any)=>row.source==='work').evidence;
const job=rows.find((row:any)=>row.payload.input?.kind==='pricing').payload;
const work=rows.find((row:any)=>row.work_key.startsWith('pricing-v11-')).payload;
const ordered=Object.entries(work.requests).sort((a:any,b:any)=>a[1].startedAt.localeCompare(b[1].startedAt));
let auditInput:any;

test('immutable .12 provider replies reproduce the failure offline; the fix does not suppress that audit',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline replay attempted network I/O');});
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'051c39a30392b446a144b2ccddd32f9615ab12fda97b49cbc6bbc557b2fd7afd');
 let index=0;
 await assert.rejects(priceDetailedScope(job.input.draft.reviewed,{...job.input.configuration,regionalRates:work.regionalRates,researchLeads:work.researchLeads},async(instructions,input,search)=>{
  const pair:any=ordered[index++];assert.ok(pair,'no invented saved reply');
  const [key,trace]=pair;
  assert.equal(pricingActivity(instructions,input,search).phase,trace.stage);
  if(trace.stage==='mapping')assert.deepEqual((input as any).taskBatch.map((task:any)=>task.id).sort(),[...trace.taskIds].sort());
  if(trace.stage==='verification')auditInput=structuredClone(input);
  return structuredClone(work.replies[key]);
 },new Date(work.pricingAt),Date.now()+600000,undefined,0,undefined,async()=>new Map(Object.entries(Object.values(work.shortlists)[0] as any))),/remaining prices could not be verified automatically/);
 assert.ok(auditInput);assert.equal(index,14);
 // These are replayed replies, not a fresh provider acceptance result.
 const policy=auditInput.currentPricing.minorWorkPolicy;
 assert.equal(policy.validPool,true);assert.equal(policy.amount,75);assert.equal(policy.positivePrimaryDirectCost,210);
 assert.deepEqual(policy.assignments.map((item:any)=>item.taskId).sort(),['door-lever-removal','installation-consumables']);
 assert.ok(auditInput.tasks.every((task:any)=>!('issues' in task)&&!('costClass' in task)));
 assert.equal(auditInput.historicalContext.taskIssues.length,2);
 for(const issue of auditInput.historicalContext.taskIssues)assert.ok(auditInput.assumptionLedger.some((entry:any)=>entry.text===issue&&entry.origin==='prior-issue'));
});

for(const defect of ['no primary cost','zero budget','over cap','under share','wrong basis','wrong unit','wrong quantity','not allowance','selling price','no task link','wrong task description','hazardous component'])test('policy contract refuses unsupported coverage: '+defect,()=>{
 assert.ok(auditInput);
 const lines=structuredClone(auditInput.additionalRules),tasks=structuredClone(auditInput.tasks);
 const pool=lines.find((line:any)=>line.id==='minor-work-allowance');
 if(defect==='no primary cost')lines[0].unitCost=0;
 if(defect==='zero budget')pool.unitCost=0;
 if(defect==='over cap')pool.unitCost=755;
 if(defect==='under share')lines[0].unitCost=10000;
 if(defect==='wrong basis')pool.evidence.basis='model-proposal';
 if(defect==='wrong unit')pool.unit='EA';
 if(defect==='wrong quantity')pool.quantity.factor=2;
 if(defect==='not allowance')pool.allowance=false;
 if(defect==='selling price')pool.priceBasis='selling-price';
 if(defect==='no task link')tasks[0].existingLineIds=[];
 if(defect==='wrong task description')tasks[0].description+=' and structural repair';
 if(defect==='hazardous component')pool.minorWorkCoverage[0].remainingComponent='Hazardous lead paint disposal';
 const policy=auditPricingState(lines,tasks).minorWorkPolicy;
 assert.ok(!policy.assignments.some(item=>item.taskId===tasks[0].id));
});

test('valid policy contract leaves a genuine audit blocker untouched',async()=>{
 const message='Door-lever-removal includes hazardous disposal outside the supporting-work budget.';
 const reply=await requestPricingAudit(async(instructions,input)=>{
  assert.match(instructions,/concrete scale, scope, hazard, responsibility or overlap defect remains blocking/);
  assert.equal((input as any).currentPricing.minorWorkPolicy.validPool,true);
  return {value:{coveredTaskIds:[],issues:[message],notes:[],resolvedIssues:[]},sourceUrls:[]};
 },{tasks:auditInput.tasks,additionalRules:auditInput.additionalRules,customerAssumptions:[]},()=>10000);
 assert.deepEqual((reply.value as any).issues,[message]);
});

function dispositionFixture(){
 const lines=structuredClone(auditInput.additionalRules);
 const task=structuredClone(auditInput.tasks[0]);
 const issue='A separate hardware-removal catalog price is required.';
 task.issues=[issue];
 const text=`${task.description}: ${issue}`;
 const ledger=assumptionLedger([],[text]);
 const review={assumptions:[{id:ledger[0].id,kind:'superseded-proposal' as const,basis:'policy-assignment' as const,message:'The named incidental operation has a positive owner budget.',taskIds:[task.id],lineIds:['minor-work-allowance'],retiredCodes:[]}],advisories:[],blockers:[]};
 const record=stampAdvisoryReview(ledger,review,lines,[task],[],[]);
 const resolution={rules:lines,issues:[],assumptions:[]};
 const render=()=>finalMinorWorkExplanation(resolution,lines.map((line:any)=>{const {minorWorkCoverage,...priced}=line;return {...priced,quantity:line.quantity.fixed*line.quantity.factor};}),{tasks:[task],advisoryProvenance:[record]});
 return {lines,task,issue,record,render};
}

test('an exact validated audit disposition resolves a historical mapper task issue once',()=>{
 const f=dispositionFixture();
 assert.equal(f.render()!.findings.some(item=>item.original===f.issue),false);
 assert.equal(f.task.issues[0],f.issue,'retain the original diagnostic');
});
for(const change of ['current blocker','missing decision','new warning','changed assignment','changed quantity','changed price'])test('historical task issue remains blocked after '+change,()=>{
 const f=dispositionFixture();
 if(change==='current blocker')f.record.review.assumptions[0].kind='current-blocker';
 if(change==='missing decision')f.record.review.assumptions=[];
 if(change==='new warning')f.task.issues[0]='The quantity is wrong and structural repair is unpriced.';
 if(change==='changed assignment')f.lines[1].minorWorkCoverage[0].remainingComponent='Different supporting work';
 if(change==='changed quantity')f.lines[1].quantity.factor=2;
 if(change==='changed price')f.lines[1].unitCost++;
 assert.ok(f.render()!.findings.some(item=>item.kind==='current-issue'&&item.original===f.task.issues[0]));
});
