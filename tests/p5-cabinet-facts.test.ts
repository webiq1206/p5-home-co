import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExtraction,type ExtractedFact} from '../lib/p5/scope.ts';
const fact=(field:ExtractedFact['field'],value:string,evidence:string):ExtractedFact=>({field,value,evidence,source:'typed scope',confidence:1,basis:'stated'});
const run=fact('cabinetBaseLf','8','8 LF base cabinets in kitchen');
const vanity={...fact('cabinetBaseLf','2.5','one 30-inch vanity; 30/12=2.5'),basis:'calculated' as const};
const extraction={summary:'600 SF ADU',facts:[run,vanity,fact('cabinetRoom','kitchen','Kitchen cabinet run'),fact('cabinetRoom','bathroom','one 30-inch vanity')],conflicts:[{field:'cabinetBaseLf' as const,values:['8','2.5'],explanation:'Different cabinet lengths'},{field:'cabinetRoom' as const,values:['kitchen','bathroom'],explanation:'Different cabinet rooms'}],missingInformation:[],reviewNotes:[]};
test('kitchen runs and a separate vanity retain both physical quantities without a false conflict',()=>{
 const result=validateExtraction(extraction);
 assert.deepEqual(result.facts.filter(f=>f.field==='cabinetBaseLf').map(f=>f.value),['8']);
 assert.deepEqual(result.facts.filter(f=>f.field==='cabinetRoom').map(f=>f.value),['kitchen']);
 assert.ok(result.facts.some(f=>f.field==='fixtures'&&f.evidence===vanity.evidence));
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(validateExtraction(result),result);
});
test('different widths of the same vanity remain a real conflict',()=>{
 const other={...vanity,value:'3',evidence:'one 36-inch vanity; 36/12=3'};
 const result=validateExtraction({...extraction,facts:[run,vanity,other]});
 assert.ok(result.conflicts.some(c=>c.field==='cabinetBaseLf'));
 assert.equal(result.facts.filter(f=>f.field==='cabinetBaseLf').length,3);
});
