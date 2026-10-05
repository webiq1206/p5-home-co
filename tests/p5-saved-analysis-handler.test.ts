import '../scripts/offline-network-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {saveDraft,readDraft} from '../lib/p5/store.ts';
import {postScope} from '../lib/p5/scopeEndpoint.ts';
import {analysisWorkKey} from '../lib/p5/analysisWork.ts';
import {ESTIMATOR_MODEL_SNAPSHOT,MODEL_POLICY_VERSION} from '../lib/p5/modelPolicy.ts';

test('authenticated historical recovery and all retry modes reuse saved results without provider dispatch',async()=>{
 const db=new PGlite();
 const oldPool=globalThis.__p5Pool,oldUrl=process.env.DATABASE_URL,oldStorage=process.env.P5_OBJECT_STORAGE_ENABLED,oldFetch=globalThis.fetch;
 let dispatches=0;
 process.env.DATABASE_URL='postgres://offline.invalid/isolated';
 globalThis.__p5Pool={query:(s:string,v:any[])=>db.query(s,v)} as any;
 globalThis.fetch=async()=>{dispatches++;throw Error('offline-provider-dispatch-forbidden');};
 try{
  const id=randomUUID(),key=randomBytes(32).toString('hex');
  const text='Remodel a 120 SF living room in Boise. Paint all walls (44 LF perimeter). Retain the existing floor and all doors/windows.';
  const original={sqft:'120',service:'remodel',location:'Boise'};
  const extraction={summary:text,facts:Object.entries({...original,trimLf:'44'}).map(([field,value])=>({field:field as any,value,confidence:1,source:'typed scope',basis:'stated' as const,evidence:field==='trimLf'?'44 LF perimeter':field==='service'?'Remodel':value})),conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{complete:true,expectedPages:0,pages:[]}};
  const analysis={provider:'fixture',model:ESTIMATOR_MODEL_SNAPSHOT,modelPolicy:MODEL_POLICY_VERSION,analyzedAt:'2026-10-05T04:07:00Z',extraction};
  let draft=await saveDraft(id,key,'p5',{text,answers:{...original,trimLf:'44'},extraction,reviewed:null,contact:{name:'[QA] Offline',email:'',phone:''}},0);
  const workKey=analysisWorkKey(draft,text,original,'remote');
  const checkpoint={prepared:0,units:[],notes:[],textDone:analysis};
  await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3)',[id,workKey,JSON.stringify(checkpoint)]);
  const request=(hint:string|null,mode={resumable:'false',background:'false',retry:'false'})=>{
   const form=new FormData();form.set('text',text);form.set('revision',String(draft.revision));
   for(const [k,v] of Object.entries(mode))form.set(k,v);
   if(hint!==null)form.set('savedAnalysisAnswers',hint);
   return new Request('https://p5homeco.com/api/p5-estimator/scope',{method:'POST',headers:{origin:'https://p5homeco.com','x-p5-draft-id':id,'x-p5-draft-key':key},body:form});
  };
  process.env.P5_OBJECT_STORAGE_ENABLED='true';
  let response=await postScope(request(JSON.stringify(original)));
  let result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.analysis);assert.ok(!result.draft.answers.trimLf);assert.equal(result.draft.answers.sqft,'120');
  draft=await readDraft(id,key) as typeof draft;
  const stored=await db.query<{payload:any}>('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,workKey]);
  assert.deepEqual(stored.rows[0].payload,checkpoint);
  for(const resumable of ['false','true'])for(const background of ['false','true'])for(const retry of ['false','true']){
   response=await postScope(request(null,{resumable,background,retry}));result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.analysis);assert.ok(!result.draft.answers.trimLf);draft=await readDraft(id,key) as typeof draft;
  }
  const before=draft.revision;
  for(const hint of ['{}','null','{"sqft":"240"}']){
   response=await postScope(request(hint,{resumable:'true',background:'true',retry:'true'}));assert.equal(response.status,409,await response.text());
  }
  assert.equal((await readDraft(id,key))?.revision,before);
  for(const resumable of ['false','true'])for(const background of ['false','true'])for(const retry of ['false','true']){
   response=await postScope(request('{}',{resumable,background,retry}));assert.equal(response.status,409,await response.text());
  }
  draft=await saveDraft(id,key,'p5',{text:draft.text,extraction:draft.extraction,reviewed:null,contact:draft.contact,answers:{...draft.answers,sqft:'240'},wizard:{skipped:[],resolutions:{sqft:'240'}}},draft.revision);
  const correctedRevision=draft.revision;
  response=await postScope(request(JSON.stringify(original)));assert.equal(response.status,409,await response.text());
  const corrected=await readDraft(id,key);assert.equal(corrected?.answers.sqft,'240');assert.equal(corrected?.revision,correctedRevision);
  assert.equal(dispatches,0);
  assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).rows.length,0);
 }finally{
  globalThis.fetch=oldFetch;globalThis.__p5Pool=oldPool;
  if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
  if(oldStorage===undefined)delete process.env.P5_OBJECT_STORAGE_ENABLED;else process.env.P5_OBJECT_STORAGE_ENABLED=oldStorage;
  await db.close();
 }
});
