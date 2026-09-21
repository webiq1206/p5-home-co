import test from 'node:test';
import assert from 'node:assert/strict';
import {unaskedQuestions,MAX_OTHER_QUESTIONS} from '../lib/p5/questionBudget.ts';

const q=(field:string,label:string,reason:string)=>({field,label,reason});
const asked=(label:string,text:string)=>({kind:'question',label,text});

test('a question already asked is never asked again, even reworded by a later document read',()=>{
  const transcript=[asked('Crawl space area','How many square feet is the crawl space?')];
  const open=[q('sqft','Crawl space area','How many square feet of crawl space need the vapor barrier?'),q('fixtureCount','Hose bibs','How many exterior hose bibs need vacuum breakers?')];
  assert.deepEqual(unaskedQuestions(open,transcript).map(x=>x.field),['fixtureCount'],'same field is not asked twice');
  const reworded=[q('otherDetails','Other details','How many square feet is the crawl space area?')];
  assert.deepEqual(unaskedQuestions(reworded,transcript),[],'nearly the same wording is not asked twice');
});
test('one round never offers the same field or wording twice',()=>{
  const open=[q('bathrooms','Bathrooms','How many bathrooms need exhaust vent corrections?'),q('bathrooms','Bathrooms','How many bathroom fans vent into the attic?')];
  assert.equal(unaskedQuestions(open,[]).length,1);
});
test('questions that change the price come first and are never capped; the rest stay few',()=>{
  const transcript=Array.from({length:MAX_OTHER_QUESTIONS},(_,i)=>asked(`Earlier ${i}`,`Earlier question number ${i} about something else entirely`));
  const open=[q('schedule','Schedule','When would you like the work done?'),q('sqft','Project area (SF)','What is the square footage of the home?')];
  assert.deepEqual(unaskedQuestions(open,transcript,['sqft']).map(x=>x.field),['sqft'],'the priced question survives the cap; the optional one does not');
  const topics=['roof pitch','window count','door schedule','cabinet style','countertop material','flooring type','tile height','paint colors','lighting fixtures','plumbing fixtures','HVAC tonnage','electrical panel','insulation type','siding material','garage doors','driveway width','landscaping budget','fence length'];
  const eighteen=topics.map((topic,i)=>q(`field${i}`,`Label ${i}`,`Please confirm the ${topic}`));
  assert.equal(unaskedQuestions(eighteen,[]).length,MAX_OTHER_QUESTIONS,'a large plan set asks a handful, not eighteen');
});
