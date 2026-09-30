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

test('one vanity installed package cannot be charged again as installation labor',()=>{
 const tasks=[{id:'supply',description:'Supply one vanity'},{id:'install',description:'Install the vanity'},{id:'tap',description:'Install two faucets'}];
 const rules=[rule('supply',tasks[0].description,'12-41-02',1),rule('install',tasks[1].description,'12-41-02',1),rule('tap',tasks[2].description,'22-41-08',2)];
 const input=inputFor(scopeFor('Replace one 60-inch double-sink bathroom vanity.',{service:'bathroom'}),tasks,rules);
 const result=applyPricingCorrections(input);
 assert.deepEqual(input.resolution.rules.map(r=>r.id),[rules[0].id,rules[2].id]);
 assert.ok(result.coveredTaskIds.includes('install'));
 assert.deepEqual(input.mappingTasks[1].existingLineIds,[rules[0].id]);
 const multiple=inputFor(scopeFor('Replace two bathroom vanities.',{service:'bathroom'}),tasks,rules);
 applyPricingCorrections(multiple);assert.equal(multiple.resolution.rules.length,3);
});
test('a specific cabinet run does not also charge generic installation on the same task',()=>{
 const tasks=[{id:'base',description:'Install 18 LF owner-supplied base cabinets'},{id:'custom',description:'Custom cabinet fitting'}];
 const specific=rule('base',tasks[0].description,'12-32-01',18,{category:'field-labor',evidence:{basis:'owner-estimating-schedule',reference:'PB-12-32-01-L'} as any});
 const generic=rule('base',tasks[0].description,'12-39-06',18);
 const hourly=rule('base',tasks[0].description,'12-01-01',2);
 const separate=rule('custom',tasks[1].description,'12-01-01',3);
 const input=inputFor(scopeFor(tasks[0].description,{}),tasks,[specific,generic,hourly,separate]);
 applyPricingCorrections(input);
 assert.deepEqual(input.resolution.rules.map(r=>r.id),[specific.id,separate.id]);
 assert.ok(input.resolution.assumptions.some(note=>/overlapping generic installation/.test(note)));
});

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

