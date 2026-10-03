import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPool} from '../scripts/model-qa-support.mjs';
import {Store} from '../src/store.mjs';
import {Pipeline,reconcileVerification} from '../src/pipeline.mjs';
import {ServiceError} from '../src/core.mjs';
import {parsePdf} from '../src/parser.mjs';
import {PDFDocument,StandardFonts} from 'pdf-lib';

const page=(number=1)=>({page:number,sheet:'A1',revision:'',status:'read',notes:[],
 facts:[{field:'otherDetails',value:'Owner supplies trim',basis:'visual',evidence:'Trim note on drawing'}],items:[],
 inclusions:['Install trim','Protect floors'],exclusions:['Electrical work','Painting'],responsibilities:['Owner supplies trim','Contractor installs'],regions:[]});
const signal=()=>new AbortController().signal;

test('statement order and equivalent citation wording do not create false conflicts',()=>{
 const original=page(),checked=structuredClone(original);
 for(const name of ['inclusions','exclusions','responsibilities'])checked[name].reverse();
 checked.inclusions[0]=' Protect  floors ';
 checked.facts[0].evidence='Same trim note independently read from the image';
 const result=reconcileVerification(original,checked);
 assert.equal(result.status,'read');assert.deepEqual(result.facts,original.facts);
 assert.deepEqual(result.inclusions,original.inclusions);assert.deepEqual(result.notes,[]);
});

test('repeated fact fields match one-to-one across reordered verifier output',()=>{
 const original=page();original.facts.push({...original.facts[0],value:'Contractor installs'});
 const checked=structuredClone(original);checked.facts.reverse();
 assert.deepEqual(reconcileVerification(original,checked),original);
 checked.facts.pop();assert.equal(reconcileVerification(original,checked).status,'partial');
});

for(const change of ['negation','quantity','basis','missing','duplicate'])test('semantic differences remain unresolved: '+change,()=>{
 const original=page(),checked=structuredClone(original);
 if(change==='negation')checked.inclusions[0]='Do not install trim';
 if(change==='quantity')checked.facts[0].value='Owner supplies 20 trim pieces';
 if(change==='basis')checked.facts[0].basis='calculated';
 if(change==='missing')checked.exclusions.pop();
 if(change==='duplicate')checked.responsibilities.push(checked.responsibilities[0]);
 assert.equal(reconcileVerification(original,checked).status,'partial');
});

test('equivalent citations cannot clear prior uncertainty',()=>{
 const original=page();original.status='partial';original.facts[0].basis='uncertain';
 const checked=structuredClone(original);checked.status='read';checked.facts[0].evidence='Another unresolved note';
 assert.equal(reconcileVerification(original,checked).status,'partial');
});

async function fixture(realCrops=false){
 const config={provider:'offline',model:'fixture',verifyModel:'fixture',parserSlots:1,maxPages:4,parseMs:10000,maxTenantBytes:1000000,maxQueue:10};
 const pool=await isolatedPool(),store=new Store(pool,config);await store.init();
 const calls=[],crops=[];let failSecond=true;
 const reader={call:async(job,system,input,images,schema,abort,verify)=>{
  calls.push({verify,pages:input.pages.map(p=>p.page)});
  if(realCrops&&verify){assert.equal(images.length,2);assert.ok(images.every(image=>image.bytes.length>100));}
  if(verify&&input.pages[0].page===2&&failSecond){failSecond=false;throw new ServiceError('provider-timeout',503);}
  return {pages:input.pages.map(p=>({...page(p.page),...(realCrops&&!verify?{regions:[{x:.1,y:.1,width:.4,height:.4,reason:'Confirm the drawing note'}]}:{})}))};
 }};
 const parser=async(bytes,options)=>{
  if(realCrops){
   if(options.crop)crops.push(options.crop.page);
   return parsePdf(bytes,{...options,onPage:p=>options.onPage({...p,kind:'text'})});
  }
  await options.onManifest(2);for(let n=1;n<=2;n++)await options.onPage({page:n,kind:'text',text:'Synthetic drawing notes',textQuality:1,image:Buffer.from('synthetic-image'),parseMs:0,nativeMs:0,renderMs:0});
 };
 const pipeline=new Pipeline(store,reader,config,parser);
 let bytes=Buffer.from('%PDF-offline-fixture');
 if(realCrops){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let n=1;n<=2;n++)pdf.addPage().drawText('Synthetic drawing notes '+n,{font,x:50,y:600});bytes=Buffer.from(await pdf.save());}
 const {document}=await store.putDocument('test','test','synthetic.pdf',bytes);
 await pipeline.prepare(await store.claim(['parse']),signal());
 return {pool,store,pipeline,calls,crops,reader,parser,config,document,job:await store.claim(['read'])};
}

