import test from 'node:test';
import assert from 'node:assert/strict';
import {saveCompletedAnalysis,readCompletedAnalysis,recoverTypedAnalysis} from '../lib/p5/savedAnalysis.ts';
import {analysisWorkKey} from '../lib/p5/analysisWork.ts';
import {ESTIMATOR_MODEL_SNAPSHOT,MODEL_POLICY_VERSION} from '../lib/p5/modelPolicy.ts';
import {normalizeDimensionSubjects} from '../lib/p5/scopeInterpretation.ts';
import {manualScopeAnswers} from '../lib/p5/adaptive.ts';
import type {Draft} from '../lib/p5/store.ts';
const text='Remodel a 120 SF room in Boise; paint walls with 44 LF perimeter. Retain the existing floor and all doors/windows.';
const answers={sqft:'120',service:'remodel',location:'Boise'};
const fact=(field:any,value:string,evidence:string)=>({field,value,evidence,source:'typed scope',confidence:1,basis:'stated' as const});
const extraction={summary:text,facts:[fact('sqft','120','120 SF'),fact('service','remodel','Remodel'),fact('location','Boise','Boise'),fact('trimLf','44','44 LF perimeter')],conflicts:[],reviewNotes:[],missingInformation:[],documentCoverage:{complete:true,expectedPages:0,pages:[]}};
const analysis={provider:'verified test provider',model:ESTIMATOR_MODEL_SNAPSHOT,modelPolicy:MODEL_POLICY_VERSION,analyzedAt:'2026-10-05T04:07:00Z',extraction};
const draft={id:'only-this-draft',text,uploads:[],answers,extraction,revision:4} as unknown as Draft;
const input={text,answers:manualScopeAnswers({...answers,trimLf:'44'},extraction),uploads:[],extraction};
const job=()=>({prepared:0,units:[],notes:[],textDone:structuredClone(analysis)});
const hint=JSON.stringify(answers);
const row=(namespace:'local'|'remote'='local')=>({work_key:analysisWorkKey(draft,text,answers,namespace),payload:job(),active:false});

test('both historical typed namespaces recover the exact server result and leave its receipt unchanged',async()=>{
 for(const namespace of ['local','remote'] as const){
  const stored=row(namespace),before=JSON.stringify(stored);
  const result=await recoverTypedAnalysis(draft,input,hint,async(sql,values)=>{
   assert.match(sql,/draft_id=\$1 AND work_key IN \(\$2,\$3\)/);
   assert.deepEqual(values,[draft.id,analysisWorkKey(draft,text,answers,'local'),analysisWorkKey(draft,text,answers,'remote')]);
   return [stored];
  });
  const normalized=normalizeDimensionSubjects(result.analysis.extraction,text);
  assert.ok(!normalized.facts.some(f=>f.field==='trimLf'));
  assert.ok(normalized.facts.some(f=>f.field==='sqft'&&f.value==='120'));
  assert.equal(JSON.stringify(stored),before);
  result.analysis.extraction.facts.length=0;
  assert.equal(JSON.stringify(stored),before);
 }
});

test('historical lookup rejects changed identity, answers, source, files, invalid hints and ambiguous results',async()=>{
 const reader=async(_sql:string,values:unknown[]=[])=>values.includes(row().work_key)?[row()]:[];
 for(const changed of [{...input,text:text+' Add one window.'},{...input,answers:{location:'Nampa'}},{...input,answers:{sqft:'240'},resolutions:{sqft:'240'}},{...input,uploads:[{id:'new',sha256:'new'}] as any}]){
  await assert.rejects(()=>recoverTypedAnalysis({...draft,uploads:changed.uploads},changed,hint,reader),{status:409});
 }
 for(const bad of ['null','[]','{"unknown":"value"}','{"sqft":120}','x'.repeat(16001)])await assert.rejects(()=>recoverTypedAnalysis(draft,input,bad,reader),{status:409});
 await assert.rejects(()=>recoverTypedAnalysis(draft,input,hint,async()=>[]),{status:409});
 await assert.rejects(()=>recoverTypedAnalysis(draft,input,hint,async()=>[row(),row('remote')]),{status:409});
});

test('active, incomplete, wrong-policy and unverified checkpoints cannot be recovered',async()=>{
 for(const mutate of [
  (r:any)=>r.active=true,
  (r:any)=>r.payload.textDone.modelPolicy='old',
  (r:any)=>r.payload.textDone.model='wrong',
  (r:any)=>r.payload.textDone.analyzedAt='',
  (r:any)=>r.payload.textDone.provider='',
  (r:any)=>r.payload.units=[{result:analysis}],
  (r:any)=>r.payload.preparationFailures=['unread'],
  (r:any)=>r.payload.notes=['incomplete'],
  (r:any)=>r.payload.textDone.extraction.documentCoverage.complete=false,
 ]){const stored=row();mutate(stored);await assert.rejects(()=>recoverTypedAnalysis(draft,input,hint,async()=>[stored]),{status:409});}
});

test('completed results persist once by content address and replay equivalent or exact input without extraction',async()=>{
 const rows:any[]=[];
 const write=async(sql:string,values:unknown[]=[])=>{
  assert.match(sql,/ON CONFLICT DO NOTHING/);
  assert.equal(values[0],draft.id);
  const work_key=String(values[1]);if(!rows.some(r=>r.work_key===work_key))rows.push({work_key,payload:JSON.parse(String(values[2]))});return [];
 };
 await saveCompletedAnalysis(draft.id,{text,answers,uploads:[]},analysis,write);
 await saveCompletedAnalysis(draft.id,{text,answers,uploads:[]},structuredClone(analysis),write);
 assert.equal(rows.length,1);
 const read=async(sql:string,values:unknown[]=[])=>{assert.match(sql,/draft_id=\$1/);assert.deepEqual(values,[draft.id]);return rows;};
 assert.ok(await readCompletedAnalysis(draft.id,input,read));
 assert.ok(await readCompletedAnalysis(draft.id,{text,answers,uploads:[],extraction:null},read));
 assert.equal(await readCompletedAnalysis(draft.id,{...input,answers:{sqft:'240'}},read),null);
 const identical={...rows[0],work_key:'background-v1-copy'};
 assert.ok(await readCompletedAnalysis(draft.id,input,async()=>[...rows,identical]));
 const conflicting=structuredClone(identical);conflicting.payload.result.analysis.extraction.summary='different result';
 assert.equal(await readCompletedAnalysis(draft.id,input,async()=>[...rows,conflicting]),null);
});
