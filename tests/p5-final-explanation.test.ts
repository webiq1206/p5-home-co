import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finishScopePricing} from '../lib/p5/scopePricing.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {applyPricingCorrections} from '../lib/p5/pricingCorrections.ts';
import {applyMinorWorkAllowance} from '../lib/p5/minorWorkAllowance.ts';
const load=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));
const now=new Date('2026-10-02T09:09:27.443Z');
function fixture(release:string){
 if(release==='8'){
  const f=load('p5-same-door-hardware');
  applyPricingCorrections({...f,inventoryTasks:f.tasks,mappingTasks:f.tasks,lines:[],pricingExtraction:f.scope.extraction,now});
  return {...f,auditTrail:{tasks:f.tasks,verification:f.audit}};
 }
 return load(release==='9'?'p5-retained-audit-copy':'p5-final-minor-work-copy');
}
const render=(f:any)=>finishScopePricing(f.scope,f.configuration,now,f.resolution,f.auditTrail,f.scope.extraction);
const explanation=(out:any)=>out.internal.scopePricing.finalExplanation;
const customerText=(out:any)=>JSON.stringify(out.customer);

for(const release of ['8','9','10'])test(`real .${release} replay uses retained prices, preserves evidence and financial amounts`,()=>{
 const f=fixture(release),before=JSON.stringify(f);
 const original=priceReviewedScope(f.scope,f.configuration,now,f.resolution);
 const out=render(f),current=explanation(out);
 assert.equal(JSON.stringify(f),before);
 assert.equal(out.internal.directCost,285);
 for(const key of ['directCost','contractPrice','planningRange','allocationDollars','contingency','operatingProfit'])assert.deepEqual((out.internal as any)[key],(original.internal as any)[key],key);
 assert.deepEqual(out.customer.range,original.customer.range);
 assert.deepEqual(render(f).customer,out.customer);
 assert.equal(current.version,'retained-minor-work-v1');
 assert.deepEqual(current.historicalAssumptions,f.resolution.assumptions);
 assert.deepEqual(out.internal.scopePricing.originalResolution,f.resolution);
 assert.deepEqual(out.internal.scopePricing.verification,f.auditTrail.verification);
 assert.match(customerText(out),/labor only, materials priced separately/);
 assert.match(customerText(out),/shared preliminary job-support allowance/);
 assert.doesNotMatch(customerText(out),/PB-08-72-07|0\.6 EA|consumables[^.]*included within the labor|labor with consumables included|Duplicate labor charge|UNRESOLVED MATERIAL CONSUMABLES/);
 assert.match(customerText(out),/pending review|Historical pricing assumptions/);
 assert.ok(current.findings.filter((x:any)=>x.kind==='historical-review').every((x:any)=>x.lineIds.length));
});

test('historical prose variations cannot change current rate or allowance facts',()=>{
 const base=fixture('10'),expected=render(base);
 const variants=['The removed hinge proposal costs 0.6 EA.','Consumables are included in labor.','Labor includes all fasteners.','DOOR INSTALLATION HAS NO SUPPLIES COST.','Scope-1 allegedly prices hinges, equipment and disposal.'];
 for(let n=0;n<variants.length;n++){
  const f=structuredClone(base);
  f.resolution.assumptions=[...variants.slice(n),...variants.slice(0,n)];
  f.resolution.rules[0].evidence.reference+=' '+variants[n];
  const out=render(f);
  assert.deepEqual(out.customer,expected.customer);
  assert.deepEqual(explanation(out).historicalAssumptions,f.resolution.assumptions);
  assert.equal(out.internal.directCost,expected.internal.directCost);
 }
});

