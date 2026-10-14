import {canonicalJson} from './canonicalJson.ts';
import {createHash} from 'node:crypto';
import {projectReviewSchema,PROJECT_REVIEW_BYTE_LIMIT,REVIEW_DOMAINS,type ProjectReview} from './projectReviewContract.ts';
export const CANONICAL_PORTAL=247066159;
export const CANONICAL_REVIEW_URL='https://p5homeco.com/api/external/project-reviews';
export type ReviewSite=keyof typeof REVIEW_DOMAINS;
export type ReceiverReceipt={status:'accepted';portalId:number;dealId:string;operationKey:string;externalLeadId:string;source:string;revision:number;snapshotDigest:string;bodyDigest:string;deliveryMode:'live'|'synthetic_qa';ownerId:string;acceptedAt:string};
export type Reservation={kind:'new';previousDealId?:string;previousReview?:ProjectReview}|{kind:'existing';receipt?:ReceiverReceipt}|{kind:'conflict'};
/** Implementations must atomically serialize a project across ALL sources/revisions.
 * A reserved operation is never automatically released, including process death. */
export interface ReceiptStore {
 reserve(p:ProjectReview,key:string,digest:string):Promise<Reservation>;
 accept(p:ProjectReview,key:string,digest:string,receipt:ReceiverReceipt):Promise<void>;
 read(source:string,key:string):Promise<ReceiverReceipt|null>;
 pending(source:string,key:string):Promise<ProjectReview|null>;
}
export interface ReviewProvider {
 portal():Promise<number>;
 write(p:ProjectReview,ownerId:string,previousDealId?:string,previousReview?:ProjectReview):Promise<string>;
 reconcile(p:ProjectReview,ownerId:string):Promise<string|null>;
 verify(p:ProjectReview,ownerId:string,dealId:string):Promise<boolean>;
}
export interface ReceiverProof {
 portalId:number;contractEvidence:string;
 ownerIds:Partial<Record<ReviewSite,string>>;
 /** Source-reviewed workflow exclusions; a QA label or pipeline alone is not proof. */
 syntheticIsolation:null|{evidence:string;expiresAt:string;noEmail:true;noSms:true;noCalls:true;noTasks:true;noWorkflows:true;allowedOperationKeys:readonly string[]};
}
export class ReceiverError extends Error {
 readonly code:string;
 constructor(code:string){super(code);this.code=code;}
}
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const reviewOperationKey=(p:ProjectReview)=>'p5-intake-'+hash(JSON.stringify([p.request.projectId,p.request.currentSite,p.request.revision,'crm']));
export function validateCanonicalReview(raw:unknown,key:string,principal:ReviewSite):ProjectReview {
 if(Buffer.byteLength(JSON.stringify(raw)??'')>PROJECT_REVIEW_BYTE_LIMIT)throw new ReceiverError('payload-limit');
 const result=projectReviewSchema.safeParse(raw);if(!result.success)throw new ReceiverError('payload-invalid');
 const p=result.data;
 if(p.request.currentSite!==principal||p.source!==REVIEW_DOMAINS[principal])throw new ReceiverError('source-mismatch');
 if(!new RegExp('^'+p.request.originSite+':[0-9a-f-]{36}$','i').test(p.request.projectId))throw new ReceiverError('origin-mismatch');
 const expected=(p.deliveryMode==='synthetic_qa'?'qa-':'')+'p5-intake-'+hash(p.request.projectId);
 if(p.externalLeadId!==expected||key!==reviewOperationKey(p))throw new ReceiverError('identity-mismatch');
 const labeled=/^(?:\[QA\](?:\s|$)|SYNTHETIC\s+QA\b)/i.test(p.request.contact.name.trim());
 if(labeled!==(p.deliveryMode==='synthetic_qa'))throw new ReceiverError('mode-mismatch');
 // Production QA is deliberately limited to non-routable fixtures. No phone means
 // even a faulty integration cannot call or text a real person from this request.
 if(p.deliveryMode==='synthetic_qa'&&(!p.request.contact.email.endsWith('@example.invalid')||p.request.contact.phone))throw new ReceiverError('qa-contact-denied');
 return p;
}
export function canonicalReceiver(store:ReceiptStore,provider:ReviewProvider,proof:ReceiverProof|null,now=()=>new Date()) {
 async function authorize(p:ProjectReview,key:string){
   if(!proof||proof.portalId!==CANONICAL_PORTAL||!proof.contractEvidence)throw new ReceiverError('contract-pending');
   const owner=proof.ownerIds[p.request.routing.primaryTeam];
   if(!owner||!/^\d+$/.test(owner))throw new ReceiverError('owner-unverified');
   if(p.deliveryMode==='synthetic_qa'){
    const q=proof.syntheticIsolation;
    if(!q||!q.evidence||!(Date.parse(q.expiresAt)>now().getTime())||!q.noEmail||!q.noSms||!q.noCalls||!q.noTasks||!q.noWorkflows||!q.allowedOperationKeys.includes(key))throw new ReceiverError('qa-isolation-unverified');
   }
   if(await provider.portal()!==CANONICAL_PORTAL)throw new ReceiverError('portal-mismatch');
   return owner;
 }
 return {
  async receive(raw:unknown,key:string,principal:ReviewSite):Promise<ReceiverReceipt>{
   const p=validateCanonicalReview(raw,key,principal),digest=hash(canonicalJson(p));
   const owner=await authorize(p,key);
   const reservation=await store.reserve(p,key,digest);
   if(reservation.kind==='conflict')throw new ReceiverError('snapshot-conflict');
   if(reservation.kind==='existing'&&reservation.receipt)return reservation.receipt;
   // Exactly one provider write attempt. Errors, malformed acknowledgements and
   // DB failures leave the reservation held for explicit read-only reconciliation.
   const dealId=reservation.kind==='existing'?await provider.reconcile(p,owner):await provider.write(p,owner,reservation.previousDealId,reservation.previousReview);
   if(!dealId)throw new ReceiverError('reconciliation-required');
   if(!/^\d+$/.test(dealId)||!await provider.verify(p,owner,dealId))throw new ReceiverError('reconciliation-required');
   const receipt:ReceiverReceipt={status:'accepted',portalId:CANONICAL_PORTAL,dealId,operationKey:key,externalLeadId:p.externalLeadId,source:p.source,revision:p.request.revision,snapshotDigest:p.snapshotDigest,bodyDigest:digest,deliveryMode:p.deliveryMode,ownerId:owner,acceptedAt:now().toISOString()};
   await store.accept(p,key,digest,receipt);return receipt;
  },
  async reconcile(source:string,key:string){
   const existing=await store.read(source,key);if(existing)return existing;
   const pending=await store.pending(source,key);if(!pending)return null;
   const principal=(Object.keys(REVIEW_DOMAINS) as ReviewSite[]).find(site=>REVIEW_DOMAINS[site]===source);
   if(!principal)throw new ReceiverError('source-mismatch');
   const p=validateCanonicalReview(pending,key,principal),owner=await authorize(p,key);
   const dealId=await provider.reconcile(p,owner);
   if(!dealId||!await provider.verify(p,owner,dealId))return null;
   const digest=hash(canonicalJson(p));
   const receipt:ReceiverReceipt={status:'accepted',portalId:CANONICAL_PORTAL,dealId,operationKey:key,externalLeadId:p.externalLeadId,source:p.source,revision:p.request.revision,snapshotDigest:p.snapshotDigest,bodyDigest:digest,deliveryMode:p.deliveryMode,ownerId:owner,acceptedAt:now().toISOString()};
   await store.accept(p,key,digest,receipt);return receipt;
  },
 };
}
/** Remains unset until production identity, owner mapping and workflow evidence are reviewed. */
export const CANONICAL_RECEIVER_PROOF:ReceiverProof|null=null;
