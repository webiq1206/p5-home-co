
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrmPayload,CRM_PAYLOAD_LIMIT_BYTES} from '../lib/p5/boundedCrmPayload.ts';
import {crmIdentity,deliverKeyedCrm} from '../lib/p5/keyedCrm.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
// The keyed CRM contract (one POST with an idempotency key, one authenticated reconciliation, never a
// replay) is shared code, so it is tested here directly, with an injected fetch, on every site. It used
// to be reached through each brand's `syncCrm()`. A brand's `syncCrm()` now forwards a published estimate
// to P5 Home Co's lead intake instead (lib/p5/p5LeadIntake.ts), and tests/p5-lead-intake.test.ts holds
// that path: one post, short errors with no response body, an HTTPS address without credentials, and
// no synthetic QA record ever posted. Nothing here calls a brand's delivery adapter or the network.
const id='12345678-1234-4123-8123-123456789abc';
const CRM_URL='https://crm.example.invalid/api/external/leads';
const receipt=(key='test-key',mode='live')=>({success:true,leadId:id,source:brand.domain,externalLeadId:key,acceptanceMode:mode});
const fixture=()=>({draftId:id,revision:7,contact:{name:'TEST ONLY',email:'test@example.invalid',phone:''},
 scope:{instructions:'Install owner-supplied trim',answers:{service:'installation',location:'Boise'}},
 customer:{summary:'Install 20 LF owner-supplied trim',range:{low:200,high:300},lineItems:[{description:'Installation',quantity:20,unit:'LF',low:200,high:300}]},
 internal:{lines:[{description:'Installation',quantity:20,unit:'LF',sellingUnitPrice:10,sellingAmount:200,evidence:{reference:'private source narrative'},quantitySource:'private measurement narrative'}],contractPrice:200,costBookSnapshot:{private:'catalog'},scopePricing:{trace:'private research'}}});
/** The keyed CRM delivery exactly as a sender composes it: identity, bounded payload, one keyed dispatch. */
async function deliver(record:ReturnType<typeof fixture>,key:string,fetcher:(url:RequestInfo|URL,init?:RequestInit)=>Promise<Response>|Response,url=CRM_URL){
 const identity=crmIdentity(record,key,brand.domain,'');
 const payload={...buildCrmPayload(record,identity.externalLeadId,brand.domain),...identity};
 return deliverKeyedCrm(payload,key,'synthetic-token',url,(async(input:RequestInfo|URL,init?:RequestInit)=>fetcher(input,init)) as typeof fetch);
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
test('contact limits reject before dispatch and never truncate identity',async()=>{
 const record=fixture();record.contact.name='N'.repeat(256);let calls=0;
 await assert.rejects(deliver(record,'test-key',()=>{calls++;throw Error('unexpected');}),/fullName.*no customer identity was truncated/);
 assert.equal(calls,0);
});
test('one POST accepts only a matching durable estimate receipt',async()=>{
 let calls=0;const accepted=await deliver(fixture(),'test-key',(url,init)=>{calls++;assert.equal(String(url),CRM_URL);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer synthetic-token');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Idempotency-Key'),'test-key');
 const body=JSON.parse(String(init?.body));assert.equal(body.source,brand.domain);assert.equal(body.externalLeadId,'test-key');assert.equal(body.deliveryMode,'live');
 return Response.json(receipt(),{status:201});});assert.equal(accepted,id);assert.equal(calls,1);
});
test('email-only conflicts and oversized receiver errors are rejected without resubmission',async()=>{
 for(const status of [409,413]){let calls=0;await assert.rejects(deliver(fixture(),'test-key',()=>{calls++;return Response.json({duplicate:true,leadId:id},{status});}),new RegExp('HTTP '+status));assert.equal(calls,1);}
});
test('lost or invalid POST receipts reconcile once with authenticated GET and never replay POST',async()=>{
 for(const first of [()=>{throw Error('private credential');},()=>Response.json({}, {status:500}),()=>Response.json({...receipt(),externalLeadId:'other-estimate'}),()=>new Response('malformed')]){
  const methods:string[]=[];const accepted=await deliver(fixture(),'test-key',(url,init)=>{methods.push(init?.method||'GET');if(methods.length===1)return first();
  const u=new URL(String(url));assert.match(u.pathname,/\/reconcile$/);assert.equal(u.searchParams.get('externalLeadId'),'test-key');
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer synthetic-token');
  return Response.json({...receipt(),found:true,status:'accepted'});});assert.equal(accepted,id);assert.deepEqual(methods,['POST','GET']);
 }
});
test('unconfirmed transport failures expose no credentials, URL or provider body',async()=>{
 let calls=0;await assert.rejects(deliver(fixture(),'test-key',()=>{calls++;throw Error('SECRET https://user:password@private');}),(e:Error)=>{
 assert.match(e.message,/unconfirmed.*reconciliation transport/);assert.doesNotMatch(e.message,/SECRET|password|private|synthetic-token/);return true;});assert.equal(calls,2);
});
test('QA receipt requires matching reconciliation and suppressed downstream campaigns',async()=>{
 for(const suppressed of [true,false]){
 const record=fixture();record.contact.name='[QA] Acceptance';let calls=0;
 const answer=(_url:RequestInfo|URL,init?:RequestInit)=>{calls++;if(init?.method==='POST'){assert.equal(JSON.parse(String(init.body)).deliveryMode,'synthetic_qa');return Response.json(receipt('qa-test-key','synthetic_qa'),{status:201});}
 return Response.json({...receipt('qa-test-key','synthetic_qa'),found:true,status:'accepted',downstreamStatus:suppressed?'suppressed':'queued'});};
 if(suppressed)assert.equal(await deliver(record,'test-key',answer),id);else await assert.rejects(deliver(record,'test-key',answer),/did not prove/);
 assert.equal(calls,2);
 }
 // A QA name with a mailbox outside the authorized list never reaches the CRM at all.
 const stray=fixture();stray.contact.name='[QA] Acceptance';stray.contact.email='person@example.com';
 assert.throws(()=>crmIdentity(stray,'test-key',brand.domain,''),/authorized test mailbox/);
 assert.deepEqual(crmIdentity(stray,'test-key',brand.domain,'person@example.com'),{source:brand.domain,externalLeadId:'qa-test-key',deliveryMode:'synthetic_qa'});
 assert.deepEqual(crmIdentity(fixture(),'test-key',brand.domain,''),{source:brand.domain,externalLeadId:'test-key',deliveryMode:'live'});
});
test('credential-bearing or insecure destinations fail before network',async()=>{
 for(const url of ['http://crm.example.invalid','https://user:password@crm.example.invalid','not-a-url']){
 let calls=0;await assert.rejects(deliver(fixture(),'test-key',()=>{calls++;throw Error('unexpected');},url),/credential-free HTTPS/);assert.equal(calls,0);
 }
 // And nothing is sent without the receiver's credential.
 let calls=0;const identity=crmIdentity(fixture(),'test-key',brand.domain,'');
 await assert.rejects(deliverKeyedCrm({...buildCrmPayload(fixture(),'test-key',brand.domain),...identity},'test-key','',CRM_URL,(async()=>{calls++;throw Error('unexpected');}) as typeof fetch),/not configured/);assert.equal(calls,0);
});
