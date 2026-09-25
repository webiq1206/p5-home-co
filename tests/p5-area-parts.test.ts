import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExtraction} from '../lib/p5/scope.ts';

const raw=(facts:{field:string;value:string;evidence:string;basis?:string}[])=>({summary:'Synthetic scope',facts:facts.map(f=>({confidence:1,source:'typed scope',basis:'stated',...f})),conflicts:[],missingInformation:[],reviewNotes:[]});

test('a stated wall area and a stated floor area of one field add up instead of asking which one was meant (live Remodeling, 2026-09-25)',()=>{
  const x=validateExtraction(raw([{field:'tileSqft',value:'80',evidence:'about 80 square feet of wall tile'},{field:'tileSqft',value:'12',evidence:'12 square foot tiled floor'}]));
  const tile=x.facts.filter(f=>f.field==='tileSqft');
  assert.equal(tile.length,1);assert.equal(tile[0].value,'92');assert.equal(tile[0].basis,'calculated');assert.match(tile[0].evidence,/80 .*\+ 12 .*= 92/);
  assert.ok(!x.conflicts.some(c=>c.field==='tileSqft'),'no conflict question');
});
test('two rooms of flooring add up; the same surface twice is still a conflict; a stated total is never re-summed',()=>{
  const rooms=validateExtraction(raw([{field:'flooringSqft',value:'200',evidence:'200 square feet of LVP in the bedroom'},{field:'flooringSqft',value:'150',evidence:'150 square feet of LVP in the living room'}]));
  assert.equal(rooms.facts.find(f=>f.field==='flooringSqft')?.value,'350');assert.ok(!rooms.conflicts.length);
  const same=validateExtraction(raw([{field:'tileSqft',value:'80',evidence:'80 square feet of wall tile'},{field:'tileSqft',value:'100',evidence:'100 square feet of wall tile per the plan'}]));
  assert.ok(same.conflicts.some(c=>c.field==='tileSqft'&&c.values.length===2),'the same wall stated twice is asked');
  const total=validateExtraction(raw([{field:'tileSqft',value:'80',evidence:'80 square feet of wall tile'},{field:'tileSqft',value:'92',evidence:'92 square feet of tile in total'}]));
  assert.ok(total.conflicts.some(c=>c.field==='tileSqft'),'a stated total against a part is not summed');
  const bare=validateExtraction(raw([{field:'tileSqft',value:'80',evidence:'80 square feet'},{field:'tileSqft',value:'12',evidence:'12 square feet'}]));
  assert.ok(bare.conflicts.some(c=>c.field==='tileSqft'),'parts that name no surface are asked');
});
test('a reader reply whose facts arrive as a JSON string is read, not rejected (live Construction plan set, 2026-09-25)',()=>{
  const facts=[{field:'sqft',value:'2400',confidence:.95,source:'plans.pdf',basis:'stated',evidence:'2,400 SF conditioned'}];
  const x=validateExtraction({summary:'Sheet A1',facts:JSON.stringify(facts),conflicts:'[]',missingInformation:[],reviewNotes:[]});
  assert.equal(x.facts.length,1);assert.equal(x.facts[0].value,'2400');
  assert.throws(()=>validateExtraction({summary:'Sheet A1',facts:'not json at all',conflicts:[],missingInformation:[],reviewNotes:[]}),/Invalid/,'a string that is not JSON is still rejected');
});
