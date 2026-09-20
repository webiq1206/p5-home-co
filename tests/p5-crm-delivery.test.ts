
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrmPayload,CRM_PAYLOAD_LIMIT_BYTES} from '../lib/p5/boundedCrmPayload.ts';
import {syncCrm} from '../lib/p5/deliveryAdapter.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
// P5 Home Co is the CRM that receives these records; only the four sender brands post them.
const senderOnly={skip:(brand.id as string)==='p5'?'this site receives CRM records; it does not send them':false};
const id='12345678-1234-4123-8123-123456789abc';
const receipt=(key='test-key',mode='live')=>({success:true,leadId:id,source:brand.domain,externalLeadId:key,acceptanceMode:mode});
const fixture=()=>({draftId:id,revision:7,contact:{name:'TEST ONLY',email:'test@example.invalid',phone:''},
 scope:{instructions:'Install owner-supplied trim',answers:{service:'installation',location:'Boise'}},
 customer:{summary:'Install 20 LF owner-supplied trim',range:{low:200,high:300},lineItems:[{description:'Installation',quantity:20,unit:'LF',low:200,high:300}]},
 internal:{lines:[{description:'Installation',quantity:20,unit:'LF',sellingUnitPrice:10,sellingAmount:200,evidence:{reference:'private source narrative'},quantitySource:'private measurement narrative'}],contractPrice:200,costBookSnapshot:{private:'catalog'},scopePricing:{trace:'private research'}}});