test('new home keeps the separately measured porch, patio and garage outside conditioned living area',()=>{
 const scope=scopeFor('Build 2000 SF home, plus 440 SF garage and 80 SF covered porch.',{service:'new-construction',sqft:'2000',garageSqft:'440',coveredOutdoorSqft:'80'});
 const tasks=[{id:'home',description:'Construct 2000 SF new home'},{id:'garage',description:'Construct 440 SF garage'},{id:'porch',description:'Construct 80 SF covered porch'},{id:'roof',description:'Roofing for house'},{id:'patio',description:'Build separate covered patio roof'}];
 const rules=[rule('home',tasks[0].description,'90-10-01',2000),rule('garage',tasks[1].description,'90-10-03',440),rule('porch',tasks[2].description,'06-15-06',80),rule('roof',tasks[3].description,'07-31-01',2000)];
 const input=inputFor(scope,tasks,rules);
 const result=applyPricingCorrections(input);
 assert.ok(input.resolution.rules.some(r=>r.scopeTaskId==='porch'&&r.quantity.fixed===80));
 assert.ok(input.resolution.rules.some(r=>r.scopeTaskId==='garage'&&r.quantity.fixed===440));
 assert.ok(!input.resolution.rules.some(r=>r.scopeTaskId==='roof'));
 assert.ok(!result.coveredTaskIds.includes('patio'),'unpriced exterior work cannot be marked covered by the house');
 assert.ok(!result.coveredTaskIds.includes('porch'));
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

test('nested assembly consolidation preserves every dependent task reference',()=>{
 const tasks=[{id:'adu',description:'Construct a complete ADU'},{id:'vanity-supply',description:'Supply one bathroom vanity'},{id:'vanity-install',description:'Install bathroom vanity and hardware'}];
 const rules=[rule('adu',tasks[0].description,'90-50-10',1),rule('vanity-supply',tasks[1].description,'12-41-01',1),rule('vanity-install',tasks[2].description,'12-41-01',1)];
 const input=inputFor(scopeFor('Construct one ADU with one bathroom vanity.',{service:'adu',sqft:'600'}),tasks,rules);
 applyPricingCorrections(input);
 const live=new Set(input.resolution.rules.map(r=>r.id));
 assert.deepEqual([...live],[rules[0].id]);
 for(const task of input.mappingTasks.filter(t=>t.id!=='adu')){
  assert.ok(task.existingLineIds.includes(rules[0].id),task.id+' must point to the retained ADU assembly');
  assert.ok(task.existingLineIds.every(id=>live.has(id)),task.id+' cannot reference a removed component');
 }
});


test('explicitly requested cabinet-install cleanup cannot bypass the supporting-work scale guard',()=>{
 const tasks=[{id:'base',description:'Install owner-supplied base cabinets',origin:'requested'},{id:'clean',description:'Perform job cleanup after cabinet installation.',origin:'requested'}];
 const scope=scopeFor('Install 9 LF owner-supplied base cabinets. Contractor supplies job cleanup.',{service:'cabinet-install'});
 const input=inputFor(scope,tasks,[rule('base',tasks[0].description,'12-39-06',9),rule('clean',tasks[1].description,'01-74-04',1)]);
 const core=direct(input.resolution.rules[0]);
 applyPricingCorrections(input);
 assert.ok(direct(input.resolution.rules[1])<=core*0.15+0.01);
 assert.ok(input.resolution.assumptions.some(a=>/allowance of about 15%/.test(a)));
 const standalone=inputFor(scopeFor('Rough construction clean of the whole home.',{service:'handyman'}),[{id:'clean',description:'Rough construction clean of the whole home.',origin:'requested'}],[rule('clean','Rough construction clean of the whole home.','01-74-04',1)]);
 const before=JSON.stringify(standalone.resolution.rules);
 applyPricingCorrections(standalone);
 assert.equal(JSON.stringify(standalone.resolution.rules),before);
 const unpriced=inputFor(scope,tasks,[rule('base',tasks[0].description,'12-39-06',9)]);
 assert.ok(!applyPricingCorrections(unpriced).coveredTaskIds.includes('clean'),'explicitly requested unpriced cleanup is not silently absorbed');
});

test('complete house covers normal protection and final clean while separate porch remains priced',()=>{
 const tasks=[{id:'home',description:'Build complete home'},{id:'porch',description:'Build separate covered porch'},{id:'cleanup',description:'Project-wide protection of adjacent finishes and final cleanup',origin:'required'}];
 const input=inputFor(scopeFor('Build a 2000 SF home and 80 SF covered porch.',{service:'new-construction',sqft:'2000'}),tasks,[rule('home',tasks[0].description,'90-10-01',2000),rule('porch',tasks[1].description,'06-15-06',80),rule('cleanup',tasks[2].description,'01-50-10',2080),rule('cleanup',tasks[2].description,'01-74-05',2000)]);
 const result=applyPricingCorrections(input);
 assert.deepEqual(input.resolution.rules.map(r=>r.scopeTaskId),['home','porch']);
 assert.ok(result.coveredTaskIds.includes('cleanup'));assert.ok(!result.coveredTaskIds.includes('porch'));
});

test('one set of door handles is not charged once for removal and again for replacement',()=>{
 const tasks=[{id:'remove',description:'Remove three existing interior lever handles'},{id:'install',description:'Install three passage lever sets on the same doors'}];
 const rules=[rule('remove',tasks[0].description,'08-71-01',3),rule('install',tasks[1].description,'08-71-01',3)];
 const input=inputFor(scopeFor('Replace three existing interior door lever handles with owner-supplied passage lever sets.',{service:'handyman'}),tasks,rules);
 const result=applyPricingCorrections(input);
 assert.deepEqual(input.resolution.rules.map(r=>r.id),[rules[1].id]);
 assert.deepEqual(input.mappingTasks[0].existingLineIds,[rules[1].id]);
 assert.ok(result.coveredTaskIds.includes('remove'));
 const separate=inputFor(input.scope,tasks,[rules[0],{...rules[1],floor:'Upstairs'}]);
 applyPricingCorrections(separate);assert.equal(separate.resolution.rules.length,2);
});
test('three individually enumerated handle replacements retain three units of labor',()=>{
 const tasks=['first','second','third'].map((ordinal,index)=>({id:'handle-'+index,description:`Remove existing lever handle set from ${ordinal} interior door and install new owner-supplied passage lever handle set, adjust, test operation.`}));
 const rules=tasks.map(task=>rule(task.id,task.description,'08-71-01',1));
 const input=inputFor(scopeFor('Replace three existing interior door lever handles with owner-supplied passage lever sets.',{service:'handyman'}),tasks,rules);
 applyPricingCorrections(input);
 assert.equal(input.resolution.rules.length,3);
 assert.equal(input.resolution.rules.reduce((n,r)=>n+(r.quantity.fixed||0),0),3);
});
test('integrated vanity top/sink references a positive installed package, never a separate faucet',()=>{
 const tasks=[{id:'vanity',description:'Supply and install one 30-inch vanity'},{id:'top',description:'Supply integrated top and sink'},{id:'tap',description:'Install faucet and reconnect plumbing'}];
 const vanity=rule('vanity',tasks[0].description,'12-41-01',1);
 const input=inputFor(scopeFor('Install one 30-inch vanity with integrated top and sink.',{service:'bathroom'}),tasks,[vanity]);
 input.mappingTasks[1].existingLineIds=[vanity.id];input.mappingTasks[2].existingLineIds=[vanity.id];
 const result=applyPricingCorrections(input);
 assert.ok(result.coveredTaskIds.includes('top'));assert.ok(!result.coveredTaskIds.includes('tap'));
 const unsupported=inputFor(input.scope,tasks,[{...vanity,unitCost:0}]);unsupported.mappingTasks[1].existingLineIds=[vanity.id];
 assert.ok(!applyPricingCorrections(unsupported).coveredTaskIds.includes('top'));
});

test('normal connections at provided building stubs are within the complete home; utility extensions remain separate',()=>{
 const tasks=[{id:'house',description:'Build complete 2000 SF house'},{id:'stubs',description:'Connect utilities at building perimeter as required for complete home'},{id:'sewer',description:'Extend sewer 20 LF beyond building perimeter'}];
 const house=rule('house',tasks[0].description,'90-10-01',2000);
 const input=inputFor(scopeFor('Build complete home. Utilities stubbed at building perimeter. Exclude utility extensions.',{service:'new-construction',sqft:'2000'}),tasks,[house]);
 const result=applyPricingCorrections(input);
 assert.ok(result.coveredTaskIds.includes('stubs'));
 assert.ok(!result.coveredTaskIds.includes('sewer'));
 const unknown=inputFor(scopeFor('Build complete home. Utility locations unknown.',{service:'new-construction'}),tasks,[house]);
 assert.ok(!applyPricingCorrections(unknown).coveredTaskIds.includes('stubs'));
});

test('equal handle counts on different doors are not assumed to be one replacement',()=>{
 const tasks=[{id:'remove',description:'Remove three garage door handles'},{id:'install',description:'Install three bedroom door handles'}];
 const input=inputFor(scopeFor('Remove existing garage handles and install bedroom handles.',{service:'handyman'}),tasks,[rule('remove',tasks[0].description,'08-71-01',3),rule('install',tasks[1].description,'08-71-01',3)]);
 applyPricingCorrections(input);assert.equal(input.resolution.rules.length,2);
});

test('whole-house completion cleanup stays covered when its description names garage and porch',()=>{
 const description='Remove all construction debris generated during building of house, garage, and porch, and perform final cleanup at project end.';
 const tasks=[{id:'home',description:'Build complete home'},{id:'porch',description:'Build covered porch'},{id:'clean',description,origin:'required'}];
 const input=inputFor(scopeFor('Build 2000 SF home and 80 SF porch.',{service:'new-construction',sqft:'2000'}),tasks,[rule('home',tasks[0].description,'90-10-01',2000),rule('porch',tasks[1].description,'06-15-06',80),rule('clean',description,'01-74-05',2080)]);
 const result=applyPricingCorrections(input);assert.deepEqual(input.resolution.rules.map(r=>r.scopeTaskId),['home','porch']);assert.ok(result.coveredTaskIds.includes('clean'));
 const external='Final cleanup of driveway and external utility trenching for the house';
 const other=inputFor(input.scope,[tasks[0],{id:'external',description:external}],[rule('home',tasks[0].description,'90-10-01',2000),rule('external',external,'01-74-05',100)]);
 applyPricingCorrections(other);assert.ok(other.resolution.rules.some(r=>r.scopeTaskId==='external'));
});

test('uploaded replacement scope ties same-quantity handle removal and installation together',()=>{
 const text='Replace exactly three existing interior door lever handles with three owner-supplied matching passage lever handle sets.';
 const tasks=[{id:'remove',description:'Remove 3 existing interior door lever handles from ground floor doors.'},{id:'install',description:'Install 3 owner-supplied matching passage lever handle sets on ground floor doors.'}];
 const scope={...scopeFor('Estimate the uploaded document.',{service:'handyman'}),extraction:{summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],sourceText:text}};
 const input=inputFor(scope,tasks,[rule('remove',tasks[0].description,'08-71-01',3),rule('install',tasks[1].description,'08-71-01',3)]);
 applyPricingCorrections(input);assert.equal(input.resolution.rules.length,1);assert.equal(input.resolution.rules[0].quantity.fixed,3);
});
test('retained uploaded plumbing locations cannot acquire new rough-in charges',()=>{
 const tasks=[{id:'plumbing',description:'Disconnect/reconnect and final connections of five replacement fixtures without moving their locations.'}];
 const scope={...scopeFor('Estimate uploaded document.',{service:'whole-home'}),extraction:{summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],sourceText:'Existing plumbing locations remain. Include removal of finishes, minor prep, reconnects and cleanup.'}};
 const input=inputFor(scope,tasks,[rule('plumbing',tasks[0].description,'22-10-02',5)]);applyPricingCorrections(input);
 assert.equal(input.resolution.rules[0].unit,'hour');assert.equal(input.resolution.rules[0].quantity.fixed,10);
});

