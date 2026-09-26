import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatorTheme} from '../lib/p5/theme.ts';
import {issueRecord} from '../lib/p5/estimateDocument.ts';

test('every family estimator uses light surfaces and accessible brand text',()=>{
  for(const id of ['p5','remodeling','construction','handyman','cabinet','unknown']){
    const theme=estimatorTheme(id);
    assert.equal(theme.mode,'light');
    assert.notEqual(theme.accentInk,theme.accent);
  }
});
const base={brandId:'cabinet',id:'792674a5-0000-4000-8000-000000000000',revision:1,now:new Date('2026-09-26T12:00:00Z'),contact:{name:'Test',email:''}};
test('text-only finish extraction is not attributed to an uploaded document',()=>{
  const issue=issueRecord({...base,scope:{answers:{service:'cabinet-install',finish:'mid-range'},uploads:[],extraction:{facts:[{field:'finish',value:'mid-range',source:'typed scope',basis:'stated'}]}}});
  assert.equal(issue.finishBasis,'description');
});
test('a matching named attachment is required for document provenance',()=>{
  const scope={answers:{service:'kitchen',finish:'mid-range'},uploads:[{name:'selections.pdf'}],extraction:{facts:[{field:'finish',value:'mid-range',source:'selections.pdf page 2',basis:'stated'}]}};
  assert.equal(issueRecord({...base,scope}).finishBasis,'document');
  assert.equal(issueRecord({...base,scope:{...scope,answers:{...scope.answers,finish:'luxury'}}}).finishBasis,'selected');
  assert.equal(issueRecord({...base,scope:{...scope,uncertainFields:['finish']}}).finishBasis,'assumed');
});
