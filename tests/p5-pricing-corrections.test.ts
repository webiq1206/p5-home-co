import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPricingCorrections,type CorrectionInput} from '../lib/p5/pricingCorrections.ts';
import {PRICE_BOOK} from '../lib/p5/priceBookData.ts';
import {priceBookRate} from '../lib/p5/priceBook.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
import type {CostRule} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

// Real book lines, priced the way the estimator prices them, so the corrections are tested against
// the exact description text the mapping step produces (live defects 2026-09-25).
const now=new Date('2026-09-25T12:00:00.000Z');
const rate=(code:string,remodel=false)=>{const row=PRICE_BOOK.find(r=>r[0]===code);if(!row)throw new Error(`missing ${code}`);return priceBookRate(row,'mid',remodel);};
let n=0;
const rule=(taskId:string,taskText:string,code:string,quantity:number,extra:Partial<CostRule>={}):CostRule=>{
  const r=rate(code,extra.building!==undefined);n++;
  return {scopeTaskId:taskId,id:`scope-${n}`,description:`${taskText}: ${r.description}`,unit:r.unit==='HR'?'hour':r.unit,quantity:{fixed:quantity,factor:1},unitCost:r.amount,category:r.type==='Material'?'materials':r.type==='Labor'?'field-labor':'subcontractors',priceBasis:'direct-cost',estimatingBasis:r.basis,evidence:{basis:'owner-estimating-schedule',reference:r.code,verifiedAt:now.toISOString(),validUntil:now.toISOString()},...extra} as CostRule;
};
const configuration=EMPTY_CONFIGURATION;
const scopeFor=(text:string,answers:ReviewedScope['answers']):ReviewedScope=>({text,answers,extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]});
const inputFor=(scope:ReviewedScope,tasks:{id:string;description:string;origin?:string}[],rules:CostRule[],extra:Partial<CorrectionInput>={}):CorrectionInput=>({
  scope,inventoryTasks:tasks,mappingTasks:tasks.map(t=>({id:t.id,description:t.description,existingLineIds:[]})),lines:[],
  resolution:{rules,assumptions:[],issues:[]},pricingExtraction:null,configuration,now,...extra});
const direct=(r:CostRule)=>r.unitCost*(r.quantity.fixed||0);

