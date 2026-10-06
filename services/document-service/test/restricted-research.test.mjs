import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {QaBudget,QA_MODEL,QA_RUN,QA_URL} from '../src/qa-budget.mjs';
import {RestrictedResearch,restrictedResearchWire,restrictedResearchUsage,RESEARCH_LIMITS} from '../src/restricted-research.mjs';
const id={tenant:'p5homeco.com',draftId:'4b984f15-af82-41ff-b181-e16696ea779a',revision:5,scopeHash:'a'.repeat(64),stageIdentity:'b'.repeat(64)};
const body={model:QA_MODEL,max_tokens:6000,system:'Research the entire original scope with cited sources.',messages:[{role:'user',content:'Original unchanged scope, inclusions, exclusions and saved answers.'}],tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}],tool_choice:{type:'tool',name:'web_search'},stream:false,service_tier:'standard_only'};
const reply={id:'msg_fixture',model:QA_MODEL,stop_reason:'end_turn',content:[{type:'text',text:'Controlled response, not real research.'}],usage:{input_tokens:2100000,output_tokens:6000,cache_creation_input_tokens:0,cache_read_input_tokens:0,server_tool_use:{web_search_requests:1,web_fetch_requests:0},service_tier:'standard'}};
const note='Independent exact wire, original scope and aggregate reservation reviewed in an isolated fixture.';
const migration=new URL('../migrations/manual/20261006-restricted-research.sql',import.meta.url);
const clone=value=>structuredClone(value);
async function fixture({migrate=true,enabled=true,respond=()=>Response.json(reply,{headers:{'request-id':'req_fixture'}})}={}){
 const db=new PGlite();await db.waitReady;let tail=Promise.resolve();
 const store={pool:{query:(sql,v)=>v===undefined?db.exec(sql).then(()=>({rows:[]})):db.query(sql,v)},transaction(fn){const work=tail.then(()=>db.transaction(tx=>fn({query:(sql,v)=>tx.query(sql,v)})));tail=work.catch(()=>{});return work;}};
 const config={provider:'anthropic',model:QA_MODEL,key:'fixture-only'};
 const legacy=new QaBudget(store,config,()=>{throw Error('Unexpected legacy dispatch');});
 await legacy.init();await legacy.provision([{tenant:id.tenant,project:'qa-paid-'+id.draftId}]);
 // Prior settled usage exists in BOTH ledger and run counter, never invented
 // by setting only a liability scalar. Reconciliation must agree with both.
 const prior=await legacy.capture(id.tenant,'qa-paid-'+id.draftId,'fixture:prior',{model:QA_MODEL,max_tokens:10000,messages:[{role:'user',content:'Previously completed fixture'}]});
 await legacy.permit(prior.requestHash,'fixture-prior-settled',note);
 await db.query("UPDATE p5ds_qa_calls SET status='settled',actual_microusd=43635 WHERE slot='fixture-prior-settled'");
 await db.query('UPDATE p5ds_qa_runs SET liability_microusd=43635 WHERE run_id=$1',[QA_RUN]);
 if(migrate)await db.exec(await readFile(migration,'utf8'));
 const state={now:1700000000000,external:7190000,epoch:'c'.repeat(64),evidence:'d'.repeat(64),identity:clone(id),calls:0,wire:null,stale:false,boundedMarker:true,noProviderMarker:false,wrongHash:false};
 const withVerifiedFence=async(expected,work)=>{
  // Fixture-only authority; production has NO adapter. A real implementation
  // must hold external-spend and draft-revision fences through awaited work.
  const run=(await db.query('SELECT liability_microusd FROM p5ds_qa_runs WHERE run_id=$1',[QA_RUN])).rows[0];
  assert.ok(Object.isFrozen(expected.body.messages[0]),'wire passed to the verifier is immutable');
  return work({identity:state.identity,requestHash:state.wrongHash?'e'.repeat(64):expected.requestHash,boundedMarker:state.boundedMarker,noProviderMarker:state.noProviderMarker,epoch:state.epoch,evidenceHash:state.evidence,externalMicrousd:state.external,qaLiabilityMicrousd:Number(run.liability_microusd),observedAt:state.now-(state.stale?120001:0),expiresAt:state.now+60000});
 };
 const budget=new RestrictedResearch(store,config,{enabled,withVerifiedFence,now:()=>state.now,request:async(url,options)=>{state.calls++;state.wire={url,options};return respond();}});
 const run=async()=>(await db.query('SELECT * FROM p5ds_qa_runs WHERE run_id=$1',[QA_RUN])).rows[0];
 return {db,store,legacy,budget,state,run,withVerifiedFence};
}

