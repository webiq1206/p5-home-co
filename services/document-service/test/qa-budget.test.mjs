import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {QaBudget,QA_MODEL,QA_RUN,qaWire} from '../src/qa-budget.mjs';
const tenant='p5homeco.com',project='qa-paid-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const body={model:QA_MODEL,max_tokens:10000,system:'Read the exact scope.',messages:[{role:'user',content:'Replace three owner-supplied door levers.'}]};
const reply={id:'msg_test',model:QA_MODEL,stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0},content:[{type:'text',text:'retained real response shape'}]};
const review='Reviewed the exact synthetic request and unchanged lifetime allowance.';
const summary=intent=>({requestHash:intent.requestHash,tenant,project,boundary:intent.boundary,model:QA_MODEL,maximum:intent.maximum});
async function fixture(request){
 const db=new PGlite();let tail=Promise.resolve();
 const store={pool:{query:(sql,values)=>db.query(sql,values)},transaction(fn){const run=tail.then(()=>db.transaction(tx=>fn({query:(sql,values)=>tx.query(sql,values)})));tail=run.catch(()=>{});return run;}};
 // PGlite prepared queries allow one statement; schema uses exec for DDL.
 const q=store.pool.query;store.pool.query=(sql,values)=>values===undefined?db.exec(sql).then(()=>({rows:[]})):q(sql,values);
 const budget=new QaBudget(store,{provider:'anthropic',model:QA_MODEL,key:'fake-only'},request);await budget.init();await budget.provision([{tenant,project}]);
 return {db,store,budget};
}
test('wire bounds full context and rejects unpriced server tools/models; no cached writes',()=>{
 const w=qaWire({...body,system:[{type:'text',text:'x',cache_control:{type:'ephemeral'}}],stream:true});
 assert.equal(w.maximum,250000);assert.equal(w.body.stream,false);assert.equal(w.body.service_tier,'standard_only');assert.equal(w.body.system[0].cache_control,undefined);
 for(const bad of [{...body,model:'other'},{...body,tools:[{type:'web_search_20250305',name:'web_search'}]},{...body,max_tokens:64000},{...body,thinking:{type:'enabled'}}])assert.throws(()=>qaWire(bad),/qa-/);
});
test('capture is zero-call; exact one-use review permits dispatch and durable replay without another charge',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json(reply,{headers:{'request-id':'req_test'}});});
 try{
  await assert.rejects(budget.dispatch(tenant,project,'site:analysis',body),/review-required/);assert.equal(calls,0);
  const intent=await budget.capture(tenant,project,'site:analysis',body);await budget.permit(intent.requestHash,'native-review-0001','Reviewed exact wire, scope, output and maximum reservation.');
  assert.deepEqual(await budget.dispatch(tenant,project,'site:analysis',body),reply);assert.equal(calls,1);
  assert.deepEqual(await budget.dispatch(tenant,project,'site:analysis',body),reply);assert.equal(calls,1);
  const run=(await db.query('SELECT * FROM p5ds_qa_runs')).rows[0];assert.equal(Number(run.liability_microusd),200);assert.equal(Number(run.historical_microusd),3250000);assert.equal(Number(run.historical_unknown_microusd),390000);
  await assert.rejects(budget.dispatch(tenant,project,'site:repair',{...body,system:'Repair the earlier output'}),/review-required/);assert.equal(calls,1);
 }finally{await db.close();}
});
test('site and reader share one in-flight boundary; restart and aged reservation remain held',async()=>{
 let release,started;const begin=new Promise(r=>started=r),wait=new Promise(r=>release=r);let calls=0;
 const {db,store,budget}=await fixture(async()=>{calls++;started();await wait;return Response.json(reply);});
 try{
  const intent=await budget.capture(tenant,project,'document:read:1',body);await budget.permit(intent.requestHash,'native-review-0001','Exact first native page and conservative reserve reviewed.');
  const first=budget.dispatch(tenant,project,'document:read:1',body);await begin;
  await assert.rejects(new QaBudget(store,budget.config,budget.request).dispatch(tenant,project,'site:shortlist',body),/run-held/);
  await db.query("UPDATE p5ds_qa_calls SET started_at=now()-interval '3 hours'");
  await assert.rejects(budget.begin(intent),/run-held/);assert.equal(calls,1);
  release();await first;
 }finally{release?.();await db.close();}
});
test('unknown response, unsupported usage and receipt-write failure retain full reservation and block new calls',async()=>{
 for(const mode of ['network','usage','receipt']){
  let calls=0;const {db,store,budget}=await fixture(async()=>{calls++;if(mode==='network')throw Error('network uncertainty');return Response.json(mode==='usage'?{...reply,usage:{}}:reply);});
  try{
   const intent=await budget.capture(tenant,project,'site:analysis',body);await budget.permit(intent.requestHash,'native-review-0001','Exact first typed scope and conservative reserve reviewed.');
   if(mode==='receipt'){const original=store.pool.query;store.pool.query=(sql,v)=>sql.includes('SET response=')?Promise.reject(Error('receipt storage failure')):original(sql,v);}
   await assert.rejects(budget.dispatch(tenant,project,'site:analysis',body));
   const run=(await db.query('SELECT * FROM p5ds_qa_runs')).rows[0];assert.equal(run.blocked,true);assert.equal(Number(run.liability_microusd),250000);
   await assert.rejects(budget.begin(intent),/run-held/);await assert.rejects(budget.permit(intent.requestHash,'native-review-0002','A retry must never consume a new automatic slot.'),/run-blocked/);assert.equal(calls,1);
  }finally{await db.close();}
 }
});
test('lifetime cap survives reprovision and missing project cannot dispatch',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json(reply);});
 try{
  await assert.rejects(budget.dispatch(tenant,'unbound','site:analysis',body),/binding-required/);
  const intent=await budget.capture(tenant,project,'site:analysis',body);
  await db.query('UPDATE p5ds_qa_runs SET liability_microusd=$1 WHERE run_id=$2',[1800000,QA_RUN]);
  await budget.provision([{tenant,project}]);await assert.rejects(budget.permit(intent.requestHash,'native-review-0001','Exact request review cannot expand the lifetime envelope.'),/budget-exhausted/);assert.equal(calls,0);
 }finally{await db.close();}
});

