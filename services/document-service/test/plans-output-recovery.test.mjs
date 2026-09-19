import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {privateJson,guardedSonnetFetch} from '../scripts/model-qa-support.mjs';
import {resumePlansOutput} from '../scripts/resume-plans-output.mjs';

import {outputFixture as fixture} from './support/plans-output-fixture.mjs';

test('inspected page-4 recovery preserves all prior charges, responses, evidence and both old archives',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json','responses/0011.json','plans-citation-recovery-v1.json','plans-spatial-page3-recovery-v1.json'];
  const before=await Promise.all(files.map(name=>readFile(join(f.root,name),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  const completed=(await f.pool.query("SELECT * FROM p5ds_jobs WHERE state='complete' ORDER BY id")).rows;
  await resumePlansOutput(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(name=>readFile(join(f.root,name),'utf8'))),before);
  assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  assert.deepEqual((await f.pool.query("SELECT * FROM p5ds_jobs WHERE state='complete' ORDER BY id")).rows,completed);
  const page4=await f.store.job('qa','plans','read-4');assert.equal(page4.state,'queued');assert.equal(page4.attempts,1);assert.equal(page4.result.readProfile,'low-effort-v1');assert.equal(page4.result.lowReadStarted,undefined);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page4-output-recovery-v1.json'),'utf8'));assert.deepEqual(archive.previousLedger,f.ledger);assert.equal(archive.pageEvidence.length,3);assert.ok(archive.pageEvidence.every(p=>p.evidence.status==='partial'));
  const guard=await guardedSonnetFetch({file:join(f.root,'cost.json'),limitUsd:3,maxCalls:64,request:()=>assert.fail('No network call')});assert.equal(guard.summary().requests,11);assert.ok(Math.abs(guard.summary().estimatedUsd-.7937253)<1e-10);
  await assert.rejects(resumePlansOutput(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','tampered-response','changed-source','changed-prior-evidence','unexpected-checkpoint','active-job','changed-old-archive'])test('output recovery refuses '+kind+' before any mutation',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[10].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='tampered-response')await writeFile(join(f.root,'responses/0011.json'),'{"request":{},"responseText":"changed"}');
  if(kind==='changed-source')await f.pool.query("UPDATE p5ds_pages SET native=jsonb_set(native,'{text}','\"Different source\"') WHERE page=4");
  if(kind==='changed-prior-evidence')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{notes}','[\"Different note\"]') WHERE page=1");
  if(kind==='unexpected-checkpoint')await f.pool.query("UPDATE p5ds_jobs SET result='{}' WHERE id='read-4'");
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='read-5'");
  if(kind==='changed-old-archive')await privateJson(join(f.root,'plans-citation-recovery-v1.json'),{version:2});
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansOutput(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page4-output-recovery-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
