import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {QaBudget,QA_MODEL,QA_RUN,qaWire} from '../src/qa-budget.mjs';
const tenant='p5homeco.com',project='qa-paid-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const body={model:QA_MODEL,max_tokens:10000,system:'Read the exact scope.',messages:[{role:'user',content:'Replace three owner-supplied door levers.'}]};
const reply={id:'msg_test',model:QA_MODEL,stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0},content:[{type:'text',text:'retained real response shape'}]};
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
