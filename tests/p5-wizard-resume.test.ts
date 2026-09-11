import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeWizardDraft} from '../lib/p5/wizardResume.ts';

test('restored question step advances to review when no questions remain',()=>{
  const draft={step:1,answers:{sqft:'80'},uploads:[{id:'saved-file'}],revision:7};
  const restored=resumeWizardDraft(draft,false);
  assert.equal(restored.step,2);
  assert.equal(restored.answers,draft.answers);
  assert.equal(restored.uploads,draft.uploads);
  assert.equal(restored.revision,7);
  assert.equal(draft.step,1);
});
test('new material questions return a restored review to the question step',()=>{
  assert.equal(resumeWizardDraft({step:2},true).step,1);
});
test('back navigation and input drafts stay on the input screen',()=>{
  const draft={step:0};
  assert.equal(resumeWizardDraft(draft,true),draft);
  assert.equal(resumeWizardDraft(draft,false),draft);
});
test('valid restored steps are unchanged',()=>{
  const question={step:1};const review={step:2};
  assert.equal(resumeWizardDraft(question,true),question);
  assert.equal(resumeWizardDraft(review,false),review);
});
