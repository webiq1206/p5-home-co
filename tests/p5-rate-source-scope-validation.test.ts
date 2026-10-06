import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution,marketResolution,planningResolution,priceDetailedScope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {QaPaidHold} from '../lib/p5/qaPaid.ts';
import {EMPTY_CONFIGURATION,type CostRule,type EstimatorConfiguration} from '../lib/p5/costBook.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import {reusableUnitRate} from '../lib/p5/unitRates.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const now=new Date('2026-10-06T12:00:00Z'),stamp=now.toISOString();
const scope=(text:string,answers:ReviewedScope['answers']={}):ReviewedScope=>({text,answers:{service:'change-order',location:'Boise',...answers},extraction:null,uploads:[],reviewedAt:stamp,corrections:[]});
// These source records are synthetic test evidence, never fetched or presented
// as real prices. Use the real saved-rate validator to reach the regional path.
function regional(description:string){
 const raw:CostRule={id:'synthetic-source',description,unit:'EA',quantity:{fixed:1,factor:1},unitCost:100,category:'subcontractors',priceBasis:'direct-cost',estimatingBasis:'sourced-market-average',
  unitRateContext:{currency:'USD',basis:'subcontractor-installed',includes:description,excludes:'Unspecified work',assumptions:['Synthetic fixture only']},
  evidence:{basis:'sourced-market-average',reference:'Synthetic observations only',verifiedAt:stamp,validUntil:'2026-10-20T12:00:00Z',provenance:{status:'estimated',location:'Boise',retrievedAt:stamp,assumptions:['Synthetic fixture only'],sources:['https://supplier-one.example/rate','https://supplier-two.example/rate'].map(url=>({url,date:'2026-10-06',dateBasis:'published',region:'Boise, Idaho',low:100,high:100}))}},
 };
 const saved=reusableUnitRate(raw,'Boise',now);assert.ok(saved);return saved;
}
function configuration(original:ReviewedScope,rate:CostRule):EstimatorConfiguration{
 return {...EMPTY_CONFIGURATION,costBooks:[{service:'change-order',rules:[],coverage:[],assumptions:[],exclusions:[],verifiedScope:'Synthetic regional-rate regression',reviewedAt:stamp}],planningCatalog:{version:'synthetic-regional-regression',source:'Canonical public master book',authorizedBy:'Synthetic test only',importedAt:stamp,rates:priceBookRates(original.answers)},regionalRates:[rate]};
}
const task=(id:string,description:string,rate:CostRule,quantity:number,quantityEvidence:string)=>({id,description,evidence:description,existingLineIds:[] as string[],additions:[{code:rate.id,quantity,quantityEvidence,quantityRange:{low:quantity,high:quantity}}],researchDescription:'',issues:[] as string[]});
const mapping=(tasks:ReturnType<typeof task>[])=>({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]});

