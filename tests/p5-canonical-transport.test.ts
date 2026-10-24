import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalReviewTransport} from '../lib/p5/canonicalReviewTransport.ts';
import {intakeDeliveryEnvelope} from '../lib/p5/intakeDeliveryPayload.ts';
import {emptyIntakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {routeIntake,INTAKE_SITES,type IntakeSite} from '../lib/p5/intakePolicy.ts';
const id='12345678-1234-4234-8234-123456789abc';
const source=(site:IntakeSite):IntakeSnapshot=>({schema:1,projectId:`${site}:${id}`,draftId:id,originSite:site,currentSite:site,revision:1,contextVersion:0,savedAt:'2026-10-14T03:00:00.000Z',contact:{name:'Fictional',email:'fictional@example.invalid',phone:'',preferredContact:'email'},details:emptyIntakeDetails(),scope:{text:'Fictional scope',answers:{},extraction:null,uploads:[]},routing:routeIntake(site,''),unresolved:[]});
test('all five senders require an exact portal, operation, revision and body receipt',async()=>{
 for(const site of Object.keys(INTAKE_SITES) as IntakeSite[]){
  const envelope=intakeDeliveryEnvelope(source(site),'crm','a'.repeat(64));
  let receipt:any,posts=0,gets=0;
  const mock=async(url:any,init:any)=>{assert.equal(new URL(url).origin,'https://p5homeco.com');if(init.method==='POST'){posts++;const p=JSON.parse(init.body);receipt={status:'accepted',portalId:247066159,operationKey:envelope.key,externalLeadId:p.externalLeadId,source:p.source,revision:1,snapshotDigest:p.snapshotDigest,bodyDigest:createHash('sha256').update(init.body).digest('hex'),deliveryMode:p.deliveryMode,dealId:'123'};throw new Error('lost ack');}gets++;return Response.json(receipt);};
  const transport=canonicalReviewTransport({enabled:true,token:'offline-only',proof:'offline-only'},mock as typeof fetch);
  assert.equal(await transport.send(envelope),'123');assert.equal(posts,1);assert.equal(gets,1);
  for(const field of ['portalId','operationKey','externalLeadId','source','revision','snapshotDigest','bodyDigest','deliveryMode','dealId']){
   const corrupt=async()=>Response.json({...receipt,[field]:'wrong'});
   await assert.rejects(canonicalReviewTransport({enabled:true,token:'offline-only',proof:'offline-only'},corrupt as typeof fetch).send(envelope));
  }
 }
});
test('existing runtime proof gate prevents any sender network access',async()=>{
 let calls=0;const mock=async()=>{calls++;throw new Error('network');};
 const transport=canonicalReviewTransport({enabled:true,token:'offline-only',proof:null},mock as typeof fetch);
 await assert.rejects(transport.send(intakeDeliveryEnvelope(source('p5'),'crm','a'.repeat(64))),/crm-contract-pending/);assert.equal(calls,0);
});
