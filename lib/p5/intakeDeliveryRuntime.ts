import {query} from './database.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {intakeSite} from './intakePolicy.ts';
import {intakeDeliveryWorker,type IntakeTransport} from './intakeDelivery.ts';
import {INTAKE_RUNTIME_PROOF} from './intakeDeliveryPolicy.ts';
import {suppressSyntheticEstimateNotifications} from './estimatorNotifications.ts';
import {qaOperationContext} from './qaOperationContext.ts';
import {intakeLocalCrmRecord} from './intakeDeliveryPayload.ts';

/** Existing adapters only. Configuration values and provider errors never enter status payloads.
 * Runtime proof is a reviewed source gate, not a user-supplied option or a credential toggle. */
export async function runtimeIntakeTransports():Promise<Record<'customer'|'team'|'crm',IntakeTransport>>{
 // The local receiver's validation is site code; load it with the transports so an
 // isolated harness that replaces the adapter never needs the site's lead modules.
 const {validateIntakeLocalCrm}=await import('./intakeCrmValidation.ts');
 const email:IntakeTransport={retryWindowMs:0,identityScope:'p5-smtp-no-automatic-replay',
  // The brand adapter owns SMTP configuration. Loaded lazily, like send, so an
  // isolated harness that replaces the adapter never needs the site's notification modules.
  readiness:async()=>{const adapter=await import('./deliveryAdapter.ts');if(typeof adapter.emailTransportReady!=='function'||!adapter.emailTransportReady())return 'configuration-missing';return INTAKE_RUNTIME_PROOF.email?null:'runtime-proof-pending';},
  send:async envelope=>{if(!envelope.email)throw new Error('payload-review');const {sendEmail}=await import('./deliveryAdapter.ts');return sendEmail({...envelope.email,attachments:envelope.email.attachments.map(f=>({filename:f.filename,content:Buffer.from(f.base64,'base64')})),key:envelope.key});},
 };
 const crm:IntakeTransport={retryWindowMs:0,identityScope:'p5-ingest-lead-no-automatic-replay',
  readiness:async()=>process.env.P5_CRM_DELIVERY!=='on'?'crm-disabled':INTAKE_RUNTIME_PROOF.crm?null:'crm-contract-pending',
  validate:validateIntakeLocalCrm,
  send:async envelope=>{
   const s=envelope.request;if(!s)throw new Error('payload-review');
   // P5's existing ingestLead adapter accepts an unpriced summary. A stable project key
   // creates one lead; later revisions append their exact reference and scoping to its activity.
   // Unknown outcomes remain held: duplicate activity is not an idempotent acknowledgement.
   const {syncCrm}=await import('./deliveryAdapter.ts');
   return syncCrm(intakeLocalCrmRecord(s),envelope.leadKey);
  },
 };
 return {customer:email,team:email,crm};
}
export async function processIntakeDeliveries(limit=2){
 if(qaOperationContext())return {processed:0};
 const site=intakeSite(ESTIMATOR_BRAND.id);if(!site)return {processed:0};
 return intakeDeliveryWorker({query,site,transports:await runtimeIntakeTransports(),suppressed:suppressSyntheticEstimateNotifications}).run(limit);
}
