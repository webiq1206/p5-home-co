import {canonicalJson} from './canonicalJson.ts';
import {createHash} from 'node:crypto';
import {intakeProjectReview} from './intakeProjectReview.ts';
import type {IntakeTransport} from './intakeDelivery.ts';
import type {IntakeDeliveryReason} from './intakeDeliveryPolicy.ts';
import {CANONICAL_PORTAL,CANONICAL_REVIEW_URL} from './canonicalReviewReceiver.ts';
/** All five senders use the same source-bound receiver and immutable acknowledgement. */
export function canonicalReviewTransport(config:{enabled:boolean;token:string;proof:string|null},fetchImpl:typeof fetch=fetch):IntakeTransport {
 const readiness=async():Promise<IntakeDeliveryReason|null>=>!config.enabled?'crm-disabled':!config.proof?'crm-contract-pending':!config.token?'configuration-missing':null;
 return {retryWindowMs:0,identityScope:createHash('sha256').update(JSON.stringify(['canonical-hubspot-v1',CANONICAL_REVIEW_URL,config.token,config.proof])).digest('hex'),readiness,
  validate(envelope){try{intakeProjectReview(envelope,'',true);return null;}catch{return 'payload-review';}},
  async send(envelope){
   const blocked=await readiness();if(blocked)throw new Error(blocked);
   const p=intakeProjectReview(envelope,'',true),body=canonicalJson(p),digest=createHash('sha256').update(body).digest('hex');
   const headers={Authorization:`Bearer ${config.token}`,'Idempotency-Key':envelope.key};
   const matching=(r:any)=>r?.status==='accepted'&&r.portalId===CANONICAL_PORTAL&&r.operationKey===envelope.key&&r.source===p.source&&r.externalLeadId===p.externalLeadId&&r.revision===p.request.revision&&r.snapshotDigest===p.snapshotDigest&&r.bodyDigest===digest&&r.deliveryMode===p.deliveryMode&&typeof r.dealId==='string'&&/^\d+$/.test(r.dealId);
   const read=async(response:Response)=>{
    if(!response.ok||!response.body)throw new Error('reconciliation-required');
    const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>16384){await reader.cancel();throw new Error('receipt-too-large');}chunks.push(next.value);}}finally{reader.releaseLock();}
    const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!matching(r))throw new Error('reconciliation-required');return r.dealId as string;
   };
   try{return await read(await fetchImpl(CANONICAL_REVIEW_URL,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(45000)}));}
   catch{
    // One authenticated receipt read; never another POST after ambiguous acceptance.
    const url=new URL(CANONICAL_REVIEW_URL+'/reconcile');url.searchParams.set('operationKey',envelope.key);
    return read(await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)}));
   }
  }};
}
