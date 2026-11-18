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
import {P5_LEAD_RETRY_WINDOW_MS,projectRequestHold,projectRequestTooOld} from './p5LeadIntake.ts';

/**
 * The CRM channel on p5homeco.com is this site's own lead system (owner decision, 18 November 2026):
 * a visitor's unpriced project request becomes a P5 lead in this process, and the lead's HubSpot deal
 * follows from the existing sync. There is no price, so nothing goes to QuickBooks; the estimate the
 * team later publishes joins the same lead (deliveryAdapter.ts, one lead per project).
 *
 * - On only while `P5_CRM_DELIVERY` is `on` (`crm-disabled` otherwise), and only for requests saved
 *   since the lead system began taking them (`PROJECT_REQUEST_LEADS_SINCE`; `P5_REQUEST_LEADS_SINCE`
 *   sets another moment), so older requests the team already answered do not arrive all at once.
 * - No second team email: the `team` channel has mailed the request, and saving a lead in process
 *   sends none.
 * - A synthetic QA request never becomes a lead: the worker suppresses it, `validate` refuses it,
 *   and `send` checks once more.
 * - A retry is safe: the lead's id is the request's lead key, so a repeat is answered as a duplicate.
 *
 * The canonical review receiver is not used and stays gated (`INTAKE_RUNTIME_PROOF.crm`), untouched.
 *
 * The lead system lives under app/, outside lib/p5. Like the mail adapter below, it is never a static
 * import of this file: an isolated harness that copies lib/p5 elsewhere and replaces the adapter must
 * still be able to load this module. `runtimeIntakeTransports()` loads the site's own checks
 * (intakeCrmValidation.ts) once, before it builds the channel, so `validate` stays synchronous and
 * reads the envelope only. Where they cannot be loaded the channel reports `configuration-missing`
 * and saves nothing.
 */
type LocalLeadChecks=typeof import('./intakeCrmValidation.ts');
function leadSystemTransport(local:LocalLeadChecks|null):IntakeTransport{
 return {retryWindowMs:P5_LEAD_RETRY_WINDOW_MS,identityScope:'p5-lead-system-in-process-v1',
  readiness:async snapshot=>process.env.P5_CRM_DELIVERY!=='on'||projectRequestTooOld(snapshot,process.env.P5_REQUEST_LEADS_SINCE)?'crm-disabled':local?null:'configuration-missing',
  // The site's own receiver checks when they are loaded, and the shared facts-only check otherwise.
  validate:envelope=>local?local.validateIntakeLocalCrm(envelope):projectRequestHold(envelope),
  send:async envelope=>{
   if(process.env.P5_CRM_DELIVERY!=='on')throw new Error('crm-disabled');
   if(!local)throw new Error('configuration-missing');
   const held=local.validateIntakeLocalCrm(envelope);if(held)throw new Error(held);
   const lead=local.intakeInboundLead(envelope);
   // Loaded on demand, so the mail channels of this runtime never load the lead system.
   const [{ingestLead},{loadSettings},{estimatorDeliveryMode}]=await Promise.all([import('../../app/lib/leads/intake.ts'),import('../../app/lib/leads/settings.ts'),import('../../app/lib/leads/synthetic-qa.ts')]);
   // Throws for a QA name outside the authorized mailbox too: neither kind is ever a live lead.
   if(estimatorDeliveryMode([lead.firstName,lead.lastName].filter(Boolean).join(' '),lead.email||'')!=='live')throw new Error('synthetic-suppressed');
   const result=await ingestLead(lead,await loadSettings());
   if(result.status==='rejected')throw new Error('contact-review');
   if(!Number.isInteger(result.dealId)||result.dealId<=0)throw new Error('uncertain-send');
   return `p5-lead:${result.dealId}`;
  },
 };
}

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
 // The lead system's checks, loaded here and never at module load (see leadSystemTransport).
 const local:LocalLeadChecks|null=await import('./intakeCrmValidation.ts').catch(()=>null);
 return {customer:email,team:email,crm:leadSystemTransport(local)};
}
export async function processIntakeDeliveries(limit=2){
 if(qaOperationContext())return {processed:0};
 const site=intakeSite(ESTIMATOR_BRAND.id);if(!site)return {processed:0};
 return intakeDeliveryWorker({query,site,transports:await runtimeIntakeTransports(),suppressed:suppressSyntheticEstimateNotifications}).run(limit);
}