test('a saved regional appliance-disposal rate reaches a focused remap before it can be priced',async()=>{
 const original=scope('Retain one existing appliance. Temporarily remove and reinstall the appliance. No new appliances.',{exclusions:'New appliances'});
 const rate=regional('Appliance removal (removal labor with haul-off and dump fees)');
 const config=configuration(original,rate),item=task('appliance','Temporarily remove and reinstall one existing appliance.',rate,1,'One retained appliance temporarily handled.');
 const unchanged=structuredClone({original,rate,item});
 const direct=mapping([structuredClone(item)]);
 const proposed=catalogResolution(direct,config,[],now,original);
 assert.deepEqual(proposed.rules,[]);assert.deepEqual(direct.tasks[0].additions,[]);
 assert.match(direct.tasks[0].researchDescription,/reinstall/);
 const calls={inventory:0,mapping:0,remap:0,audit:0,network:0};
 const boundary=new QaPaidHold('synthetic-regional-remap-boundary');
 const request:PricingRequest=async(_instructions,value,search)=>{
  assert.equal(search,false);
  const input=value as {taskBatch?:{id:string}[];remainingComponents?:{id:string;request:string}[];catalog?:unknown;priorPricingIssues?:unknown};
  if(input.remainingComponents){
   calls.remap++;assert.deepEqual(input.taskBatch?.map(entry=>entry.id),[item.id]);
   assert.match(input.remainingComponents[0].request,/retained appliances/);
   assert.deepEqual(input.catalog,config.planningCatalog!.rates);
   throw boundary;
  }
  if('priorPricingIssues' in input){calls.audit++;throw new QaPaidHold('unexpected-audit-before-regional-remap');}
  if(input.taskBatch){calls.mapping++;return {value:mapping([structuredClone(item)]),sourceUrls:[]};}
  calls.inventory++;return {value:{tasks:[{id:item.id,description:item.description,evidence:item.evidence}],issues:[]},sourceUrls:[]};
 };
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async()=>{calls.network++;throw new Error('No network in regional regression');};
 try{
  await assert.rejects(priceDetailedScope(original,config,request,now,Date.now()+30_000,undefined,0,undefined,async()=>new Map()),error=>error===boundary);
 }finally{globalThis.fetch=previousFetch;}
 assert.deepEqual(calls,{inventory:1,mapping:1,remap:1,audit:0,network:0});
 assert.deepEqual({original,rate,item},unchanged,'source scope, saved rate and mapping receipt remain unchanged');
});

test('a regional pantry rate cannot convert an original linear run into a confirmed cabinet count',()=>{
 const original=scope('Supply and install 4 LF of tall pantry cabinets.',{cabinetTallLf:'4'});
 const rate=regional('Tall pantry cabinet, installed');
 const item=task('pantry','Supply and install 4 LF of tall pantry cabinets.',rate,4,'Modeled as four cabinet units at one LF each = 4 EA.');
 const unchanged=structuredClone(original),mapped=mapping([item]);
 const result=catalogResolution(mapped,configuration(original,rate),[],now,original);
 assert.deepEqual(result.rules,[]);assert.deepEqual(item.additions,[]);
 assert.match(item.researchDescription,/LF cannot be copied into confirmed EA/);
 assert.deepEqual(original,unchanged);
});

test('a regional pantry rate preserves an original stated count and its independent length fact',()=>{
 const original=scope('Supply and install two tall pantry cabinets spanning 4 LF.',{cabinetTallLf:'4'});
 const rate=regional('Tall pantry cabinet, installed');
 const item=task('pantry','Supply and install tall pantry cabinets.',rate,2,'Two tall pantry cabinets explicitly requested.');
 const unchanged=structuredClone(original);
 const result=catalogResolution(mapping([item]),configuration(original,rate),[],now,original);
 assert.equal(result.rules.length,1);assert.deepEqual(result.issues,[]);
 assert.equal(result.rules[0].quantity.fixed,2);assert.equal(result.rules[0].unit,'each');
 assert.equal(item.researchDescription,'');assert.deepEqual(original,unchanged);
 assert.equal(original.answers.cabinetTallLf,'4','the EA price never overwrites the source LF fact');
});

type Proposal={description:string;unit:string;quantity:number;quantityEvidence:string;quantityRange:{low:number;high:number};basis:'subcontractor-installed'|'trade-labor';includes:string;excludes:string};
function researched(kind:'market'|'planning',original:ReviewedScope,item:ReturnType<typeof task>,proposal:Proposal){
 const targeted={...item,additions:[],researchDescription:item.description};
 const rate={taskId:item.id,...proposal};
 if(kind==='planning')return planningResolution({rates:[{...rate,low:100,high:100,confidence:'medium',rationale:'Synthetic rate only; not real estimating evidence.'}],issues:[]},[targeted],now,0,'Boise',original);
 const urls=['https://supplier-one.example/research','https://supplier-two.example/research'];
 const sources=urls.map(url=>({url,low:100,high:100,unit:proposal.unit,costBasis:proposal.basis,publishedAt:'2026-10-06',region:'Boise, Idaho',excerpt:'Synthetic test observation: $100 per stated unit.',sourceType:'contractor-rate',dateBasis:'published'}));
 return marketResolution({rates:[{...rate,sources}],issues:[]},urls,[targeted],now,0,'Boise',original);
}

