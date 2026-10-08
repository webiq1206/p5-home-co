import test from 'node:test';
import type {IntakeRow} from '../lib/p5/intakeStore.ts';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {PGlite} from '@electric-sql/pglite';
import {intakeTransferHandlers,requireTransferProof,requireReceiveOrigin,transferRemote} from '../lib/p5/intakeTransferEndpoint.ts';
import {transferredFileId,transferSecretHash,type TransferBundle} from '../lib/p5/intakeTransferStore.ts';
import {copyIntakeTransferFile} from '../lib/p5/intakeTransferFiles.ts';
import {intakeReviewFingerprint,emptyIntakeDetails} from '../lib/p5/intakeContract.ts';
import {INTAKE_SITES,type IntakeSite} from '../lib/p5/intakePolicy.ts';
import type {ScopeUpload} from '../lib/p5/scope.ts';
const id='12345678-1234-4234-8234-123456789abc',destination='12345678-1234-4234-8234-123456789abd',key='a'.repeat(64),secret='b'.repeat(64),grant='c'.repeat(64),fileId='87654321-1234-4234-8234-123456789abc';
const bytes=Buffer.from('[QA] Fictional plan and instruction bytes.');
const seed={transferId:'12345678-1234-4234-8234-123456789abe',destinationDraftId:destination,destinationKey:secret,grant,revision:1};
async function fixture(){
 const dbs=new Map<IntakeSite,PGlite>(),handlers=new Map<IntakeSite,ReturnType<typeof intakeTransferHandlers>>();let failAcknowledgement=false;
 const queries=new Map<IntakeSite,(s:string,v?:unknown[])=>Promise<IntakeRow[]>>();
 const fetcher:typeof fetch=async(input,init)=>{
  assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');const url=new URL(String(input));assert.equal(url.search,'');
  const site=(Object.keys(INTAKE_SITES) as IntakeSite[]).find(s=>INTAKE_SITES[s].domain===url.hostname);assert.ok(site);assert.ok(handlers.has(site));
  if(failAcknowledgement&&url.pathname.endsWith('/ack'))throw Error('synthetic acknowledgement loss');
  return handlers.get(site)!.post(new Request(url,init));
 };
 for(const site of ['handyman','remodeling'] as IntakeSite[]){
  const db=new PGlite();dbs.set(site,db);await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,key_hash text,revision integer,brand text,status text,payload jsonb,updated_at timestamptz DEFAULT now());CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,lease_token text,lease_until timestamptz,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));CREATE TABLE p5_estimator_files(id uuid PRIMARY KEY,draft_id uuid REFERENCES p5_estimator_drafts(id),name text,mime_type text,size_bytes integer,sha256 text,data_base64 text,created_at timestamptz DEFAULT now(),UNIQUE(draft_id,sha256));`);
  const query=async(s:string,v:unknown[]=[])=> (await db.query<IntakeRow>(s,v)).rows;queries.set(site,query);
  const files=async(draftId:string):Promise<ScopeUpload[]>=> (await query('SELECT * FROM p5_estimator_files WHERE draft_id=$1',[draftId])).map(f=>({id:f.id,name:f.name,type:f.mime_type,size:f.size_bytes,sha256:f.sha256,status:'stored'}));
  const readDraft=async(draftId:string,credential:string)=>{const [row]=await query('SELECT * FROM p5_estimator_drafts WHERE id=$1',[draftId]);if(!row||row.key_hash!==transferSecretHash(credential))return null;return {id:draftId,brand:row.brand,revision:row.revision,status:row.status,updatedAt:'2099-01-02T12:00:00Z',...row.payload,uploads:await files(draftId)};};
  handlers.set(site,intakeTransferHandlers({site,query,readDraft,fetcher,importedFiles:files,
   originalTransferStream:async(bundle:TransferBundle,requested:string,offset:number)=>{assert.equal(bundle.binding.sourceSite,site);assert.equal(requested,fileId);return Readable.from([bytes.subarray(offset)]);},
   importTransferFile:async(bundle,file,readSource)=>{const chunks=new Map<string,Uint8Array>();return copyIntakeTransferFile(file,{chunks:[]},{readSource,readChunk:async(i,sha)=>chunks.get(`${i}:${sha}`)!,writeChunk:async(i,sha,part)=>{chunks.set(`${i}:${sha}`,part.slice());},checkpoint:async()=>{},publish:async stream=>{const parts:Buffer[]=[];for await(const part of stream)parts.push(Buffer.from(part));return Buffer.concat(parts);},register:async original=>{await query('INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(draft_id,sha256) DO NOTHING',[transferredFileId(file.id,bundle.binding.destinationDraftId),bundle.binding.destinationDraftId,file.name,file.type,file.size,file.sha256,original.toString('base64')]);return (await files(bundle.binding.destinationDraftId))[0];}});}
  }));
 }
 const file:ScopeUpload={id:fileId,name:'fictional-plan.txt',type:'text/plain',size:bytes.length,sha256:transferSecretHash(bytes.toString()),status:'stored'};
 const payload={text:'[QA] Fictional kitchen remodel with cabinets.',answers:{service:'kitchen'},extraction:null,reviewed:null,contact:{name:'[QA] Fictional',email:'inquiry@example.invalid',phone:''},intake:{...emptyIntakeDetails(),reviewedScopeFingerprint:'',projectId:`handyman:${id}`,originSite:'handyman',currentSite:'handyman',version:1,supportingServices:['cabinetry'] as import('../lib/p5/intakePolicy.ts').SupportingService[],transcript:[{id:'toy',role:'user',text:'Keep the fictional floor.',at:1}]}};
 payload.intake.reviewedScopeFingerprint=intakeReviewFingerprint({...payload,uploads:[file]});
 await queries.get('handyman')!('INSERT INTO p5_estimator_drafts(id,key_hash,revision,brand,status,payload) VALUES($1,$2,1,$3,$4,$5::jsonb)',[id,transferSecretHash(key),'handyman','draft',JSON.stringify(payload)]);
 await queries.get('handyman')!('INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,$3,$4,$5,$6,$7)',[fileId,id,file.name,file.type,file.size,file.sha256,bytes.toString('base64')]);
 const call=async(site:IntakeSite,action:string,body:unknown,credentials?:{id:string;key:string},origin=`https://${INTAKE_SITES[site].domain}`)=>handlers.get(site)!.post(new Request(`https://${INTAKE_SITES[site].domain}/api/p5-estimator/intake-transfer/${action}`,{method:'POST',headers:{Origin:origin,'Content-Type':action==='receive'?'application/x-www-form-urlencoded':'application/json',...(credentials?{'x-p5-draft-id':credentials.id,'x-p5-draft-key':credentials.key}:{})},body:action==='receive'?new URLSearchParams({transfer:JSON.stringify(body)}):JSON.stringify(body)}));
 return {call,queries,handlers,failAck:()=>{failAcknowledgement=true;},resumeAck:()=>{failAcknowledgement=false;},close:async()=>{for(const db of dbs.values())await db.close();}};
}
test('authenticated HTTP handoff carries verified file bytes and conversation; lost acknowledgement keeps one owner',async()=>{
 const x=await fixture();try{
  const prepared=await x.call('handyman','prepare',seed,{id,key});assert.equal(prepared.status,200);const first=await prepared.json();const proof=requireTransferProof({binding:first.binding,destinationKey:secret,grant});
  const repeat=await x.call('handyman','prepare',seed,{id,key});assert.equal((await repeat.json()).digest,first.digest);
  const bad=await x.call('remodeling','receive',proof,undefined,'https://attacker.invalid');assert.equal(bad.status,403);assert.equal((await x.queries.get('remodeling')!('SELECT * FROM p5_estimator_drafts')).length,0);
  const received=await x.call('remodeling','receive',proof,undefined,'https://boisehandyman.co');assert.equal(received.status,200);assert.match(received.headers.get('content-security-policy')!,/default-src 'none'/);assert.match(await received.text(),/p5-intake-transfer-recovery-v2:/);
  assert.equal((await x.call('handyman','cancel',{binding:proof.binding},{id,key})).status,409);
  assert.equal((await x.call('remodeling','next',proof,{id:destination,key:'d'.repeat(64)})).status,404);
  const copied=await x.call('remodeling','next',proof,{id:destination,key:secret});assert.equal(copied.status,200);assert.equal((await copied.json()).state,'importing');
  x.failAck();const ready=await x.call('remodeling','next',proof,{id:destination,key:secret});assert.equal(ready.status,200);const result=await ready.json();assert.equal(result.sourceAcknowledged,false);assert.equal(result.draft.intake.projectId,`handyman:${id}`);assert.equal(result.draft.intake.transcript[0].text,'Keep the fictional floor.');
  assert.equal((await x.queries.get('handyman')!('SELECT status FROM p5_estimator_drafts'))[0].status,'intake-transferring');
  x.resumeAck();const reconciled=await x.call('remodeling','next',proof,{id:destination,key:secret});assert.equal((await reconciled.json()).sourceAcknowledged,true);
  assert.equal((await x.queries.get('handyman')!('SELECT status FROM p5_estimator_drafts'))[0].status,'intake-transferred');
  assert.equal((await x.queries.get('remodeling')!('SELECT * FROM p5_estimator_drafts')).length,1);const files=await x.queries.get('remodeling')!('SELECT * FROM p5_estimator_files');assert.equal(files.length,1);assert.deepEqual(Buffer.from(files[0].data_base64,'base64'),bytes);
  assert.equal((await x.queries.get('handyman')!('SELECT * FROM p5_estimator_files')).length,1);
 }finally{await x.close();}
});
test('proof/origin binding and remote request constraints reject forged transfers before I/O',async()=>{
 const binding={transferId:seed.transferId,projectId:`handyman:${id}`,sourceSite:'handyman',destinationSite:'remodeling',sourceOrigin:'https://boisehandyman.co',sourceDraftId:id,sourceRevision:1,destinationDraftId:destination,destinationKeyHash:transferSecretHash(secret),grantHash:transferSecretHash(grant)};
 const proof=requireTransferProof({binding,destinationKey:secret,grant});assert.throws(()=>requireTransferProof({...proof,grant:'d'.repeat(64)}),/credentials/);assert.throws(()=>requireTransferProof({...proof,binding:{...binding,extra:'untrusted'}}),/identity/);
 assert.throws(()=>requireReceiveOrigin(new Request('https://boiseremodeling.co'),proof.binding),/original/);
 let calls=0;const fake:typeof fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://boiseremodeling.co/api/p5-estimator/intake-transfer/receipt');assert.equal(init!.redirect,'error');assert.equal(init!.credentials,'omit');assert.equal(init!.cache,'no-store');assert.deepEqual(JSON.parse(String(init!.body)),proof);return Response.json({receipt:'toy'});};
 assert.deepEqual(await transferRemote('receipt','remodeling',proof,fake),{receipt:'toy'});assert.equal(calls,1);
});
