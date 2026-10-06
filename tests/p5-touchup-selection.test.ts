import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution} from '../lib/p5/scopePricing.ts';
import {applyMinorWorkAllowance} from '../lib/p5/minorWorkAllowance.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import {PRICE_BOOK} from '../lib/p5/priceBookData.ts';
import {priceBookRate} from '../lib/p5/priceBook.ts';

const now=new Date('2026-10-06T12:00:00Z');
const required=['03-17-01-M','03-17-01-L','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const configuration=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'Synthetic regression',authorizedBy:'Test only',importedAt:now.toISOString(),rates:[...required.map(code=>({code,description:'Synthetic required rate',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic regression',basis:'owner-average-cost' as const})),...['12-32-01','12-39-02'].map(code=>priceBookRate(PRICE_BOOK.find(row=>row[0]===code)!,'mid',false))]});
const touchDescription='Cabinet touch-up painting (factory-painted cabinets only; exterior painting excluded).';
const touchEvidence='painting outside cabinet touch-up [excluded]';
const task=(id:string,description:string,evidence:string,code:string,quantity=10)=>({id,description,evidence,existingLineIds:[] as string[],additions:[{code,quantity,quantityEvidence:`${quantity} LF stated`}],researchDescription:'',issues:[] as string[]});
const primary=()=>task('cabinets','Supply and install 10 LF base cabinets','10 LF base cabinets','PB-12-32-01');
const touch=()=>task('touch',touchDescription,touchEvidence,'PB-12-39-02');
const mapping=(tasks:ReturnType<typeof task>[])=>({tasks,issues:[] as string[],notes:[] as string[],replacements:[],removeExclusions:[]});

test('outside-work exclusion retains localized cabinet touch-up and uses the existing shared allowance',()=>{
 const input=mapping([primary(),touch()]);
 const result=catalogResolution(input,configuration,[],now);
 assert.ok(!result.assumptions.some(note=>note.includes('unselected')),'the excluded work is painting outside touch-up');
 assert.ok(!result.rules.some(rule=>rule.scopeTaskId==='touch'),'full spray refinishing must not price localized touch-up');
 assert.deepEqual(applyMinorWorkAllowance(input.tasks,result,[],now),['touch']);
 const pool=result.rules.find(rule=>rule.id==='minor-work-allowance');assert.ok(pool);
 assert.equal(pool.evidence.basis,'owner-budget-allowance');
 assert.equal(pool.minorWorkCoverage?.[0].taskId,'touch');
 assert.equal(result.rules.filter(rule=>rule.scopeTaskId==='cabinets').length,1);
 assert.equal(input.tasks[1].researchDescription,'');
 assert.match(result.assumptions.join('\n'),/local|touch-up/i);
});

for(const evidence of ['Cabinet touch-up is excluded.','Painting outside cabinet touch-up excluded; cabinet touch-up not selected.','Cabinet touch-up is excluded and painting outside cabinet touch-up [excluded]'])test('direct touch-up exclusion remains excluded: '+evidence,()=>{
 const item=touch();item.evidence=evidence;const input=mapping([primary(),item]);
 const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.assumptions.some(note=>note.includes('unselected')));
 assert.ok(!result.rules.some(rule=>rule.scopeTaskId==='touch'));
 assert.equal(item.researchDescription,'','excluded work does not acquire a budget request');
});

test('full refinishing and a separate localized touch-up retain separate correct responsibilities',()=>{
 const full=task('refinish','Full professional spray refinishing of 10 LF existing cabinets','Full professional spray refinishing, 10 LF','PB-12-39-02');
 const small=touch();small.id='small-touch';small.evidence='Minor touch-up of new factory-painted cabinet installation edges only.';
 const input=mapping([primary(),full,small]);const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.rules.some(rule=>rule.scopeTaskId==='refinish'&&rule.unitCost>0));
 assert.ok(!result.rules.some(rule=>rule.scopeTaskId==='small-touch'));
 assert.deepEqual(applyMinorWorkAllowance(input.tasks,result,[],now),['small-touch']);
 assert.equal(result.rules.filter(rule=>rule.id==='minor-work-allowance').length,1);
});