test('exact one-search profile preserves scope and rejects every unsupported extension',()=>{
 assert.deepEqual(restrictedResearchWire(body),body);
 for(const change of [
  {model:'claude-haiku-4-5'},{max_tokens:6001},{stream:true},{service_tier:'auto'},
  {tools:[...body.tools,{type:'web_fetch_20250910',name:'web_fetch'}]},
  {tools:[{...body.tools[0],max_uses:2}]},{tools:[{...body.tools[0],allowed_callers:['code_execution_20260120']}]},
  {system:[{type:'text',text:'scope',cache_control:{type:'ephemeral'}}]},
  {messages:[...body.messages,{role:'assistant',content:'Paused tool state'}]},
  {messages:[{...body.messages[0],cache_control:{type:'ephemeral'}}]},
  {messages:[{role:'user',content:[{type:'text',text:'scope'}]}]},
  {cache_control:{type:'ephemeral'}},{thinking:{type:'enabled'}},{output_config:{}},{betas:['loop-override']},{max_retries:1},{fallback:'other'},
  {tool_choice:{type:'auto'}},{tool_choice:{...body.tool_choice,extra:true}}
 ])assert.throws(()=>restrictedResearchWire({...body,...change}),/qa-research-/);
 assert.equal(RESEARCH_LIMITS.reserve,11*200000+6000*5+10000);
 assert.equal(7190000+43635+RESEARCH_LIMITS.reserve,9473635);
});

test('usage reconciles cumulative inputs and search fee; missing or unpriced usage cannot release hold',()=>{
 assert.equal(restrictedResearchUsage(reply,'req_fixture'),2140000);
 for(const change of [{input_tokens:2200001},{input_tokens:-1},{input_tokens:'10'},{output_tokens:6001},{cache_creation_input_tokens:1},{cache_read_input_tokens:undefined},{server_tool_use:undefined},{server_tool_use:{web_search_requests:2}},{server_tool_use:{web_search_requests:1,web_fetch_requests:1}},{server_tool_use:{web_search_requests:1,unknown_tool:0}},{service_tier:undefined},{service_tier:'priority'},{inference_geo:'us'},{cache_creation:{unknown:0}},{unknown_fee:0}])assert.throws(()=>restrictedResearchUsage({...reply,usage:{...reply.usage,...change}},'req_fixture'),/usage-/);
 assert.throws(()=>restrictedResearchUsage(reply,''),/receipt-/);
 assert.throws(()=>restrictedResearchUsage({...reply,model:'other'},'req_fixture'),/receipt-/);
});

