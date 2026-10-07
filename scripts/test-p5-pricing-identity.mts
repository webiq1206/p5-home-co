import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-pricing-identity-'));
let database:any;
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 await writeFile(path.join(dir,'scopePricing.ts'),`
 export const PRICING_STAGE_MAX_MS=150000;export const RESEARCH_STAGE_MS=150000;
 export let calls=0;let variant=0;let reverse=false;let interrupt=false;
 export function scenario(v:number,r=false,pause=false){variant=v;reverse=r;interrupt=pause;}
 export async function requestPricing(instructions:string,input:any){calls++;return {value:{instructions,input},sourceUrls:[]};}
 export async function priceCompleteScope(scope:any,configuration:any,request:any,now:Date){
   const inputs=[{taskBatch:[{id:'doors',quantity:variant?1:4}],responsibility:variant?'owner supplies three':'contractor supplies four',date:now.toISOString(),configuration},
     {taskBatch:[{id:'trim',quantity:120}],date:now.toISOString(),configuration}];
   if(reverse)inputs.reverse();
   const results=[];
   for(const input of inputs){results.push(await request('You are a construction estimator',input,false,150000));if(interrupt)throw new Error('synthetic-cancellation');}
   return {customer:{range:{low:100,high:150}},results,inputs};
 }
 `);
 const load=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 database=await load('database');
 const work=await load('pricingWork'),provider=await load('scopePricing'),store=await load('store');
 const {ESTIMATOR_BRAND}=await load('brand');
 const id=randomUUID();
 await store.saveDraft(id,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:'Test scope',answers:{},extraction:null,reviewed:null,contact:{name:'Synthetic',email:'synthetic@example.invalid',phone:''}},0);
 const scope={text:'Test scope',answers:{},extraction:null,uploads:[]};
 const date=new Date('2026-09-19T23:59:59Z');
 const run=(time=date)=>work.priceSavedScope(id,scope,{},time);
 const check=(result:any)=>assert.deepEqual(result.results.map((r:any)=>r.value.input),result.inputs,'each reply belongs to its exact requested scope');
 check(await run());assert.equal(provider.calls,2);
 check(await run(new Date('2026-09-19T23:59:59.999Z')));assert.equal(provider.calls,2,'same-day resume also keeps the original timestamp');
 provider.scenario(0,true);check(await run(new Date('2026-09-20T00:00:01Z')));
 assert.equal(provider.calls,2,'reordering and a later resume reuse completed requests');
 check(await run(new Date('2026-09-25T12:00:00Z')));
 assert.equal(provider.calls,2,'multi-day resume retains the original exact requests');
 provider.scenario(1);check(await run());
 assert.equal(provider.calls,3,'changed quantity and responsibility invalidate only the affected batch');
 provider.scenario(0);check(await run());assert.equal(provider.calls,3,'earlier exact evidence is still available');
 const key=work.pricingWorkKey(scope,{},date);
 const [row]=await database.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,key]);
 assert.equal(row.payload.pricingAt,date.toISOString());
 // Historical position-only replies have no evidence tying them to current
 // quantities. Preserve the records, but never treat them as a validated hit.
 row.payload.replies={'mapping#1':{value:{input:'wrong historical scope'},sourceUrls:[]}};
 await database.query('UPDATE p5_estimator_work SET payload=$1::jsonb WHERE draft_id=$2 AND work_key=$3',[JSON.stringify(row.payload),id,key]);
 check(await run());assert.equal(provider.calls,5);
 const [retained]=await database.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,key]);
 assert.ok(retained.payload.replies['mapping#1'],'historical checkpoints remain available for inspection');
 const later=new Date('2026-09-26T12:00:00Z');
 const identity={draftId:id,customerKey:'synthetic@example.invalid|synthetic',revision:1};
 const keyed=work.pricingWorkKey(scope,{},date,undefined,identity);
 const snapshot=await work.pricingWorkSnapshot(id,scope,{},later,identity);
 assert.notEqual(snapshot.workKey,key,'legacy work without a proven revision cannot be adopted');
 // Establish a deployed, pre-fix inline checkpoint with durable server request
 // traces in the current revision. Read jsonb as the real pricing worker does.
 const [server]=await database.query('SELECT $1::jsonb AS scope',[JSON.stringify(scope)]);
 const legacyKey=work.pricingWorkKey(server.scope,{},date);
 const legacyPayload={...retained.payload,pricingAt:date.toISOString(),shortlists:{saved:{doors:['synthetic-rate']}},repairClock:{startedAt:1234,busyWaitMs:7},busyWaitMs:11};
 delete legacyPayload.identityKey;
 await database.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload',[id,legacyKey,JSON.stringify(legacyPayload)]);
 const job={createdAt:later.toISOString(),input:{kind:'pricing',draft:{id,revision:1,contact:{email:'synthetic@example.invalid',name:'Synthetic',phone:''},reviewed:server.scope},configuration:{}}};
 await database.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb)',[id,'background-v1-synthetic-pricing',JSON.stringify(job)]);
 const adopted=await work.pricingWorkSnapshot(id,server.scope,{},later,identity);
 assert.equal(adopted.workKey,legacyKey);assert.equal(adopted.pricingAt.toISOString(),date.toISOString());
 const changedIdentity={...identity,revision:2};
 for(const [changedScope,configuration,currentIdentity] of [
  [server.scope,{},changedIdentity],
  [server.scope,{finance:{rate:99}},identity],
  [{...server.scope,text:'Different scope'}, {},identity],
  [{...server.scope,uploads:[{id:'source',sha256:'changed-source',status:'stored'}]}, {},identity],
  [server.scope,{}, {...identity,customerKey:'another@example.invalid|another'}],
 ]){
  const invalidated=await work.pricingWorkSnapshot(id,changedScope,configuration,later,currentIdentity);
  assert.notEqual(invalidated.workKey,legacyKey);assert.equal(invalidated.pricingAt.toISOString(),later.toISOString(),'genuine identity changes start a fresh snapshot');
 }
 assert.notEqual(work.pricingWorkKey(scope,{},date,'synthetic-new-engine'),key,'engine releases remain distinct');
 const oldRevisionId=randomUUID();
 await store.saveDraft(oldRevisionId,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:'Test scope',answers:{},extraction:null,reviewed:null,contact:{name:'Synthetic',email:'synthetic@example.invalid',phone:''}},0);
 const oldRevisionPayload={...legacyPayload,requests:{old:{startedAt:'2026-09-19T23:59:59Z'}}};
 await database.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb)',[oldRevisionId,legacyKey,JSON.stringify(oldRevisionPayload)]);
 const oldRevisionSnapshot=await work.pricingWorkSnapshot(oldRevisionId,server.scope,{},later,{...identity,draftId:oldRevisionId});
 assert.notEqual(oldRevisionSnapshot.workKey,legacyKey,'a trace predating the current revision cannot authenticate identical legacy scope');
 provider.scenario(0);
 const priorCalls=provider.calls;
 check(await work.priceSavedScope(id,server.scope,{},later,undefined,identity));
 const [adoptedRow]=await database.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,legacyKey]);
 assert.equal(adoptedRow.payload.pricingAt,date.toISOString());
 assert.deepEqual(adoptedRow.payload.shortlists,legacyPayload.shortlists);
 assert.deepEqual(adoptedRow.payload.repairClock,legacyPayload.repairClock);
 assert.equal(adoptedRow.payload.busyWaitMs,11,'resuming does not forgive prior worked time');
 check(await work.priceSavedScope(id,server.scope,{},new Date('2026-10-01T01:00:00Z'),undefined,identity));
 assert.equal(provider.calls,priorCalls,'legacy exact replies survive adoption and subsequent resumes');
 const background=await load('backgroundJobs');
 const [savedJob]=await database.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,'background-v1-synthetic-pricing']);
 assert.deepEqual(await background.jobProgressWorkKeys(savedJob.payload),[legacyKey],'status inspection follows the same frozen checkpoint after a retry resets the job date');
 // An interrupted pass retains its first reply and lease; an overnight retry
 // must not buy that stage again or create a second runnable work record.
 const cancelId=randomUUID();
 await store.saveDraft(cancelId,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:'Test scope',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 provider.scenario(0,false,true);const beforeCancel=provider.calls;
 await assert.rejects(work.priceSavedScope(cancelId,scope,{},date),/synthetic-cancellation/);
 assert.equal(provider.calls,beforeCancel+1);
 await database.query("UPDATE p5_estimator_work SET lease_token='active',lease_until=now()+interval '1 minute' WHERE draft_id=$1 AND work_key=$2",[cancelId,key]);
 await assert.rejects(work.priceSavedScope(cancelId,scope,{},later),/already running/);
 assert.equal(provider.calls,beforeCancel+1,'an active overnight lease blocks duplicate dispatch');
 await database.query('UPDATE p5_estimator_work SET lease_token=NULL,lease_until=NULL WHERE draft_id=$1 AND work_key=$2',[cancelId,key]);
 provider.scenario(0);check(await work.priceSavedScope(cancelId,scope,{},later));assert.equal(provider.calls,beforeCancel+2);
 assert.equal((await database.query("SELECT * FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'pricing-v11-%'",[cancelId])).length,1);
 assert.ok((await database.query('SELECT lease_token FROM p5_estimator_work WHERE draft_id=$1',[cancelId])).every((row:{lease_token:unknown})=>row.lease_token===null));
 const ledger=await load('pricingLedger');
 const input={date:date.toISOString(),quantity:3,unitCost:100};
 for(const altered of [{...input,date:later.toISOString()},{...input,quantity:4},{...input,unitCost:101}]){
  assert.notEqual(work.pricingReplyKey('exact',input,false),work.pricingReplyKey('exact',altered,false));
  assert.notEqual(ledger.pricingFingerprint('anthropic','exact',input,false,identity),ledger.pricingFingerprint('anthropic','exact',altered,false,identity),'paid request identity remains exact');
 }
 assert.notEqual(ledger.pricingFingerprint('anthropic','exact',input,false,identity),ledger.pricingFingerprint('anthropic','exact',input,false,changedIdentity));
 assert.notEqual(work.pricingReplyKey('exact',input,false),work.pricingReplyKey('changed instructions',input,false));
 assert.notEqual(work.pricingReplyKey('exact',input,false),work.pricingReplyKey('exact',input,true));
 assert.notEqual(keyed,key,'new work is bound to customer and revision');
 assert.equal(keyed,work.pricingWorkKey(scope,{},later,undefined,identity),'the initial lease identity cannot split across midnight');
 const raceId=randomUUID(),raceIdentity={...identity,draftId:raceId};
 await store.saveDraft(raceId,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:'Test scope',answers:{},extraction:null,reviewed:null,contact:{name:'Synthetic',email:'synthetic@example.invalid',phone:''}},0);
 const beforeRace=provider.calls;
 const raced=await Promise.allSettled([date,new Date('2026-09-20T00:00:01Z')].map(time=>work.priceSavedScope(raceId,scope,{},time,undefined,raceIdentity)));
 assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(raced.filter(result=>result.status==='rejected'&&/already running/.test(String(result.reason))).length,1,'concurrent first requests share one lease across midnight');
 assert.equal(provider.calls,beforeRace+2);
 assert.equal((await database.query("SELECT * FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'pricing-v11-%'",[raceId])).length,1);
 console.log('PASS: UTC midnight/multi-day replay, legacy revision proof, configuration/source/customer/revision invalidation, cancellation/retry, active leases, frozen status and exact cost/request hashes. Isolated SQL and synthetic responses only.');
}finally{
 if(database)await database.database.close();
 await rm(dir,{recursive:true,force:true});
}
