import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceMixedSources} from '../lib/p5/analysisWork.ts';
import {type ScopeExtraction} from '../lib/p5/scope.ts';
import {reconcileScope} from '../lib/p5/adaptive.ts';
import type {Draft} from '../lib/p5/store.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
const extraction=(source:string,value:string):ScopeExtraction=>({
 summary:source,facts:[{field:'sqft',value,source,evidence:`Area ${value}`,confidence:1,basis:'stated'}],
 conflicts:[],missingInformation:[],reviewNotes:[],
});
const done=(e:ScopeExtraction)=>({pending:false as const,version:'fixture',analysis:{extraction:e,provider:'offline fixture',model:'none',analyzedAt:'2026-01-01T00:00:00Z'}});
const draft={id:'offline-project',brand:ESTIMATOR_BRAND.id,uploads:[
 {id:'pdf',name:'plans.pdf',type:'application/pdf',status:'stored',size:5,sha256:'a'},
 {id:'photo',name:'photo.png',type:'image/png',status:'stored',size:5,sha256:'b'},
 {id:'csv',name:'rooms.csv',type:'text/csv',status:'stored',size:5,sha256:'c'},
 {id:'xlsx',name:'schedule.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',status:'stored',size:5,sha256:'d'},
]} as Draft;
test('PDF/photo/CSV/XLSX contributions share one scope with contradictions and manual answers intact',async()=>{
 const pdf=extraction('plans.pdf','120'),other=extraction('rooms.csv','140');
 other.facts.push({field:'materials',value:'Oak fronts',source:'photo.png',evidence:'Visible oak fronts',confidence:.8,basis:'visual'},
  {field:'otherDetails',value:'Retain existing hinges',source:'schedule.xlsx',evidence:'Retain existing hinges',confidence:1,basis:'stated'});
 pdf.facts.push({field:'exclusions',value:'No flooring',source:'typed scope',evidence:'No flooring',confidence:1,basis:'stated'});
 const answers={exclusions:'No flooring',ownerSupplied:'Appliances',sqft:'130'};
 const result=await advanceMixedSources(draft,'Retain existing hinges. No flooring.',answers,async d=>{
  assert.deepEqual(d.uploads.map(u=>u.id),['pdf']);return done(pdf);
 },async d=>{
  assert.deepEqual(d.uploads.map(u=>u.id),['photo','csv','xlsx']);return done(other);
 });
 assert.equal(result.pending,false);if(result.pending)return;
 const merged=result.analysis.extraction;
 assert.ok(merged.facts.some(f=>f.value==='Oak fronts'));
 assert.ok(merged.facts.some(f=>f.value==='Retain existing hinges'));
 assert.ok(merged.facts.some(f=>f.value==='No flooring'));
 assert.ok(merged.conflicts.some(c=>c.field==='sqft'));
 const reconciled=reconcileScope(answers,merged,{});
 assert.equal(reconciled.answers.ownerSupplied,'Appliances');
 assert.equal(reconciled.answers.exclusions,'No flooring');
 assert.equal(reconciled.answers.sqft,'130');
 assert.deepEqual(answers,{exclusions:'No flooring',ownerSupplied:'Appliances',sqft:'130'});
});
test('missing spreadsheet quantity remains missing; no invented photo measurements',async()=>{
 const pdf:ScopeExtraction={summary:'Included cabinets',facts:[],conflicts:[],missingInformation:['Cabinet length is not supplied'],reviewNotes:[],clarifications:[{field:'cabinetBaseLf',question:'What is the measured cabinet run?',reason:'Required for cabinet quantity'}]};
 const result=await advanceMixedSources(draft,'Install cabinets',{},async()=>done(pdf),async()=>done({...pdf,summary:'Photo has no scale'}));
 assert.equal(result.pending,false);if(result.pending)return;
 assert.equal(result.analysis.extraction.facts.some(f=>f.field==='cabinetBaseLf'),false);
 assert.ok(result.analysis.extraction.clarifications?.some(q=>q.field==='cabinetBaseLf'));
 assert.ok(result.analysis.extraction.missingInformation.includes('Cabinet length is not supplied'));
});
test('pending or rejected remote PDF never falls back to local or reports completion',async()=>{
 let localCalls=0;
 const local=async()=>{localCalls++;return done(extraction('photo','1'));};
 const pending=await advanceMixedSources(draft,'',{},async()=>({pending:true,progress:'Saved PDF reading'}),local);
 assert.equal(pending.pending,true);assert.equal(localCalls,0);
 await assert.rejects(advanceMixedSources(draft,'',{},async()=>{throw new Error('Host capacity mismatch');},local),/capacity/);
 assert.equal(localCalls,0);
});
test('local pending remains pending even after PDF completion',async()=>{
 const result=await advanceMixedSources(draft,'',{},async()=>done(extraction('plans.pdf','120')),async()=>({pending:true,progress:'Reading spreadsheet'}));
 assert.equal(result.pending,true);
});