test('unchanged fixture wording rejects rough-and-finish packages and subtracts already priced installations',()=>{
 const tasks=[{id:'faucet',description:'Supply and install one faucet'},{id:'toilet',description:'Supply and install one toilet'},{id:'reconnect',description:'Normal plumbing reconnections'}];
 const scope=scopeFor('Existing fixture locations stay unchanged. Include normal plumbing reconnections. No new rough-in or relocation.',{service:'bathroom'});
 const input=inputFor(scope,tasks,[rule('faucet',tasks[0].description,'22-42-02',1),rule('toilet',tasks[1].description,'22-42-01',1),rule('reconnect',tasks[2].description,'22-10-02',3)]);
 applyPricingCorrections(input);
 assert.ok(!input.resolution.rules.some(r=>/Plumbing per fixture/.test(r.description)));
 const remaining=input.resolution.rules.find(r=>r.unit==='hour')!;
 assert.equal(remaining.quantity.fixed,2,'only the one remaining connection carries plumber time');
 assert.equal(remaining.allowance,true);assert.deepEqual(remaining.quantityRange,{low:1.5,high:3});
});
test('whole-home reconnection summary does not repeat fixture labor and preserves residual sink connections across repeated passes',()=>{
 const tasks=[{id:'kitchen',description:'Supply and install one kitchen sink and faucet'},{id:'bath1',description:'Supply and install vanity, faucet and toilet in bathroom 1'},{id:'bath2',description:'Supply and install vanity, faucet and toilet in bathroom 2'},{id:'reconnect',description:'Perform plumbing disconnects and reconnects at existing stub-outs for all replaced fixtures'}];
 const rules=[rule('kitchen',tasks[0].description,'22-42-03',1),rule('kitchen',tasks[0].description,'22-42-02',1),...tasks.slice(1,3).flatMap(t=>[rule(t.id,t.description,'12-41-01',1),rule(t.id,t.description,'22-42-02',1),rule(t.id,t.description,'22-42-01',1)]),rule('reconnect',tasks[3].description,'22-42-03',3),rule('reconnect',tasks[3].description,'22-42-02',3),rule('reconnect',tasks[3].description,'22-42-01',2),rule('reconnect',tasks[3].description,'22-01-09',2)];
 const input=inputFor(scopeFor('Existing plumbing locations remain. Include normal reconnects.',{service:'whole-home'}),tasks,rules);
 applyPricingCorrections(input);applyPricingCorrections(input);
 const reconnect=input.resolution.rules.filter(r=>r.scopeTaskId==='reconnect');
 assert.equal(reconnect.length,1);assert.equal(reconnect[0].quantity.fixed,2);
 assert.match(reconnect[0].evidence.reference,/22-42-03/);
 assert.equal(input.resolution.rules.filter(r=>/Faucet install/.test(r.description)).reduce((n,r)=>n+(r.quantity.fixed||0),0),3);
 assert.equal(input.resolution.rules.filter(r=>/Toilet set/.test(r.description)).reduce((n,r)=>n+(r.quantity.fixed||0),0),2);
});

test('explicit bathroom protection uses room-scale book components and disclosed quantities',()=>{
 const task={id:'protect',description:'Provide protection of adjacent finishes and bathroom work area',origin:'requested'};
 const input=inputFor(scopeFor('Remodel one 60 SF bathroom.',{service:'bathroom',sqft:'60'}),[task],[rule(task.id,task.description,'01-50-04',1)]);
 applyPricingCorrections(input);applyPricingCorrections(input);
 assert.deepEqual(input.resolution.rules.map(r=>[r.unit,r.quantity.fixed]),[['SF',60],['EA',1]]);
 assert.deepEqual(input.resolution.rules.map(r=>r.quantityRange),[{low:60,high:120},{low:1,high:2}]);
 assert.ok(input.resolution.rules.every(r=>r.allowance));
 assert.equal(input.resolution.rules[0].unitCost,rate('01-50-10').amount);
 assert.equal(input.resolution.rules[1].unitCost,rate('01-50-11').amount);
});
