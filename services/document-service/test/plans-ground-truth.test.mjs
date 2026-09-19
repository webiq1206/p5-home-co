import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targetedChecks} from '../scripts/model-qa-support.mjs';

const result=()=>({facts:[['sqft','3019'],['garageSqft','836'],['coveredOutdoorSqft','557'],['stories','2']].map(([field,value])=>({field,value})),conflicts:[],pages:Array.from({length:23},(_,i)=>({page:i+1,status:'read',sheet:i===9?'A5.1':''}))});
test('plans checks retain independently transcribed cover quantities and scanned sheet identity',()=>{
 const quality=targetedChecks('plans',result(),23);
 assert.equal(quality.passed,true);assert.equal(quality.checks.length,6);
 assert.equal(quality.exhaustive,false);assert.equal(quality.quantityAccuracy,null);
});
for(const [field,value] of [['sqft','3855'],['garageSqft','559'],['coveredOutdoorSqft','443'],['stories','1']])test('plans fail incorrect '+field+' even with every page marked read',()=>{
 const wrong=result();wrong.facts.find(f=>f.field===field).value=value;
 assert.equal(targetedChecks('plans',wrong,23).passed,false);
});
test('missing, contradictory and nonnumeric quantities do not pass by matching a fragment',()=>{
 for(const mutate of [r=>r.facts.shift(),r=>r.facts.push({field:'sqft',value:'2422'}),r=>r.facts[0].value='3019 or 3855',r=>r.conflicts.push({field:'sqft',values:['3019','3855']})]){
  const wrong=result();mutate(wrong);assert.equal(targetedChecks('plans',wrong,23).passed,false);
 }
});
test('correct quantities cannot promote partial coverage or hide a missing scanned sheet',()=>{
 const partial=result();partial.pages[0].status='partial';assert.equal(targetedChecks('plans',partial,23).passed,false);
 const omitted=result();omitted.pages.splice(9,1);assert.equal(targetedChecks('plans',omitted,23).passed,false);
 const relabeled=result();relabeled.pages[9].sheet='A5.2';assert.equal(targetedChecks('plans',relabeled,23).passed,false);
});
