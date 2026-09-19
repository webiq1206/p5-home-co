import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceCorrectionFixture as fixture} from './support/plans-source-correction-fixture.mjs';
import {resumePlansSourceCorrection} from '../scripts/resume-plans-source-correction.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {READER_SYSTEM} from '../src/contracts.mjs';


test('page-5 recovery retains its saved read and citations, all completed evidence and all eighteen charges',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:18},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-page4-source-recovery-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  await resumePlansSourceCorrection(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const recovered=await f.store.job('qa','plans','read-5');assert.deepEqual(recovered.result,f.result);assert.equal(recovered.attempts,1);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page5-source-correction-v1.json'),'utf8'));assert.deepEqual(archive.previousLedger,f.ledger);assert.equal(archive.pageEvidence[3].evidence.status,'read');
  await assert.rejects(resumePlansSourceCorrection(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
  const purposes=[],reader={call:async(job,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);
   if(purpose==='source-repair')return {facts:[],items:input.rejectedStatements.map(s=>({key:s.key,statement:{...s.statement,evidence:'Synthetic source'},reason:'Use the original literal source.'})),regions:[]};
   assert.equal(purpose,'citation','The saved initial read and citations must be reused');
   return {citations:input.statements.map(s=>({key:s.key,supported:true,lines:[1]}))};
  }};
  const pipeline=new Pipeline(f.store,reader,{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1});
  const claimed=await f.store.claim(['read']);assert.equal(claimed.id,'read-5','Recovered source work precedes every untouched queued page');
  await pipeline.evidence(claimed,READER_SYSTEM,f.input5,[],new AbortController().signal);
  assert.deepEqual(purposes,['source-repair','citation']);
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','changed-page4','changed-page5','changed-citation','already-correcting','active-job','tampered-cache'])test('page-5 recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[17].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-page4')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"partial\"') WHERE document_id=$1 AND page=4",[f.document.id]);
  if(kind==='changed-page5'){f.result.evidenceCheckpoint.raw.pages[0].items[9].description='Changed';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='changed-citation'){f.result.evidenceCheckpoint.repair.citations[0].lines=[99];await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='already-correcting'){f.result.evidenceCheckpoint.sourceCorrectionStarted=true;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='tampered-cache'){const file=join(f.root,'responses/0018.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.responseText='changed';await privateJson(file,cache);}
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansSourceCorrection(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page5-source-correction-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