test('a new worker reclaims an expired lease and reuses completed real PDF crop verification',async()=>{
 const f=await fixture(true);
 try{
  const nativeBefore=await f.store.pages(f.document.id,null,true);
  await assert.rejects(f.pipeline.read(f.job,signal()),/provider-timeout/);
  assert.deepEqual(f.crops,[1,2]);
  const checkpoint=(await f.store.job('test','test',f.job.id)).result.completedPages[1];
  await f.pool.query("UPDATE p5ds_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[f.job.id]);
  const freshStore=new Store(f.pool,f.config),freshPipeline=new Pipeline(freshStore,f.reader,f.config,f.parser);
  const reclaimed=await freshStore.claim(['read']);
  assert.notEqual(reclaimed.lease_token,f.job.lease_token);
  await assert.rejects(f.store.checkpoint(f.job,{discard:'stale worker'}),/lease-lost/);
  await freshPipeline.read(reclaimed,signal());
  assert.deepEqual(f.crops,[1,2,2],'completed page 1 crop is never rendered again');
  assert.deepEqual(f.calls,[{verify:false,pages:[1,2]},{verify:true,pages:[1]},{verify:true,pages:[2]},{verify:true,pages:[2]}]);
  const saved=await freshStore.job('test','test',f.job.id);
  assert.deepEqual(saved.result.completedPages[1],checkpoint);assert.equal(saved.state,'complete');
  const nativeAfter=await freshStore.pages(f.document.id,null,true);
  assert.deepEqual(nativeAfter.map(({native,image})=>({native,image})),nativeBefore.map(({native,image})=>({native,image})));
 }finally{await f.pool.end();}
});

test('restart skips completed page verification and completion retains all successful checkpoints',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.pipeline.read(f.job,signal()),/provider-timeout/);
  const interrupted=await f.store.job('test','test',f.job.id);
  assert.ok(interrupted.result.completedPages[1]);assert.equal(interrupted.result.completedPages[2],undefined);
  const original=structuredClone(interrupted.result.evidenceCheckpoint);
  const verified=structuredClone(interrupted.result.verificationCheckpoints['verify-1']);
  await f.pipeline.read(interrupted,signal());
  assert.deepEqual(f.calls,[{verify:false,pages:[1,2]},{verify:true,pages:[1]},{verify:true,pages:[2]},{verify:true,pages:[2]}]);
  const complete=await f.store.job('test','test',f.job.id);
  assert.equal(complete.state,'complete');assert.deepEqual(complete.result.evidenceCheckpoint,original);
  assert.deepEqual(complete.result.verificationCheckpoints['verify-1'],verified);
  assert.ok(complete.result.verificationCheckpoints['verify-2']);
  assert.deepEqual(complete.result.pages,[1,2]);
  assert.deepEqual((await f.store.pages(f.document.id)).map(p=>p.evidence),[page(1),page(2)]);
  assert.equal((await f.store.document('test','test',f.document.id)).state,'complete');
 }finally{await f.pool.end();}
});

test('saved page replay rejects changed source and preserves uncertainty',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.pipeline.read(f.job,signal()),/provider-timeout/);
  const restarted=await f.store.job('test','test',f.job.id);
  restarted.result.completedPages[1].key='different-source';
  await assert.rejects(f.pipeline.read(restarted,signal()),/completed-page-source-changed/);
  assert.equal(f.calls.length,3);
 }finally{await f.pool.end();}
});

test('completion reads durable checkpoints even when caller state is stale and rolls back on quota failure',async()=>{
 const f=await fixture();
 try{
  await f.store.checkpoint(f.job,{evidenceCheckpoint:{raw:{pages:[page()]}},verificationCheckpoints:{'verify-1':{raw:{pages:[page()]}}}});
  const stale={...f.job,result:null};
  const check=f.store.checkStorage.bind(f.store);f.store.checkStorage=async()=>{throw new ServiceError('document-storage-quota',422);};
  await assert.rejects(f.store.complete(stale,{pages:[1,2]}),/document-storage-quota/);
  assert.equal((await f.store.job('test','test',f.job.id)).state,'running');
  f.store.checkStorage=check;await f.store.complete(stale,{pages:[1,2]});
  const complete=await f.store.job('test','test',f.job.id);
  assert.deepEqual(complete.result.evidenceCheckpoint,f.job.result.evidenceCheckpoint);
  assert.deepEqual(complete.result.verificationCheckpoints,f.job.result.verificationCheckpoints);
  await assert.rejects(f.store.complete(stale,{cached:true}),/lease-lost/);
 }finally{await f.pool.end();}
});
