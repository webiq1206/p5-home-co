import test from 'node:test';
import assert from 'node:assert/strict';
import {combineScopeExtractions,type ScopeExtraction,type ExtractedFact} from '../lib/p5/scope.ts';

const page=(facts:ExtractedFact[]):ScopeExtraction=>({summary:'',facts,conflicts:[],missingInformation:[],reviewNotes:[]});
const fact=(field:ExtractedFact['field'],value:string,evidence:string,basis:ExtractedFact['basis']='stated',source='estimate.pdf, page 1'):ExtractedFact=>({field,value,evidence,basis,source,confidence:.95});
test('separately named fixture schedule rows retain quantities without a false aggregate conflict',()=>{
 const rows=[fact('fixtureCount','1','Vanity light fixture (EA) 1'),fact('fixtureCount','3','Surface mount LED ceiling fixtures (EA) 3'),fact('fixtureCount','12','Duplex receptacles, switches and wall plates (EA) 12')];
 const result=combineScopeExtractions([page(rows)]);
 assert.equal(result.facts.filter(f=>f.field==='taskList').length,3);
 assert.deepEqual(result.facts.map(f=>f.evidence),rows.map(f=>f.evidence));
 assert.deepEqual(result.conflicts,[]);
 const saved=page(rows);saved.conflicts=[{field:'fixtureCount',values:['1','3','12'],explanation:'Different document pages state different values. Confirm the intended project information.'}];
 assert.deepEqual(combineScopeExtractions([saved]).conflicts,[]);
});
test('same-item discrepancies, totals, and different sources remain fixture conflicts',()=>{
 for(const pair of [
  [fact('fixtureCount','1','Vanity light fixture (EA) 1'),fact('fixtureCount','2','Vanity light fixture (EA) 2')],
  [fact('fixtureCount','1','Vanity light fixture (EA) 1'),fact('fixtureCount','3','Total fixtures (EA) 3')],
  [fact('fixtureCount','1','Vanity light fixture (EA) 1'),fact('fixtureCount','3','Ceiling lights (EA) 3','stated','revised.pdf')],
 ])assert.equal(combineScopeExtractions([page(pair)]).conflicts[0]?.field,'fixtureCount');
});
test('flooring component does not conflict with its verified arithmetic total',()=>{
 const result=combineScopeExtractions([
  page([fact('flooringSqft','380','380 SF carpet in bedroom')]),
  page([fact('flooringSqft','500','380 SF carpet + 120 SF LVP bathroom = 500 SF total installed flooring.','calculated','estimate.pdf')]),
 ]);
 assert.deepEqual(result.facts.map(f=>f.value),['500']);
 assert.deepEqual(result.conflicts,[]);
});
test('unsupported arithmetic and different documents retain conflicting measurements',()=>{
 for(const [evidence,source] of [['380 SF carpet + 100 SF LVP = 500 SF total','estimate.pdf'],['380 SF carpet + 120 SF LVP = 500 SF total','different.pdf']]){
  const result=combineScopeExtractions([page([fact('flooringSqft','380','380 SF carpet')]),page([fact('flooringSqft','500',evidence,'calculated',source)])]);
  assert.equal(result.conflicts[0]?.field,'flooringSqft');
 }
});
test('resumed page aggregation clears only the obsolete automatic conflict',()=>{
 const saved=page([fact('flooringSqft','380','380 SF carpet'),fact('flooringSqft','500','380 SF carpet + 120 SF LVP = 500 SF total','calculated','estimate.pdf')]);
 saved.conflicts=[{field:'flooringSqft',values:['380','500'],explanation:'Different document pages state different values. Confirm the intended project information.'}];
 assert.deepEqual(combineScopeExtractions([saved]).conflicts,[]);
 saved.conflicts[0].explanation='The owner requested 380 SF but the revised plans specify 500 SF.';
 assert.equal(combineScopeExtractions([saved]).conflicts.length,1);
});
test('exterior and interior trim are distinct components, not competing quantities',()=>{
 const result=combineScopeExtractions([page([fact('trimLf','140','Exterior Trim and Corner Boards 140 LF')]),page([fact('trimLf','400','220 LF baseboard + 180 LF casing = 400 LF total','calculated','estimate.pdf, page 2')])]);
 assert.equal(result.facts[0]?.value,'540');
 assert.deepEqual(result.conflicts,[]);
});
