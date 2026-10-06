import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution,normalizeRetainedComponentMapping} from '../lib/p5/scopePricing.ts';
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from '../lib/p5/costBook.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const now=new Date('2026-10-06T12:00:00Z');
const scope:ReviewedScope={text:'Replace the cabinets. Retain the existing countertop and appliances; temporarily remove and reinstall them as needed.',answers:{service:'change-order',location:'Boise',cabinetBaseLf:'10',countertopSqft:'21.25'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]};
const configuration:EstimatorConfiguration={...EMPTY_CONFIGURATION,planningCatalog:{version:'synthetic-retained-work',source:'Public master book',authorizedBy:'Synthetic test',importedAt:now.toISOString(),rates:priceBookRates(scope.answers)}};
const task=(kind:'countertop'|'appliances',code:string,quantity:number)=>({id:kind,description:`Temporarily remove and reinstall existing ${kind} for cabinet replacement.`,evidence:'Existing components are retained.',existingLineIds:[] as string[],additions:[{code,quantity,quantityEvidence:kind==='countertop'?'ALLOWANCE: 21.25 SF / (25 in / 12 in per foot) = 10.2 LF; range 9.5–11 LF.':'ALLOWANCE: two appliances, range 2–3, temporarily moved and reinstalled.',quantityRange:kind==='countertop'?{low:9.5,high:11}:{low:2,high:3}}],researchDescription:'',issues:[] as string[]});
const mapping=(tasks:ReturnType<typeof task>[])=>({tasks,notes:[] as string[],issues:[] as string[],replacements:[],removeExclusions:[]});

for(const [kind,code,quantity] of [['countertop','PB-02-41-07',10.2],['appliances','PB-02-41-23',2]] as const)test('retained '+kind+' cannot be covered by permanent haul-off',()=>{
 const item=task(kind,code,quantity),input=mapping([item]);
 const result=catalogResolution(input,configuration,[],now,scope);
 assert.equal(result.rules.length,0,'the disposal package is incompatible even when its unit conversion is valid');
 assert.equal(item.additions.length,0);
 assert.match(item.researchDescription,/reinstall/i);
 assert.match(item.researchDescription,/hour|labor/i);
 assert.match(item.researchDescription,/disposal|haul-off/i);
});

test('explicit permanent removal and disposal keeps its approved package',()=>{
 const item=task('appliances','PB-02-41-23',2);item.description='Remove and dispose of two old appliances.';item.evidence='Two appliances for removal and haul-off; no reinstallation.';
 const permanent={...scope,text:'Remove and dispose of two old appliances. No reinstallation.',answers:{service:'change-order',location:'Boise'}};
 const result=catalogResolution(mapping([item]),configuration,[],now,permanent);
 assert.equal(result.rules.length,1);assert.equal(result.rules[0].quantity.fixed,2);
 assert.equal(item.researchDescription,'');
});

test('compatible retained-work labor survives beside an incompatible disposal proposal',()=>{
 const item=task('countertop','PB-02-41-07',10.2);
 item.additions.push({code:'PB-12-01-01',quantity:4,quantityEvidence:'ALLOWANCE: 4 cabinet-installer labor hours to support, remove, protect and reinstall the retained countertop; 3–6 hours pending site review.',quantityRange:{low:3,high:6}});
 const result=catalogResolution(mapping([item]),configuration,[],now,scope);
 assert.equal(item.additions.length,1);assert.equal(item.additions[0].code,'PB-12-01-01');
 assert.equal(result.rules.length,1);assert.equal(result.rules[0].unit,'hour');
 assert.equal(result.rules[0].allowance,true);
});

test('a new countertop supply-and-install task is unaffected by retention of separate appliances',()=>{
 const item=task('countertop','PB-12-36-02',21.25);item.description='Supply and install a new quartz countertop, 21.25 SF.';item.evidence='21.25 SF new countertop';item.additions[0].quantityEvidence='21.25 SF of new quartz countertop';item.additions[0].quantityRange={low:21.25,high:21.25};
 const mixed={...scope,text:'Install a new quartz countertop. Retain and reinstall existing appliances.'};
 const result=catalogResolution(mapping([item]),configuration,[],now,mixed);
 assert.equal(result.rules.length,1);assert.equal(result.rules[0].unit,'SF');
 assert.equal(item.researchDescription,'');
});

