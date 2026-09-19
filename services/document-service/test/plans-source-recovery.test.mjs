import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {citationOutputFixture} from './support/plans-citation-output-fixture.mjs';
import {resumePlansCitationOutput} from '../scripts/resume-plans-citation-output.mjs';
import {resumePlansSourceRepair} from '../scripts/resume-plans-source-repair.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {hash,validateEvidence} from '../src/core.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {requestBody} from '../src/provider.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput} from '../src/evidence-citations.mjs';

const rejected=new Set(['4:facts:1','4:items:0','4:items:1','4:items:7','4:items:10','4:items:12','4:items:23','4:items:42']);
async function fixture(){
 const f=await citationOutputFixture(),raw=f.result.evidenceCheckpoint.raw,page=raw.pages[0],native=(await f.store.pages(f.document.id))[3].native;
 page.status='partial';page.facts=[{field:'site',value:'Synthetic source',basis:'stated',evidence:'Wrong quote'},{field:'projectMonths',value:'',basis:'stated',evidence:'Drawing issue date'},{field:'otherDetails',value:'Synthetic detail',basis:'stated',evidence:'Wrong quote'}];
 page.items=Array.from({length:45},(_,i)=>({id:'item-'+i,description:'Synthetic work',building:'Main',floor:'Main level',component:'Trim',quantity:null,unit:'',basis:'stated',evidence:'Wrong quote'}));
 const caches=await Promise.all([12,13].map(n=>readFile(join(f.root,'responses/'+String(n).padStart(4,'0')+'.json'),'utf8').then(JSON.parse)));
 const complete=JSON.parse(caches[0].responseText);complete.content[0].text=JSON.stringify(raw);caches[0].responseText=JSON.stringify(complete);
 caches[1].request.messages[0].content[0].text=JSON.stringify(citationInput(raw,[native]));
 for(let i=0;i<2;i++){
  const cache=caches[i],call=f.ledger.calls[11+i];cache.requestSha256=hash(JSON.stringify(cache.request));call.requestSha256=cache.requestSha256;call.responseSha256=hash(cache.responseText);
  await privateJson(join(f.root,call.responseFile),cache);
 }
 await privateJson(join(f.root,'cost.json'),f.ledger);await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-4'",[f.result]);
 await resumePlansCitationOutput(f.store,f.document,f.root);
 const repair={citations:citationInput(raw,[native]).statements.map(s=>({key:s.key,supported:!rejected.has(s.key),lines:rejected.has(s.key)?[]:[1]}))};
 const request=requestBody('anthropic','claude-sonnet-5',CITATION_SYSTEM,citationInput(raw,[native]),[],CITATION_SCHEMA,2048,'citation').body;
 const response={stop_reason:'end_turn',usage:{input_tokens:20308,output_tokens:1142},content:[{type:'text',text:JSON.stringify(repair)}]},responseText=JSON.stringify(response),requestSha256=hash(JSON.stringify(request));
 const call={status:'usage-reported',usage:response.usage,reservedUsd:.052036,httpStatus:200,requestSha256,responseFile:'responses/0014.json',responseSha256:hash(responseText)};
 f.ledger.calls.push(call);await privateJson(join(f.root,call.responseFile),{request,requestSha256,httpStatus:200,responseText});await privateJson(join(f.root,'cost.json'),f.ledger);
 f.result.evidenceCheckpoint.repair=repair;
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=3,error_code='unsupported-source-statement',result=$1 WHERE id='read-4'",[f.result]);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='unsupported-source-statement' WHERE id=$1",[f.document.id]);
 const report=JSON.parse(await readFile(join(f.root,'report.json'),'utf8'));report.error='unsupported-source-statement';await privateJson(join(f.root,'report.json'),report);
 f.document=await f.store.document('qa','plans',f.document.id);return f;
}

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
