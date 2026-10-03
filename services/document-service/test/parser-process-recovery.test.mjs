import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {createParser} from '../src/parser.mjs';
import {runPrimary,createPrimaryPool} from '../src/renderer-runtime.mjs';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {isolatedPool} from '../scripts/model-qa-support.mjs';
const processFile=new URL('./fixtures/parser-exit.mjs',import.meta.url);
test('small Wasm allocations work inside the unchanged guarded address-space budget',async()=>{
 const result=await runPrimary({fault:'wasm'},{processFile,timeoutMs:3000});assert.equal(result.value.bytes,65536);
});
test('engine initialization reuse is serial and recycles after eight requests',async()=>{
 const pool=createPrimaryPool({processFile}),pids=[];
 try{for(let i=0;i<17;i++)pids.push((await pool.run({fault:'respond'},{timeoutMs:3000})).value.pid);}
 finally{await pool.close();}
 assert.equal(new Set(pids.slice(0,8)).size,1);assert.equal(new Set(pids.slice(8,16)).size,1);
 assert.notEqual(pids[0],pids[8]);assert.notEqual(pids[8],pids[16]);
 for(const pid of new Set(pids))assert.throws(()=>process.kill(pid,0));
});
test('controlled native allocation pressure is contained in the guarded child',async()=>{
 let peak=0;
 await assert.rejects(runPrimary({fault:'memory'},{processFile,timeoutMs:10000,onNative:value=>{peak=Math.max(peak,value.rss);}}),error=>['parser-memory-limit','parser-process-failed'].includes(error.code));
 assert.ok(peak>32*1024*1024);assert.ok(peak<512*1024*1024);
 console.log(`Controlled allocation fixture maximum reported child RSS: ${Math.ceil(peak/1024)} KiB; sampled evidence, not a universal hard RSS bound.`);
});
for(const fault of ['exit','timeout'])test('real child '+fault+' preserves durable successful pages across a new worker and lease',async()=>{
 const pdf=await PDFDocument.create();for(let i=1;i<=2;i++)pdf.addPage([300,200]).drawText('Source page '+i,{x:30,y:100,size:12});
 const bytes=Buffer.from(await pdf.save()),pool=await isolatedPool();
 const config={provider:'offline',model:'fixture',parserSlots:1,maxPages:4,parseMs:15000,maxTenantBytes:10000000,maxQueue:10};
 try{
  const store=new Store(pool,config);await store.init();const {document}=await store.putDocument('test','test','fixture.pdf',bytes),job=await store.claim(['parse']);
  const parser=createParser({primary:(r,o)=>r.page===2?runPrimary({...r,fault},{...o,processFile,timeoutMs:500}):runPrimary(r,o)});
  await assert.rejects(new Pipeline(store,{},config,parser).prepare(job,new AbortController().signal),error=>error.code===(fault==='exit'?'parser-process-failed':'parser-attempt-timeout'));
  const saved=await store.pages(document.id,null,true);assert.equal(saved.length,1);assert.equal(saved[0].page,1);
  await pool.query("UPDATE p5ds_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
  const freshStore=new Store(pool,config),freshJob=await freshStore.claim(['parse']),rendered=[];
  const resumed=createParser({primary:(r,o)=>{if(r.page)rendered.push(r.page);return runPrimary(r,o);}});
  await new Pipeline(freshStore,{},config,resumed).prepare(freshJob,new AbortController().signal);
  assert.deepEqual(rendered,[2]);assert.deepEqual((await freshStore.pages(document.id,null,true))[0],saved[0]);
  await assert.rejects(store.manifest(job,2),/lease-lost/);
  assert.deepEqual(Buffer.from((await freshStore.document('test','test',document.id,true)).bytes),bytes);
 }finally{await pool.end();}
});
test('timeout and cancellation reap the child before releasing the call',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'p5-reap-test-'));
 try{
  for(const cancel of [false,true]){
   const pidFile=path.join(directory,cancel?'abort.pid':'timeout.pid'),controller=new AbortController();
   const call=runPrimary({fault:'hang',pidFile},{processFile,timeoutMs:1000,signal:controller.signal});
   const assertion=assert.rejects(call,error=>error.code===(cancel?'processing-cancelled':'parser-attempt-timeout'));
   let pid;for(let n=0;n<40;n++){try{pid=Number(await readFile(pidFile,'utf8'));break;}catch{await new Promise(r=>setTimeout(r,20));}}
   assert.ok(pid);if(cancel)controller.abort();await assertion;
   assert.throws(()=>process.kill(pid,0));
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
