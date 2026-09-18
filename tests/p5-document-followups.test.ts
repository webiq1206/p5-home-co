import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReview} from '../services/document-service/src/contracts.mjs';
import {reviewForWebsite} from '../services/document-service/src/website-review.mjs';
import {validateExtraction} from '../lib/p5/scope.ts';
import {reconcileScope,scopeQuestions} from '../lib/p5/adaptive.ts';
import {instructionPrompts,removeInstructionPrompt} from '../lib/p5/clarifications.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';

// Sanitized synthetic fixture from the owner's successful deployed QA review.
const doorQuestion='What size and type are the 4 interior doors (slab vs. pre-hung, with or without jambs, casing and hardware)?';
const materialQuestion='Is the baseboard and finish paint supplied by the contractor, and is it pre-primed/pre-finished or field-painted after installation?';
const source='P5-QA.pdf p.1';
const manifest=[{source:'P5-QA.pdf',page:1,sheet:'',revision:'',status:'read',notes:['Door dimensions explicitly stated as not supplied.']}];
const fixture=()=>({summary:'Install 120 linear feet of painted baseboard and 4 interior doors. Plumbing and electrical excluded.',
 facts:[
  {field:'trimLf',value:'120',evidence:'Install 120 linear feet of painted baseboard.',source,confidence:.95,basis:'stated'},
  {field:'materials',value:'Painted baseboard trim',evidence:'Install 120 linear feet of painted baseboard.',source,confidence:.9,basis:'stated'},
  {field:'otherDetails',value:'Door dimensions are not supplied',evidence:'Door dimensions are not supplied.',source,confidence:.95,basis:'stated'}
 ],takeoffs:[{id:'doors',description:'Interior doors, dimensions not supplied',component:'Interior door',building:'',floor:'',quantity:4,unit:'each',basis:'stated',evidence:'Install 4 interior doors. Door dimensions are not supplied.',sources:[{source:'P5-QA.pdf',page:1,sheet:'',revision:''}],supersedes:[],issues:['Door dimensions not supplied']}],
 instructions:{...emptyInstructions(),inclusions:['Install 120 lf baseboard','Install 4 interior doors'],exclusions:['Plumbing work','Electrical work']},
 clarifications:[{field:'otherDetails',question:doorQuestion,reason:'Door dimensions and configuration affect the door cost.'},{field:'materials',question:materialQuestion,reason:'Supply and painting responsibility affect material and labor costs.'}],
 conflicts:[],reviewNotes:[],missingInformation:['Door dimensions','Material supply responsibility']
});

test('saved source details cannot hide outstanding door and material decisions',()=>{
 const extraction=validateExtraction(reviewForWebsite(validateReview(fixture(),manifest)));
 const {answers,conflicts}=reconcileScope({service:'handyman'},extraction);
 assert.equal(answers.trimLf,'120');assert.equal(answers.materials,'Painted baseboard trim');
 assert.equal(answers.otherDetails,'Door dimensions are not supplied');
 const questions=scopeQuestions(answers,extraction,conflicts);
 for(const question of [doorQuestion,materialQuestion]){
  const matches=questions.filter(q=>q.reason===question);
  assert.equal(matches.length,1,`Exactly one pending question: ${question}`);
  assert.ok(matches[0].instructionId,'the answer uses the existing saved scope-question flow');
 }
 assert.ok(!questions.some(q=>['trimLf','sqft','finish','plumbing','electrical'].includes(q.field)));
 assert.deepEqual(extraction.instructions?.exclusions,['Plumbing work','Electrical work']);
 assert.equal(extraction.takeoffs?.[0].quantity,4);
 assert.equal(extraction.documentCoverage?.complete,true);
});

test('answered question is removed independently while source evidence and other questions survive',()=>{
 const extraction=validateExtraction(reviewForWebsite(validateReview(fixture(),manifest)));
 const {answers}=reconcileScope({service:'handyman'},extraction);
 const prompt=instructionPrompts(extraction,answers).find(q=>q.question===doorQuestion);
 assert.ok(prompt);
 const before=structuredClone(extraction);
 const updated={...extraction,instructions:removeInstructionPrompt(extraction.instructions!,prompt.id)};
 const questions=scopeQuestions(answers,updated);
 assert.ok(!questions.some(q=>q.reason===doorQuestion));
 assert.ok(questions.some(q=>q.reason===materialQuestion));
 assert.deepEqual(updated.facts,before.facts);assert.deepEqual(updated.takeoffs,before.takeoffs);
 assert.deepEqual(updated.documentCoverage,before.documentCoverage);
});
