import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReview} from '../src/contracts.mjs';

const manifest=[{source:'QA.pdf',page:1,sheet:'',revision:'',status:'read',notes:[]}];
const fact=(field,value)=>({field,value,confidence:.9,source:'QA.pdf p.1',evidence:value,basis:'stated'});
const review=facts=>({summary:'Synthetic scope',facts,takeoffs:[],clarifications:[],conflicts:[],reviewNotes:[]});

test('a physical finish and unfamiliar trade survive as sourced scope without invented enum choices',()=>{
 const originals=[fact('finish','Painted baseboard'),fact('service','Specialty acoustic baffle installation')];
 const result=validateReview(review(originals),manifest);
 assert.deepEqual(result.facts,originals.map((f,i)=>({...f,field:'otherDetails',value:`${i?'Project type':'Finish level'}: ${f.value}`})));
 assert.deepEqual(originals.map(f=>f.field),['finish','service'],'normalization does not rewrite source fact objects');
 assert.ok(!result.facts.some(f=>f.field==='finish'||f.field==='service'),'no grade or project type is invented');
 const before=structuredClone(result);assert.deepEqual(validateReview(result,manifest),before,'revalidation does not prepend labels again');
});

test('only exact option spellings with harmless formatting differences set a choice',()=>{
 const result=validateReview(review([fact('service',' New_Construction '),fact('finish','HIGH END'),fact('urgency','standard')]),manifest);
 assert.deepEqual(result.facts.map(f=>[f.field,f.value]),[['service','new-construction'],['finish','high-end'],['urgency','standard']]);
 for(const [field,value] of [['urgency','not an emergency'],['garageIncluded','yes, except detached garage'],['finish','mid-range or luxury']]){
  const [preserved]=validateReview(review([fact(field,value)]),manifest).facts;
  assert.equal(preserved.field,'otherDetails');assert.ok(preserved.value.endsWith(value));
 }
});

test('custom descriptions preserve quantities, exclusions, takeoff provenance and missing information',()=>{
 const result=review([fact('finish','Painted baseboard'),fact('trimLf','120'),fact('otherDetails','Door dimensions are not supplied')]);
 result.instructions={inclusions:['Install 120 lf baseboard','Install 4 interior doors'],exclusions:['Plumbing','Electrical']};
 result.missingInformation=['Door dimensions'];
 result.takeoffs=[{id:'doors',quantity:4,unit:'each',basis:'stated',evidence:'Install 4 interior doors.',sources:[{source:'QA.pdf',page:1}]}];
 const before=structuredClone(result);validateReview(result,manifest);
 for(const key of ['instructions','missingInformation','takeoffs'])assert.deepEqual(result[key],before[key]);
 assert.equal(result.facts.find(f=>f.field==='trimLf').value,'120');
 assert.equal(result.pages.length,1);
});

test('known absent information remains a focused clarification instead of a reread request',()=>{
 const result=review([]);
 result.missingInformation=['Door dimensions are not supplied'];
 result.clarifications=[];
 const validated=validateReview(result,manifest);
 assert.deepEqual(validated.missingInformation,['Door dimensions are not supplied']);
 assert.equal(validated.clarifications.length,1);
 assert.equal(validated.clarifications[0].field,'otherDetails');
 assert.match(validated.clarifications[0].question,/door dimensions/i);
 assert.match(validated.clarifications[0].reason,/cannot be recovered by rereading/i);
 assert.equal(validated.pages[0].status,'read');
});

test('custom-scope preservation does not relax structural, numeric or provenance validation',()=>{
 for(const f of [fact('unknownField','custom'),fact('finish',''),{...fact('finish','Painted'),evidence:''},{...fact('finish','Painted'),confidence:2}]){
  assert.throws(()=>validateReview(review([f]),manifest),/invalid-review-fact/);
 }
 for(const value of ['120 feet','unknown','-1'])assert.throws(()=>validateReview(review([fact('trimLf',value)]),manifest),/invalid-numeric-fact/);
 const result=review([fact('finish','Painted baseboard')]);
 result.takeoffs=[{id:'doors',quantity:4,basis:'stated',sources:[{source:'another-project.pdf',page:1}]}];
 assert.throws(()=>validateReview(result,manifest),/invalid-takeoff-provenance/);
 assert.equal(result.facts[0].field,'finish','failed validation cannot partially rewrite the result');
});
