import test from 'node:test';
import assert from 'node:assert/strict';
import {crmIdentity,deliverKeyedCrm} from '../lib/p5/keyedCrm.ts';
const id='5ded40b8-1513-4fc2-99ac-1114f467b100';
const payload={...crmIdentity({contact:{name:'Customer',email:'person@example.invalid'}},'estimate-7','boiseremodeling.co'),fullName:'Customer'};
const ack={success:true,leadId:id,source:payload.source,externalLeadId:payload.externalLeadId,acceptanceMode:'live'};
const receipt={...ack,found:true,status:'accepted',downstreamStatus:'scheduled'};
const json=(body:any,status=200)=>Response.json(body,{status});
test('exact configured QA addresses receive a campaign-suppressed identity',()=>{
  const record={contact:{name:'[QA] Runtime test',email:' Test@Example.com '}};
  assert.throws(()=>crmIdentity(record,'key','brand.co','other@example.com'));
  assert.deepEqual(crmIdentity(record,'key','brand.co','test@example.com'),{source:'brand.co',externalLeadId:'qa-key',deliveryMode:'synthetic_qa'});
  assert.equal(crmIdentity({contact:{name:'Customer',email:'test@example.com'}},'key','brand.co','test@example.com').deliveryMode,'live');
});
test('a lost POST receipt uses one exact authenticated reconciliation and never reposts',async()=>{
  const calls:any[]=[];
  const fetcher=async(url:any,init:any)=>{calls.push([String(url),init]);if(calls.length===1)throw new Error('timeout');return json(receipt);};
  assert.equal(await deliverKeyedCrm(payload,'key','test-token','https://crm.example/api/external/leads',fetcher as any),id);
  assert.equal(calls.length,2);assert.equal(calls[0][1].method,'POST');assert.equal(calls[1][1].method,undefined);
  const lookup=new URL(calls[1][0]);assert.equal(lookup.searchParams.get('source'),payload.source);assert.equal(lookup.searchParams.get('externalLeadId'),payload.externalLeadId);
  assert.equal(calls[1][1].headers['Idempotency-Key'],'key');assert.equal(calls[1][1].headers.Authorization,'Bearer test-token');
});
test('email-only duplicates and mismatched keyed receipts never count as acceptance',async()=>{
  let calls=0;
  await assert.rejects(deliverKeyedCrm(payload,'key','token','https://crm.example/api/external/leads',(async()=>{calls++;return json({duplicate:true,leadId:id},409);}) as any),/HTTP 409/);
  assert.equal(calls,1);
  await assert.rejects(deliverKeyedCrm(payload,'key','token','https://crm.example/api/external/leads',(async()=>json({...receipt,externalLeadId:'different-estimate'})) as any),/did not prove/);
});
test('QA acceptance requires matching live receiver suppression proof',async()=>{
  const qa={...payload,externalLeadId:'qa-estimate-7',deliveryMode:'synthetic_qa'};
  const qaAck={...ack,externalLeadId:qa.externalLeadId,acceptanceMode:'synthetic_qa'};
  for(const state of ['scheduled','suppressed']){
    let calls=0;const fetcher=async()=>++calls===1?json(qaAck,201):json({...qaAck,found:true,status:'accepted',downstreamStatus:state});
    const operation=deliverKeyedCrm(qa,'key','token','https://crm.example/api/external/leads',fetcher as any);
    if(state==='suppressed')assert.equal(await operation,id);else await assert.rejects(operation,/did not prove/);
    assert.equal(calls,2);
  }
});
test('valid acceptance completes once and credential-bearing destinations send nothing',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return json(ack,201);};
  assert.equal(await deliverKeyedCrm(payload,'key','token','https://crm.example/api/external/leads',fetcher as any),id);
  assert.equal(calls,1);
  await assert.rejects(deliverKeyedCrm(payload,'key','token','https://user:pass@crm.example/api/external/leads',fetcher as any),/credential-free/);
  assert.equal(calls,1);
});