test('capture control returns only its safe intent and never consumes an existing permit',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;throw Error('Provider must not run.');});
 try{
  const intent=await budget.capture(tenant,project,'site:capture',body),expected=summary(intent);
  await budget.permit(intent.requestHash,'capture-reviewed-0001',review,expected);
  budget.config={};
  for(let i=0;i<2;i++)await assert.rejects(budget.dispatch(tenant,project,'site:capture',body,undefined,{mode:'capture'}),error=>{
   assert.equal(error.code,'qa-exact-request-review-required');assert.deepEqual(error.capturedIntent,expected);assert.equal(JSON.stringify(error.capturedIntent).includes(body.system),false);return true;
  });
  const saved=(await db.query('SELECT * FROM p5ds_qa_calls')).rows[0];
  assert.equal(saved.status,'permitted');assert.equal(saved.started_at,null);assert.equal(calls,0);
  const run=(await db.query('SELECT * FROM p5ds_qa_runs')).rows[0];assert.equal(Number(run.liability_microusd),250000);assert.equal(Number(run.allowance_microusd),2000000);
 }finally{await db.close();}
});

test('exact control and permit bind every displayed identity field and never issue their own permit',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json(reply);});
 try{
  const intent=await budget.capture(tenant,project,'site:exact',body),expected=summary(intent);
  for(const patch of [{requestHash:'f'.repeat(64)},{tenant:'another.example'},{project:'qa-paid-other'},{boundary:'site:other'},{maximum:expected.maximum+1}]){
   const changed={...expected,...patch};
   await assert.rejects(budget.permit(intent.requestHash,'exact-reviewed-0001',review,changed),/reviewed-intent-changed/);
   await assert.rejects(budget.dispatch(tenant,project,'site:exact',body,undefined,{mode:'exact',expected:changed}),error=>{assert.deepEqual(error.capturedIntent,expected);return true;});
  }
  for(const control of [null,{}, {mode:'capture',expected}, {mode:'exact'}, {mode:'exact',expected:{...expected,model:'other'}}, {mode:'exact',expected:{...expected,extra:true}}, {mode:'exact',expected:{...expected,maximum:String(expected.maximum)}}])await assert.rejects(budget.dispatch(tenant,project,'site:exact',body,undefined,control),/invalid-request-control/);
  await assert.rejects(budget.dispatch(tenant,project,'site:exact',body,undefined,{mode:'exact',expected}),/exact-request-review-required/);
  assert.equal((await db.query('SELECT * FROM p5ds_qa_calls')).rows.length,0);assert.equal(calls,0);
  await budget.permit(intent.requestHash,'exact-reviewed-0001',review,expected);
  assert.deepEqual(await budget.dispatch(tenant,project,'site:exact',body,undefined,{mode:'exact',expected}),reply);assert.equal(calls,1);
 }finally{await db.close();}
});

