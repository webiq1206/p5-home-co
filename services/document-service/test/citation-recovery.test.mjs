import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedPool,guardedSonnetFetch,privateJson,reservationFingerprint} from '../scripts/model-qa-support.mjs';
import {resumeReviewStream,inspectReviewStreamState} from '../scripts/resume-review-stream.mjs';
import {resumeReservedStream} from '../scripts/resume-reserved-stream.mjs';
import {resumeLegacyCitationFailure} from '../scripts/resume-citation-failure.mjs';
import {qualificationWindow,admitBeforeDeadline} from '../scripts/check-sonnet-documents.mjs';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {Reader} from '../src/provider.mjs';
import {ServiceError} from '../src/core.mjs';
import {citationInput,applyCitations} from '../src/evidence-citations.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';

const native={page:1,kind:'text',textQuality:1,text:'Interior trim scope\nInstall 120 linear feet of painted baseboard.\nExclude all electrical work.'};
const evidence=()=>({page:1,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[{id:'baseboard',description:'Painted baseboard',component:'Trim',building:'',floor:'',quantity:120,unit:'lf',basis:'stated',evidence:'Install 120 lf of painted baseboard.'}],inclusions:[],exclusions:['Electrical work'],responsibilities:[],regions:[]});
const repair={citations:[{key:'1:items:0',supported:true,lines:[2]}]};
const config={provider:'anthropic',model:'claude-sonnet-5',verifyModel:'claude-sonnet-5',parserSlots:1,slots:1,rpm:60,tpm:600000,callMs:40000,parseMs:60000,jobMs:300000,maxPages:4,maxTenantBytes:1000000,maxQueue:30,maxOutput:10000};
test('sequential plans do not inherit the production queue deadline or admit work too close to shutdown',()=>{
 const before=structuredClone(config),timing=qualificationWindow(config,'plans');
 assert.equal(timing.windowMs,1200000);assert.equal(timing.jobMs,1200000);assert.deepEqual(config,before);
 assert.doesNotThrow(()=>admitBeforeDeadline(1200000,40000,600000));
 assert.throws(()=>admitBeforeDeadline(1200000,40000,1160000),/before-next-request/);
});
async function fixture(){
 const pool=await isolatedPool(),store=new Store(pool,config);await store.init();
 const reader={call:async()=>({pages:[evidence()]})};
 const parser=async(bytes,{onManifest,onPage})=>{await onManifest(1);await onPage({...native,image:Buffer.from('synthetic'),parseMs:0,nativeMs:0,renderMs:0});};
 const pipeline=new Pipeline(store,reader,config,parser);
 const {document}=await store.putDocument('qa','test','synthetic.pdf',Buffer.from('%PDF-test'));
 await pipeline.prepare(await store.claim(['parse']),new AbortController().signal);
 return {pool,store,reader,pipeline,document,job:await store.claim(['read'])};
}

test('citation recovery changes only the quote and preserves all work, quantities and exclusions',async()=>{
 const f=await fixture();let calls=0;
 try{
  f.reader.call=async(job,system,input,images,schema,signal,verify,purpose)=>{
   if(++calls===1)return {pages:[evidence()]};
   assert.equal(purpose,'citation');assert.equal(images.length,0);
   const saved=await f.store.job('qa','test',job.id);
   assert.equal(saved.result.evidenceCheckpoint.raw.pages[0].items[0].quantity,120);
   assert.equal(saved.result.evidenceCheckpoint.repairStarted,true);
   assert.equal(input.statements[0].key,'1:items:0');
   return repair;
  };
  await f.pipeline.read(f.job,new AbortController().signal);
  const actual=(await f.store.pages(f.document.id))[0].evidence,expected=evidence();expected.items[0].evidence=native.text.split('\n')[1];
  assert.deepEqual(actual,expected);assert.equal(calls,2);
 }finally{await f.pool.end();}
});

for(const kind of ['unsupported','out-of-range','duplicate','changed-value'])test('citation repair refuses '+kind,()=>{
 const raw={pages:[evidence()]},input=citationInput(raw,[native]),answer=structuredClone(repair);
 if(kind==='unsupported')answer.citations[0].supported=false;
 if(kind==='out-of-range')answer.citations[0].lines=[99];
 if(kind==='duplicate')answer.citations.push(answer.citations[0]);
 if(kind==='changed-value')answer.citations[0].quantity=999;
 assert.throws(()=>applyCitations(raw,[native],input,answer));
 assert.equal(raw.pages[0].items[0].quantity,120);
});

