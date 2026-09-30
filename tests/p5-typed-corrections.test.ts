import test from 'node:test';
import assert from 'node:assert/strict';
import {applyExplicitTypedCorrections} from '../lib/p5/typedCorrections.ts';
import {readFileSync} from 'node:fs';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const evidence='Change only wall cabinets to 10 LF, superseding 8 LF in the PDF.';
const extraction=()=>({summary:'',facts:[{field:'cabinetUpperLf' as const,value:'8',confidence:1,basis:'stated' as const,source:'plans.pdf',evidence:'8 LF wall cabinets'},{field:'cabinetUpperLf' as const,value:'10',confidence:1,basis:'stated' as const,source:'typed scope',evidence}],conflicts:[{field:'cabinetUpperLf' as const,values:['8','10'],explanation:'PDF has 8; typed scope updates to 10.'}],missingInformation:[],reviewNotes:[]});
test('explicit typed correction resolves its quantity without a redundant question',()=>{
 const result=applyExplicitTypedCorrections(extraction(),evidence);
 assert.equal(result.conflicts.length,0);assert.deepEqual(result.facts.map(f=>f.value),['10']);
 assert.equal(extraction().facts.length,2,'original extraction remains untouched');
});

test('captured live combined revisions resolve only the explicitly changed components',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/p5-qualification/revision-extractions.json',import.meta.url),'utf8')) as {case:string;text:string;extraction:ScopeExtraction}[];
 for(const row of cases){
  const before=JSON.stringify(row.extraction);const output=applyExplicitTypedCorrections(row.extraction,row.text);
  assert.equal(output.conflicts.length,0,row.case);assert.equal(JSON.stringify(row.extraction),before,'no source mutation');
  assert.equal(applyExplicitTypedCorrections(row.extraction,'Use the uploaded document.').conflicts.length,row.extraction.conflicts.length,'no revision may be invented');
 }
 const adu=cases.find(row=>row.case==='adu')!;
 const water={field:'plumbing' as const,values:['20 LF water','40 LF water'],explanation:'Water extension length conflicts between plans.'};
 const output=applyExplicitTypedCorrections({...adu.extraction,conflicts:[...adu.extraction.conflicts,water]},adu.text);
 assert.deepEqual(output.conflicts,[water],'changing sewer does not answer a separate water conflict');
 const wrong=structuredClone(adu);wrong.extraction.facts.find(f=>f.field==='plumbing')!.value='Complete ADU plumbing, 40 LF sewer extension, 20 LF water extension';
 assert.ok(applyExplicitTypedCorrections(wrong.extraction,wrong.text).conflicts.length,'the extracted replacement must match the typed quantity');
});
test('a different number or fabricated typed evidence cannot silently override a document',()=>{
 const input=extraction();input.facts[1].evidence='I have 10 LF of wall cabinets.';
 assert.equal(applyExplicitTypedCorrections(input,input.facts[1].evidence).conflicts.length,1);
 assert.equal(applyExplicitTypedCorrections(extraction(),'Please follow the PDF.').conflicts.length,1);
 const mismatch=extraction();mismatch.facts[1].value='12';assert.equal(applyExplicitTypedCorrections(mismatch,evidence).conflicts.length,1);
 const wrongUnit=extraction();wrongUnit.facts[1].evidence=evidence.replace('10 LF','10 SF');assert.equal(applyExplicitTypedCorrections(wrongUnit,wrongUnit.facts[1].evidence).conflicts.length,1);
});
