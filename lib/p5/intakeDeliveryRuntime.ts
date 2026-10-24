import {prepareIntakeEmail} from './intakeEmailDelivery.ts';
import {readStoredBytes} from './objectStorage.ts';
import {linkSecret} from './estimateLinks.ts';
import {query} from './database.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {intakeSite} from './intakePolicy.ts';
import {intakeDeliveryWorker,type IntakeTransport} from './intakeDelivery.ts';
import {INTAKE_RUNTIME_PROOF} from './intakeDeliveryPolicy.ts';
import {suppressSyntheticEstimateNotifications} from './estimatorNotifications.ts';
import {qaOperationContext} from './qaOperationContext.ts';
import {canonicalReviewTransport} from './canonicalReviewTransport.ts';

/** Existing adapters only. Configuration values and provider errors never enter status payloads.
 * Runtime proof is a reviewed source gate, not a user-supplied option or a credential toggle. */
export async function runtimeIntakeTransports():Promise<Record<'customer'|'team'|'crm',IntakeTransport>>{
 const email:IntakeTransport={retryWindowMs:0,identityScope:'p5-smtp-no-automatic-replay',
  // The brand adapter owns SMTP configuration. Loaded lazily, like send, so an
  // isolated harness that replaces the adapter never needs the site's notification modules.
  readiness:async()=>{const adapter=await import('./deliveryAdapter.ts');if(typeof adapter.emailTransportReady!=='function'||!adapter.emailTransportReady())return 'configuration-missing';return INTAKE_RUNTIME_PROOF.email?null:'runtime-proof-pending';},
  prepare:(snapshot,envelope)=>prepareIntakeEmail(snapshot,envelope,{query,readBytes:readStoredBytes,secret:linkSecret}),
  send:async envelope=>{if(!envelope.email)throw new Error('payload-review');const {sendEmail}=await import('./deliveryAdapter.ts');return sendEmail({...envelope.email,attachments:envelope.email.attachments.map(f=>({filename:f.filename,content:Buffer.from(f.base64,'base64'),contentType:f.contentType})),key:envelope.key});},
 };
 const crm=canonicalReviewTransport({enabled:process.env.P5_CRM_DELIVERY==='on',token:process.env.P5_CANONICAL_REVIEW_TOKEN||'',proof:INTAKE_RUNTIME_PROOF.crm});
 return {customer:email,team:email,crm};
}
export async function processIntakeDeliveries(limit=2){
 if(qaOperationContext())return {processed:0};
 const site=intakeSite(ESTIMATOR_BRAND.id);if(!site)return {processed:0};
 return intakeDeliveryWorker({query,site,transports:await runtimeIntakeTransports(),suppressed:suppressSyntheticEstimateNotifications}).run(limit);
}