test('rejected or interrupted corrections retain drafts and never silently repeat paid requests on retry',async()=>{
 for(const interrupted of [false,true]){
  const f=await fixture();let calls=0;
  try{
   f.reader.call=async()=>{if(++calls===1)return {pages:[evidence()]};if(interrupted)throw new ServiceError('provider-timeout',503);return {citations:[{...repair.citations[0],supported:false}]};};
   const first=await f.pipeline.read(f.job,new AbortController().signal).catch(e=>e);
   assert.ok(first instanceof Error);
   await f.store.fail({...f.job,attempts:3},first);
   const saved=await f.store.job('qa','test',f.job.id);assert.ok(saved.result.evidenceCheckpoint.raw);
   await f.store.retry('qa','test',f.document.id,'documents');
   const retry=await f.store.claim(['read']);
   await assert.rejects(f.pipeline.read(retry,new AbortController().signal),interrupted?/citation-repair-needs-inspection/:/unsupported-source-statement/);
   assert.equal(calls,2);
  }finally{await f.pool.end();}
 }
});

test('failed document blocks the next page and expired lease cannot write evidence checkpoints',async()=>{
 const f=await fixture();
 try{
  await f.pipeline.enqueueRead(f.job,[{page:2}]);
  await f.store.fail(f.job,new ServiceError('quote-not-in-source',422));
  assert.equal(await f.store.claim(['read']),null);
  await assert.rejects(f.store.checkpoint(f.job,{evidenceCheckpoint:{raw:'stale'}}),/lease-lost/);
 }finally{await f.pool.end();}
});

