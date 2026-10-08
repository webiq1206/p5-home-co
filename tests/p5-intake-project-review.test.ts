/** Offline contract tests. All transports are mocked; no receiver or provider is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeProjectReview,validateIntakeProjectReview,projectReviewEndpoint,projectReviewTransport} from '../lib/p5/intakeProjectReview.ts';
import {projectReviewSchema,PROJECT_REVIEW_BYTE_LIMIT} from '../lib/p5/projectReviewContract.ts';
import {intakeDeliveryEnvelope} from '../lib/p5/intakeDeliveryPayload.ts';
import {emptyIntakeDetails,intakeContact,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {INTAKE_RUNTIME_PROOF} from '../lib/p5/intakeDeliveryPolicy.ts';
import {routeIntake,INTAKE_SITES,type IntakeSite} from '../lib/p5/intakePolicy.ts';
const id='12345678-1234-4234-8234-123456789abc',digest='a'.repeat(64),leadId='12345678-1234-4234-8234-123456789abd';
const source=(site:IntakeSite='remodeling',revision=1):IntakeSnapshot=>({schema:1,projectId:`p5:${id}`,draftId:id,originSite:'p5',currentSite:site,revision,contextVersion:0,savedAt:'2099-01-02T12:00:00.000Z',contact:{name:'Fictional Person',email:'fictional@example.invalid',phone:'',preferredContact:'email'},details:{...emptyIntakeDetails(),desiredOutcome:'Fictional outcome',budget:'1–2 fictional units',workContext:'Fictional existing home',transcript:[{id:'fictional-message',role:'user',text:'Fictional conversation',at:1,files:['fictional-plan.txt']}]},scope:{text:'Fictional whole scope',answers:{service:site==='construction'?'addition':site==='cabinet'?'cabinet-install':site==='handyman'?'handyman':'kitchen',exclusions:'Fictional exclusions'},extraction:null,uploads:[{id:leadId,name:'fictional-plan.txt',type:'text/plain',size:1,sha256:digest,status:'stored'}]},routing:routeIntake(site,site==='construction'?'addition':site==='cabinet'?'cabinet-install':site==='handyman'?'handyman':'kitchen',['cabinetry']),unresolved:['Confirm fictional condition']});
const env=(s=source())=>intakeDeliveryEnvelope(s,'crm',digest);
const response=(payload:ReturnType<typeof intakeProjectReview>)=>({success:true,status:'accepted',requestType:'project_review_v1',source:payload.source,externalLeadId:payload.externalLeadId,leadId,revision:payload.request.revision,snapshotDigest:payload.snapshotDigest,acceptanceMode:payload.deliveryMode,appliedAtAcceptance:true,downstreamStatus:payload.deliveryMode==='synthetic_qa'?'suppressed':'source_site_managed'});
const config={enabled:true,token:'fictional-test-token',url:'https://leads.boiseremodeling.co/api/external/leads',proof:'mock-only-proof'};
test('all specialties project full material into the exact contract while retaining source data',()=>{
 for(const site of ['construction','remodeling','handyman','cabinet'] as const){
  const s=source(site),original=JSON.stringify(s),payload=intakeProjectReview(env(s));
  assert.ok(projectReviewSchema.safeParse(payload).success);assert.equal(payload.source,INTAKE_SITES[site].domain);
  assert.equal(payload.request.originSite,'p5');assert.deepEqual(payload.request.contact,s.contact);assert.deepEqual(payload.request.scope.answers,s.scope.answers);
  assert.deepEqual(payload.request.details.transcript,s.details.transcript);assert.equal(payload.request.details.budget,s.details.budget);assert.deepEqual(payload.request.unresolved,s.unresolved);
  assert.deepEqual(payload.request.scope.uploads,[{id:leadId,name:'fictional-plan.txt',type:'text/plain',size:1,sha256:digest}]);
  assert.ok(!JSON.stringify(payload).includes('extraction'));assert.equal(JSON.stringify(s),original);
 }
 assert.equal(validateIntakeProjectReview(env(source('p5'))),'payload-review');
});
test('phone-only contact has no invented email; invalid contact is held before sending',()=>{
 const s=source();s.contact={name:'Fictional Phone Person',email:'',phone:'2085550100',preferredContact:'phone'};
 assert.equal(intakeProjectReview(env(s)).request.contact.email,'');
 for(const change of [{phone:''},{phone:'2'},{phone:'208555010012345678'},{preferredContact:'email'}])assert.equal(validateIntakeProjectReview(env({...s,contact:{...s.contact,...change} as IntakeSnapshot['contact']})),'contact-review');
});
test('both contact methods and each preference survive validation, CRM and confirmation copies',()=>{
 for(const preferredContact of ['email','phone','either'] as const){
  const s=source();s.contact={...s.contact,phone:'2085550100',preferredContact};
  assert.deepEqual(intakeContact(s.contact),s.contact);assert.deepEqual(intakeProjectReview(env(s)).request.contact,s.contact);
  for(const channel of ['customer','team'] as const){
   const email=intakeDeliveryEnvelope(s,channel,digest).email!;
   assert.deepEqual(JSON.parse(Buffer.from(email.attachments[0].base64,'base64').toString()).contact,s.contact);
   assert.match(email.text,/2085550100/);assert.match(email.text,/fictional@example.invalid/);
  }
 }
 for(const contact of [{name:'Fictional',email:'',phone:'',preferredContact:'either'},{name:'Fictional',email:'',phone:'2085550100',preferredContact:'email'},{name:'Fictional',email:'fictional@example.invalid',phone:'',preferredContact:'phone'},{name:'Fictional',email:'fictional@example.invalid',phone:'208555010012345678',preferredContact:'either'}])assert.throws(()=>intakeContact(contact));
 const s=source();assert.match(intakeDeliveryEnvelope(s,'team',digest).email!.text,/Phone: Not provided/);
 s.contact={...s.contact,email:'',phone:'2085550100',preferredContact:'phone'};assert.match(intakeDeliveryEnvelope(s,'team',digest).email!.text,/Email: Not provided/);
});
test('revision keys change while project identity remains stable; malformed identities are held',()=>{
 const one=env(),two=env(source('remodeling',2));assert.equal(one.leadKey,two.leadKey);assert.notEqual(one.key,two.key);
 assert.equal(validateIntakeProjectReview({...one,key:'wrong'}),'snapshot-conflict');assert.equal(validateIntakeProjectReview({...one,leadKey:'wrong'}),'snapshot-conflict');
 assert.equal(validateIntakeProjectReview({...one,snapshotDigest:'wrong'}),'payload-review');
});
test('oversized material is explicitly held without truncation or mutation',()=>{
 const s=source();s.scope.text='x'.repeat(PROJECT_REVIEW_BYTE_LIMIT);const before=JSON.stringify(s);
 assert.equal(validateIntakeProjectReview(env(s)),'payload-review');assert.equal(JSON.stringify(s),before);
});
test('QA naming, authorized email and phone-only QA preserve suppressed identities',()=>{
 for(const name of ['[QA] Fictional Person','SYNTHETIC QA Fictional Person']){
  const s=source();s.contact.name=name;const p=intakeProjectReview(env(s));assert.equal(p.deliveryMode,'synthetic_qa');assert.ok(p.externalLeadId.startsWith('qa-p5-intake-'));
  s.contact.email='fictional@unapproved.invalid';assert.equal(validateIntakeProjectReview(env(s)),'contact-review');assert.equal(validateIntakeProjectReview(env(s),s.contact.email),null);
  s.contact.email='';s.contact.phone='2085550100';s.contact.preferredContact='phone';assert.equal(intakeProjectReview(env(s)).deliveryMode,'synthetic_qa');
 }
});
test('target mapping accepts only verified legacy/new BRC endpoint forms',()=>{
 assert.equal(projectReviewEndpoint(config.url),'https://leads.boiseremodeling.co/api/external/project-reviews');
 for(const url of ['https://other.invalid/api/external/leads',config.url+'?x=1',config.url+'#fragment','http://leads.boiseremodeling.co/api/external/leads','https://user:password@leads.boiseremodeling.co/api/external/leads'])assert.equal(projectReviewEndpoint(url),null);
});
test('absent source proof, settings, credentials or verified destination cannot dispatch',async()=>{
 assert.deepEqual(INTAKE_RUNTIME_PROOF,{email:'fleet-release-2026-10-08',crm:null});let calls=0;const fetcher=async()=>{calls++;throw Error('Must not send');};
 for(const [change,reason] of [[{proof:null},'runtime-proof-pending'],[{enabled:false},'crm-disabled'],[{token:''},'configuration-missing'],[{url:'https://unknown.invalid'},'crm-contract-pending']] as const){
  const t=projectReviewTransport({...config,...change},fetcher);assert.equal(await t.readiness(source()),reason);await assert.rejects(t.send(env()),new RegExp(reason));assert.equal(t.retryWindowMs,0);
 }
 assert.equal(calls,0);
});
test('exact new receipt accepts once; lost response performs only one matching authenticated read',async()=>{
 const e=env(),p=intakeProjectReview(e),ack=response(p);
 for(const lost of [false,true]){const calls:Array<{url:string;init:RequestInit}>=[];const t=projectReviewTransport(config,async(url,init)=>{calls.push({url:String(url),init:init!});if(lost&&calls.length===1)throw Error('Lost mock response');return Response.json({...ack,found:true});});
  assert.equal(await t.send(e),leadId);assert.equal(calls.length,lost?2:1);assert.equal(calls[0].init.method,'POST');assert.deepEqual(JSON.parse(String(calls[0].init.body)),p);
  if(lost){assert.equal(calls[1].init.method,undefined);assert.equal(new Headers(calls[1].init.headers).get('Idempotency-Key'),e.key);assert.equal(new URL(calls[1].url).searchParams.get('externalLeadId'),p.externalLeadId);}
 }
});
test('legacy, stale, mismatched and unisolated acknowledgments never confirm the new request',async()=>{
 const e=env(),ack=response(intakeProjectReview(e));
 for(const wrong of [{requestType:undefined},{revision:2},{snapshotDigest:'b'.repeat(64)},{downstreamStatus:'scheduled'},{appliedAtAcceptance:undefined},{status:'queued'}]){
  let calls=0;const t=projectReviewTransport(config,async()=>{calls++;return Response.json({...ack,...wrong,found:true});});
  await assert.rejects(t.send(e),/did not prove/);assert.equal(calls,2);
 }
});
test('explicit receiver rejections never automatically resend or reconcile as acceptance',async()=>{
 for(const status of [400,401,409,413]){let calls=0;const t=projectReviewTransport(config,async()=>{calls++;return Response.json({error:'Mock rejection'},{status});});await assert.rejects(t.send(env()),new RegExp('HTTP '+status));assert.equal(calls,1);}
});