test('mixed full refinishing and touch-up is not silently reduced to minor work',()=>{
 const mixed=task('mixed','Cabinet touch-up and full professional spray refinishing','Full refinishing and localized touch-up are both requested','PB-12-39-02');
 const input=mapping([primary(),mixed]);const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.rules.some(rule=>rule.scopeTaskId==='mixed'&&rule.unitCost>0));
 assert.deepEqual(applyMinorWorkAllowance(input.tasks,result,[],now),[]);
});

test('an unknown touch-up rate remains unsupported instead of becoming a fabricated catalog price',()=>{
 const unknown=touch();unknown.additions[0].code='UNKNOWN-RATE';
 const input=mapping([primary(),unknown]);const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.issues.some(issue=>issue.endsWith('catalog rate is unavailable.')),JSON.stringify(result.issues));
 assert.ok(!result.rules.some(rule=>rule.scopeTaskId==='touch'));
});

for(const description of ['Cabinet touch-up (and full cabinet refinishing)','Cabinet touch-up and full professional spray painting'])test('an affirmative complete finish cannot hide inside touch-up wording: '+description,()=>{
 const item=task('mixed',description,'Not full cabinet spray painting on the new run; full cabinet refinishing on the retained run.','PB-12-39-02');
 const input=mapping([primary(),item]);const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.rules.some(rule=>rule.scopeTaskId==='mixed'));
 assert.equal(item.researchDescription,'');
});

for(const description of ['Cabinet touch-up and repaint all cabinet doors','Cabinet touch-up and professional spray painting','Cabinet touch-up and painting every cabinet door','Cabinet touch-up and spray painting of cabinet doors','Cabinet touch-up and painting cabinets a new color','Cabinet touch-up, painting cabinet doors','Cabinet touch-up (cabinet painting included)'])test('mixed repaint and spray work never becomes an incidental allowance: '+description,()=>{
 const item=task('mixed',description,'Minor installation damage plus '+description+' are requested.','PB-12-39-02');
 const input=mapping([primary(),item]);const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.rules.some(rule=>rule.scopeTaskId==='mixed'&&rule.unitCost>0));
 assert.deepEqual(applyMinorWorkAllowance(input.tasks,result,[],now),[]);
 assert.equal(item.researchDescription,'');
});

test('touch-up evidence cannot hide an included painting responsibility beside a different exclusion',()=>{
 const item=touch();item.evidence='Minor touch-up with cabinet painting included and exterior painting excluded.';
 const input=mapping([primary(),item]);const result=catalogResolution(input,configuration,[],now);
 assert.ok(result.rules.some(rule=>rule.scopeTaskId==='touch'&&rule.unitCost>0));
 assert.deepEqual(applyMinorWorkAllowance(input.tasks,result,[],now),[]);
});

test('outside exception cannot override a direct exclusion in the same clause',()=>{
 const item=touch();item.evidence='painting outside cabinet touch-up [excluded] and cabinet touch-up excluded';
 const result=catalogResolution(mapping([primary(),item]),configuration,[],now);
 assert.ok(result.assumptions.some(note=>note.includes('unselected')));
 assert.ok(!result.rules.some(rule=>rule.scopeTaskId==='touch'));
});

test('another component exception does not select this cabinet task',()=>{
 const item=touch();item.evidence='painting outside countertop touch-up [excluded]';
 const result=catalogResolution(mapping([primary(),item]),configuration,[],now);
 assert.ok(result.assumptions.some(note=>note.includes('unselected')));
 assert.ok(!result.rules.some(rule=>rule.scopeTaskId==='touch'));
});

test('an entirely unsupported project cannot be funded by the touch-up allowance',()=>{
 const input=mapping([touch()]);const result=catalogResolution(input,configuration,[],now);
 assert.deepEqual(applyMinorWorkAllowance(input.tasks,result,[],now),[]);
 assert.equal(result.rules.length,0);assert.ok(input.tasks[0].researchDescription);
});
