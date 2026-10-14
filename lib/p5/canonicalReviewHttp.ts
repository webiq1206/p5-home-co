import {createHash,timingSafeEqual} from 'node:crypto';
import {CANONICAL_RECEIVER_PROOF,canonicalReceiver,ReceiverError,type ReviewSite} from './canonicalReviewReceiver.ts';
import {canonicalReviewStore} from './canonicalReviewStore.ts';
import {canonicalHubspotProvider} from './canonicalReviewHubspot.ts';
import {PROJECT_REVIEW_BYTE_LIMIT,REVIEW_DOMAINS} from './projectReviewContract.ts';
import {query,transaction} from './database.ts';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
/** Distinct server-to-server credentials are provisioned only after explicit review.
 * Neither a domain header nor a payload's claimed brand authenticates its sender. */
export function reviewPrincipal(header:string|null,env:Record<string,string|undefined>):ReviewSite|null {
 const match=/^Bearer (.{32,4096})$/.exec(header||'');if(!match)return null;
 const hash=(s:string)=>createHash('sha256').update(s).digest();
 const hits=(Object.keys(REVIEW_DOMAINS) as ReviewSite[]).filter(site=>{
  const value=env[`P5_REVIEW_SOURCE_${site.toUpperCase()}_TOKEN_SHA256`];
  return value&&/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(hash(match[1]),Buffer.from(value,'hex'));
 });return hits.length===1?hits[0]:null;
}
export async function canonicalReviewHttp(request:Request,reconcile=false){
 if(!CANONICAL_RECEIVER_PROOF)return response({error:'contract-pending'},503);
 const principal=reviewPrincipal(request.headers.get('authorization'),process.env);
 if(!principal)return response({error:'unauthorized'},401);
 const receiver=canonicalReceiver(canonicalReviewStore(query,transaction),canonicalHubspotProvider(process.env.HUBSPOT_TOKEN||''),CANONICAL_RECEIVER_PROOF);
 try{
  if(reconcile){
   const key=new URL(request.url).searchParams.get('operationKey')||'';
   if(!/^p5-intake-[a-f0-9]{64}$/.test(key))return response({error:'invalid-operation'},400);
   const receipt=await receiver.reconcile(REVIEW_DOMAINS[principal],key);
   return receipt?response(receipt):response({error:'unconfirmed'},404);
  }
  if(!request.body)return response({error:'payload-invalid'},400);
  const reader=request.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
  try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>PROJECT_REVIEW_BYTE_LIMIT){await reader.cancel();return response({error:'payload-limit'},413);}chunks.push(item.value);}}finally{reader.releaseLock();}
  let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return response({error:'payload-invalid'},400);}
  return response(await receiver.receive(raw,request.headers.get('idempotency-key')||'',principal));
 }catch(error){return response({error:error instanceof ReceiverError?error.code:'reconciliation-required'},409);}
}