test('controlled continuation replays settled checkpoints, admits its one reviewed hash and stops before the next',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json(reply);});
 try{
  const first=await budget.capture(tenant,project,'site:first',body);await budget.permit(first.requestHash,'continuation-first-0001',review);
  await budget.dispatch(tenant,project,'site:first',body);
  const nextBody={...body,system:'The next exact structured output.'},next=await budget.capture(tenant,project,'site:next',nextBody),expected=summary(next),control={mode:'exact',expected};
  assert.deepEqual(await budget.dispatch(tenant,project,'site:first',body,undefined,{mode:'capture'}),reply);
  assert.deepEqual(await budget.dispatch(tenant,project,'site:first',body,undefined,control),reply);assert.equal(calls,1);
  await budget.permit(next.requestHash,'continuation-next-0002',review,expected);
  await budget.dispatch(tenant,project,'site:next',nextBody,undefined,control);assert.equal(calls,2);
  await budget.dispatch(tenant,project,'site:next',nextBody,undefined,control);assert.equal(calls,2);
  await assert.rejects(budget.dispatch(tenant,project,'site:third',{...body,system:'Another unreviewed stage.'},undefined,control),error=>{assert.equal(error.code,'qa-exact-request-review-required');assert.equal(error.capturedIntent.boundary,'site:third');return true;});
  await assert.rejects(budget.dispatch(tenant,project,'site:research',{...body,tools:[{type:'web_search_20250305',name:'web_search'}]},undefined,control),/server-tools-not-budgeted/);
  assert.equal(calls,2);assert.equal((await db.query('SELECT * FROM p5ds_qa_calls')).rows.length,2);
  const run=(await db.query('SELECT * FROM p5ds_qa_runs')).rows[0];assert.equal(Number(run.liability_microusd),400);assert.equal(Number(run.historical_unknown_microusd),390000);
 }finally{await db.close();}
});

test('controlled replay rejects an uncertain response or changed receipt without another provider attempt',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json(reply);});
 try{
  const intent=await budget.capture(tenant,project,'site:receipt',body),expected=summary(intent),control={mode:'exact',expected};
  await budget.permit(intent.requestHash,'receipt-reviewed-0001',review,expected);await budget.dispatch(tenant,project,'site:receipt',body,undefined,control);
  for(const altered of [ {...reply,model:'wrong'}, {...reply,usage:{...reply.usage,input_tokens:101}}, {...reply,usage:{...reply.usage,server_tool_use:{web_search_requests:1}}}, {...reply,usage:{...reply.usage,server_tool_use:{web_search_requests:'garbage'}}}, {...reply,usage:{...reply.usage,cache_read_input_tokens:null}}  ]){
   await db.query('UPDATE p5ds_qa_calls SET response=$1::jsonb',[JSON.stringify(altered)]);
   await assert.rejects(budget.dispatch(tenant,project,'site:receipt',body,undefined,{mode:'capture'}),/saved-receipt-unverified/);
  }
  await db.query('UPDATE p5ds_qa_calls SET response=$1::jsonb',[JSON.stringify(reply)]);
  for(const [field,altered,original] of [['provider_request_id','',reply.id],['actual_microusd',201,200],['reserved_microusd',250001,250000]]){
   await db.query(`UPDATE p5ds_qa_calls SET ${field}=$1`,[altered]);
   await assert.rejects(budget.dispatch(tenant,project,'site:receipt',body,undefined,control),/saved-receipt-unverified/);
   await db.query(`UPDATE p5ds_qa_calls SET ${field}=$1`,[original]);
  }
  await db.query('UPDATE p5ds_qa_intents SET request=$1::jsonb',[JSON.stringify({...intent.body,system:'Changed retained request.'})]);
  await assert.rejects(budget.dispatch(tenant,project,'site:receipt',body,undefined,control),/saved-receipt-unverified/);
  await db.query('UPDATE p5ds_qa_intents SET request=$1::jsonb',[JSON.stringify(intent.body)]);
  await db.query("UPDATE p5ds_qa_calls SET response=$1::jsonb,status='unknown'",[JSON.stringify(reply)]);
  await db.query('UPDATE p5ds_qa_runs SET blocked=true WHERE run_id=$1',[QA_RUN]);
  await assert.rejects(budget.dispatch(tenant,project,'site:receipt',body,undefined,control),/run-held/);
  await assert.rejects(budget.dispatch(tenant,project,'site:receipt',body,undefined,{mode:'capture'}),error=>{assert.deepEqual(error.capturedIntent,expected);return true;});
  assert.equal(calls,1);assert.equal((await db.query('SELECT status FROM p5ds_qa_calls')).rows[0].status,'unknown');
 }finally{await db.close();}
});

