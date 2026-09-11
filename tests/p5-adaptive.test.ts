import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveScopeAnswers,reconcileScope,scopeQuestions,scopeAssumptions,validateScopeAnswer} from '../lib/p5/adaptive.ts';
import {requireDraftReceipt} from '../lib/p5/browserDraft.ts';
import {validateExtraction,type ScopeAnswers,type ScopeExtraction} from '../lib/p5/scope.ts';
const extracted=(answers:ScopeAnswers,confidence=.98):ScopeExtraction=>({summary:'Synthetic scope',facts:Object.entries(answers).map(([field,value])=>({field:field as keyof ScopeAnswers,value:value!,confidence,source:'scope.pdf',evidence:value!})),conflicts:[],reviewNotes:[],missingInformation:[]});
test('observed HTTP 200 null draft never advances or clears uploads',()=>{
 for(const data of [{draft:null},{},{draft:{revision:1}},{draft:{revision:'1',answers:{},uploads:[]}}])assert.throws(()=>requireDraftReceipt(data),/save was not confirmed/);
 assert.equal(requireDraftReceipt({draft:{revision:1,answers:{},uploads:[]}}).revision,1);
});
test('detailed bathroom scope skips known details and derives area',()=>{
 const e=extracted({service:'bathroom',length:'8',width:'10',flooringSqft:'80',fixtures:'One shower and one toilet',materials:'Porcelain tile',demolition:'Remove tile and vanity',location:'Boise'});
 const m=reconcileScope({},e);assert.equal(m.answers.sqft,'80');assert.deepEqual(scopeQuestions(m.answers,e,m.conflicts),[]);
});
test('only missing cost-book variables generate questions and zero is known',()=>{
 const a={service:'cabinet-install',cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0'};
 assert.deepEqual(scopeQuestions(a,null,[],[],['cabinetBaseLf','cabinetUpperLf']),[]);
 assert.deepEqual(scopeQuestions(a,null,[],[],['countertopSqft']).map(q=>q.field),['countertopSqft']);
});
test('conflicts are one clarification and confirmation persists',()=>{
 const e=extracted({sqft:'200'});const m=reconcileScope({sqft:'300'},e);assert.equal(m.conflicts.length,1);
 assert.equal(scopeQuestions(m.answers,e,m.conflicts)[0].field,'sqft');
 assert.equal(reconcileScope({sqft:'300'},e,{sqft:'300'}).conflicts.length,0);
 assert.equal(reconcileScope({sqft:'200.0'},e).conflicts.length,0);
});
test('low confidence is one clarification, never an accepted quantity',()=>{
 const e=extracted({sqft:'80'},.65);const m=reconcileScope({service:'bathroom',materials:'Porcelain',demolition:'Remove tile'},e);
 assert.equal(m.answers.sqft,undefined);const q=scopeQuestions(m.answers,e);assert.equal(q.length,1);assert.deepEqual(q[0].values,['80']);
});
test('derive explicit rectangular area without guessing scale or overwriting stated area',()=>{
 assert.equal(deriveScopeAnswers({length:'8',width:'10'}).sqft,'80');assert.equal(deriveScopeAnswers({length:'8'}).sqft,undefined);
 assert.equal(deriveScopeAnswers({length:'8',width:'10',sqft:'70'}).sqft,'70');
 assert.ok(reconcileScope({length:'8',width:'10',sqft:'70'},extracted({})).conflicts.length);
});
test('unknown answers are assumptions instead of repeated questions',()=>{
 const a={service:'bathroom',demolition:'Remove fixtures',materials:'Porcelain'};
 assert.deepEqual(scopeQuestions(a,null,[],['sqft']),[]);assert.match(scopeAssumptions(a,['sqft']).join(' '),/not yet known/);
});
test('a clarification answered elsewhere is skipped',()=>{
 const e=validateExtraction({...extracted({plumbing:'Keep fixtures'}),clarifications:[{field:'plumbing',question:'Are fixtures moving?',reason:'Relocation cost'}]});
 assert.deepEqual(scopeQuestions({service:'bathroom',sqft:'80',materials:'Tile',demolition:'Remove tile',plumbing:'Keep fixtures'},e),[]);
});
test('unrelated remodeling questions never appear for repairs',()=>{
 assert.deepEqual(scopeQuestions({service:'handyman',taskList:'Repair three doors'},null),[]);
 assert.ok(validateScopeAnswer('sqft','0'));assert.equal(validateScopeAnswer('cabinetUpperLf','0'),null);
});

test('model confidence cannot promote inferred or unscaled visual details into pricing facts',()=>{
 const raw=extracted({service:'bathroom',sqft:'80',finish:'luxury',urgency:'emergency'});
 raw.facts=raw.facts.map(f=>({...f,basis:f.field==='service'?'stated':f.field==='urgency'?'inferred':'visual'}));
 const e=validateExtraction(raw); const merged=reconcileScope({},e);
 assert.equal(merged.answers.service,'bathroom');
 assert.equal(merged.answers.sqft,undefined);
 assert.equal(merged.answers.finish,undefined);
 assert.equal(merged.answers.urgency,undefined);
 const questions=scopeQuestions(merged.answers,e);
 assert.equal(questions.some(q=>q.field==='urgency'),false);
 assert.equal(questions.find(q=>q.field==='sqft')?.values,undefined);
});
test('explicit calculated measurements retain their evidence and skip repeat questions',()=>{
 const raw=extracted({service:'bathroom',sqft:'80',materials:'Porcelain tile',demolition:'Remove old fixtures'});
 raw.facts=raw.facts.map(f=>({...f,basis:f.field==='sqft'?'calculated':'stated'}));
 const e=validateExtraction(raw), merged=reconcileScope({},e);
 assert.equal(merged.answers.sqft,'80');assert.deepEqual(scopeQuestions(merged.answers,e),[]);
});

test('discarded image-scale guesses do not create a conflict with explicit measurements',()=>{
 const raw=extracted({sqft:'80'});
 raw.facts.push({field:'sqft',value:'150',confidence:.99,source:'photo.png',evidence:'Looks like 150 square feet',basis:'visual'});
 const e=validateExtraction(raw);const m=reconcileScope({},e);
 assert.equal(m.answers.sqft,'80');assert.deepEqual(m.conflicts,[]);
});

import {mergeProjectSource} from '../lib/p5/projectSource.ts';
test('designer handoff retains existing notes, contact, files and visitor corrections',()=>{
 const draft:any={id:'fixture',namespace:'cabinet-design',answers:{cabinetBaseLf:'20'},text:'Keep existing flooring',contact:{name:'Test',email:'test@example.com'},uploads:[{id:'plan'}],revision:4,projectSource:{id:'cabinet-design',answers:{cabinetBaseLf:'20'}}};
 const next=mergeProjectSource(draft,{id:'cabinet-design',answers:{cabinetBaseLf:'25',cabinetUpperLf:'12'}});
 assert.equal(next.answers.cabinetBaseLf,'25');assert.equal(next.text,draft.text);assert.deepEqual(next.contact,draft.contact);assert.deepEqual(next.uploads,draft.uploads);assert.equal(next.revision,4);
 const edited=mergeProjectSource({...next,answers:{...next.answers,cabinetBaseLf:'30'}},{id:'cabinet-design',answers:{cabinetBaseLf:'28',cabinetUpperLf:'12'}});
 assert.equal(edited.answers.cabinetBaseLf,'30');assert.equal(edited.conflicts?.length,1);
});
test('living area and garage stay separate and known specifications do not generate optional questions',()=>{
 const a={service:'new-construction',sqft:'2500',garageIncluded:'yes',materials:'Paint grade Shaker, engineered wood',taskList:'Residence and attached garage'};
 const e=extracted({});e.clarifications=[{field:'finish',question:'What finish level?',reason:'materials'},{field:'location',question:'Where?',reason:'jurisdiction'}];
 assert.deepEqual(scopeQuestions(a,e).map(q=>q.field),['garageSqft']);
 assert.deepEqual(scopeQuestions({...a,garageSqft:'800'},e),[]);
 assert.equal(deriveScopeAnswers({...a,garageSqft:'800'}).sqft,'2500');
});

test('uncertain quantities are asked only when required by pricing',()=>{
 const a={service:'bathroom',length:'8',width:'10',materials:'Porcelain',demolition:'Remove tile'};
 const e=extracted({flooringSqft:'80'},.65);
 assert.deepEqual(scopeQuestions(a,e),[]);
 const q=scopeQuestions(a,e,[],[],['flooringSqft']);
 assert.equal(q.length,1);assert.equal(q[0].field,'flooringSqft');
 assert.ok(q[0].reason.includes(q[0].label));
});

test('model follow-ups must match a required field and its answer type',()=>{
 const a={service:'bathroom',length:'8',width:'10',materials:'Porcelain',demolition:'Remove tile'};
 const e=extracted({});e.clarifications=[{field:'fixtureCount',question:'Which fixtures and who supplies them?',reason:'Scope'}];
 assert.deepEqual(scopeQuestions(a,e),[]);
 const q=scopeQuestions(a,e,[],[],['fixtureCount']);
 assert.equal(q.length,1);assert.match(q[0].reason,/number of fixtures/i);
 assert.doesNotMatch(q[0].reason,/which fixtures/i);
});

// A narrower edited scope must not inherit auto-extracted work from the old scope.
test("reanalysis replaces source facts while preserving visitor corrections",async()=>{
 const {manualScopeAnswers}=await import("../lib/p5/adaptive.ts");
 const previous={summary:"Old scope",facts:[{field:"demolition" as const,value:"Remove flooring",confidence:.98,source:"scope.pdf",evidence:"Remove flooring"},{field:"sqft" as const,value:"80",confidence:.98,source:"scope.pdf",evidence:"80 square feet"}],conflicts:[],missingInformation:[],reviewNotes:[]};
 assert.deepEqual(manualScopeAnswers({demolition:"Remove flooring",sqft:"80",location:"Eagle"},previous),{location:"Eagle"});
 assert.equal(manualScopeAnswers({demolition:"Only remove vanity",sqft:"80"},previous).demolition,"Only remove vanity");
 assert.equal(manualScopeAnswers({sqft:"80"},previous,{sqft:"80"}).sqft,"80");
});
