import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPool} from '../scripts/model-qa-support.mjs';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {Reader} from '../src/provider.mjs';
import {ServiceError} from '../src/core.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';

const config={parserSlots:1,slots:2,rpm:60,tpm:600000,callMs:40000,parseMs:60000,
 jobMs:300000,maxPages:4,maxTenantBytes:1000000,maxQueue:30};
const evidence=page=>({page,sheet:'',revision:'',status:'read',notes:[],facts:[],
 items:[{id:'trim-'+page,description:'Baseboard',component:'Trim',building:'',floor:'',quantity:120,unit:'lf',basis:'stated',evidence:'Install 120 lf baseboard.'}],
 inclusions:['Install 120 lf baseboard.'],exclusions:['Electrical work'],responsibilities:[],regions:[]});
const signal=()=>new AbortController().signal;

async function fixture(count=4){
 const pool=await isolatedPool(),store=new Store(pool,config);await store.init();
 const calls=[];
 const reader={call:async(job,system,input)=>{calls.push(input.pages.map(p=>p.page));return {pages:input.pages.map(p=>evidence(p.page))};}};
 const parser=async(bytes,{onManifest,onPage})=>{
  await onManifest(count);
  for(let page=1;page<=count;page++)await onPage({page,kind:'text',text:'Install 120 lf baseboard. Exclude electrical work.',textQuality:1,image:Buffer.from('synthetic-image'),parseMs:1,nativeMs:1,renderMs:0});
 };
 const pipeline=new Pipeline(store,reader,config,parser);
 const {document}=await store.putDocument('test','test','synthetic.pdf',Buffer.from('%PDF-synthetic-parser'));
 await pipeline.prepare(await store.claim(['parse']),signal());
 const job=await store.claim(['read']);
 return {pool,store,pipeline,reader,calls,document,job};
}

test('a timed-out batch becomes durable single-page jobs without rereading cached evidence',async()=>{
 const f=await fixture();
 try{
  await f.pool.query('UPDATE p5ds_pages SET evidence=$2::jsonb WHERE document_id=$1 AND page=1',[f.document.id,JSON.stringify(evidence(1))]);
  const original=f.reader.call;
  f.reader.call=async(...args)=>{
   if(args[2].pages.length>1){f.calls.push(args[2].pages.map(p=>p.page));throw new ServiceError('provider-timeout',503);}
   return original(...args);
  };
  await f.pipeline.read(f.job,signal());
  const parent=await f.store.job('test','test',f.job.id);
  assert.equal(parent.state,'complete');assert.equal(parent.result.reason,'provider-timeout');
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