test('QA saves the complete paid reply before domain rejection without saving credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-paid-reply-'));
 try{
  const response={stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:20},content:[{type:'text',text:JSON.stringify({pages:[evidence()]})}]};
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:1,maxCalls:3,request:async url=>new Response(JSON.stringify(url.endsWith('count_tokens')?{input_tokens:100}:response))});
  await guard.request('https://api.anthropic.com/v1/messages',{body:JSON.stringify({model:'claude-sonnet-5',max_tokens:1000,messages:[]}),headers:{'x-api-key':'never-save-this'}});
  const ledger=JSON.parse(await readFile(join(root,'cost.json'),'utf8')),file=join(root,ledger.calls[0].responseFile),saved=await readFile(file,'utf8');
  assert.deepEqual(JSON.parse(JSON.parse(saved).responseText),response);assert.ok(!saved.includes('never-save-this'));assert.equal((await stat(file)).mode&0o777,0o600);
  assert.equal(guard.summary().unknownChargeRequests,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('caller cancellation is distinct from provider timeout and releases its slot',async()=>{
 for(const name of ['AbortError','TimeoutError']){
  const metrics=[];let released=0;
  const reader=new Reader(config,{reserve:async()=>1,release:async()=>released++,metric:async(...args)=>metrics.push(args)},async()=>{throw new DOMException('synthetic',name);});
  await assert.rejects(reader.call({kind:'read'},'',{pages:[native]},[],EVIDENCE_SCHEMA,new AbortController().signal),new RegExp(name==='AbortError'?'provider-cancelled':'provider-timeout'));
  assert.equal(released,1);assert.equal(metrics[0][3].cancelled,name==='AbortError');
 }
});

test('an identical paid reply replays free across restart but a changed request cannot reuse it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-response-replay-'));let calls=0,counts=0;
 try{
  const settings={file:join(root,'cost.json'),limitUsd:1,maxCalls:3,reuseResponses:true,request:async url=>{
   if(url.endsWith('count_tokens')){counts++;return new Response('{"input_tokens":100}');}
   calls++;return new Response(JSON.stringify({usage:{input_tokens:100,output_tokens:20},content:[{type:'text',text:'Saved even if downstream validation fails.'}]}));
  }};
  const body={model:'claude-sonnet-5',max_tokens:1000,messages:[]},url='https://api.anthropic.com/v1/messages';
  let guard=await guardedSonnetFetch(settings);
  const first=await (await guard.request(url,{body:JSON.stringify(body)})).text();
  guard=await guardedSonnetFetch(settings);
  assert.equal(await (await guard.request(url,{body:JSON.stringify(body)})).text(),first);
  assert.equal(calls,1);assert.equal(counts,1);assert.equal(guard.summary().requests,1);
  await guard.request(url,{body:JSON.stringify({...body,max_tokens:1001})});assert.equal(calls,2);
  const file=join(root,'responses','0001.json'),saved=JSON.parse(await readFile(file,'utf8'));saved.responseText='tampered';await privateJson(file,saved);
  await assert.rejects(guard.request(url,{body:JSON.stringify(body)}),/checkpoint-mismatch/);assert.equal(calls,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('legacy recovery archives the reported failure, retains charges and pages, and runs at most once',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-legacy-citation-')),f=await fixture();
 try{
  await f.pool.query('UPDATE p5ds_documents SET page_count=4 WHERE id=$1',[f.document.id]);
  for(let page=2;page<=4;page++)await f.store.putPage(f.job,{...native,page,image:Buffer.from('synthetic')});
  for(const page of [1,2])await f.pool.query('UPDATE p5ds_pages SET evidence=$3 WHERE document_id=$1 AND page=$2',[f.document.id,page,{...evidence(),page}]);
  await f.pool.query("UPDATE p5ds_jobs SET payload=$2 WHERE id=$1",[f.job.id,{pages:[3]}]);
  await f.store.fail(f.job,new ServiceError('quote-not-in-source',422));
  const ledger={version:1,model:'claude-sonnet-5',calls:[{status:'usage-reported',usage:{input_tokens:3718,output_tokens:3731},reservedUsd:.050426}],paused:false};
  await privateJson(join(root,'cost.json'),ledger);await privateJson(join(root,'report.json'),{error:'quote-not-in-source'});
  const doc=await f.store.document('qa','test',f.document.id),before=await f.store.pages(doc.id);
  assert.equal(await resumeLegacyCitationFailure(f.store,doc,root),true);
  assert.deepEqual(await f.store.pages(doc.id),before);
  assert.deepEqual(JSON.parse(await readFile(join(root,'cost.json'),'utf8')),ledger);
  assert.equal((await f.store.job('qa','test',f.job.id)).attempts,1);
  assert.equal((await f.store.document('qa','test',doc.id)).state,'prepared');
  await assert.rejects(resumeLegacyCitationFailure(f.store,doc,root),/already attempted/);
 }finally{await f.pool.end();await rm(root,{recursive:true,force:true});}
});


test('explicit reserved-charge recovery archives the failure, preserves costs and pages, and refuses another restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-reserved-stream-')),f=await fixture();
 try{
  await f.pool.query('UPDATE p5ds_documents SET page_count=4,digest=$2 WHERE id=$1',[f.document.id,'ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018']);
  for(let page=2;page<=4;page++)await f.store.putPage(f.job,{...native,page,image:Buffer.from('synthetic')});
  for(const page of [1,2])await f.pool.query('UPDATE p5ds_pages SET evidence=$3 WHERE document_id=$1 AND page=$2',[f.document.id,page,{...evidence(),page}]);
  await f.pool.query('UPDATE p5ds_jobs SET payload=$2 WHERE id=$1',[f.job.id,{pages:[3]}]);
  await f.store.fail(f.job,new ServiceError('qa-paused-unknown-provider-charge',422));
  const ledger={version:1,model:'claude-sonnet-5',tokenCountMs:515,calls:[{status:'usage-reported',usage:{input_tokens:3718,output_tokens:3731},reservedUsd:.050426},{status:'charge-unknown',reservedUsd:.12375}],paused:true};
  await privateJson(join(root,'cost.json'),ledger);await privateJson(join(root,'report.json'),{error:'qa-paused-unknown-provider-charge'});
  const review=await f.pipeline.submitReview('qa','test',{documents:[{id:f.document.id,source:'fixture.pdf'}],text:'Synthetic scope',answers:{}});
  await f.pool.query("UPDATE p5ds_jobs SET state='failed',error_code='source-reading-failed' WHERE id=$1",[review.id]);
  const settings={file:join(root,'cost.json'),limitUsd:1,maxCalls:12,request:()=>{throw Error('No provider call permitted');}};
  let guard=await guardedSonnetFetch(settings);assert.equal(guard.summary().paused,true);
  const doc=await f.store.document('qa','test',f.document.id),before=await f.store.pages(doc.id);
  await resumeReservedStream(f.store,doc,root);
  const archive=JSON.parse(await readFile(join(root,'reserved-stream-recovery-v1.json'),'utf8'));
  assert.deepEqual(archive.previousLedger,ledger);assert.deepEqual(await f.store.pages(doc.id),before);
  guard=await guardedSonnetFetch(settings);assert.equal(guard.summary().paused,false);assert.equal(guard.summary().estimatedUsd,.174176);assert.equal(guard.summary().unknownChargeRequests,1);
  assert.equal((await f.store.job('qa','test',review.id)).state,'queued');
  assert.equal((await f.store.job('qa','test',f.job.id)).state,'queued');assert.equal((await f.store.job('qa','test',f.job.id)).attempts,1);
  await assert.rejects(resumeReservedStream(f.store,doc,root),/already attempted/);
  const slot=await f.store.reserve(100),leases=await f.pool.query('SELECT extract(epoch FROM(expires_at-now())) AS seconds FROM p5ds_provider_leases WHERE token=$1',[slot]);
  assert.ok(Number(leases.rows[0].seconds)>120);await f.store.release(slot);
 }finally{await f.pool.end();await rm(root,{recursive:true,force:true});}
});

