import test from 'node:test';
import assert from 'node:assert/strict';
import {separateFixtureFacts} from '../lib/p5/fixtureFacts.ts';
import {validateExtraction,combineScopeExtractions,type ExtractedFact} from '../lib/p5/scope.ts';
const fact=(value:string,evidence:string):ExtractedFact=>({field:'fixtureCount',value,evidence,source:'schedule.pdf',confidence:.99,basis:'stated'});
const three=fact('3','Three scheduled fixtures: mop sink, lobby sink and drinking fountain.');
const two=fact('2','Two 100-gallon water heaters.');
const conflict={field:'fixtureCount' as const,values:['3','2'],explanation:'Different fixture counts.'};
const extraction=(facts:ExtractedFact[])=>({summary:'Fixture schedule',facts,conflicts:[],missingInformation:[],reviewNotes:[]});
test('independent fixture groups retain both counts without asking for a false global total',()=>{
 const separated=separateFixtureFacts([three,two],[conflict]);assert.deepEqual(separated.conflicts,[]);
 assert.ok(separated.facts.every(f=>f.field==='fixtures'));assert.deepEqual(separated.facts.map(f=>f.evidence),[three.evidence,two.evidence]);
 const validated=validateExtraction({...extraction([three,two]),conflicts:[conflict]});assert.deepEqual(validated.conflicts,[]);
 const merged=combineScopeExtractions([validateExtraction(extraction([three])),validateExtraction(extraction([two]))]);
 assert.ok(!merged.conflicts.some(c=>c.field==='fixtureCount'));assert.ok(merged.facts.every(f=>f.field!=='fixtureCount'));
});
test('same-type and ambiguous counts still require clarification',()=>{
 for(const other of [fact('2','Two scheduled fixtures.'),fact('2','Two fixtures: mop sink and lobby sink.'),fact('2','Two drinking fountains.')]){
  const result=separateFixtureFacts([three,other],[conflict]);assert.deepEqual(result.conflicts,[conflict]);assert.equal(result.facts[0].field,'fixtureCount');
 }
 const sameType=separateFixtureFacts([two,fact('3','Three 100-gallon water heaters.')],[conflict]);assert.deepEqual(sameType.conflicts,[conflict]);
});

test('a generic scheduled count uses the matching named fixture schedule, not the water-heater count',()=>{
 const generic=fact('3','Quantity basis: Three scheduled fixtures');
 const schedule={...fact('Mop sink, lobby sink, foyer fountain (3 scheduled fixtures; 5 additional fountains excluded)','Mop sink, lobby sink, foyer fountain'),'field':'fixtures' as const};
 const result=separateFixtureFacts([generic,two,schedule],[conflict]);
 assert.deepEqual(result.conflicts,[]);
 assert.ok(result.facts.every(f=>f.field==='fixtures'));
 const unrelated={...schedule,value:'Mop sink, lobby sink and foyer fountain'};
 assert.deepEqual(separateFixtureFacts([generic,two,unrelated],[conflict]).conflicts,[conflict]);
});