test('appliance retention cannot establish countertop retention in the same sentence',()=>{
 const item=task('countertop','PB-02-41-07',10.2);item.description='Temporarily remove countertop for cabinet access';
 const input=mapping([item]),original=structuredClone(input);
 const distinct={...scope,text:'Remove the old countertop for disposal and retain existing appliances for reinstallation.'};
 assert.equal(normalizeRetainedComponentMapping(input,configuration,[],distinct).size,0);
 assert.deepEqual(input,original,'do not invent a retained-countertop responsibility');
});

test('contradictory disposal and reinstallation responsibilities remain held',()=>{
 const item=task('countertop','PB-02-41-07',10.2);
 const conflicting={...scope,text:'Dispose of the old countertop. Retain existing appliances for reinstallation.'};
 assert.throws(()=>catalogResolution(mapping([item]),configuration,[],now,conflicting),/retained-component-scope-conflict/);
});

for(const text of ['Temporarily remove and reinstall existing appliances.','Temporarily remove and reinstall the existing appliances.','Retain and reinstall the existing appliances.','Temporarily remove and reinstall the appliances.'])test('explicit same-component reinstallation excludes disposal: '+text,()=>{
 const item=task('appliances','PB-02-41-23',2);
 const explicit={...scope,text};
 const result=catalogResolution(mapping([item]),configuration,[],now,explicit);
 assert.equal(result.rules.length,0);assert.ok(item.researchDescription);
});

function existingDisposal(owner?:string){
 const rate=configuration.planningCatalog!.rates.find(rate=>rate.code==='PB-02-41-23')!;
 return {id:'old-appliance-charge',scopeTaskId:owner,description:rate.description,unit:'EA',quantity:2,unitCost:rate.amount,category:'subcontractors',evidence:{basis:'owner-estimating-schedule',reference:'PB-02-41-23',verifiedAt:now.toISOString(),validUntil:now.toISOString()}};
}
for(const explicit of [false,true])test('an owned or explicitly replaced disposal reference removes the actual charge: '+explicit,()=>{
 const item=task('appliances','PB-02-41-23',2);item.additions=[];item.existingLineIds=['old-appliance-charge'];
 const input=mapping([item]);
 const prepared={...input,replacements:explicit?[{lineId:'old-appliance-charge',reason:'Replace the old disposal package with retained-component handling.'}]:[]};
 const result=catalogResolution(prepared,configuration,[existingDisposal(explicit?undefined:'appliances')] as Parameters<typeof catalogResolution>[2],now,scope);
 assert.deepEqual(result.removeLineIds,['old-appliance-charge']);
 assert.deepEqual(item.existingLineIds,[]);assert.ok(item.researchDescription);
});

test('a wrong reference with unverified ownership cannot become an orphaned charge',()=>{
 const item=task('appliances','PB-02-41-23',2);item.additions=[];item.existingLineIds=['old-appliance-charge'];
 const input=mapping([item]),original=structuredClone(input);
 assert.throws(()=>catalogResolution(input,configuration,[existingDisposal('different-task')] as Parameters<typeof catalogResolution>[2],now,scope),/retained-component-disposal-ownership-unverified/);
 assert.deepEqual(input,original,'no reference or charge is silently removed');
});

test('one retained-work task rejects disposal for every named component',()=>{
 const item=task('countertop','PB-02-41-07',10.2);
 item.description='Temporarily remove and reinstall countertop and appliances';
 item.additions.push(task('appliances','PB-02-41-23',2).additions[0]);
 const result=catalogResolution(mapping([item]),configuration,[],now,scope);
 assert.deepEqual(result.rules,[]);assert.deepEqual(item.additions,[]);
 assert.match(item.researchDescription,/countertop and appliances/);
});

test('one retained-work task removes owned existing disposal charges for both families',()=>{
 const item=task('countertop','PB-02-41-07',10.2);item.description='Temporarily remove and reinstall countertop and appliances';item.additions=[];
 item.existingLineIds=['old-countertop-charge','old-appliance-charge'];
 const countertop={...existingDisposal(item.id),id:'old-countertop-charge',description:configuration.planningCatalog!.rates.find(rate=>rate.code==='PB-02-41-07')!.description,unit:'LF',quantity:10};
 const result=catalogResolution(mapping([item]),configuration,[countertop,existingDisposal(item.id)] as Parameters<typeof catalogResolution>[2],now,scope);
 assert.deepEqual(result.removeLineIds,['old-countertop-charge','old-appliance-charge']);assert.deepEqual(item.existingLineIds,[]);
});