test('review-only recovery retains every source page and reservation and runs only the final review',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-review-stream-')),f=await fixture();let paid=0;
 try{
  await f.pool.query('UPDATE p5ds_documents SET page_count=4,digest=$2 WHERE id=$1',[f.document.id,'ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018']);
  for(let page=2;page<=4;page++)await f.store.putPage(f.job,{...native,page,image:Buffer.from('synthetic')});
  for(let page=1;page<=4;page++){
   const value={...evidence(),page};value.items[0].evidence='Install 120 linear feet of painted baseboard.';
   await f.pool.query('UPDATE p5ds_pages SET evidence=$3 WHERE document_id=$1 AND page=$2',[f.document.id,page,value]);
  }
  await f.pool.query("UPDATE p5ds_documents SET state='prepared' WHERE id=$1",[f.document.id]);
  await f.store.complete(f.job,{pages:[1,2,3,4]},c=>f.store.finalize(f.document.id,c));
  const review=await f.pipeline.submitReview('qa','test',{documents:[{id:f.document.id,source:'fixture.pdf'}],text:'Synthetic scope',answers:{}});
  await f.store.fail(await f.store.claim(['review']),new ServiceError('qa-paused-unknown-provider-charge',422));
  const prior={status:'charge-unknown',reservedUsd:.12375};prior.acknowledgement={action:'resume-reserved',fingerprint:reservationFingerprint(prior)};
  const used=n=>({status:'usage-reported',usage:{input_tokens:100,output_tokens:100},reservedUsd:n});
  const ledger={version:1,model:'claude-sonnet-5',tokenCountMs:1694,paused:true,calls:[used(.050426),prior,used(.072026),used(.0541404),used(.007206),{status:'charge-unknown',reservedUsd:.189205,httpStatus:200,failure:{code:'provider-invalid-stream'},progress:{streaming:true,complete:false,toolCharacters:24214,events:3467}}]};
  await privateJson(join(root,'cost.json'),ledger);await privateJson(join(root,'report.json'),{error:'qa-paused-unknown-provider-charge'});
  const doc=await f.store.document('qa','test',f.document.id),before=await f.store.pages(doc.id);
  assert.equal(doc.state,'complete');
  const eligible=await inspectReviewStreamState(f.store,doc,root);
  assert.equal(eligible.diagnostic.eligible,true);
  assert.deepEqual(eligible.diagnostic.failedChecks,[]);
  for(const [state,expected] of [['running','oneFailedReview'],['queued','oneFailedReview']]){
   await f.pool.query('UPDATE p5ds_jobs SET state=$2 WHERE id=$1',[review.id,state]);
   await assert.rejects(resumeReviewStream(f.store,doc,root),error=>error.recoveryDiagnostic.failedChecks.includes(expected));
   assert.equal((await f.store.job('qa','test',review.id)).state,state);
  }
  await f.pool.query("UPDATE p5ds_jobs SET state='failed' WHERE id=$1",[review.id]);
  const partial=structuredClone(before[3].evidence);partial.status='partial';
  await f.pool.query('UPDATE p5ds_pages SET evidence=$3 WHERE document_id=$1 AND page=$2',[doc.id,4,partial]);
  await assert.rejects(resumeReviewStream(f.store,doc,root),error=>{
   assert.deepEqual(error.recoveryDiagnostic.failedChecks,['everyPageRead']);
   assert.equal(error.recoveryDiagnostic.pages[3].status,'partial');return true;
  });
  await f.pool.query('UPDATE p5ds_pages SET evidence=$3 WHERE document_id=$1 AND page=$2',[doc.id,4,before[3].evidence]);
  await f.pool.query("UPDATE p5ds_jobs SET state='queued' WHERE id=$1",[f.job.id]);
  await assert.rejects(resumeReviewStream(f.store,doc,root),error=>error.recoveryDiagnostic.failedChecks.includes('sourceJobsComplete'));
  await f.pool.query("UPDATE p5ds_jobs SET state='complete' WHERE id=$1",[f.job.id]);
  assert.deepEqual(JSON.parse(await readFile(join(root,'cost.json'),'utf8')),ledger);
  assert.deepEqual(await f.store.pages(doc.id),before);
  for(const change of [x=>x.calls[5].reservedUsd+=.01,x=>x.calls[5].failure.code='provider-total-timeout',x=>x.calls[5].progress.complete=true,x=>x.calls.push(used(.01))]){
   const changed=structuredClone(ledger);change(changed);await privateJson(join(root,'cost.json'),changed);
   await assert.rejects(resumeReviewStream(f.store,doc,root),/differs/);
   await assert.rejects(stat(join(root,'review-stream-recovery-v1.json')),e=>e.code==='ENOENT');
   assert.equal((await f.store.job('qa','test',review.id)).state,'failed');
  }
  await privateJson(join(root,'cost.json'),ledger);
  await resumeReviewStream(f.store,doc,root);
  assert.deepEqual(await f.store.pages(doc.id),before);
  assert.equal((await f.store.document('qa','test',doc.id)).state,'complete');
  assert.equal((await f.store.job('qa','test',f.job.id)).state,'complete');
  const archived=JSON.parse(await readFile(join(root,'review-stream-recovery-v1.json'),'utf8'));
  assert.deepEqual(archived.previousLedger,ledger);
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:1,maxCalls:12,request:async(url,options)=>{
   if(url.endsWith('count_tokens'))return new Response('{"input_tokens":100}');
   paid++;const body=JSON.parse(options.body),input=JSON.parse(body.messages[0].content[0].text);
   assert.equal(body.tools[0].name,'submit_document_review');assert.equal(body.output_config.effort,'medium');assert.equal(input.documents[0].pages.length,4);
   const result={summary:'Trim scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:['Trim'],exclusions:['Electrical'],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:[],takeoffs:[]};
   return new Response(JSON.stringify({stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:100},content:[{type:'tool_use',name:'submit_document_review',id:'synthetic-review',input:result}]}));
  }});
  assert.equal(guard.summary().paused,false);assert.ok(Math.abs(guard.summary().estimatedUsd-.4967534)<1e-8);assert.equal(guard.summary().unknownChargeRequests,2);
  f.pipeline.reader=new Reader({...config,key:'synthetic-no-network'},f.store,guard.request);
  await f.pipeline.review(await f.store.claim(['review']),new AbortController().signal);
  assert.equal(paid,1);assert.equal((await f.store.job('qa','test',review.id)).state,'complete');
  assert.deepEqual(await f.store.pages(doc.id),before);
  const finalLedger=JSON.parse(await readFile(join(root,'cost.json'),'utf8'));
  assert.deepEqual(finalLedger.calls.slice(0,5),ledger.calls.slice(0,5));assert.equal(finalLedger.calls[5].reservedUsd,.189205);
  await assert.rejects(resumeReviewStream(f.store,doc,root),/already attempted/);
 }finally{await f.pool.end();await rm(root,{recursive:true,force:true});}
});
