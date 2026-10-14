import {canonicalJson} from '../lib/p5/canonicalJson.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {canonicalReceiver,reviewOperationKey,validateCanonicalReview,type ReceiverProof,type ReviewProvider} from '../lib/p5/canonicalReviewReceiver.ts';
import {canonicalReviewStore} from '../lib/p5/canonicalReviewStore.ts';
import {canonicalHubspotProvider,canonicalDealProperties} from '../lib/p5/canonicalReviewHubspot.ts';
import {REVIEW_DOMAINS,type ProjectReview} from '../lib/p5/projectReviewContract.ts';
const id='12345678-1234-4234-8234-123456789abc';
function fixture(site:keyof typeof REVIEW_DOMAINS='p5',qa=false):ProjectReview {
 const projectId=`${site}:${id}`;
 return {schema:1,requestType:'project_review_v1',source:REVIEW_DOMAINS[site],externalLeadId:(qa?'qa-':'')+'p5-intake-'+createHash('sha256').update(projectId).digest('hex'),snapshotDigest:'a'.repeat(64),deliveryMode:qa?'synthetic_qa':'live',request:{projectId,draftId:id,revision:1,savedAt:'2026-10-14T03:00:00.000Z',originSite:site,currentSite:site,contact:{name:qa?'[QA] Fictional':'Fictional',email:'fictional@example.invalid',phone:'',preferredContact:'email'},scope:{text:'Fictional project',answers:{},uploads:[]},details:{desiredOutcome:'Fictional repair',workContext:'',budget:'',transcript:[]},routing:{primaryTeam:site,supportingServices:[]},unresolved:[]}};
}
const proof:ReceiverProof={portalId:247066159,contractEvidence:'offline-test-only',ownerIds:{p5:'1',construction:'2',remodeling:'3',handyman:'4',cabinet:'5'},syntheticIsolation:null};
async function setup(){
 const db=new PGlite();await db.exec(readFileSync('migrations/018_canonical_project_reviews.sql','utf8'));
 type Query=(sql:string,values?:unknown[])=>Promise<Record<string,any>[]>;
 const q:Query=async(sql,values=[])=>((await db.query(sql,values)).rows as Record<string,any>[]);
 const tx=async<T>(run:(read:Query)=>Promise<T>)=>db.transaction(async client=>run(async(sql,values=[])=>((await client.query(sql,values)).rows as Record<string,any>[])));
 const store=canonicalReviewStore(q,tx);let writes=0;
 const remote=new Map<string,{p:ProjectReview;owner:string;id:string}>();
 const provider:ReviewProvider={portal:async()=>247066159,write:async(p,owner,previous)=>{writes++;const remoteId=previous||String(writes);remote.set(p.externalLeadId,{p:structuredClone(p),owner,id:remoteId});return remoteId;},verify:async(p,owner,remoteId)=>{const saved=remote.get(p.externalLeadId);return saved?.id===remoteId&&saved.owner===owner&&JSON.stringify(saved.p)===JSON.stringify(p);},reconcile:async(p,owner)=>{const saved=remote.get(p.externalLeadId);return saved&&saved.owner===owner&&JSON.stringify(saved.p)===JSON.stringify(p)?saved.id:null;}};
 return {db,store,provider,writes:()=>writes};
}
test('five sources retain provenance, immutable receipts and one deal across revisions',async()=>{
 const f=await setup();try{const receiver=canonicalReceiver(f.store,f.provider,proof);
  for(const site of Object.keys(REVIEW_DOMAINS) as (keyof typeof REVIEW_DOMAINS)[]){
   const p=fixture(site),key=reviewOperationKey(p),receipt=await receiver.receive(p,key,site);
   assert.equal(receipt.ownerId,proof.ownerIds[site]);assert.equal(receipt.source,REVIEW_DOMAINS[site]);
   assert.deepEqual(await receiver.receive(p,key,site),receipt);assert.deepEqual(await receiver.reconcile(p.source,key),receipt);
   assert.equal(await receiver.reconcile('unrelated.invalid',key),null);
   const later=structuredClone(p);later.request.revision=2;later.snapshotDigest='b'.repeat(64);
   assert.equal((await receiver.receive(later,reviewOperationKey(later),site)).dealId,receipt.dealId);
   const conflict=structuredClone(p);conflict.request.scope.text='changed';await assert.rejects(receiver.receive(conflict,key,site),/snapshot-conflict/);
  }assert.equal(f.writes(),10);
 }finally{await f.db.close();}
});
test('lost provider response is reconciled by read without duplicate creation',async()=>{
 const f=await setup();try{const p=fixture(),key=reviewOperationKey(p),write=f.provider.write;
  f.provider.write=async(...args)=>{await write(...args);throw new Error('lost response');};
  const receiver=canonicalReceiver(f.store,f.provider,proof);await assert.rejects(receiver.receive(p,key,'p5'),/lost response/);
  assert.equal((await receiver.reconcile(p.source,key))?.dealId,'1');assert.equal(f.writes(),1);
 }finally{await f.db.close();}
});
test('process death before remote write stays held and cannot trigger another write',async()=>{
 const f=await setup();try{const p=fixture(),key=reviewOperationKey(p);f.provider.write=async()=>{throw new Error('offline');};
  const receiver=canonicalReceiver(f.store,f.provider,proof);await assert.rejects(receiver.receive(p,key,'p5'),/offline/);
  await assert.rejects(receiver.receive(p,key,'p5'),/reconciliation-required/);assert.equal(f.writes(),0);
 }finally{await f.db.close();}
});
test('portal, source, owner, workflow isolation and synthetic contact guards precede writes',async()=>{
 const f=await setup();try{const p=fixture(),qa=fixture('p5',true),qkey=reviewOperationKey(qa);
  await assert.rejects(canonicalReceiver(f.store,f.provider,null).receive(p,reviewOperationKey(p),'p5'),/contract-pending/);
  await assert.rejects(canonicalReceiver(f.store,f.provider,{...proof,ownerIds:{}}).receive(p,reviewOperationKey(p),'p5'),/owner-unverified/);
  await assert.rejects(canonicalReceiver(f.store,f.provider,proof).receive(p,reviewOperationKey(p),'cabinet'),/source-mismatch/);
  await assert.rejects(canonicalReceiver(f.store,{...f.provider,portal:async()=>12},proof).receive(p,reviewOperationKey(p),'p5'),/portal-mismatch/);
  await assert.rejects(canonicalReceiver(f.store,f.provider,proof).receive(qa,qkey,'p5'),/qa-isolation-unverified/);
  const isolated={...proof,syntheticIsolation:{evidence:'offline-only',expiresAt:'2099-01-01T00:00:00Z',noEmail:true,noSms:true,noCalls:true,noTasks:true,noWorkflows:true,allowedOperationKeys:[qkey]}} as ReceiverProof;
  qa.request.contact.phone='2085550100';await assert.rejects(canonicalReceiver(f.store,f.provider,isolated).receive(qa,qkey,'p5'),/qa-contact-denied/);
  assert.equal(f.writes(),0);qa.request.contact.phone='';assert.equal((await canonicalReceiver(f.store,f.provider,isolated).receive(qa,qkey,'p5')).deliveryMode,'synthetic_qa');
  p.request.contact.name='[QA] Hidden';assert.throws(()=>validateCanonicalReview(p,reviewOperationKey(p),'p5'),/mode-mismatch/);
 }finally{await f.db.close();}
});
test('provider holds existing IDs and remote edits instead of overwriting or duplicating',async()=>{
 const p=fixture();let mutations=0;
 const mock=async(url:any,init:any={})=>{if(init.method==='PATCH'||(init.method==='POST'&&!String(url).endsWith('/search')))mutations++;return Response.json(String(url).endsWith('/search')?{total:1,results:[{id:'1'}]}:{id:'1',properties:{...canonicalDealProperties(p,'1'),description:'staff edited'}});};
 const provider=canonicalHubspotProvider('offline-fake-token',mock as typeof fetch);
 await assert.rejects(provider.write(p,'1'),/existing-record-review/);
 await assert.rejects(provider.write(p,'1','1',p),/remote-record-changed/);assert.equal(mutations,0);
});

test('receipt serialization survives jsonb object-key reordering and keeps array order',()=>{
 const a={nested:{b:2,a:1},list:[{z:1,x:2},3]};
 const b={list:[{x:2,z:1},3],nested:{a:1,b:2}};
 assert.equal(canonicalJson(a),canonicalJson(b));
 assert.notEqual(canonicalJson(a),canonicalJson({...b,list:[3,{x:2,z:1}]}));
});
