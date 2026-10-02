import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {reconcileRetainedAuditCopy} from '../lib/p5/retainedAuditCopy.ts';
const saved=JSON.parse(readFileSync(new URL('./fixtures/p5-retained-audit-copy.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(saved);
// Retain the old reconciler's conservative unit tests. The final-renderer
// integration and all three live records are tested in p5-final-explanation.
const render=(f:any)=>{
 const now=new Date('2026-10-02T08:40:35.608Z');
 const original=priceReviewedScope(f.scope,f.configuration,now,f.resolution);
 const copy=reconcileRetainedAuditCopy(f.resolution.assumptions,f.scope,f.auditTrail.tasks,f.resolution,'lines' in original.internal?original.internal.lines:[]);
 const out=priceReviewedScope(f.scope,f.configuration,now,{...f.resolution,assumptions:copy.notes});
 return {...out,customer:{...out.customer,verificationItems:[...copy.notes,...f.resolution.issues]},internal:{...out.internal,scopePricing:{...f.auditTrail,customerCopyDecisions:copy.decisions}}};
};
const notes=(out:ReturnType<typeof render>)=>JSON.stringify([...out.customer.assumptions,...out.customer.verificationItems]);

test('saved .9 shared-line allegation is reconciled to final one-charge evidence with raw audit intact',()=>{
 const f=fixture(),before=JSON.stringify(f);
 const out=render(f);
 assert.doesNotMatch(notes(out),/Duplicate labor charge|consolidate to one per-door charge/i);
 assert.match(notes(out),/removal and installation.*share.*one.*labor charge/i);
 assert.equal(out.internal.directCost,285);
 assert.deepEqual(out.customer.range,{low:450,high:555});
 assert.equal(JSON.stringify(f),before);
 const decisions=(out.internal.scopePricing as any).customerCopyDecisions;
 assert.equal(decisions.length,3);
 assert.ok(decisions.every((d:any)=>f.resolution.assumptions.includes(d.original)&&d.reason&&d.lineIds.length));
 assert.deepEqual(render(f).customer,out.customer,'repeated rendering is deterministic');
});

test('unresolved pricing issues are not promoted to a complete estimate by copy reconciliation',()=>{
 const f=fixture();
 f.resolution.issues.push('Missing contractor-supplied consumables: no supported price.');
 const out=render(f);
 assert.equal(out.customer.status,'review-required');assert.equal(out.customer.range,null);
 assert.match(notes(out),/Missing contractor-supplied consumables: no supported price/i);
 assert.equal(f.resolution.issues.length,1);
});

test('saved .9 affirmative included-within-labor claim reflects actual exclusive consumables allowance',()=>{
 const f=fixture();const out=render(f);
 assert.doesNotMatch(notes(out),/consumables[^.]*included within the labor-only rate/i);
 assert.match(notes(out),/consumables.*shared preliminary job-support allowance/i);
 assert.equal(out.internal.directCost,285);
 assert.deepEqual(out.internal.scopePricing.verification,f.auditTrail.verification);
});

for(const variant of ['real duplicate','missing reference','different task','wrong quantity','no correction evidence','mixed unresolved finding'])test('retain genuine or unproven duplicate warning: '+variant,()=>{
 const f=fixture(),rule=f.resolution.rules[0];
 if(variant==='real duplicate')f.resolution.rules.push({...structuredClone(rule),id:'scope-3',scopeTaskId:'remove-old-levers'});
 if(variant==='missing reference')f.auditTrail.tasks[0].existingLineIds=[];
 if(variant==='different task')f.auditTrail.tasks[0].description='Remove hinges from three other doors';
 if(variant==='wrong quantity')rule.quantity.fixed=6;
 if(variant==='no correction evidence')rule.description='Install three replacement passage levers';
 if(variant==='mixed unresolved finding')f.resolution.assumptions=f.resolution.assumptions.map((s:string)=>s.includes('Duplicate labor charge')?s+' Missing disposal coverage must be priced.':s);
 assert.match(notes(render(f)),/Duplicate labor charge/i);
});

for(const variant of ['missing pool','zero pool','unlinked task','missing coverage','extra consumables charge','labor includes materials'])test('retain unproven consumables claim and real warnings: '+variant,()=>{
 const f=fixture(),pool=f.resolution.rules[1];
 if(variant==='missing pool')f.resolution.rules.pop();
 if(variant==='zero pool')pool.quantity.fixed=0;
 if(variant==='unlinked task')f.auditTrail.tasks[2].existingLineIds=[];
 if(variant==='missing coverage')pool.evidence.reference=pool.evidence.reference.replace('Supply contractor installation consumables','Cleanup only');
 if(variant==='extra consumables charge')f.resolution.rules.push({...structuredClone(f.resolution.rules[0]),id:'extra-material',category:'materials',scopeTaskId:f.auditTrail.tasks[2].id});
 if(variant==='labor includes materials')f.resolution.rules[0].description='Installation labor with consumables included';
 f.resolution.assumptions.push('Unresolved: installation consumables have no supported material coverage.');
 const text=notes(render(f));assert.match(text,/included within the labor-only rate/i);assert.match(text,/no supported material coverage/i);
});
