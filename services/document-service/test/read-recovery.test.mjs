import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPool} from '../scripts/model-qa-support.mjs';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {Reader,requestBody} from '../src/provider.mjs';
import {ServiceError} from '../src/core.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';

const config={parserSlots:1,slots:2,rpm:60,tpm:600000,callMs:40000,parseMs:60000,
 jobMs:300000,maxPages:4,maxTenantBytes:1000000,maxQueue:30};
const evidence=page=>({page,sheet:'',revision:'',status:'read',notes:[],facts:[],
 items:[{id:'trim-'+page,description:'Baseboard',component:'Trim',building:'',floor:'',quantity:120,unit:'lf',basis:'stated',evidence:'Install 120 lf baseboard.'}],
 inclusions:['Install 120 lf baseboard.'],exclusions:['Electrical work'],responsibilities:[],regions:[]});
const signal=()=>new AbortController().signal;

async function fixture(count=4,overrides={}){
 const settings={...config,...overrides};
 const pool=await isolatedPool(),store=new Store(pool,settings);await store.init();
 const calls=[];
 const reader={call:async(job,system,input)=>{calls.push(input.pages.map(p=>p.page));return {pages:input.pages.map(p=>evidence(p.page))};}};
 const parser=async(bytes,{onManifest,onPage})=>{
  await onManifest(count);
  for(let page=1;page<=count;page++)await onPage({page,kind:'text',text:'Install 120 lf baseboard. Exclude electrical work.',textQuality:1,image:Buffer.from('synthetic-image'),parseMs:1,nativeMs:1,renderMs:0});
 };
 const pipeline=new Pipeline(store,reader,settings,parser);
 const {document}=await store.putDocument('test','test','synthetic.pdf',Buffer.from('%PDF-synthetic-parser'));
 await pipeline.prepare(await store.claim(['parse']),signal());
 const job=await store.claim(['read']);
 return {pool,store,pipeline,reader,calls,document,job};
}

for(const failure of ['provider-timeout','provider-output-limit'])test(failure+' batch becomes durable single-page jobs without rereading cached evidence',async()=>{
 const f=await fixture();
 try{
  await f.pool.query('UPDATE p5ds_pages SET evidence=$2::jsonb WHERE document_id=$1 AND page=1',[f.document.id,JSON.stringify(evidence(1))]);
  const original=f.reader.call;
  f.reader.call=async(...args)=>{
   if(args[2].pages.length>1){f.calls.push(args[2].pages.map(p=>p.page));throw new ServiceError(failure,503);}
   return original(...args);
  };
  await f.pipeline.read(f.job,signal());
  const parent=await f.store.job('test','test',f.job.id);
  assert.equal(parent.state,'complete');assert.equal(parent.result.reason,failure);
  assert.deepEqual(parent.result.pages,[2,3,4]);
  assert.equal((await f.store.document('test','test',f.document.id)).state,'prepared');
  for(let n=0;n<3;n++)await f.pipeline.read(await f.store.claim(['read']),signal());
  assert.deepEqual(f.calls,[[2,3,4],[2],[3],[4]]);
  assert.equal(await f.store.claim(['read']),null);
  assert.equal((await f.store.document('test','test',f.document.id)).state,'complete');
  const pages=await f.store.pages(f.document.id);
  assert.deepEqual(pages.map(p=>p.evidence),[1,2,3,4].map(evidence));
  assert.deepEqual((await f.store.documentProgress(f.document.id)),{parsed:4,checked:4,read:4});
 }finally{await f.pool.end();}
});

