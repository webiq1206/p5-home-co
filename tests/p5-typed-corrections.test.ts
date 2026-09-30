import test from 'node:test';
import assert from 'node:assert/strict';
import {applyExplicitTypedCorrections} from '../lib/p5/typedCorrections.ts';
const evidence='Change only wall cabinets to 10 LF, superseding 8 LF in the PDF.';
const extraction=()=>({summary:'',facts:[{field:'cabinetUpperLf' as const,value:'8',confidence:1,basis:'stated' as const,source:'plans.pdf',evidence:'8 LF wall cabinets'},{field:'cabinetUpperLf' as const,value:'10',confidence:1,basis:'stated' as const,source:'typed scope',evidence}],conflicts:[{field:'cabinetUpperLf' as const,values:['8','10'],explanation:'PDF has 8; typed scope updates to 10.'}],missingInformation:[],reviewNotes:[]});
test('explicit typed correction resolves its quantity without a redundant question',()=>{
 const result=applyExplicitTypedCorrections(extraction(),evidence);
 assert.equal(result.conflicts.length,0);assert.deepEqual(result.facts.map(f=>f.value),['10']);
 assert.equal(extraction().facts.length,2,'original extraction remains untouched');
});
test('a different number or fabricated typed evidence cannot silently override a document',()=>{
 const input=extraction();input.facts[1].evidence='I have 10 LF of wall cabinets.';
 assert.equal(applyExplicitTypedCorrections(input,input.facts[1].evidence).conflicts.length,1);
 assert.equal(applyExplicitTypedCorrections(extraction(),'Please follow the PDF.').conflicts.length,1);
 const mismatch=extraction();mismatch.facts[1].value='12';assert.equal(applyExplicitTypedCorrections(mismatch,evidence).conflicts.length,1);
 const wrongUnit=extraction();wrongUnit.facts[1].evidence=evidence.replace('10 LF','10 SF');assert.equal(applyExplicitTypedCorrections(wrongUnit,wrongUnit.facts[1].evidence).conflicts.length,1);
});
