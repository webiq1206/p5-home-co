import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha,canonical,provisionRecoveryEpoch,RecoveryEpochLedger} from './lib/recoveryEpoch.mjs';
import {recoveryTransport,HAIKU_POLICY as policy,recoveryRequestPolicySha256} from './lib/recoveryTransport.mjs';
import {requestBody} from '../services/document-service/src/provider.mjs';
const h=sha('SYNTHETIC ONLY'),endpoint=policy.endpoint;
function setup(t,reply,edit=()=>{}){
 const directory=mkdtempSync(path.join(tmpdir(),'p5-transport-test-')),file=path.join(directory,'epoch.sqlite');let q,calls=0;
 t.after(()=>{q?.close();rmSync(directory,{recursive:true,force:true});});
 const attestation={version:1,epochId:'synthetic',umbrellaId:'synthetic',authorizationEvidence:'TEST ONLY, never real authorization',umbrellaMicros:12_000_000,crmEnabled:false,ledgerPath:file,expiresAt:new Date(Date.now()+3600000).toISOString(),
 historicalUpperBoundMicros:3_250_000,historicalLiability:{mode:'attested-carryforward',evidenceSha256:h,description:'Synthetic evidence, not real historical ledger',unknownHoldMicros:390000},oldWorkers:{state:'stopped',evidenceSha256:h,upperBoundMicros:0},epochCeilingMicros:2_000_000,
 bindings:{source:h,dependencies:h,runtime:h,documents:h,models:h},cases:[{id:'lot29',documentSha256:h,priorUpperBoundMicros:1_000_000,ceilingMicros:3_000_000,
 stages:['read','review','pricing'].map(id=>({id,envelopeMicros:id==='read'?800000:600000,maxCalls:30,requestPolicySha256:recoveryRequestPolicySha256,endpoint,model:policy.model,billingBoundEvidenceSha256:sha(canonical([policy.pricingEvidenceSha256,policy.modelEvidenceSha256]))}))}]};
 edit(attestation);const args={file,attestation,expectedSha256:sha(canonical(attestation)),bindings:attestation.bindings};provisionRecoveryEpoch(args);q=new RecoveryEpochLedger(args);
 const context={caseId:'lot29',stageId:'read',documentSha256:h};
 const send=recoveryTransport({ledger:q,context,credential:()=> 'SYNTHETIC-NOT-A-KEY',transport:async(url,init)=>{calls++;assert.equal(q.report().attempts.at(-1).state,'reserved');assert.equal(init.redirect,'error');return reply(url,init);}});
 return {q,send,calls:()=>calls,body:{model:policy.model,max_tokens:1000,messages:[{role:'user',content:[{type:'text',text:'SYNTHETIC ONLY'}]}]}};
}
const success=()=>Response.json({model:policy.model,type:'message',content:[{type:'text',text:'{}'}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:10,cache_creation_input_tokens:0,cache_read_input_tokens:0}});
const request=body=>({method:'POST',body:JSON.stringify(body)});
test('durable predispatch bound, usage settlement, exact replay and protected completion envelopes',async t=>{
 const f=setup(t,success);assert.equal((await f.send(endpoint,request(f.body))).status,200);
 const report=f.q.report();assert.equal(report.attempts[0].reserved,405000);assert.equal(report.attempts[0].actual,150);assert.equal(report.aggregateUpperBoundMicros,3250150);
 await f.send(endpoint,request(f.body));assert.equal(f.calls(),1);assert.equal(f.q.report().frozen,false);
});
test('unbounded routes, tools, cache, beta and changed models never dispatch',async t=>{
 const f=setup(t,success);
 for(const extra of [{tools:[{type:'web_search_20250305',name:'web_search'}]},{service_tier:'auto'},{inference_geo:'us'},{model:'other'},{max_tokens:32001},{messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'https://example.invalid'}}]}]}])
  await assert.rejects(f.send(endpoint,request({...f.body,...extra})),/recovery-transport/);
 await assert.rejects(f.send(endpoint,{...request(f.body),headers:{'anthropic-beta':'unreviewed'}}),/beta-forbidden/);
 await assert.rejects(f.send('https://other.invalid',request(f.body)),/request-route/);assert.equal(f.calls(),0);
});
test('network loss, bad usage and incomplete output freeze without any retry',async t=>{
 for(const reply of [async()=>{throw Error('secret must not persist');},()=>Response.json({model:policy.model,stop_reason:'end_turn',content:[]}),()=>Response.json({model:policy.model,stop_reason:'max_tokens',content:[],usage:{input_tokens:100,output_tokens:1000}})]){
  const f=setup(t,reply);await assert.rejects(f.send(endpoint,request(f.body)),/held-or-stopped/);
  await assert.rejects(f.send(endpoint,request({...f.body,max_tokens:2000})),/stopped-until-review/);
  assert.equal(f.calls(),1);assert.equal(f.q.report().frozen,true);assert.doesNotMatch(JSON.stringify(f.q.report()),/secret must/);
 }
});
test('second request is denied while first response is outstanding',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);const f=setup(t,async()=>{await gate;return success();});
 const first=f.send(endpoint,request(f.body));await assert.rejects(f.send(endpoint,request({...f.body,max_tokens:500})),/unresolved/);release();await first;assert.equal(f.calls(),1);
});
test('unchanged production reader body accepts bounded ephemeral caching and client schema tools',async t=>{
 const schema={type:'object',properties:{facts:{type:'array',items:{type:'string'}}},required:['facts'],additionalProperties:false};
 const built=requestBody('anthropic',policy.model,'SYNTHETIC ONLY',{page:1},[],schema,1000,'read');
 const f=setup(t,()=>Response.json({model:policy.model,type:'message',stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic',name:built.body.tool_choice.name,input:{facts:[]}}],usage:{input_tokens:100,output_tokens:10,cache_creation_input_tokens:20,cache_read_input_tokens:0}}));
 await f.send(endpoint,request(built.body));assert.equal(f.calls(),1);assert.equal(f.q.report().attempts[0].actual,190);
});

test('invalid structured output is durably stopped with its response preserved',async t=>{
 const schema={type:'object',properties:{facts:{type:'array',items:{type:'string'}}},required:['facts'],additionalProperties:false};
 const built=requestBody('anthropic',policy.model,'SYNTHETIC ONLY',{page:1},[],schema,1000,'read');
 const f=setup(t,()=>Response.json({model:policy.model,stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic',name:built.body.tool_choice.name,input:{facts:42}}],usage:{input_tokens:100,output_tokens:10}}));
 await assert.rejects(f.send(endpoint,request(built.body)),/held-or-stopped/);
 const report=f.q.report();assert.equal(report.frozen,true);assert.equal(report.attempts[0].state,'stopped');assert.equal(report.newLiabilityMicros,405000);assert.ok(report.attempts[0].response_hash);
 const fresh=recoveryTransport({ledger:f.q,context:{caseId:'lot29',stageId:'read',documentSha256:h},credential:()=>assert.fail('must not read credential'),transport:()=>assert.fail('must not dispatch')});
 await assert.rejects(fresh(endpoint,request(built.body)),/receipt-unavailable/);
 await assert.rejects(fresh(endpoint,request({...built.body,max_tokens:500})),/unresolved/);
 assert.equal(f.calls(),1);
});
