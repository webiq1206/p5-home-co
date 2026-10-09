import {timingSafeEqual,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {query} from './database.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {draftCredentials,readDraft,DraftError} from './store.ts';
import {protectRequest,limitedBody,json,failed} from './http.ts';
import {intakeSite,routeIntake,intakeRoutingContext,type IntakeSite} from './intakePolicy.ts';
import {intakeScopeReviewed} from './intakeContract.ts';
import {intakeTransferStore,IntakeTransferConflict,requireTransferBinding,requireTransferBundle,requireTransferReceipt,transferOrigin,transferSecretHash,type TransferBinding,type TransferBundle,type TransferReadyReceipt} from './intakeTransferStore.ts';
import {originalTransferStream,importTransferFile,importedFiles} from './intakeTransferStorage.ts';
import type {IntakeQuery} from './intakeStore.ts';

export interface TransferProof {binding:TransferBinding;destinationKey:string;grant:string}
const secretPattern=/^[a-f\d]{64}$/;
function secretMatches(secret:string,hash:string){return timingSafeEqual(Buffer.from(transferSecretHash(secret),'hex'),Buffer.from(hash,'hex'));}
export function requireTransferProof(value:unknown):TransferProof {
 const proof=value as TransferProof;requireTransferBinding(proof?.binding);
 if(!secretPattern.test(proof.destinationKey)||!secretPattern.test(proof.grant)||!secretMatches(proof.destinationKey,proof.binding.destinationKeyHash)||!secretMatches(proof.grant,proof.binding.grantHash))throw new IntakeTransferConflict('The project transfer credentials do not match.');return proof;
}
export function requireReceiveOrigin(request:Request,binding:TransferBinding){
 requireTransferBinding(binding);
 if(request.headers.get('origin')!==binding.sourceOrigin)throw new DraftError('Open this transfer from its original project page.',403);
}
/** Network targets are derived from the fixed five-site allowlist. No redirects,
 * cookies, customer fields, or credentials appear in a URL. */
export async function transferRemote(action:'claim'|'receipt'|'ack',site:TransferBinding['sourceSite'],proof:TransferProof,fetcher:typeof fetch=fetch){
 const response=await fetcher(`${transferOrigin(site)}/api/p5-estimator/intake-transfer/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});
 const value=JSON.parse(new TextDecoder().decode(await limitedBody(response as unknown as Request,40*1024*1024)));
 if(!response.ok)throw new IntakeTransferConflict(typeof value?.error==='string'?value.error:'The other project site could not confirm this transfer.');return value;
}
function receivePage(proof:TransferProof){
 const nonce=randomBytes(18).toString('base64');
 const data=JSON.stringify(proof).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 // Separate recovery storage never overwrites an existing project draft. The estimator
 // archives that draft only after the destination import is complete and verified.
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue your project</title></head><body><main><h1>Continue your saved project</h1><p id="status">Saving your transfer so you can resume here.</p><p><a href="/estimate">Open project review</a></p></main><script nonce="${nonce}">try{const p=${data};const key='p5-intake-transfer-recovery-v2:'+p.binding.transferId;const raw=JSON.stringify(p);localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw Error('storage');location.replace('/estimate');}catch{document.getElementById('status').textContent='This browser could not save the transfer. Keep the original project page open and resume there. Your original details and files are retained.';}</script></body></html>`;
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`}});
}
export interface TransferDependencies {site:IntakeSite;query:IntakeQuery;readDraft:typeof readDraft;originalTransferStream:typeof originalTransferStream;importTransferFile:typeof importTransferFile;importedFiles:typeof importedFiles;fetcher:typeof fetch}
export function intakeTransferHandlers(overrides:Partial<TransferDependencies>={}){
 const dependencies={site:intakeSite(ESTIMATOR_BRAND.id)!,query,readDraft,originalTransferStream,importTransferFile,importedFiles,fetcher:fetch,...overrides};
 const {site:currentSite,readDraft:ownedDraft,originalTransferStream:sourceStream,importTransferFile:copyFile,importedFiles:destinationFiles,fetcher}=dependencies;
 const remote=(action:'claim'|'receipt'|'ack',site:IntakeSite,proof:TransferProof)=>transferRemote(action,site,proof,fetcher);
 const store=()=>intakeTransferStore(dependencies.query);
async function sourceOwner(request:Request){
 protectRequest(request);const credentials=draftCredentials(request),draft=await ownedDraft(credentials.id,credentials.key);
 if(!draft||draft.brand!==currentSite)throw new DraftError('Project not found.',404);return {credentials,draft};
}
async function imported(proof:TransferProof){
 const b=proof.binding;if(b.destinationSite!==currentSite)throw new DraftError('This transfer belongs to another destination.',404);
 const current=await store().readImport(b.destinationDraftId);
 if(!current||JSON.stringify(requireTransferBundle(current.bundle).binding)!==JSON.stringify(b)){
  // Compare semantic bindings despite jsonb key ordering by validating the supplied
  // secrets and matching every persisted field individually.
  if(!current||Object.keys(current.bundle.binding).some(key=>current.bundle.binding[key as keyof TransferBinding]!==b[key as keyof TransferBinding]))throw new DraftError('Transferred project not found.',404);
 }
 return current;
}
async function verifyDestination(proof:TransferProof,bundle:TransferBundle):Promise<TransferReadyReceipt>{
 const value=await remote('receipt',proof.binding.destinationSite,proof);return requireTransferReceipt(value.receipt,bundle);
}
async function getIntakeTransfer(request:Request){try{
 const {credentials}=await sourceOwner(request);const source=await store().readSource(credentials.id);
 return json({transfer:source?{binding:source.binding,state:source.state,expiresAt:source.expiresAt,digest:source.bundle?.digest,receipt:source.receipt}:null});
}catch(error){return failed(error);}}
async function postIntakeTransfer(request:Request){try{
 const action=new URL(request.url).pathname.split('/').at(-1);
 if(['prepare','renew','cancel','abandon'].includes(action||'')){
  const {credentials,draft}=await sourceOwner(request);
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,16000)));
  if(action==='abandon'){await store().abandon(credentials.id,body.transferId,body.revision);return json({cancelled:true});}
  if(action==='prepare'){
   if(body.revision!==draft.revision)throw new DraftError('Save and review the latest project before transferring.',409);
   if(!intakeScopeReviewed(draft))throw new DraftError('Confirm the current whole project type, supporting work and exclusions before transferring.',409);
   const site=intakeSite(draft.brand);if(!site)throw new DraftError('This site cannot transfer projects.',503);
   const routing=routeIntake(site,draft.answers.service||'',draft.intake?.supportingServices,intakeRoutingContext(draft));
   if(!routing.handoff)throw new DraftError('This project should be completed on the current site.',409);
   if(!secretPattern.test(body.destinationKey)||!secretPattern.test(body.grant))throw new DraftError('Invalid project transfer credentials.');
   const binding:TransferBinding={transferId:body.transferId,projectId:draft.intake?.projectId||`${site}:${draft.id}`,sourceSite:site,sourceOrigin:request.headers.get('origin')||'',destinationSite:routing.handoff,sourceDraftId:draft.id,sourceRevision:draft.revision,destinationDraftId:body.destinationDraftId,destinationKeyHash:transferSecretHash(body.destinationKey),grantHash:transferSecretHash(body.grant)};
   requireTransferBinding(binding);await store().prepare(binding);const sealed=await store().seal(binding);
   return json({binding,state:sealed.state,expiresAt:sealed.expiresAt,digest:sealed.bundle!.digest,destination:`${transferOrigin(routing.handoff)}/api/p5-estimator/intake-transfer/receive`});
  }
  const binding=requireTransferBinding(body.binding);
  if(binding.sourceDraftId!==credentials.id||binding.sourceSite!==currentSite)throw new DraftError('Project transfer does not match.',404);
  if(action==='cancel'){await store().cancel(binding);return json({cancelled:true});}
  return json({transfer:await store().renew(binding)});
 }
 let raw:unknown;
 if(action==='receive'){
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new DraftError('Open this transfer from the original project.',415);
  const form=new URLSearchParams(new TextDecoder().decode(await limitedBody(request,16000)));raw=JSON.parse(form.get('transfer')||'null');
 }else raw=JSON.parse(new TextDecoder().decode(await limitedBody(request,16000)));
 const proof=requireTransferProof(raw),b=proof.binding;
 if(action==='receive'){
  requireReceiveOrigin(request,b);if(b.destinationSite!==currentSite)throw new DraftError('This is not the destination for this project.',403);
  const existing=await store().readImport(b.destinationDraftId);
  if(existing)await imported(proof);
  else{
   const response=await remote('claim',b.sourceSite,proof),bundle=requireTransferBundle(response.bundle);
   if(Object.keys(b).some(key=>b[key as keyof TransferBinding]!==bundle.binding[key as keyof TransferBinding]))throw new DraftError('The source returned a different transfer.',409);
   await store().beginImport(bundle);
  }
  return receivePage(proof);
 }
 if(action==='claim'||action==='file'||action==='ack'){
  if(b.sourceSite!==currentSite)throw new DraftError('This is not the source for this project.',404);
  if(action==='claim')return json({bundle:await store().claim(b)});
  if(action==='ack'){
   const source=await store().readSource(b.sourceDraftId);
   if(!source?.bundle)throw new DraftError('Original project transfer not found.',404);
   const receipt=await verifyDestination(proof,source.bundle);return json({receipt:await store().acknowledge(b,receipt)});
  }
  const bundle=await store().claim(b),input=raw as TransferProof&{fileId:string;offset:number};
  const file=bundle.files.find(f=>f.id===input.fileId);if(!file)throw new DraftError('File is not in this project transfer.',404);
  const stream=await sourceStream(bundle,input.fileId,input.offset);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size-input.offset),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 }
 if(action==='receipt'){const current=await imported(proof);if(!current.receipt)throw new DraftError('The destination is still copying this project.',409);return json({receipt:requireTransferReceipt(current.receipt,current.bundle)});}
 if(action==='next'){
  protectRequest(request);const credentials=draftCredentials(request);
  if(credentials.id!==b.destinationDraftId||credentials.key!==proof.destinationKey||!await ownedDraft(credentials.id,credentials.key))throw new DraftError('Destination project not found.',404);
  const current=await imported(proof),bundle=current.bundle;
  const files=await destinationFiles(b.destinationDraftId),missing=bundle.files.find(file=>!files.some(saved=>saved.sha256===file.sha256&&saved.size===file.size&&saved.name===file.name&&saved.type===file.type));
  if(missing){
   await copyFile(bundle,missing,async offset=>{
    const response=await fetcher(`${transferOrigin(b.sourceSite)}/api/p5-estimator/intake-transfer/file`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...proof,fileId:missing.id,offset}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(90000)});
    if(!response.ok||!response.body||Number(response.headers.get('content-length'))!==missing.size-offset)throw new Error('The original file could not be resumed. Its source is retained; resume from the original project if the transfer expired.');
    return response.body as unknown as AsyncIterable<Uint8Array>;
   });
   return json({state:'importing',copiedFiles:files.length+1,totalFiles:bundle.files.length});
  }
  const receipt=await store().completeImport(bundle);
  // Failure to acknowledge leaves the source frozen; it never opens a second owner.
  let sourceAcknowledged=false;try{const response=await remote('ack',b.sourceSite,proof);requireTransferReceipt(response.receipt,bundle);sourceAcknowledged=true;}catch{}
  const draft=await ownedDraft(b.destinationDraftId,proof.destinationKey);if(!draft)throw new Error('The destination project could not be reopened.');
  return json({state:'ready',receipt,sourceAcknowledged,draft});
 }
 throw new DraftError('Unknown project transfer action.',404);
}catch(error){return failed(error instanceof IntakeTransferConflict?new DraftError(error.message,409):error);}}

 return {get:getIntakeTransfer,post:postIntakeTransfer};
}
export const getIntakeTransfer=(request:Request)=>intakeTransferHandlers().get(request);
export const postIntakeTransfer=(request:Request)=>intakeTransferHandlers().post(request);
