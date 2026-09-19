import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {citationOutputFixture as fixture} from './support/plans-citation-output-fixture.mjs';
import {resumePlansCitationOutput} from '../scripts/resume-plans-citation-output.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {hash} from '../src/core.mjs';
import {Pipeline} from '../src/pipeline.mjs';


test('citation-output recovery reuses the completed page read and preserves all three prior archives and charges',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json','responses/0012.json','responses/0013.json','plans-citation-recovery-v1.json','plans-spatial-page3-recovery-v1.json','plans-page4-output-recovery-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  await resumePlansCitationOutput(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const recovered=await f.store.job('qa','plans','read-4');assert.deepEqual(recovered.result.evidenceCheckpoint.raw,f.result.evidenceCheckpoint.raw);assert.equal(recovered.result.evidenceCheckpoint.repairStarted,false);assert.equal(recovered.result.lowReadStarted,true);assert.equal(recovered.attempts,2);
  await assert.rejects(resumePlansCitationOutput(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
  await f.pool.query("UPDATE p5ds_jobs SET available_at=now()+interval '1 day' WHERE state='queued' AND id!='read-4'");
  const purposes=[],reader={call:async(job,system,input,images,schema,signal,verify,purpose)=>{purposes.push(purpose);assert.equal(purpose,'citation','A saved successful read must never be called again');return {citations:[{key:'4:facts:0',supported:true,lines:[1]}]};}};
  const pipeline=new Pipeline(f.store,reader,{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1});
  await pipeline.read(await f.store.claim(['read']),new AbortController().signal);
  assert.deepEqual(purposes,['citation']);assert.equal((await f.store.pages(f.document.id))[3].evidence.facts[0].evidence,'Synthetic source');
  assert.ok((await f.store.pages(f.document.id)).slice(0,3).every(p=>p.evidence.status==='partial'));
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','changed-raw-read','changed-citation-request','active-review'])test('citation-output recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[12].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-raw-read'){f.result.evidenceCheckpoint.raw.pages[0].facts[0].value='Different statement';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-4'",[f.result]);}
  if(kind==='changed-citation-request'){
   const file=join(f.root,'responses/0013.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.request.messages[0].content[0].text='{}';cache.requestSha256=hash(JSON.stringify(cache.request));f.ledger.calls[12].requestSha256=cache.requestSha256;await privateJson(file,cache);await privateJson(join(f.root,'cost.json'),f.ledger);
  }
  if(kind==='active-review')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansCitationOutput(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page4-citation-output-recovery-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