test('default-off and missing migration cannot reserve, provision or dispatch',async()=>{
 const f=await fixture({migrate:false,enabled:false});
 try{
  await assert.rejects(f.budget.reserve(id,body,note),/disabled/);
  await assert.rejects(new RestrictedResearch(f.store,f.budget.config).dispatch(id,body),/disabled/);
  f.budget.enabled=true;await assert.rejects(f.budget.reserve(id,body,note),/p5ds_qa_research_admission/);
  assert.equal(Number((await f.run()).liability_microusd),43635);assert.equal(f.state.calls,0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM p5ds_qa_intents')).rows[0].n,1,'failed reservation rolls back captured intent');
 }finally{await f.db.close();}
});

test('one exact permit reserves full envelope and settles one direct request without altering old allowance/history',async()=>{
 const f=await fixture();try{
  const permit=await f.budget.reserve(id,body,note);assert.equal(permit.maximum,2240000);
  const held=await f.run();assert.equal(Number(held.liability_microusd),2283635);assert.equal(Number(held.allowance_microusd),2000000);assert.equal(Number(held.historical_unknown_microusd),390000);
  const result=await f.budget.dispatch(id,body);assert.equal(result.replayed,false);assert.equal(f.state.calls,1);
  assert.equal(f.state.wire.url,QA_URL);assert.equal(f.state.wire.options.redirect,'error');assert.deepEqual(JSON.parse(f.state.wire.options.body),body);
  assert.equal(Number((await f.run()).liability_microusd),2183635);
  assert.deepEqual((await f.budget.dispatch(id,body)).response,reply);assert.equal(f.state.calls,1);
  await assert.rejects(f.budget.reserve(id,{...body,system:'Changed research'},note));assert.equal(f.state.calls,1,'singleton cannot issue another research permit');
 }finally{await f.db.close();}
});

test('scope, epoch, stale snapshot, aggregate and inconsistent ledger reject before dispatch',async()=>{
 const f=await fixture();try{
  f.state.external=7716366;await assert.rejects(f.budget.reserve(id,body,note),/budget-exhausted/);
  f.state.external=7190000;f.state.stale=true;await assert.rejects(f.budget.reserve(id,body,note),/accounting-unverified/);f.state.stale=false;
  for(const field of ['boundedMarker','noProviderMarker','wrongHash']){const old=f.state[field];f.state[field]=!old;await assert.rejects(f.budget.reserve(id,body,note),/accounting-unverified/);f.state[field]=old;}
  await f.db.query('UPDATE p5ds_qa_runs SET liability_microusd=0');await assert.rejects(f.budget.reserve(id,body,note),/liability-changed/);await f.db.query('UPDATE p5ds_qa_runs SET liability_microusd=43635');
  await assert.rejects(f.budget.reserve({...id,draftId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},body,note),/case-identity/);
  await f.budget.reserve(id,body,note);
  f.state.identity.revision++;await assert.rejects(f.budget.dispatch(id,body),/accounting-unverified/);f.state.identity.revision--;
  f.state.epoch='e'.repeat(64);await assert.rejects(f.budget.dispatch(id,body),/admission-stale/);f.state.epoch='c'.repeat(64);
  await assert.rejects(f.budget.dispatch(id,{...body,system:'Changed prompt'}),/admission-stale/);
  f.state.now+=120001;await assert.rejects(f.budget.dispatch(id,body),/admission-stale/);
  assert.equal(f.state.calls,0);assert.equal(Number((await f.run()).liability_microusd),2283635,'stale admission remains held');
 }finally{await f.db.close();}
});

test('settled exact receipt survives expiry, restart and blocked spending without provider credentials',async()=>{
 const f=await fixture();try{
  await f.budget.reserve(id,body,note);await f.budget.dispatch(id,body);
  f.state.now+=1000000;f.state.epoch='e'.repeat(64);await f.db.query('UPDATE p5ds_qa_runs SET blocked=true');
  const restarted=new RestrictedResearch(f.store,{}, {enabled:true,withVerifiedFence:()=>{throw Error('No spending fence needed for paid replay');},request:()=>{throw Error('No provider request permitted');}});
  assert.deepEqual((await restarted.dispatch(id,body)).response,reply);assert.equal(f.state.calls,1);
  await assert.rejects(restarted.dispatch({...id,revision:6},body),/resident-provider-unavailable/);
 }finally{await f.db.close();}
});

test('expiry while waiting for the run lock rolls back reservation and admission',async()=>{
 const f=await fixture();try{
  const transaction=f.store.transaction;f.store.transaction=fn=>transaction(async c=>{f.state.now+=120001;return fn(c);});
  await assert.rejects(f.budget.reserve(id,body,note),/accounting-unverified/);
  assert.equal(Number((await f.run()).liability_microusd),43635);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM p5ds_qa_research_admission')).rows[0].n,0);assert.equal(f.state.calls,0);
 }finally{await f.db.close();}
});

test('simultaneous approvals and dispatches never duplicate reservations or outbound requests',async()=>{
 let release,started;const waiting=new Promise(r=>release=r),begun=new Promise(r=>started=r);
 const f=await fixture({respond:async()=>{started();await waiting;return Response.json(reply,{headers:{'request-id':'req_fixture'}});}});
 try{
  const attempts=await Promise.allSettled([f.budget.reserve(id,body,note),f.budget.reserve(id,body,note)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(Number((await f.run()).liability_microusd),2283635);
  const first=f.budget.dispatch(id,body);await Promise.race([begun,first]);
  await assert.rejects(f.budget.dispatch(id,body),/prior-call-held/);assert.equal(f.state.calls,1);
  release();await first;
 }finally{release();await f.db.close();}
});

test('network, HTTP, receipt-storage and malformed usage retain full unknown hold without retry',async()=>{
 for(const mode of ['network','http','usage','receipt']){
  const f=await fixture({respond:()=>{if(mode==='network')throw Error('fixture disconnect');return Response.json(mode==='usage'?{...reply,usage:{}}:reply,{status:mode==='http'?429:200,headers:{'request-id':'req_fixture'}});}});
  try{
   await f.budget.reserve(id,body,note);
   if(mode==='receipt'){const q=f.store.pool.query;f.store.pool.query=(sql,v)=>sql.includes('SET response=')?Promise.reject(Error('fixture receipt failure')):q(sql,v);}
   await assert.rejects(f.budget.dispatch(id,body));
   const run=await f.run();assert.equal(run.blocked,true);assert.equal(Number(run.liability_microusd),2283635);
   assert.equal((await f.db.query("SELECT status FROM p5ds_qa_calls WHERE slot='restricted-research-20261006-one-request'")).rows[0].status,'unknown');
   await assert.rejects(f.budget.dispatch(id,body),/run-held/);assert.equal(f.state.calls,1);
  }finally{await f.db.close();}
 }
});

test('pause and truncation persist a single response, never continue or retry; valid usage alone can settle',async()=>{
 for(const stop_reason of ['pause_turn','max_tokens','refusal']){
  const f=await fixture({respond:()=>Response.json({...reply,stop_reason},{headers:{'request-id':'req_fixture'}})});
  try{await f.budget.reserve(id,body,note);const result=await f.budget.dispatch(id,body);assert.equal(result.response.stop_reason,stop_reason);assert.equal(f.state.calls,1);assert.equal(result.complete,undefined);assert.equal((await f.budget.dispatch(id,body)).replayed,true);assert.equal(f.state.calls,1);}finally{await f.db.close();}
 }
});

test('manual schema and module are excluded from startup; old server-tools policy is unchanged',async()=>{
 for(const path of ['../src/main.mjs','../src/store.mjs','../src/server.mjs','../src/database-schema.mjs'])assert.doesNotMatch(await readFile(new URL(path,import.meta.url),'utf8'),/restricted-research|p5ds_qa_research_admission/);
 const f=await fixture();try{await assert.rejects(f.legacy.capture(id.tenant,'qa-paid-'+id.draftId,'legacy:research',body),/server-tools-not-budgeted/);assert.equal(f.state.calls,0);}finally{await f.db.close();}
});
