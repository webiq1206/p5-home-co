import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence} from '../src/core.mjs';
import {validateReview} from '../src/contracts.mjs';

const record=(extra={})=>({page:1,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[],regions:[],...extra});
const source=text=>({page:1,kind:'text',textQuality:1,text,spans:[]});

test('a resolved-conflict note does not invalidate a completely read source',()=>{
 const page=validateEvidence({pages:[record({notes:['No unresolved conflicts remain after verification.']})]},[source('Install 120 linear feet of baseboard.')]).pages[0];
 assert.equal(page.status,'read');
});

for(const note of [
 'No unresolved conflicts remain. Confirm the unreadable ceiling dimension.',
 'No unresolved conflicts remain, but the roof slope is unclear.',
 'No conflicts remain on page 1; conflicting dimensions remain on page 2.',
 'No unresolved conflicts remain on page 1, but conflicts remain around the stair.',
])test('a clearance statement cannot hide a separate unresolved finding: '+note,()=>{
 assert.equal(validateEvidence({pages:[record({notes:[note]})]},[source('Scope')]).pages[0].status,'partial');
});

test('a clearance note cannot promote structured partial coverage',()=>{
 for(const extra of [{status:'partial'},{regions:[{x:0,y:0,width:.2,height:.2,reason:'Unread dimension'}]},{facts:[{field:'otherDetails',value:'Ceiling dimension unclear',evidence:'Ceiling dimension unclear',basis:'uncertain'}]}]){
  assert.equal(validateEvidence({pages:[record({...extra,notes:['No unresolved conflicts remain after verification.']})]},[source('Scope')]).pages[0].status,'partial');
 }
});

test('an explicit duration remains usable beside an unrelated issue date',()=>{
 const text='Project duration: 6 months. Issue Date: 13 July 2026.';
 const fact={field:'projectMonths',value:'6',evidence:text,basis:'stated'};
 assert.equal(validateEvidence({pages:[record({facts:[fact]})]},[source(text)]).pages[0].facts[0].value,'6');
 const review={summary:'Scope',facts:[{...fact,confidence:1,source:'scope.pdf'}],takeoffs:[],clarifications:[],conflicts:[],reviewNotes:[]};
 assert.equal(validateReview(review,[{source:'scope.pdf',page:1,status:'read',notes:[]}]).facts[0].value,'6');
});

test('a nearby duration cannot validate the wrong number extracted from a date',()=>{
 const text='Project duration: 6 months. Issue Date: 13 July 2026.';
 const fact={field:'projectMonths',value:'13',evidence:text,basis:'stated'};
 assert.throws(()=>validateEvidence({pages:[record({facts:[fact]})]},[source(text)]),/invalid-project-duration-source/);
 assert.throws(()=>validateReview({summary:'Scope',facts:[{...fact,confidence:1,source:'scope.pdf'}],takeoffs:[],clarifications:[],conflicts:[],reviewNotes:[]},[{source:'scope.pdf',page:1,status:'read',notes:[]}]),/invalid-project-duration-source/);
});