test('duplicate exact dispatch is atomic, never replays in-flight data and leaves no transaction open during provider I/O',async()=>{
 let started,release,calls=0,activeTransactions=0;
 const begun=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve);
 const {db,store,budget}=await fixture(async()=>{assert.equal(activeTransactions,0);calls++;started();await wait;return Response.json(reply);});
 const transaction=store.transaction.bind(store);store.transaction=fn=>transaction(async client=>{activeTransactions++;try{return await fn(client);}finally{activeTransactions--;}});
 try{
  const intent=await budget.capture(tenant,project,'site:atomic',body),expected=summary(intent),control={mode:'exact',expected};
  await budget.permit(intent.requestHash,'atomic-reviewed-0001',review,expected);
  const first=budget.dispatch(tenant,project,'site:atomic',body,undefined,control);await begun;
  // Even a saved partial response on an active call is not replayable.
  await db.query('UPDATE p5ds_qa_calls SET response=$1::jsonb',[JSON.stringify(reply)]);
  await assert.rejects(new QaBudget(store,budget.config,budget.request).dispatch(tenant,project,'site:atomic',body,undefined,control),/run-held/);
  await assert.rejects(budget.dispatch(tenant,project,'site:atomic',body,undefined,{mode:'capture'}),/exact-request-review-required/);assert.equal(calls,1);
  release();assert.deepEqual(await first,reply);
  assert.deepEqual(await budget.dispatch(tenant,project,'site:atomic',body,undefined,control),reply);assert.equal(calls,1);
 }finally{release?.();await db.close();}
});

test('a request control is snapshotted before capture and cannot be changed while awaiting binding',async()=>{
 let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json(reply);});
 try{
  const intent=await budget.capture(tenant,project,'site:immutable',body),expected=summary(intent);
  await budget.permit(intent.requestHash,'immutable-reviewed-0001',review,expected);
  let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),binding=budget.binding.bind(budget);
  budget.binding=async(...args)=>{started();await gate;return binding(...args);};
  const mutable={mode:'exact',expected:{...expected,requestHash:'f'.repeat(64)}};
  const pending=budget.dispatch(tenant,project,'site:immutable',body,undefined,mutable);await ready;
  mutable.expected.requestHash=expected.requestHash;release();
  await assert.rejects(pending,error=>{assert.deepEqual(error.capturedIntent,expected);return true;});assert.equal(calls,0);
  assert.equal((await db.query('SELECT status FROM p5ds_qa_calls')).rows[0].status,'permitted');
 }finally{await db.close();}
});


test('malformed server-tool usage retains the full reservation and cannot be replayed',async()=>{
 for(const server_tool_use of [{web_search_requests:'garbage'},{web_search_requests:null},{web_search_requests:-1},{web_search_requests:0.5},[],null,'invalid']){
  let calls=0;const {db,budget}=await fixture(async()=>{calls++;return Response.json({...reply,usage:{...reply.usage,server_tool_use}});});
  try{
   const intent=await budget.capture(tenant,project,'site:malformed-usage',body),expected=summary(intent);
   await budget.permit(intent.requestHash,'malformed-reviewed-0001',review,expected);
   await assert.rejects(budget.dispatch(tenant,project,'site:malformed-usage',body,undefined,{mode:'exact',expected}),/usage-unverified/);
   const run=(await db.query('SELECT * FROM p5ds_qa_runs')).rows[0],call=(await db.query('SELECT * FROM p5ds_qa_calls')).rows[0];
   assert.equal(run.blocked,true);assert.equal(Number(run.liability_microusd),intent.maximum);assert.equal(call.status,'unknown');assert.equal(call.actual_microusd,null);
   await assert.rejects(budget.dispatch(tenant,project,'site:malformed-usage',body,undefined,{mode:'exact',expected}),/run-held/);assert.equal(calls,1);
  }finally{await db.close();}
 }
});