async function network(fetcher,fn){
 const old=globalThis.fetch,keys=['LEAD_DASHBOARD_KEY','LEAD_DASHBOARD_API_URL','SYNTHETIC_QA_EMAIL_ALLOWLIST'];
 const env=keys.map(k=>process.env[k]);globalThis.fetch=fetcher;
 process.env.LEAD_DASHBOARD_KEY='synthetic-token';process.env.LEAD_DASHBOARD_API_URL='https://crm.example.invalid/api/external/leads';delete process.env.SYNTHETIC_QA_EMAIL_ALLOWLIST;
 try{return await fn();}finally{globalThis.fetch=old;keys.forEach((k,i)=>{if(env[i]===undefined)delete process.env[k];else process.env[k]=env[i];});}
}
test('CRM projection preserves full scope and priced quantities without mutating the durable record',()=>{
 const record=fixture(),before=JSON.stringify(record),p=buildCrmPayload(record,'test-key',brand.domain);
 assert.equal(p.source,brand.domain);assert.equal(p.externalLeadId,'test-key');
 assert.deepEqual(p.estimate.scope,record.scope);assert.deepEqual(p.estimate.customer,record.customer);
 assert.equal(p.estimate.internal.lines[0].quantity,20);assert.equal(p.estimate.internal.lines[0].sellingUnitPrice,10);
 assert.equal(p.estimate.internal.contractPrice,200);assert.ok(!JSON.stringify(p).includes('private source narrative'));
 assert.ok(p.estimate.omittedRedundantMetadata.length>=3);assert.equal(JSON.stringify(record),before);
});
test('large UTF-8 scope and priced lines use an explicit authenticated revision reference',()=>{
 for(const field of ['scope','line']){
  const record=fixture();if(field==='scope')record.scope.instructions='🏗'.repeat(40000);else record.internal.lines[0].description='priced work '.repeat(20000);
  const before=JSON.stringify(record),p=buildCrmPayload(record,'test-key',brand.domain);
  assert.equal(p.estimate.mode,'authenticated-reference');assert.equal(p.estimate.revision,7);
  const url=new URL(p.estimate.durableAdminRecord.url);assert.equal(url.hostname,brand.domain);assert.equal(url.searchParams.get('id'),id);assert.equal(url.searchParams.get('revision'),'7');
  assert.match(p.estimate.durableAdminRecord.access,/authenticated/);assert.deepEqual(p.estimate.sellingRange,{low:200,high:300});
  assert.ok(Buffer.byteLength(JSON.stringify(p))<CRM_PAYLOAD_LIMIT_BYTES);assert.equal(JSON.stringify(record),before);
 }
});
test('contact limits reject before dispatch and never truncate identity',senderOnly,async()=>{
 const record=fixture();record.contact.name='N'.repeat(256);let calls=0;
 await network(async()=>{calls++;throw Error('unexpected');},async()=>assert.rejects(syncCrm(record,'test-key'),/fullName.*no customer identity was truncated/));
 assert.equal(calls,0);
});
test('one POST accepts only a matching durable estimate receipt',senderOnly,async()=>{
 let calls=0;await network(async(url,init)=>{calls++;assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Idempotency-Key'),'test-key');
 const body=JSON.parse(String(init?.body));assert.equal(body.source,brand.domain);assert.equal(body.externalLeadId,'test-key');assert.equal(body.deliveryMode,'live');
 return Response.json(receipt(),{status:201});},async()=>assert.equal(await syncCrm(fixture(),'test-key'),id));assert.equal(calls,1);
});
test('email-only conflicts and oversized receiver errors are rejected without resubmission',senderOnly,async()=>{
 for(const status of [409,413]){let calls=0;await network(async()=>{calls++;return Response.json({duplicate:true,leadId:id},{status});},async()=>assert.rejects(syncCrm(fixture(),'test-key'),new RegExp('HTTP '+status)));assert.equal(calls,1);}
});
test('lost or invalid POST receipts reconcile once with authenticated GET and never replay POST',senderOnly,async()=>{
 for(const first of [()=>{throw Error('private credential');},()=>Response.json({}, {status:500}),()=>Response.json({...receipt(),externalLeadId:'other-estimate'}),()=>new Response('malformed')]){
  const methods=[];await network(async(url,init)=>{methods.push(init?.method||'GET');if(methods.length===1)return first();
  const u=new URL(String(url));assert.match(u.pathname,/\/reconcile$/);assert.equal(u.searchParams.get('externalLeadId'),'test-key');
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer synthetic-token');
  return Response.json({...receipt(),found:true,status:'accepted'});},async()=>assert.equal(await syncCrm(fixture(),'test-key'),id));assert.deepEqual(methods,['POST','GET']);
 }
});
test('unconfirmed transport failures expose no credentials, URL or provider body',senderOnly,async()=>{
 let calls=0;await network(async()=>{calls++;throw Error('SECRET https://user:password@private');},async()=>assert.rejects(syncCrm(fixture(),'test-key'),e=>{
 assert.match(e.message,/unconfirmed.*reconciliation transport/);assert.doesNotMatch(e.message,/SECRET|password|private/);return true;}));assert.equal(calls,2);
});
test('QA receipt requires matching reconciliation and suppressed downstream campaigns',senderOnly,async()=>{
 for(const suppressed of [true,false]){
 const record=fixture();record.contact.name='[QA] Acceptance';let calls=0;
 await network(async(_url,init)=>{calls++;if(init?.method==='POST')return Response.json(receipt('qa-test-key','synthetic_qa'),{status:201});
 return Response.json({...receipt('qa-test-key','synthetic_qa'),found:true,status:'accepted',downstreamStatus:suppressed?'suppressed':'queued'});},async()=>{
 if(suppressed)assert.equal(await syncCrm(record,'test-key'),id);else await assert.rejects(syncCrm(record,'test-key'),/did not prove/);
 });assert.equal(calls,2);
 }
});
test('credential-bearing or insecure destinations fail before network',senderOnly,async()=>{
 for(const url of ['http://crm.example.invalid','https://user:password@crm.example.invalid','not-a-url']){
 let calls=0;await network(async()=>{calls++;throw Error('unexpected');},async()=>{process.env.LEAD_DASHBOARD_API_URL=url;await assert.rejects(syncCrm(fixture(),'test-key'),/credential-free HTTPS/);});assert.equal(calls,0);
 }
});
