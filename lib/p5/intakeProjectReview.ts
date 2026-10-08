import {createHash} from 'node:crypto';
import {projectReviewSchema,PROJECT_REVIEW_BYTE_LIMIT,type ProjectReview} from './projectReviewContract.ts';
import {intakeLeadKey,intakeOperationKey,type IntakeDeliveryEnvelope} from './intakeDeliveryPayload.ts';
import {INTAKE_SITES} from './intakePolicy.ts';
import type {IntakeDeliveryReason} from './intakeDeliveryPolicy.ts';
import type {IntakeTransport} from './intakeDelivery.ts';
import {deliverKeyedCrm} from './keyedCrm.ts';

const endpoint='https://leads.boiseremodeling.co/api/external/project-reviews';
/** Resolve only the verified existing BRC target. Unknown overrides require review. */
export function projectReviewEndpoint(configured:string):string|null{
 return configured===endpoint||configured==='https://leads.boiseremodeling.co/api/external/leads'?endpoint:null;
}
class ReviewValidationError extends Error{
 readonly reason:IntakeDeliveryReason;
 constructor(reason:IntakeDeliveryReason){super(reason);this.reason=reason;}
}
/** Explicit source-owned projection. Retain full submitted material; omit storage credentials,
 * engine extraction and binary files. The receiver derives authenticated staff references. */
export function intakeProjectReview(envelope:IntakeDeliveryEnvelope,qaAllowlist=''):ProjectReview{
 const s=envelope.request;
 if(!s||s.currentSite==='p5')throw new ReviewValidationError('payload-review');
 if(envelope.channel!=='crm'||envelope.leadKey!==intakeLeadKey(s.projectId)||envelope.key!==intakeOperationKey(s,'crm'))throw new ReviewValidationError('snapshot-conflict');
 const qa=[s.contact.name,(s.scope.answers as Record<string,unknown>).projectName].some(value=>typeof value==='string'&&/^(?:\[QA\](?:\s|$)|SYNTHETIC\s+QA\b)/i.test(value.trim()));
 const email=s.contact.email.toLowerCase();
 if(qa&&email&&!email.endsWith('@example.invalid')&&!qaAllowlist.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).includes(email))throw new ReviewValidationError('contact-review');
 const payload={schema:1,requestType:'project_review_v1',source:INTAKE_SITES[s.currentSite].domain,
  externalLeadId:(qa?'qa-':'')+envelope.leadKey,snapshotDigest:envelope.snapshotDigest,deliveryMode:qa?'synthetic_qa':'live',
  request:{projectId:s.projectId,draftId:s.draftId,revision:s.revision,savedAt:s.savedAt,originSite:s.originSite,currentSite:s.currentSite,
   contact:s.contact,scope:{text:s.scope.text,answers:s.scope.answers,uploads:s.scope.uploads.map(f=>({id:f.id,name:f.name,type:f.type,size:f.size,sha256:f.sha256}))},
   details:{desiredOutcome:s.details.desiredOutcome,workContext:s.details.workContext,budget:s.details.budget,transcript:s.details.transcript},
   routing:{primaryTeam:s.routing.primaryTeam,supportingServices:s.routing.supportingServices},unresolved:s.unresolved}};
 const parsed=projectReviewSchema.safeParse(payload);
 if(!parsed.success)throw new ReviewValidationError(parsed.error.issues.some(i=>i.path[0]==='request'&&i.path[1]==='contact')?'contact-review':'payload-review');
 if(Buffer.byteLength(JSON.stringify(parsed.data))>PROJECT_REVIEW_BYTE_LIMIT)throw new ReviewValidationError('payload-review');
 return parsed.data;
}
export function validateIntakeProjectReview(envelope:IntakeDeliveryEnvelope,qaAllowlist=''):IntakeDeliveryReason|null{
 try{intakeProjectReview(envelope,qaAllowlist);return null;}catch(error){return error instanceof ReviewValidationError?error.reason:'payload-review';}
}
/** Configuration is supplied by the brand's existing adapter. Runtime proof remains a
 * reviewed source gate; this constructor cannot infer verification from environment flags. */
export function projectReviewTransport(config:{enabled:boolean;token:string;url:string;proof:string|null;qaAllowlist?:string},fetchImpl:typeof fetch=fetch):IntakeTransport{
 const url=projectReviewEndpoint(config.url);
 const readiness=async():Promise<IntakeDeliveryReason|null>=>!config.enabled?'crm-disabled':!url?'crm-contract-pending':!config.token?'configuration-missing':!config.proof?'runtime-proof-pending':null;
 return {retryWindowMs:0,identityScope:createHash('sha256').update(JSON.stringify(['project_review_v1',url,config.token,config.proof])).digest('hex'),readiness,
  validate:envelope=>validateIntakeProjectReview(envelope,config.qaAllowlist),
  send:async envelope=>{const blocked=await readiness();if(blocked)throw new Error(blocked);return deliverKeyedCrm(intakeProjectReview(envelope,config.qaAllowlist),envelope.key,config.token,url!,fetchImpl);}};
}