test('split creation rolls back with the parent and a lost lease cannot enqueue paid work',async()=>{
 const f=await fixture();
 try{
  f.reader.call=async()=>{throw new ServiceError('provider-timeout',503);};
  const enqueue=f.store.enqueue.bind(f.store);let n=0;
  f.store.enqueue=async(...args)=>{if(++n===2)throw Error('Simulated database interruption');return enqueue(...args);};
  await assert.rejects(f.pipeline.read(f.job,signal()),/database interruption/);
  const queued=await f.pool.query("SELECT count(*)::int AS n FROM p5ds_jobs WHERE kind='read'");
  assert.equal(queued.rows[0].n,1);
  assert.equal((await f.store.job('test','test',f.job.id)).state,'running');
  f.store.enqueue=enqueue;
  await f.pool.query("UPDATE p5ds_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[f.job.id]);
  await assert.rejects(f.pipeline.read(f.job,signal()),/lease-lost/);
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM p5ds_jobs WHERE kind='read'")).rows[0].n,1);
 }finally{await f.pool.end();}
});

test('cancellation, authentication and rate limits do not fan out into new requests',async()=>{
 const f=await fixture();
 try{
  for(const error of [new ServiceError('provider-http-401',422),new ServiceError('provider-rate-limit',429,1000)]){
   f.reader.call=async()=>{throw error;};
   await assert.rejects(f.pipeline.read(f.job,signal()),e=>e===error);
  }
  const controller=new AbortController();
  f.reader.call=async()=>{controller.abort();throw new ServiceError('provider-timeout',503);};
  await assert.rejects(f.pipeline.read(f.job,controller.signal),e=>e.name==='AbortError');
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM p5ds_jobs WHERE kind='read'")).rows[0].n,1);
 }finally{await f.pool.end();}
});

test('single-page timeout remains a failure without creating a recursive split',async()=>{
 const f=await fixture(1);
 try{
  f.reader.call=async()=>{throw new ServiceError('provider-timeout',503);};
  await assert.rejects(f.pipeline.read(f.job,signal()),/provider-timeout/);
  await f.store.fail({...f.job,attempts:3},new ServiceError('provider-timeout',503));
  assert.equal((await f.store.document('test','test',f.document.id)).state,'failed');
  assert.equal((await f.store.documentProgress(f.document.id)).checked,0);
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM p5ds_jobs WHERE kind='read'")).rows[0].n,1);
 }finally{await f.pool.end();}
});

test('provider failure metrics identify the request shape without source text or credentials',async()=>{
 const metrics=[];let released=0;
 const reader=new Reader({...config,provider:'anthropic',model:'test-model',key:'secret-not-for-metrics',maxOutput:10000},
  {reserve:async()=> 'slot',release:async()=>released++,metric:async(...args)=>metrics.push(args)},
  async()=>{throw new DOMException('Private provider error body','TimeoutError');});
 await assert.rejects(reader.call({kind:'read',attempts:2},'private instructions',{pages:[{page:2,text:'Private source contents'}]},[],EVIDENCE_SCHEMA,signal()),/provider-timeout/);
 const detail=metrics[0][3];
 assert.deepEqual(detail.pages,[2]);assert.equal(detail.attempt,2);assert.equal(detail.timeoutMs,120000);assert.equal(detail.maxOutputTokens,10000);
 assert.equal(detail.cancelled,false);assert.equal(released,1);
 assert.ok(!JSON.stringify(metrics).includes('Private'));assert.ok(!JSON.stringify(metrics).includes('secret-not-for-metrics'));
});

test('single-page output recovery retains quantities, exclusions and independent visual verification',async()=>{
 const f=await fixture(1,{provider:'anthropic',model:'claude-sonnet-5'}),requests=[];
 try{
  f.reader.call=async(job,system,input,images,schema,signal,verify,purpose)=>{
   requests.push({purpose,verify,input,images,schema});
   if(purpose==='read')throw new ServiceError('provider-output-limit',422);
   const page=evidence(1);if(purpose==='read-efficient')page.items[0].basis='visual';
   return {pages:[page]};
  };
  await f.pipeline.read(f.job,signal());
  assert.deepEqual(requests.map(r=>r.purpose),['read','read-efficient','verify']);
  assert.equal(requests[2].verify,true);
  assert.deepEqual(requests[0].input,requests[1].input);assert.deepEqual(requests[0].images,requests[1].images);
  assert.equal(requests[0].schema,requests[1].schema);
  const actual=(await f.store.pages(f.document.id))[0].evidence;
  assert.equal(actual.items[0].quantity,120);assert.deepEqual(actual.exclusions,['Electrical work']);
  const ordinary=requestBody('anthropic','claude-sonnet-5','',{},[],EVIDENCE_SCHEMA,10000,'read').body;
  const recovered=requestBody('anthropic','claude-sonnet-5','',{},[],EVIDENCE_SCHEMA,10000,'read-efficient').body;
  assert.equal(ordinary.output_config.effort,'medium');assert.equal(recovered.output_config.effort,'low');
  recovered.output_config.effort='medium';assert.deepEqual(recovered,ordinary,'Recovery changes only effort, not model, output ceiling or schema');
  assert.equal(requestBody('anthropic','claude-sonnet-5','',{},[],EVIDENCE_SCHEMA,10000,'verify').body.output_config.effort,undefined);
 }finally{await f.pool.end();}
});

for(const code of ['provider-output-limit','qa-paused-unknown-provider-charge','provider-timeout'])test('an interrupted lower-effort recovery cannot repeat on job restart: '+code,async()=>{
 const f=await fixture(1,{provider:'anthropic',model:'claude-sonnet-5'});let calls=0;
 try{
  f.reader.call=async()=>{calls++;throw new ServiceError(calls===1?'provider-output-limit':code,422);};
  await assert.rejects(f.pipeline.read(f.job,signal()),e=>e.code===code);assert.equal(calls,2);
  const restarted=await f.store.job('test','test',f.job.id);
  assert.equal(restarted.result.lowReadStarted,true);
  await assert.rejects(f.pipeline.read(restarted,signal()),e=>e.code==='output-recovery-needs-inspection');
  assert.equal(calls,2);assert.equal((await f.store.documentProgress(f.document.id)).checked,0);
 }finally{await f.pool.end();}
});

test('a lower-effort reply retains a strict citation rejection as uncertainty and preserves its checkpoint',async()=>{
 const f=await fixture(1,{provider:'anthropic',model:'claude-sonnet-5'}),purposes=[];
 try{
  f.reader.call=async(job,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);if(purpose==='read')throw new ServiceError('provider-output-limit',422);
   if(purpose==='citation')return {citations:[{key:'1:items:0',supported:false,lines:[]}]};
   const page=evidence(1);page.items[0].quantity=999;page.items[0].evidence='Invented amount';if(purpose==='source-repair')return {facts:[],items:[{key:'1:items:0',statement:page.items[0],reason:'Still unsupported.'}],regions:[]};return {pages:[page]};
  };
   await f.pipeline.read(f.job,signal());
   const saved=(await f.store.pages(f.document.id))[0].evidence;
   assert.equal(saved.status,'partial');assert.equal(saved.items[0].basis,'uncertain');assert.equal(saved.items[0].quantity,null);
  assert.deepEqual(purposes,['read','read-efficient','citation','source-repair','citation']);
   assert.equal((await f.store.documentProgress(f.document.id)).checked,1);
 }finally{await f.pool.end();}
});

for(const reason of ['cancelled','lease-lost'])test('output-limit recovery cannot spend after '+reason,async()=>{
 const f=await fixture(1,{provider:'anthropic',model:'claude-sonnet-5'}),controller=new AbortController();let calls=0;
 try{
  f.reader.call=async()=>{
   calls++;if(reason==='cancelled')controller.abort();else await f.pool.query("UPDATE p5ds_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[f.job.id]);
   throw new ServiceError('provider-output-limit',422);
  };
  await assert.rejects(f.pipeline.read(f.job,controller.signal));assert.equal(calls,1);
  assert.equal((await f.store.job('test','test',f.job.id)).result,null);
 }finally{await f.pool.end();}
});
