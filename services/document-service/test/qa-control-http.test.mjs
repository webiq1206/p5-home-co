import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {QaBudget,QA_MODEL} from '../src/qa-budget.mjs';
import {makeServer} from '../src/server.mjs';
import {signedHeaders} from '../src/core.mjs';

const tenant='p5homeco.com',secret='synthetic-qa-control-test-key-123456789';
const project='qa-paid-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const wire={model:QA_MODEL,max_tokens:10000,system:'Return this synthetic structured output.',messages:[{role:'user',content:'Synthetic case only.'}]};
const reply={id:'msg_synthetic',model:QA_MODEL,stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5},content:[{type:'text',text:'synthetic result'}]};

test('authenticated broker body carries capture/exact restrictions; spoofed headers cannot promote capture',async()=>{
 const db=new PGlite();let tail=Promise.resolve(),calls=0;
 const store={nonce:async()=>true,pool:{query:(sql,values)=>values===undefined?db.exec(sql).then(()=>({rows:[]})):db.query(sql,values)},transaction(fn){const run=tail.then(()=>db.transaction(tx=>fn({query:(sql,values)=>tx.query(sql,values)})));tail=run.catch(()=>{});return run;}};
 store.qa=new QaBudget(store,{provider:'anthropic',model:QA_MODEL,key:'fake-only'},async()=>{calls++;return Response.json(reply,{headers:{'request-id':'req_synthetic'}});});
 await store.qa.init();await store.qa.provision([{tenant,project}]);
 const server=makeServer(store,{}, {tenants:{[tenant]:secret},maxBytes:1024});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,path=`/v1/projects/${project}/qa-provider`;
 const request=async(data,{headers={},sign=data}={})=>{
  const body=Buffer.from(JSON.stringify(data)),signedBody=Buffer.from(JSON.stringify(sign));
  const response=await fetch(base+path,{method:'POST',headers:{...signedHeaders(secret,'POST',path,tenant,signedBody),'content-type':'application/json',...headers},body});
  return {status:response.status,data:await response.json()};
 };
 try{
  const payload={boundary:'site:control-http',body:wire,control:{mode:'capture'}};
  const captured=await request(payload,{headers:{'x-p5-qa-mode':'exact','x-p5-qa-admin':'true'}});
  assert.equal(captured.status,422);assert.equal(captured.data.error,'qa-exact-request-review-required');
  const expected=captured.data.capturedIntent;
  assert.deepEqual(Object.keys(expected).sort(),['boundary','maximum','model','project','requestHash','tenant']);
  assert.equal(expected.project,project);assert.equal(expected.maximum,250000);assert.equal(calls,0);
  const exact={...payload,control:{mode:'exact',expected}};
  assert.equal((await request(exact)).status,422);assert.equal((await db.query('SELECT * FROM p5ds_qa_calls')).rows.length,0);
  const tampered=await request(exact,{sign:payload});assert.equal(tampered.status,401);assert.equal(tampered.data.capturedIntent,undefined);
  const unsigned=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-p5-qa-admin':'true'},body:JSON.stringify(exact)});
  assert.equal(unsigned.status,401);assert.equal((await unsigned.json()).capturedIntent,undefined);assert.equal(calls,0);
  await store.qa.permit(expected.requestHash,'http-reviewed-0001','Reviewed exact synthetic HTTP control and existing budget.',expected);
  assert.equal((await request(payload)).status,422);assert.equal(calls,0,'capture must not consume an existing permit');
  const paid=await request(exact);assert.equal(paid.status,200);assert.deepEqual(paid.data,reply);assert.equal(calls,1);
  const replay=await request(payload);assert.equal(replay.status,200);assert.deepEqual(replay.data,reply);assert.equal(calls,1);
  const next=await request({...exact,boundary:'site:unreviewed-http'});assert.equal(next.status,422);assert.equal(next.data.capturedIntent.boundary,'site:unreviewed-http');assert.equal(calls,1);
  const malformed=await request({...payload,control:{mode:'capture',grant:true}});assert.equal(malformed.status,422);assert.equal(malformed.data.error,'qa-invalid-request-control');
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await db.close();}
});
