import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {priceCompleteScope,type PricingRequest,type PricingReply} from '../lib/p5/scopePricing.ts';
import {QaPaidHold} from '../lib/p5/qaPaid.ts';
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from '../lib/p5/costBook.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

for(const corrected of [false,true])test('split tall-cabinet proposals are rejected after mapping and revalidated after remap: '+corrected,async()=>{
 const now=new Date('2026-10-06T12:00:00Z'),stamp=now.toISOString();
 const scope:ReviewedScope={text:'Supply and install 8 LF base cabinets and 3 LF of tall pantry cabinets. Exclude all other work.',answers:{service:'change-order',location:'Boise',cabinetBaseLf:'8',cabinetTallLf:'3',exclusions:'All other work'},extraction:null,uploads:[],reviewedAt:stamp,corrections:[]};
 const rates=priceBookRates(scope.answers);
 const configuration:EstimatorConfiguration={...EMPTY_CONFIGURATION,costBooks:[{service:'change-order',mode:'owner-planning',rules:[],coverage:[],assumptions:[],exclusions:[],verifiedScope:'Synthetic split-cabinet replay',reviewedAt:stamp}],planningCatalog:{version:'synthetic-split-cabinet-replay',source:'Public master book',authorizedBy:'Synthetic test',importedAt:stamp,rates}};
 const codes=['PB-12-32-04-M','PB-12-32-04-L'];
 const pantry={id:'pantry',description:'Supply and install 3 LF of tall pantry cabinets.',evidence:'3 LF of tall pantry cabinets.',existingLineIds:[] as string[],additions:codes.map(code=>({code,quantity:3,quantityEvidence:'Modeled as 3 cabinet units at 1 LF each = 3 EA.',quantityRange:{low:3,high:3}})),researchDescription:'',issues:[] as string[]};
 const base={...pantry,id:'base',description:'Supply and install 8 LF base cabinets.',evidence:'8 LF base cabinets.',additions:[{code:'PB-12-32-01',quantity:8,quantityEvidence:'8 LF base cabinets explicitly requested.',quantityRange:{low:8,high:8}}]};
 const raw={tasks:[base,pantry],issues:[]},untouched=structuredClone(raw);
 const calls={inventory:0,mapping:0,remap:0,research:0,audit:0,network:0};
 const stop=new QaPaidHold('synthetic-revalidation-boundary');
 const request:PricingRequest=async(_instructions,value,search)=>{
  const input=value as {taskBatch?:typeof raw.tasks;remainingComponents?:{id:string;rejectedCodes:string[]}[];catalog?:typeof rates;priorMappedTasks?:typeof raw.tasks;priorPricingIssues?:string[];additionalRules?:{scopeTaskId?:string;quantity:{fixed?:number};unit:string;unitCost:number;allowance?:boolean}[]};
  if(search){calls.research++;assert.equal(corrected,false,'valid width allowances use approved costs');assert.equal(calls.remap,1);throw stop;}
  if(input.remainingComponents){
   calls.remap++;assert.equal(calls.mapping,1,'normalize only after the ordinary mapping has completed');
   assert.deepEqual(input.remainingComponents,[{id:'pantry',request:input.remainingComponents[0].request,rejectedCodes:codes}]);
   assert.deepEqual(input.taskBatch?.map(task=>task.id),['pantry']);assert.deepEqual(input.catalog,rates);
   assert.deepEqual(input.priorMappedTasks?.map(task=>task.additions),[base.additions],'valid base pricing is retained');
   const replacement=structuredClone(pantry);
   if(corrected)replacement.additions=replacement.additions.map(addition=>({...addition,quantity:2,quantityEvidence:'ALLOWANCE: 3 LF tall pantry run / assumed 18-inch-wide cabinet = 2 EA; confirm count and widths before ordering.',quantityRange:{low:1,high:3}}));
   return {value:{tasks:[replacement],issues:[]},sourceUrls:[]};
  }
  if('priorPricingIssues' in input){
   calls.audit++;assert.equal(corrected,true,'repeated unsupported EA proposals cannot reach verification as priced work');
   assert.equal(calls.remap,1);const accepted=input.additionalRules?.filter(rule=>rule.scopeTaskId==='pantry')||[];
   assert.equal(accepted.length,2);assert.deepEqual(accepted.map(rule=>rule.quantity.fixed),[2,2]);
   assert.ok(accepted.every(rule=>/^(?:EA|each)$/i.test(rule.unit)&&rule.allowance));
   assert.deepEqual(accepted.map(rule=>rule.unitCost),codes.map(code=>rates.find(rate=>rate.code===code)!.amount),'approved material and labor costs are unchanged');
   throw stop;
  }
  if(input.taskBatch){calls.mapping++;return {value:structuredClone(raw),sourceUrls:[]};}
  calls.inventory++;return {value:{tasks:raw.tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
 };
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{calls.network++;throw Error('Offline replay only');};
 try{await assert.rejects(priceCompleteScope(scope,configuration,request,now,Date.now()+30_000,undefined,0,undefined,async()=>new Map(raw.tasks.map(task=>[task.id,task.additions.map(addition=>addition.code)]))),error=>error===stop);}
 finally{globalThis.fetch=oldFetch;}
 assert.deepEqual(calls,{inventory:1,mapping:1,remap:1,research:corrected?0:1,audit:corrected?1:0,network:0});
 assert.deepEqual(raw,untouched,'retained raw proposals remain inspection evidence, not a final price');
});

// Deliberately small synthetic records, not copied provider receipts or a
// production policy. Stop at the new request: there is no invented repair or
// audit answer with which this test could claim completed pricing.
test('saved component proposals reach one focused full-book remap before an expired repair clock',async()=>{
 const now=new Date(),stamp=now.toISOString();
 const scope:ReviewedScope={text:'Replace 8 LF base cabinets and 4 LF tall pantry cabinets. Retain the existing countertop and appliances; temporarily remove and reinstall them. No new countertop.',answers:{service:'change-order',location:'Boise',cabinetBaseLf:'8',cabinetTallLf:'4',countertopSqft:'24',exclusions:'New countertop'},extraction:null,uploads:[],reviewedAt:stamp,corrections:[]};
 const rates=priceBookRates(scope.answers);
 const configuration:EstimatorConfiguration={...EMPTY_CONFIGURATION,costBooks:[{service:'change-order',mode:'owner-planning',rules:[],coverage:[],assumptions:[],exclusions:[],verifiedScope:'Synthetic component replay only',reviewedAt:stamp}],planningCatalog:{version:'synthetic-component-replay',source:'Canonical public master book',authorizedBy:'Synthetic test only',importedAt:stamp,rates}};
 const task=(id:string,description:string,code:string,quantity:number,quantityEvidence:string,quantityRange:{low:number;high:number}|null=null)=>({id,description,evidence:description,existingLineIds:[] as string[],additions:[{code,quantity,quantityEvidence,quantityRange}],researchDescription:'',issues:[] as string[]});
 const tasks=[
  task('base','Replace 8 LF base cabinets.','PB-12-32-01',8,'8 LF base cabinets explicitly requested.'),
  task('pantry','Replace 4 LF tall pantry cabinets.','PB-12-32-04',4,'Modeled as 4 cabinet units at 1 LF each = 4 EA.',{low:4,high:4}),
  task('counter','Temporarily remove and reinstall the existing countertop.','PB-02-41-07',24,'ALLOWANCE: 24 SF copied to 24 LF without a depth conversion.',{low:22,high:26}),
  task('appliances','Temporarily remove and reinstall existing appliances.','PB-02-41-23',1,'ALLOWANCE: one appliance temporarily moved and reinstalled; count to confirm.',{low:1,high:2}),
 ];
 const saved:Record<string,PricingReply>={
  inventory:{value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]},
  mapping:{value:{tasks:[...tasks,tasks[0]],issues:[]},sourceUrls:[]},
  format:{value:{tasks,issues:[]},sourceUrls:[]},
 };
 const savedShortlist=tasks.map(item=>[item.id,item.additions.map(addition=>addition.code)] as [string,string[]]);
 const expiredClock={startedAt:Date.now()-3_600_000,busyWaitMs:0};
 const untouched=structuredClone({saved,savedShortlist,expiredClock});
 const calls={inventory:0,mapping:0,format:0,shortlist:0,remap:0,audit:0,repairClock:0,network:0};
 const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const initialKeys:string[]=[],remapKeys:string[]=[];
 const hold=new QaPaidHold('synthetic-remap-has-no-saved-reply');
 const request:PricingRequest=async(instructions,value,search)=>{
  assert.equal(search,false,'a compatible full-book attempt must precede web research');
  const input=value as {taskBatch?:typeof tasks;formatRepair?:{errors:{message:string}[]};remainingComponents?:{id:string;rejectedCodes:string[]}[];catalog?:typeof rates;priorMappedTasks?:typeof tasks;priorPricingIssues?:unknown};
  if(input.remainingComponents){
   calls.remap++;remapKeys.push(digest([instructions,input,search]));
   assert.deepEqual(input.taskBatch?.map(item=>item.id),['pantry','counter','appliances']);
   assert.deepEqual(input.remainingComponents.map(({id,rejectedCodes})=>({id,rejectedCodes})),[
    {id:'pantry',rejectedCodes:['PB-12-32-04']},{id:'counter',rejectedCodes:['PB-02-41-07']},{id:'appliances',rejectedCodes:['PB-02-41-23']},
   ]);
   assert.deepEqual(input.catalog,rates,'the remap sees every canonical rate');
   assert.equal(input.priorMappedTasks?.length,1);
   assert.deepEqual(input.priorMappedTasks?.[0].additions,tasks[0].additions,'unaffected priced work survives');
   assert.deepEqual(input.priorMappedTasks?.[0].existingLineIds,tasks[0].existingLineIds);
   throw hold;
  }
  if('priorPricingIssues' in input){calls.audit++;throw new QaPaidHold('unexpected-audit-before-component-repair');}
  if(input.taskBatch){
   if(input.formatRepair){calls.format++;assert.ok(input.formatRepair.errors.some(error=>error.message.includes('Incomplete mapping batch')));return structuredClone(saved.format);}
   calls.mapping++;initialKeys.push(digest([instructions,input,search]));return structuredClone(saved.mapping);
  }
  calls.inventory++;return structuredClone(saved.inventory);
 };
 const oldFetch=globalThis.fetch,oldShortlist=process.env.P5_BOOK_SHORTLIST_TEST;
 process.env.P5_BOOK_SHORTLIST_TEST='1';
 globalThis.fetch=async()=>{calls.network++;throw new Error('No network in saved-stage replay');};
 try{
  for(let resume=0;resume<2;resume++)await assert.rejects(priceCompleteScope(scope,configuration,request,now,Date.now()+30_000,undefined,0,async()=>{calls.repairClock++;return expiredClock;},async()=>{calls.shortlist++;return new Map(structuredClone(savedShortlist));}),error=>error===hold,'pricing must pause at the genuinely new remap, without fabricating a completion');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldShortlist===undefined)delete process.env.P5_BOOK_SHORTLIST_TEST;else process.env.P5_BOOK_SHORTLIST_TEST=oldShortlist;
 }
 assert.deepEqual(calls,{inventory:2,mapping:2,format:2,shortlist:2,remap:2,audit:0,repairClock:0,network:0});
 assert.deepEqual({saved,savedShortlist,expiredClock},untouched,'resumes never mutate their saved earlier work or renew the late clock');
 assert.equal(initialKeys[0],initialKeys[1]);assert.equal(remapKeys[0],remapKeys[1]);
 assert.notEqual(remapKeys[0],initialKeys[0],'new component work has a different request identity');
});
