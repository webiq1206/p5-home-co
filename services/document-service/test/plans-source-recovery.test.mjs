import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceRecoveryFixture as fixture} from './support/plans-source-fixture.mjs';
import {resumePlansSourceRepair} from '../scripts/resume-plans-source-repair.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {validateEvidence} from '../src/core.mjs';
import {Pipeline} from '../src/pipeline.mjs';


test('inspected source recovery archives the rejected draft, preserves charges and completed pages, and rereads only page 4 once',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:14},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-citation-recovery-v1.json','plans-spatial-page3-recovery-v1.json','plans-page4-output-recovery-v1.json','plans-page4-citation-output-recovery-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  await resumePlansSourceRepair(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page4-source-recovery-v1.json'),'utf8'));
  assert.deepEqual(archive.previousLedger,f.ledger);assert.deepEqual(archive.previousJobs.find(j=>j.id==='read-4').result,f.result);
  assert.equal(archive.previousJobs.find(j=>j.id==='read-4').result.evidenceCheckpoint.raw.pages[0].facts[1].value,'');
  const recovered=await f.store.job('qa','plans','read-4');assert.equal(recovered.attempts,3);assert.equal(recovered.result.readProfile,'low-effort-v1');assert.equal(recovered.result.lowReadStarted,undefined);
  await assert.rejects(resumePlansSourceRepair(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
  await f.pool.query("UPDATE p5ds_jobs SET available_at=now()+interval '1 day' WHERE state='queued' AND id!='read-4'");
  const purposes=[],reader={call:async(job,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);assert.equal(purpose,'read-efficient');assert.deepEqual(input.pages.map(p=>p.page),[4]);
   return {pages:[{page:4,sheet:'',revision:'',status:'read',notes:[],facts:[{field:'site',value:'Synthetic source',basis:'stated',evidence:'Synthetic source'}],items:[],inclusions:[],exclusions:[],responsibilities:[],regions:[]}]};
  }};
  await new Pipeline(f.store,reader,{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1}).read(await f.store.claim(['read']),new AbortController().signal);
  assert.deepEqual(purposes,['read-efficient']);assert.equal((await f.store.pages(f.document.id))[3].evidence.status,'read');
  assert.deepEqual((await f.store.pages(f.document.id)).slice(0,3).map(p=>p.evidence),pages.slice(0,3).map(p=>p.evidence));
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','changed-source','changed-draft','changed-repair','changed-archive','active-review','later-page-started'])test('source recovery refuses '+kind+' without mutating saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[13].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-source')await f.pool.query("UPDATE p5ds_pages SET native=jsonb_set(native,'{text}','\"changed\"') WHERE document_id=$1 AND page=4",[f.document.id]);
  if(kind==='changed-draft'){f.result.evidenceCheckpoint.raw.pages[0].items[0].quantity=99;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-4'",[f.result]);}
  if(kind==='changed-repair'){f.result.evidenceCheckpoint.repair.citations[0].supported=false;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-4'",[f.result]);}
  if(kind==='changed-archive'){const file=join(f.root,'plans-page4-citation-output-recovery-v1.json'),old=JSON.parse(await readFile(file,'utf8'));old.previousRecoverySha256='changed';await privateJson(file,old);}
  if(kind==='active-review')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='later-page-started')await f.pool.query("UPDATE p5ds_jobs SET attempts=1 WHERE id='read-5'");
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansSourceRepair(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page4-source-recovery-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});

test('empty source facts cannot pass merely because their evidence quote exists',()=>{
 const page={page:1,status:'read',facts:[{field:'projectMonths',value:'',evidence:'13 July 2026',basis:'stated'}],items:[],notes:[],regions:[]},source={page:1,textQuality:1,text:'13 July 2026'};
 for(const value of ['', '   ']){page.facts[0].value=value;assert.throws(()=>validateEvidence({pages:[page]},[source]),/empty-source-fact/);}
 page.facts[0]={field:'otherDetails',value:'Source date: 13 July 2026',evidence:'13 July 2026',basis:'stated'};
 assert.doesNotThrow(()=>validateEvidence({pages:[page]},[source]));
});
