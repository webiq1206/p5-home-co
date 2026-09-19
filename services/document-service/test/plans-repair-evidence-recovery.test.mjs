import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repairEvidenceFixture as fixture} from './support/plans-repair-evidence-fixture.mjs';
import {resumePlansEmptyFact} from '../scripts/resume-plans-empty-fact.mjs';
import {resumePlansRepairEvidence} from '../scripts/resume-plans-repair-evidence.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {hash,validateEvidence} from '../src/core.mjs';
import {Pipeline,reconcileVerification} from '../src/pipeline.mjs';
import {requestBody} from '../src/provider.mjs';
import {READER_SYSTEM,VERIFIER_SYSTEM,EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,applyCitations} from '../src/evidence-citations.mjs';
import {SOURCE_REPAIR_SYSTEM,SOURCE_REPAIR_EVIDENCE_RULE,SOURCE_REPAIR_SCHEMA,prepareSourceRepair,applySourceRepairs} from '../src/evidence-source-repair.mjs';


test('28-call recovery archives the invalid correction and preserves six pages, original page7 read/citations and all charges',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:28},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-page7-empty-fact-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true),original=structuredClone(f.result7);
  await resumePlansRepairEvidence(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const job=await f.store.claim(['read']);assert.equal(job.id,'read-7');assert.deepEqual(job.result.evidenceCheckpoint.raw,original.evidenceCheckpoint.raw);assert.deepEqual(job.result.evidenceCheckpoint.repair,original.evidenceCheckpoint.repair);assert.equal(job.result.evidenceCheckpoint.sourceCorrection,undefined);
  const purposes=[],pipeline=new Pipeline(f.store,{call:async(j,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);assert.equal(purpose,'source-repair');assert.ok(system.includes(SOURCE_REPAIR_EVIDENCE_RULE));
   const response=structuredClone(original.evidenceCheckpoint.sourceCorrection);response.facts[0].statement.evidence='Limitation: the original elevation sheet does not establish a floor-area value.';return response;
  }},{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1});
  const result=await pipeline.evidence(job,READER_SYSTEM,f.input7,[],new AbortController().signal);assert.equal(result.pages[0].status,'partial');assert.deepEqual(purposes,['source-repair']);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page7-repair-evidence-v1.json'),'utf8'));assert.equal(archive.previousLedger.calls.length,28);assert.deepEqual(archive.previousJobs.find(j=>j.id==='read-7').result,original);
  await assert.rejects(resumePlansRepairEvidence(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
 }finally{await f.close();}
});
for(const kind of ['unknown-charge','changed-page5','changed-page7','changed-correction','active-job','tampered-cache','changed-attempt','changed-archive'])test('28-call recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[27].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-page5')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"read\"') WHERE document_id=$1 AND page=5",[f.document.id]);
  if(kind==='changed-page7'){f.result7.evidenceCheckpoint.raw.pages[0].facts[0].value='999';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-7'",[f.result7]);}
  if(kind==='changed-correction'){f.result7.evidenceCheckpoint.sourceCorrection.facts[0].statement.evidence='Changed';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-7'",[f.result7]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='changed-attempt')await f.pool.query("UPDATE p5ds_jobs SET attempts=3 WHERE id='read-7'");
  if(kind==='changed-archive')await privateJson(join(f.root,'plans-citation-recovery-v1.json'),{changed:true});
  if(kind==='tampered-cache'){const file=join(f.root,'responses/0028.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.responseText='changed';await privateJson(file,cache);}
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansRepairEvidence(f.store,f.document,f.root));assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page7-repair-evidence-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
