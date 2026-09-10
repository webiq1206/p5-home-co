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