test('a whole-unit assembly is priced once and covers its own component lines; site work and permits stay',()=>{
  const scope=scopeFor('Build a complete detached 600 square foot ADU.',{service:'adu',sqft:'600',finish:'mid-range'});
  const tasks=[{id:'adu',description:'Construct one detached 600 sq ft ADU, complete',origin:'requested'},{id:'slab',description:'Construct the slab-on-grade foundation',origin:'required'},{id:'frame',description:'Frame the ADU',origin:'required'},{id:'kitchen',description:'Provide a complete kitchen',origin:'required'},{id:'sewer',description:'Extend the sewer 20 feet',origin:'required'},{id:'permit',description:'Obtain the building permit',origin:'required'},{id:'debris',description:'Haul construction debris',origin:'required'},{id:'roof',description:'Install the complete roofing assembly',origin:'required'},{id:'power',description:'Extend electrical service 20 feet with trenching',origin:'required'}];
  const rules=[rule('adu','Construct one detached 600 sq ft ADU, complete','90-50-10',1),rule('slab','Construct the slab-on-grade foundation','90-50-10',1),rule('frame','Frame the ADU','90-50-10',1),rule('frame','Frame the ADU','06-10-01',600),rule('kitchen','Provide a complete kitchen','90-20-01',1),rule('sewer','Extend the sewer 20 feet','22-13-01',20),rule('permit','Obtain the building permit','00-20-01',1),rule('debris','Haul construction debris','90-50-10',1)];
  const input=inputFor(scope,tasks,rules);
  const before=rules.reduce((t,r)=>t+direct(r),0);
  const result=applyPricingCorrections(input);
  const kept=input.resolution.rules;
  assert.equal(kept.filter(r=>/ADU, new detached/.test(r.description)).length,1,'the ADU assembly is priced once');
  assert.ok(!kept.some(r=>/Kitchen remodel, complete/.test(r.description)),'a room assembly inside the unit is removed');
  assert.ok(!kept.some(r=>r.scopeTaskId==='frame'),'framing components are covered by the assembly');
  assert.ok(kept.some(r=>r.scopeTaskId==='sewer'),'utility work outside the unit stays');
  assert.ok(kept.some(r=>r.scopeTaskId==='permit'),'permits stay');
  const after=kept.reduce((t,r)=>t+direct(r),0);
  assert.ok(after<before/3,`the total drops from ${before} to ${after}`);
  for(const id of ['slab','frame','kitchen','debris','roof'])assert.ok(result.coveredTaskIds.includes(id),`${id} is covered`);
  assert.ok(!result.coveredTaskIds.includes('power'),'an unpriced utility extension is outside the unit and stays an open item');
  assert.ok(input.mappingTasks.find(t=>t.id==='frame')!.existingLineIds.includes(kept.find(r=>r.scopeTaskId==='adu')!.id),'a covered task references the assembly line');
  assert.ok(input.resolution.assumptions.some(a=>/priced once/.test(a))&&input.resolution.assumptions.some(a=>/complete assembly/.test(a)));
});
test('a single kitchen assembly and its separately requested appliance allowance are left alone',()=>{
  const scope=scopeFor('Complete kitchen remodel with new appliances.',{service:'kitchen',finish:'mid-range'});
  const tasks=[{id:'k',description:'Complete kitchen remodel',origin:'requested'},{id:'a',description:'Appliance package',origin:'requested'}];
  const rules=[rule('k','Complete kitchen remodel','90-20-01',1,{building:'Main house'}),rule('a','Appliance package','11-31-01',1,{building:'Main house'})];
  const input=inputFor(scope,tasks,rules);
  applyPricingCorrections(input);
  assert.equal(input.resolution.rules.length,2);
});
test('invented building labels are dropped for a one-building project and kept when the customer named two',()=>{
  const scope=scopeFor('Two bathrooms in a Boise home.',{service:'bathroom',finish:'mid-range'});
  const tasks=[{id:'t1',description:'Tile shower one',origin:'requested'},{id:'t2',description:'Tile shower two',origin:'requested'}];
  const one=inputFor(scope,tasks,[rule('t1','Tile shower one','09-30-01',90,{building:'Boise home'}),rule('t2','Tile shower two','09-30-01',90,{building:'Main home'})]);
  applyPricingCorrections(one);
  assert.ok(one.resolution.rules.every(r=>!r.building),'labels removed');
  assert.ok(one.resolution.assumptions.some(a=>/one building/.test(a)));
  const two=inputFor(scope,tasks,[rule('t1','Tile shower one','09-30-01',90,{building:'Main house'}),rule('t2','Tile shower two','09-30-01',90,{building:'ADU'})],{pricingExtraction:{summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:['Main house','ADU'],floors:[],separateBuildings:true,laborOnly:false,materialsOnly:false,questions:[]}} as any});
  applyPricingCorrections(two);
  assert.deepEqual(two.resolution.rules.map(r=>r.building),['Main house','ADU']);
});
test('a debris line is removed when every removal line already includes haul-off, and kept otherwise',()=>{
  const scope=scopeFor('Replace both showers.',{service:'bathroom',finish:'mid-range'});
  const tasks=[{id:'demo',description:'Remove the two existing showers',origin:'required'},{id:'debris',description:'Collect, haul away and dispose of demolition debris',origin:'required'},{id:'tile',description:'Tile the showers',origin:'requested'}];
  const withHaul=inputFor(scope,tasks,[rule('demo','Remove the two existing showers','02-41-04',2),rule('debris','Collect, haul away and dispose of demolition debris','01-74-13',1),rule('tile','Tile the showers','09-30-01',180)]);
  applyPricingCorrections(withHaul);
  assert.ok(!withHaul.resolution.rules.some(r=>r.scopeTaskId==='debris'),'the junk-removal truckload is gone');
  assert.ok(withHaul.resolution.assumptions.some(a=>/not charged twice/.test(a)));
  const laborOnlyRemoval=inputFor(scope,tasks,[rule('demo','Remove the two existing showers','06-01-01',8),rule('debris','Collect, haul away and dispose of demolition debris','01-74-13',1),rule('tile','Tile the showers','09-30-01',180)]);
  applyPricingCorrections(laborOnlyRemoval);
  assert.ok(laborOnlyRemoval.resolution.rules.some(r=>r.scopeTaskId==='debris'),'a labor-only removal still needs its haul-off');
});
test('reconnecting existing plumbing replaces a rough-in-plus-finish package with a plumber-hour allowance',()=>{
  const scope=scopeFor('Replace the shower and reconnect the existing plumbing.',{service:'bathroom',finish:'mid-range',plumbing:'Reconnect existing plumbing for new showers'});
  const tasks=[{id:'p',description:'Reconnect the existing plumbing for both showers',origin:'required'}];
  const input=inputFor(scope,tasks,[rule('p','Reconnect the existing plumbing for both showers','22-10-02',2)]);
  input.mappingTasks[0].existingLineIds=[input.resolution.rules[0].id];
  applyPricingCorrections(input);
  const replaced=input.resolution.rules[0];
  assert.match(replaced.description,/Licensed plumber/);
  assert.equal(replaced.unit,'hour');assert.equal(replaced.quantity.fixed,4);assert.equal(replaced.allowance,true);
  assert.deepEqual(input.mappingTasks[0].existingLineIds,[replaced.id]);
  assert.ok(direct(replaced)<rate('22-10-02').amount*2/3,'reconnection costs a fraction of two rough-ins');
  const relocated=inputFor(scopeFor('Move the shower drain and reconnect to the existing stack.',{service:'bathroom',finish:'mid-range'}),tasks,[rule('p','Reconnect the existing plumbing for both showers','22-10-02',2)]);
  applyPricingCorrections(relocated);
  assert.match(relocated.resolution.rules[0].description,/rough \+ finish/,'a relocation keeps the rough-in package');
});
test('whole-house protection on a one-room job is scaled to a share of the priced work; a proportionate line is untouched',()=>{
  const scope=scopeFor('Supply and install 200 SF of LVP in one bedroom.',{service:'handyman',flooringSqft:'200'});
  const tasks=[{id:'lvp',description:'Supply and install 200 SF of LVP',origin:'requested'},{id:'tear',description:'Remove carpet and pad',origin:'required'},{id:'protect',description:'Protect adjacent finishes and the access path',origin:'required'},{id:'clean',description:'Final flooring-work cleanup',origin:'required'}];
  const input=inputFor(scope,tasks,[rule('lvp','Supply and install 200 SF of LVP','09-65-01',200),rule('tear','Remove carpet and pad','02-41-08',200),rule('protect','Protect adjacent finishes and the access path','01-50-04',1),rule('clean','Final flooring-work cleanup','01-74-05',200)]);
  const core=direct(input.resolution.rules[0])+direct(input.resolution.rules[1]);
  applyPricingCorrections(input);
  const protection=input.resolution.rules.find(r=>r.scopeTaskId==='protect')!;
  assert.ok(direct(protection)<=core*0.15+0.01,`protection ${direct(protection)} is within 15% of ${core}`);
  assert.equal(protection.allowance,true);
  const clean=input.resolution.rules.find(r=>r.scopeTaskId==='clean')!;
  assert.equal(clean.unitCost,rate('01-74-05').amount,'a small final-clean line keeps its book price');
  assert.ok(input.resolution.assumptions.some(a=>/allowance of about 15%/.test(a)));
});
test('nothing changes on an ordinary estimate with no assemblies, one building and sized supporting work',()=>{
  const scope=scopeFor('Install 100 LF of baseboard.',{service:'handyman',trimLf:'100'});
  const tasks=[{id:'b',description:'Install 100 LF of baseboard',origin:'requested'},{id:'c',description:'Contractor supplies nails and caulk',origin:'requested'}];
  const rules=[rule('b','Install 100 LF of baseboard','06-20-26',100),rule('c','Contractor supplies nails and caulk','06-20-27',100)];
  const snapshot=JSON.stringify(rules);
  const input=inputFor(scope,tasks,rules);
  const result=applyPricingCorrections(input);
  assert.equal(JSON.stringify(input.resolution.rules),snapshot);
  assert.deepEqual(result.notes,[]);
});
test('an unpriced protection, cleanup or debris task on a small job is absorbed into the requested work, not a hold (live Handyman trim-only, 2026-09-25)',()=>{
  const scope=scopeFor('Only price the trim: 300 LF of MDF baseboard and casing for 8 doors.',{service:'handyman',trimLf:'300'});
  const tasks=[{id:'base',description:'Supply and install 300 LF of MDF baseboard',origin:'requested'},{id:'protect',description:'Protect adjacent completed basement surfaces during the trim installation',origin:'required'},{id:'debris',description:'Remove MDF cutoffs and packaging debris',origin:'required'},{id:'clean',description:'Final cleanup of the work area',origin:'required'}];
  const input=inputFor(scope,tasks,[rule('base','Supply and install 300 LF of MDF baseboard','06-20-26',300),rule('debris','Remove MDF cutoffs and packaging debris','01-74-13',1)]);
  const result=applyPricingCorrections(input);
  assert.ok(result.coveredTaskIds.includes('protect')&&result.coveredTaskIds.includes('clean'),'unpriced supporting tasks are covered');
  assert.ok(input.mappingTasks.find(t=>t.id==='protect')!.existingLineIds.includes(input.resolution.rules[0].id),'covered by the requested line');
  const debris=input.resolution.rules.find(r=>r.scopeTaskId==='debris')!;
  assert.ok(direct(debris)<=direct(input.resolution.rules[0])*0.15+0.01,'a full truckload for cutoffs is capped');
  assert.ok(input.resolution.assumptions.some(a=>/included within the installation labor/.test(a)));
});
