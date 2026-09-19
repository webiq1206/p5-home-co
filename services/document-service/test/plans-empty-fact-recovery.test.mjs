import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {emptyFactFixture as fixture} from './support/plans-empty-fact-fixture.mjs';
import {resumePlansEmptyFact} from '../scripts/resume-plans-empty-fact.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {READER_SYSTEM} from '../src/contracts.mjs';


test('24-call recovery preserves every charge and checkpoint and actually claims page 5 then page 7 first',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:24},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-page5-source-correction-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  await resumePlansEmptyFact(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  assert.deepEqual((await f.store.job('qa','plans','read-5')).result,f.result);assert.deepEqual((await f.store.job('qa','plans','read-7')).result,f.result7);
  const first=await f.store.claim(['read']),second=await f.store.claim(['read']);assert.equal(first.id,'read-5');assert.equal(second.id,'read-7');
  const purposes=[],pipeline=new Pipeline(f.store,{call:async(job,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);assert.equal(purpose,'source-repair');assert.deepEqual(input.rejectedStatements.map(s=>s.key),['7:facts:0']);
   return {facts:[{key:'7:facts:0',statement:{field:'otherDetails',value:'Floor area is not specified.',evidence:'No floor area is given on this page.',basis:'uncertain'},reason:'Keep the missing value explicit.'}],items:[],regions:[]};
  }},{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1});
  const result=await pipeline.evidence(second,READER_SYSTEM,f.input7,[],new AbortController().signal);assert.equal(result.pages[0].status,'partial');assert.deepEqual(purposes,['source-repair']);
  await assert.rejects(resumePlansEmptyFact(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page7-empty-fact-v1.json'),'utf8'));assert.equal(archive.previousLedger.calls.length,24);assert.deepEqual(archive.pageEvidence.map(p=>p.page),[1,2,3,4,6]);
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','changed-page6','changed-page5','changed-empty-fact','already-correcting','active-job','tampered-cache','changed-attempt','changed-source','changed-archive'])test('24-call recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[23].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-page6')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"partial\"') WHERE document_id=$1 AND page=6",[f.document.id]);
  if(kind==='changed-page5'){f.result.evidenceCheckpoint.raw.pages[0].items[9].description='Changed';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='changed-empty-fact'){f.result7.evidenceCheckpoint.raw.pages[0].facts[0].value='999';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-7'",[f.result7]);}
  if(kind==='already-correcting'){f.result7.evidenceCheckpoint.sourceCorrectionStarted=true;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-7'",[f.result7]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='changed-attempt')await f.pool.query("UPDATE p5ds_jobs SET attempts=2 WHERE id='read-7'");
  if(kind==='changed-source')await f.pool.query("UPDATE p5ds_pages SET native=jsonb_set(native,'{text}','\"Changed source\"') WHERE document_id=$1 AND page=7",[f.document.id]);
  if(kind==='changed-archive')await privateJson(join(f.root,'plans-citation-recovery-v1.json'),{changed:true});
  if(kind==='tampered-cache'){const file=join(f.root,'responses/0024.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.responseText='changed';await privateJson(file,cache);}
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansEmptyFact(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page7-empty-fact-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