for(const kind of ['market','planning'] as const){
 test(kind+' cannot reintroduce appliance disposal through research inclusions',()=>{
  const original=scope('Retain one existing appliance; temporarily remove and reinstall it.');
  const item=task('appliance','Temporarily remove and reinstall the existing appliance.',regional('Appliance handling'),1,'One retained appliance.');
  const unchanged=structuredClone(original);
  const result=researched(kind,original,item,{description:'Appliance removal',unit:'EA',quantity:1,quantityEvidence:'One existing appliance.',quantityRange:{low:1,high:1},basis:'subcontractor-installed',includes:'haul-off and dump fees',excludes:'Reinstallation'});
  assert.deepEqual(result.rules,[]);assert.ok(result.issues.some(issue=>issue.includes('not permanent disposal')));
  assert.deepEqual(original,unchanged);
 });

 test(kind+' accepts compatible retained-appliance handling and reinstallation labor',()=>{
  const original=scope('Retain one existing plug-in appliance; temporarily remove and reinstall it.');
  const item=task('appliance','Temporarily remove and reinstall the existing appliance.',regional('Appliance handling'),1,'One retained appliance.');
  const unchanged=structuredClone(original);
  const result=researched(kind,original,item,{description:'Retained appliance handling and reinstallation labor',unit:'HR',quantity:2,quantityEvidence:'ALLOWANCE: two labor hours to move, protect and reinstall one plug-in appliance; one to three hours pending site review.',quantityRange:{low:1,high:3},basis:'trade-labor',includes:'Temporary handling and reinstallation labor',excludes:'Permanent disposal and new appliances'});
  assert.deepEqual(result.issues,[]);assert.equal(result.rules.length,1);
  assert.equal(result.rules[0].category,'field-labor');assert.equal(result.rules[0].quantity.fixed,2);
  assert.equal(result.rules[0].allowance,true);assert.deepEqual(original,unchanged);
 });

 test(kind+' rejects pantry LF copied into EA before constructing a price',()=>{
  const original=scope('Supply and install 4 LF of tall pantry cabinets.',{cabinetTallLf:'4'});
  const item=task('pantry','Supply and install tall pantry cabinets.',regional('Tall pantry cabinet'),4,'Four LF copied into four units.');
  const unchanged=structuredClone(original);
  const result=researched(kind,original,item,{description:'Tall pantry cabinet, installed',unit:'EA',quantity:4,quantityEvidence:'Modeled as four units at one LF each.',quantityRange:{low:4,high:4},basis:'subcontractor-installed',includes:'Cabinet supply and installation',excludes:'Other work'});
  assert.deepEqual(result.rules,[]);assert.ok(result.issues.some(issue=>issue.includes('LF cannot be copied into confirmed EA')));
  assert.deepEqual(original,unchanged);
 });

 test(kind+' preserves an original pantry count independently of its linear run',()=>{
  const original=scope('Supply and install two tall pantry cabinets spanning 4 LF.',{cabinetTallLf:'4'});
  const item=task('pantry','Supply and install tall pantry cabinets.',regional('Tall pantry cabinet'),2,'Two cabinets requested.');
  const unchanged=structuredClone(original);
  const result=researched(kind,original,item,{description:'Tall pantry cabinet, installed',unit:'EA',quantity:2,quantityEvidence:'Two tall pantry cabinets explicitly requested.',quantityRange:{low:2,high:2},basis:'subcontractor-installed',includes:'Cabinet supply and installation',excludes:'Other work'});
  assert.deepEqual(result.issues,[]);assert.equal(result.rules.length,1);assert.equal(result.rules[0].quantity.fixed,2);
  assert.equal(result.rules[0].unit,'EA');assert.deepEqual(original,unchanged);
 });
}
