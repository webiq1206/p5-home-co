import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMinorWorkAllowance,minorWorkEligible} from '../lib/p5/minorWorkAllowance.ts';
import type {ScopePriceResolution} from '../lib/p5/costBook.ts';
import {reusableUnitRate} from '../lib/p5/unitRates.ts';
const now=new Date('2026-10-02T00:00:00Z');
const task=(id:string,description:string)=>({id,description,evidence:description,researchDescription:description,existingLineIds:[] as string[]});
const resolution=():ScopePriceResolution=>({rules:[],assumptions:[],issues:[]});
test('different minor tasks share one conservative job budget, including repeated repair passes',()=>{
 const tasks=[task('a','Remove and dispose of three old passage levers'),task('b','Supply ordinary installation consumables'),task('c','Minor cleanup and packaging disposal'),task('d','Small touch-up adjustment')];
 const r=resolution();const base=[{id:'install',quantity:3,unitCost:75}];
 assert.deepEqual(applyMinorWorkAllowance(tasks,r,base,now),['a','b','c','d']);
 assert.equal(r.rules.length,1);assert.equal(r.rules[0].unitCost,75);
 assert.ok(tasks.every(t=>t.existingLineIds.includes('minor-work-allowance')&&!t.researchDescription));
 tasks[0].researchDescription='Minor hardware disposal';applyMinorWorkAllowance(tasks,r,base,now);
 assert.equal(r.rules.length,1);assert.equal(r.rules[0].unitCost,75);
 assert.equal(r.rules[0].evidence.basis,'owner-budget-allowance');
 assert.match(r.rules[0].evidence.reference,/No embedded reserve/);
 assert.equal(reusableUnitRate(r.rules[0],'Boise',now),null,'policy budgets never become learned market rates');
});
test('budget scales with priced work without multiplying minimums or compounding its own amount',()=>{
 const r=resolution();const base=[{id:'work',quantity:1,unitCost:10000}];
 applyMinorWorkAllowance([task('a','Minor cleanup')],r,base,now);assert.equal(r.rules[0].unitCost,300);
 applyMinorWorkAllowance([task('b','Small packaging disposal')],r,[...base,{id:'minor-work-allowance',quantity:1,unitCost:300}],now);
 assert.equal(r.rules[0].unitCost,300);
 const large=resolution();applyMinorWorkAllowance([task('a','Minor cleanup')],large,[{id:'work',quantity:1,unitCost:100000}],now);
 assert.equal(large.rules[0].unitCost,750,'one shared cap');
});
test('major work, hazards, already priced tasks and an entirely unpriced job cannot use the minor budget',()=>{
 for(const description of ['Hazardous waste disposal','Remove structural beam','Minor asbestos cleanup','Dumpster and three cubic yards of debris','Purchase kitchen cabinets','Foundation excavation'])assert.equal(minorWorkEligible({...task('a',description),costClass:'minor-job-support'}),false,description);
 assert.equal(minorWorkEligible({...task('a','Minor cleanup'),researchDescription:''}),false);
 assert.equal(minorWorkEligible({...task('a','Protective overlay'),researchDescription:'Price only the still-unpriced components of: Protective overlay. Include expressly requested contractor consumables not covered by installation labor.'}),false,'generic research instructions cannot turn primary work into supplies');
 const r=resolution();applyMinorWorkAllowance([task('a','Minor cleanup')],r,[],now);assert.equal(r.rules.length,0);
});
