/** Offline only: execute the real brand adapter against fail-closed transport doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
import {safeEmailReplyTo} from '../lib/p5/emailReplyTo.ts';
import {intakeDeliveryEnvelope} from '../lib/p5/intakeDeliveryPayload.ts';
import {prepareIntakeEmail} from '../lib/p5/intakeEmailDelivery.ts';
import {emptyIntakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {INTAKE_RECIPIENTS,routeIntake,type IntakeSite} from '../lib/p5/intakePolicy.ts';
const site=brand.id as IntakeSite,mailbox=INTAKE_RECIPIENTS[site];
const snapshot=(email='customer+project@example.invalid'):IntakeSnapshot=>({schema:1,projectId:'p5:12345678-1234-4234-8234-123456789abc',draftId:'12345678-1234-4234-8234-123456789abc',originSite:site,currentSite:site,revision:1,contextVersion:0,savedAt:'2099-01-02T12:00:00Z',contact:{name:'Fictional Customer',email,phone:'2085550100',preferredContact:'either'},details:emptyIntakeDetails(),scope:{text:'Fictional scope',answers:{service:'handyman'},extraction:null,uploads:[]},routing:routeIntake(site,'handyman'),unresolved:[]});
function adapter(){
 const calls:any[]=[],exports:any={};const from=`${brand.name} <${mailbox}>`;
 const send=async(body:any,options:any)=>{calls.push({body,options});return {data:{id:'mock-accepted'}};};
 const deps:Record<string,unknown>={
  './brand':{ESTIMATOR_BRAND:brand},'./brand.ts':{ESTIMATOR_BRAND:brand},'./emailReplyTo.ts':{safeEmailReplyTo},
  'nodemailer':{createTransport:()=>({sendMail:async(body:any)=>{calls.push({body});return {accepted:[body.to],rejected:[],messageId:body.messageId};}})},
  '../../app/lib/notifications/smtp-config.ts':{getSmtpConfig:()=>({from,replyTo:mailbox,options:{}}),assertSmtpAccepted:(result:any)=>assert.equal(result.accepted.length,1)},
  '../../app/lib/notifications/dispatch.ts':{},'../../app/lib/leads/intake.ts':{},'../../app/lib/leads/synthetic-qa.ts':{},'../../app/lib/leads/settings.ts':{},
  '../../server/services/emailTransport':{getUncachableEmailClient:async()=>({client:{emails:{send}},fromEmail:mailbox})},
  '../../server/resend':{getUncachableResendClient:async()=>({client:{emails:{send}},fromEmail:mailbox})},
  '../../server/services/emailLayout':{formatFromAddress:()=>from},'./crmPayload':{},'./crmPayload.ts':{},'./keyedCrm':{},'./keyedCrm.ts':{},'./boundedCrmPayload':{},'./deliveryPayloads':{},
 };
 vm.runInNewContext(ts.transpileModule(readFileSync('lib/p5/deliveryAdapter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{assert.ok(Object.hasOwn(deps,name),`Unexpected adapter dependency: ${name}`);return deps[name];},Buffer,process:{env:{}}});
 return {sendEmail:exports.sendEmail,calls,from};
}
test('both channels keep From, recipients, content, attachment bytes and delivery identity while routing replies correctly',async()=>{
 const a=adapter(),s=snapshot();
 for(const channel of ['team','customer'] as const){
  const envelope=await prepareIntakeEmail(s,intakeDeliveryEnvelope(s,channel,'digest'),{query:async()=>{throw Error('unexpected storage');},readBytes:async()=>{throw Error('unexpected bytes');},secret:()=>{throw Error('unexpected secret');}});
  const frozen=JSON.parse(JSON.stringify(envelope)),email=frozen.email;
  const attachments=email.attachments.map((f:any)=>({filename:f.filename,content:Buffer.from(f.base64,'base64')}));
  await a.sendEmail({...email,attachments,key:envelope.key});const sent=a.calls.at(-1);
  assert.equal(sent.body.replyTo,channel==='team'?s.contact.email:mailbox);assert.equal(sent.body.to,channel==='team'?mailbox:s.contact.email);assert.equal(sent.body.from,a.from);
  assert.equal(sent.body.subject,email.subject);assert.equal(sent.body.text,email.text);assert.equal(sent.body.html,email.html);assert.equal(sent.body.attachments,attachments);
  assert.equal(site==='p5'?sent.body.messageId:sent.options.idempotencyKey,site==='p5'?`<${envelope.key}@${brand.domain}>`:envelope.key);
  assert.deepEqual(envelope,frozen,'Preparation and transport never mutate the frozen envelope');
 }
});
test('phone-only and malformed submitted email use the established brand reply fallback without guessing',async()=>{
 const a=adapter();for(const email of ['', 'not-an-email','a@example.invalid,b@example.invalid','a@example.invalid; b@example.invalid','Name <a@example.invalid>','a@example.invalid\r\nBcc: b@example.invalid','a@example.invalid\n','a\0@example.invalid','a..b@example.invalid']){
  const envelope=intakeDeliveryEnvelope(snapshot(email),'team','digest');assert.equal(envelope.email!.replyTo,mailbox);
  await a.sendEmail({...envelope.email,attachments:[],key:envelope.key});assert.equal(a.calls.at(-1).body.replyTo,mailbox);assert.equal(a.calls.at(-1).body.to,mailbox);
  await a.sendEmail({to:mailbox,replyTo:email,subject:'Test',text:'Test',attachments:[],key:'mock-invalid'});assert.equal(a.calls.at(-1).body.replyTo,mailbox);
 }
});
test('legacy frozen envelopes without Reply-To retain their prior brand fallback',async()=>{
 const a=adapter(),email=intakeDeliveryEnvelope(snapshot(),'team','digest').email!;delete email.replyTo;
 for(let attempt=0;attempt<2;attempt++)await a.sendEmail({...JSON.parse(JSON.stringify(email)),attachments:[],key:'same-frozen-key'});
 assert.equal(a.calls[0].body.replyTo,mailbox);assert.deepEqual(a.calls[0],a.calls[1]);
});