for(const variant of ['missing pool','zero pool','unlinked task','missing exact coverage','ambiguous structured coverage','extra material','real duplicate','unpriced component'])test('current integrity check retains uncertainty: '+variant,()=>{
 const f=fixture('10'),pool=f.resolution.rules[1],supplies=f.auditTrail.tasks[1];
 if(variant==='missing pool')f.resolution.rules.pop();
 if(variant==='zero pool')pool.quantity.fixed=0;
 if(variant==='unlinked task')supplies.existingLineIds=[];
 if(variant==='missing exact coverage')pool.evidence.reference=pool.evidence.reference.replace(supplies.description,'Unrelated cleanup');
 if(variant==='ambiguous structured coverage')pool.minorWorkCoverage=[{taskId:'other-task',description:supplies.description,remainingComponent:supplies.description}];
 if(variant==='extra material')f.resolution.rules.push({...structuredClone(f.resolution.rules[0]),id:'extra',scopeTaskId:supplies.id,category:'materials'});
 if(variant==='real duplicate')f.resolution.rules.push({...structuredClone(f.resolution.rules[0]),id:'second-labor'});
 if(variant==='unpriced component')supplies.researchDescription='Price remaining required mounting brackets';
 const before=JSON.stringify(f),out=render(f);
 assert.equal(JSON.stringify(f),before);
 assert.equal(out.customer.status,'review-required');
 assert.equal(out.customer.range,null);
 assert.ok(explanation(out).findings.some((x:any)=>x.kind==='coverage'||x.kind==='overlap'));
 assert.ok(explanation(out).findings.every((x:any)=>x.lineIds.every((id:string)=>out.internal.lines.some((line:any)=>line.id===id))));
});

test('blocking and source warnings remain visible; an unknown advisory stays pending with its raw evidence',()=>{
 const f=fixture('10');
 const block='Verify concealed structural damage before installing replacement hardware.';
 const site='Check restricted access at the site visit.';
 const advisory='Confirm asbestos survey before disturbing the existing finish.';
 f.resolution.issues.push(block);f.scope.extraction.reviewNotes.push(site);
 f.resolution.assumptions.push(advisory);f.auditTrail.verification.issues.push(advisory);
 const out=render(f),text=customerText(out);
 assert.match(text,/concealed structural damage/);assert.match(text,/restricted access/);
 assert.match(text,/pending review/);assert.equal(out.customer.range,null);
 assert.ok(explanation(out).findings.some((x:any)=>x.original===advisory&&x.lineIds.length));
 assert.ok(explanation(out).historicalAssumptions.includes(advisory));
});

test('fresh policy assignments identify remaining components and survive idempotent reapplication',()=>{
 const f=fixture('10'),pool=f.resolution.rules[1];
 f.resolution.rules.pop();
 const tasks=f.auditTrail.tasks.map((t:any)=>({...t,researchDescription:t.id==='remove-install-levers'?'Minor disposal of removed levers':t.description}));
 applyMinorWorkAllowance(tasks,f.resolution,[],now);
 const created=f.resolution.rules[1];
 assert.ok(created.minorWorkCoverage.some((x:any)=>x.taskId==='remove-install-levers'&&x.remainingComponent==='Minor disposal of removed levers'));
 const once=JSON.stringify(f.resolution);
 applyMinorWorkAllowance(tasks,f.resolution,[],now);assert.equal(JSON.stringify(f.resolution),once);
 f.auditTrail.tasks=tasks;
 const out=render(f);
 assert.ok(explanation(out).coverage.every((x:any)=>x.source==='structured-policy'));
 assert.equal(out.internal.directCost,285);assert.equal(created.unitCost,pool.unitCost);
});

test('minor-work explanations apply to the common renderer; non-policy estimates keep existing behavior',()=>{
 const f=fixture('10');f.resolution.rules.pop();f.auditTrail.tasks=f.auditTrail.tasks.slice(0,1);f.auditTrail.tasks[0].existingLineIds=[];
 assert.equal(explanation(render(f)),undefined);
 for(const service of ['handyman','re10','cabinet-install','remodel']){
  const f=fixture('10');f.scope.answers.service=service;f.configuration.costBooks[0].service=service;
  assert.equal(explanation(render(f)).version,'retained-minor-work-v1');
 }
});
