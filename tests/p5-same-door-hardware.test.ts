import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyPricingCorrections} from '../lib/p5/pricingCorrections.ts';
import {finishScopePricing} from '../lib/p5/scopePricing.ts';
import {retainedConsumablesCopy} from '../lib/p5/consumablesCopy.ts';
const saved=JSON.parse(readFileSync(new URL('./fixtures/p5-same-door-hardware.json',import.meta.url),'utf8'));
const fixture=()=>{const f=structuredClone(saved);return {...f,inventoryTasks:f.tasks,mappingTasks:f.tasks,lines:[],pricingExtraction:f.scope.extraction,now:new Date('2026-10-02T08:07:44.144Z')};};

test('saved .8 same-three-doors scope retains one replacement labor charge and explicit disposal coverage',()=>{
 const f=fixture();const before=JSON.stringify(f.scope);
 const result=applyPricingCorrections(f);
 const labor=f.resolution.rules.filter((r:any)=>r.category==='field-labor');
 assert.equal(labor.length,1);assert.equal(labor[0].quantity.fixed,3);assert.equal(labor[0].unitCost,70);
 assert.ok(result.coveredTaskIds.includes('door_lever_removal_disposal'));
 assert.ok(f.mappingTasks[0].existingLineIds.includes(labor[0].id));
 const pool=f.resolution.rules.find((r:any)=>r.id==='minor-work-allowance');
 assert.equal(pool.unitCost,75);assert.match(pool.evidence.reference,/dispos/i);
 assert.equal(JSON.stringify(f.scope),before,'original evidence remains untouched');
 const once=JSON.stringify(f.resolution);applyPricingCorrections(f);assert.equal(JSON.stringify(f.resolution),once);
 const priced=finishScopePricing(f.scope,f.configuration,f.now,f.resolution,{tasks:f.tasks},f.scope.extraction);
 assert.equal(priced.internal.directCost,285);
 assert.ok(!priced.customer.verificationItems.some((n:string)=>/same item counted twice/.test(n)));
});

test('saved .8 consumables copy reflects retained allowance without changing original audit or price lines',()=>{
 const f=fixture();const audit={tasks:f.tasks,verification:f.audit};const original=JSON.stringify(audit);
 const out=finishScopePricing(f.scope,f.configuration,f.now,f.resolution,audit,f.scope.extraction);
 const notes=[...out.customer.assumptions,...out.customer.verificationItems];
 const copy=JSON.stringify(notes);
 assert.ok(!notes.some((n:string)=>/^Contractor supplies .*consumables.*as part of (?:the )?(?:installation )?labor/i.test(n)));
 assert.ok(out.internal.scopePricing.finalExplanation?.historicalAssumptions.some((n:string)=>/not expected to absorb these costs as part of labor/.test(n)),'negated warning is preserved internally');
 assert.match(JSON.stringify(out.customer.verificationItems),/Historical pricing assumptions.*Review/,'unknown legacy caveats remain explicitly pending');
 assert.match(copy,/shared[^.]*allowance[^.]*consumables/i);
 assert.equal(JSON.stringify(audit),original);
 assert.equal(out.internal.directCost,495,'copy repair does not change prices');
});

test('consumables copy preserves warnings, negations, unknown coverage and unpaid allowances',()=>{
 const f=fixture();
 const affirmative='Contractor supplies installation consumables as part of installation labor.';
 const warnings=['Contractor supplies consumables but not as part of installation labor.','Contractor supplies consumables, but confirm whether they are included as part of installation labor.','Unresolved: installation consumables have no supported price.'];
 assert.deepEqual(retainedConsumablesCopy(warnings,f.resolution),warnings);
 for(const variant of ['missing pool','zero pool','uncovered pool','installed material rate']){
  const f=fixture(),pool=f.resolution.rules[2];
  if(variant==='missing pool')f.resolution.rules.pop();
  if(variant==='zero pool')pool.unitCost=0;
  if(variant==='uncovered pool')pool.evidence.reference='minor-work-v1;\nCovered work:\nCleanup';
  if(variant==='installed material rate')f.resolution.rules[0].description='Labor with consumables';
  assert.deepEqual(retainedConsumablesCopy([affirmative],f.resolution),[affirmative],variant);
 }
});

for(const variant of ['different doors','different floor','different building','different quantity','different rate','different unit','different cost','two removal groups','negated same doors','different hardware','hazardous disposal','additional hinges'])test('preserves genuinely separate or ambiguous removal: '+variant,()=>{
 const f=fixture();const [remove,install]=f.resolution.rules;
 if(variant==='different doors')f.scope.text='Remove three garage door levers. Install three replacement levers on different bedroom doors.';
 if(variant==='negated same doors')f.scope.text='Remove three door levers and install three replacement levers, but not on the same three doors.';
 if(variant==='different hardware')f.scope.text='Remove three door hinges and install three passage levers on the same three doors.';
 if(['different doors','negated same doors','different hardware'].includes(variant)){
  f.scope.extraction=null;f.pricingExtraction=null;f.mappingTasks.forEach((t:any)=>t.evidence='');
 }
 if(variant==='hazardous disposal')f.mappingTasks[0].description+=' with hazardous waste disposal';
 if(variant==='additional hinges')f.mappingTasks[0].description+=' and remove door hinges';
 if(variant==='different floor')remove.floor='Upstairs';
 if(variant==='different building')remove.building='Garage';
 if(variant==='different quantity')remove.quantity.fixed=2;
 if(variant==='different rate')remove.evidence.reference='Approved separate removal labor; PB-08-71-02';
 if(variant==='different unit')remove.unit='hour';
 if(variant==='different cost')remove.unitCost=90;
 if(variant==='two removal groups'){
  f.resolution.rules.push({...structuredClone(remove),id:'other-removal',scopeTaskId:'other-removal'});
  f.mappingTasks.push({...structuredClone(f.mappingTasks[0]),id:'other-removal'});
 }
 const before=f.resolution.rules.filter((r:any)=>r.category==='field-labor').length;
 applyPricingCorrections(f);assert.equal(f.resolution.rules.filter((r:any)=>r.category==='field-labor').length,before);
 assert.ok(f.resolution.rules.includes(remove));assert.ok(f.resolution.rules.includes(install));
});
