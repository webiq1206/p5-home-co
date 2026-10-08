import {randomUUID} from 'node:crypto';
import {deliveryKey,snapshotKey,intakeDigest,type IntakeQuery} from './intakeStore.ts';
import type {IntakeSnapshot} from './intakeContract.ts';
import type {IntakeSite} from './intakePolicy.ts';
import {INTAKE_RECIPIENTS} from './intakePolicy.ts';
import {INTAKE_CHANNELS,type IntakeChannel,type IntakeDeliveryReason} from './intakeDeliveryPolicy.ts';
import {intakeDeliveryEnvelope,intakeOperationKey,intakeLeadKey,type IntakeDeliveryEnvelope} from './intakeDeliveryPayload.ts';

export interface IntakeChannelState {status:string;recipient?:string;attempts:number;reason?:IntakeDeliveryReason;nextAttemptAt?:string;firstAttemptAt?:string;providerId?:string;acceptedAt?:string;envelope?:IntakeDeliveryEnvelope;envelopeDigest?:string;retryWindowMs?:number;transportScope?:string}
interface Job {schema:1;projectId:string;revision:number;channels:Record<IntakeChannel,IntakeChannelState>}
export interface IntakeTransport {
 /** Zero means uncertain attempts must never be replayed. This window is pinned on first attempt. */
 retryWindowMs:number;
 /** Opaque fingerprint of the provider/account/sender scope; never store credentials. */
 identityScope:string;
 readiness:(snapshot:IntakeSnapshot)=>Promise<IntakeDeliveryReason|null>;
 /** Deterministic validation only; it must not perform I/O or side effects. */
 validate?:(envelope:IntakeDeliveryEnvelope)=>IntakeDeliveryReason|null;
 /** Read/verify originals and freeze the complete message before recording send intent. */
 prepare?:(snapshot:IntakeSnapshot,envelope:IntakeDeliveryEnvelope)=>Promise<IntakeDeliveryEnvelope>;
 send:(envelope:IntakeDeliveryEnvelope)=>Promise<string>;
}
export interface IntakeDeliveryDependencies {query:IntakeQuery;site:IntakeSite;transports:Record<IntakeChannel,IntakeTransport>;now?:()=>number;suppressed?:(s:IntakeSnapshot)=>boolean;timeoutMs?:number;budgetMs?:number}
const MAX_ATTEMPTS=6,LEASE_SECONDS=240;
const terminal=new Set(['accepted','received','not-requested','suppressed','unknown','failed']);
const iso=(now:number)=>new Date(now).toISOString();
const retrySafe=(s:IntakeChannelState,now:number)=>!!s.firstAttemptAt&&s.attempts<MAX_ATTEMPTS&&(s.retryWindowMs||0)>0&&now-Date.parse(s.firstAttemptAt)<s.retryWindowMs!;

/** Future retries and interrupted leases keep the existing signed driver awake.
 * Hourly configuration holds do not. $1 is the receiving site's brand id. */
export const INTAKE_DRIVER_PENDING_SQL=`(SELECT count(*) FROM p5_estimator_work w JOIN p5_estimator_drafts d ON d.id=w.draft_id
 WHERE w.work_key LIKE 'intake-delivery-v1:%' AND d.brand=$1
 AND EXISTS (SELECT 1 FROM jsonb_each(w.payload->'channels') c WHERE c.value->>'status' IN ('pending','retry','sending')
 OR (c.value->>'status'='blocked' AND (c.value->>'nextAttemptAt' IS NULL OR (c.value->>'nextAttemptAt')::timestamptz<=now()))))`;
export async function independentDeliveryPasses(intake:()=>Promise<unknown>,legacy:()=>Promise<unknown>){
 try{await intake();}finally{await legacy();}
}

/** Claim one durable revision at a time, using the existing work-table lease.
 * Provider calls are outside SQL transactions. Every side effect first records a fenced intent. */
export const CLAIM_INTAKE_DELIVERY=`WITH candidate AS (
 SELECT w.draft_id,w.work_key FROM p5_estimator_work w JOIN p5_estimator_drafts d ON d.id=w.draft_id
 WHERE w.work_key LIKE 'intake-delivery-v1:%' AND d.brand=$1
 AND (w.lease_until IS NULL OR w.lease_until<now())
 AND EXISTS (SELECT 1 FROM jsonb_each(w.payload->'channels') c WHERE c.value->>'status' IN ('pending','blocked','retry','sending')
 AND (c.value->>'nextAttemptAt' IS NULL OR (c.value->>'nextAttemptAt')::timestamptz<=$3::timestamptz))
 ORDER BY w.updated_at,w.draft_id,w.work_key FOR UPDATE OF w SKIP LOCKED LIMIT 1
) UPDATE p5_estimator_work w SET lease_token=$2,lease_until=now()+make_interval(secs=>${LEASE_SECONDS}),updated_at=now()
 FROM candidate c WHERE w.draft_id=c.draft_id AND w.work_key=c.work_key RETURNING w.draft_id,w.work_key,w.payload`;

export function intakeDeliveryWorker(deps:IntakeDeliveryDependencies){
 const now=deps.now||Date.now;
 async function run(limit=2){
  let processed=0;const bounded=Math.max(0,Math.min(4,Math.floor(limit)||0)),deadline=now()+Math.max(1,Math.min(deps.budgetMs||20000,60000));
  for(let i=0;i<bounded;i++){
   if(now()>=deadline)break;
   const token=randomUUID(),[row]=await deps.query(CLAIM_INTAKE_DELIVERY,[deps.site,token,iso(now())]);if(!row)break;
   const draftId=String(row.draft_id),workKey=String(row.work_key),job=row.payload as Job;
   const persist=async()=>{const rows=await deps.query(`UPDATE p5_estimator_work SET payload=$4::jsonb,lease_until=now()+make_interval(secs=>${LEASE_SECONDS}),updated_at=now() WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3 AND lease_until>now() RETURNING draft_id`,[draftId,workKey,token,JSON.stringify(job)]);if(!rows.length)throw new Error('intake-delivery-lease-lost');};
   try{
    const [stored]=await deps.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draftId,snapshotKey(job.revision)]);
    const s=stored?.payload?.snapshot as IntakeSnapshot|undefined;
    const valid=!!s&&s.currentSite===deps.site&&s.draftId===draftId&&s.projectId===job.projectId&&s.revision===job.revision&&workKey===deliveryKey(job.revision)&&(()=>{const {savedAt,...input}=s;void savedAt;return intakeDigest(input)===stored?.payload?.digest;})();
    for(const channel of INTAKE_CHANNELS){
     if(now()>=deadline)break;
     const state=job.channels[channel],at=now(),transport=deps.transports[channel];
     if(terminal.has(state.status)||Date.parse(state.nextAttemptAt||'')>at)continue;
     if(!valid||!s){state.status='failed';state.reason='snapshot-conflict';await persist();continue;}
     // Recover an interrupted invocation conservatively before any readiness or suppression change.
     if((state.status==='sending'||state.status==='retry'||state.attempts>0)&&(!retrySafe(state,at)||state.transportScope!==transport.identityScope||transport.retryWindowMs<=0||at-Date.parse(state.firstAttemptAt||'')>=transport.retryWindowMs)){
      state.status='unknown';state.reason=state.attempts>=MAX_ATTEMPTS?'attempt-limit':'uncertain-send';await persist();continue;
     }
     const expected=channel==='customer'?s.contact.email:channel==='team'?INTAKE_RECIPIENTS[s.currentSite]:undefined;
     if(state.recipient!==expected){state.status='failed';state.reason='snapshot-conflict';await persist();continue;}
     if(deps.suppressed?.(s)&&state.attempts===0){state.status='suppressed';state.reason='synthetic-suppressed';await persist();continue;}
     let reason:IntakeDeliveryReason|null;
     try{reason=await transport.readiness(s);}catch{reason='configuration-missing';}
     if(reason){state.status='blocked';state.reason=reason;state.nextAttemptAt=iso(at+60*60*1000);await persist();continue;}
     try{
      if(!state.envelope){
       const envelope=intakeDeliveryEnvelope(s,channel,stored!.payload.digest);
       state.envelope=transport.prepare?await transport.prepare(s,envelope):envelope;
       state.envelopeDigest=intakeDigest(state.envelope);
      }
      if(state.envelopeDigest!==intakeDigest(state.envelope)||state.envelope.snapshotDigest!==stored!.payload.digest||state.envelope.key!==intakeOperationKey(s,channel)||state.envelope.leadKey!==intakeLeadKey(s.projectId)||state.envelope.channel!==channel||state.envelope.email?.to!==expected)throw new Error('snapshot-conflict');
      const invalid=transport.validate?.(state.envelope);if(invalid){state.status='failed';state.reason=invalid;await persist();continue;}
     }catch(error){
      const fileUnavailable=error instanceof Error&&['file-delivery-unavailable','estimate-link-secret-unavailable'].includes(error.message);
      state.status=fileUnavailable?'blocked':'failed';state.reason=fileUnavailable?'file-delivery-unavailable':error instanceof Error&&error.message==='snapshot-conflict'?'snapshot-conflict':'payload-review';
      if(fileUnavailable)state.nextAttemptAt=iso(now()+60*60*1000);
      await persist();continue;
     }
     // Persist the exact provider payload, key and transport retry contract before calling the adapter.
     state.retryWindowMs=state.retryWindowMs===undefined?transport.retryWindowMs:Math.min(state.retryWindowMs,transport.retryWindowMs);
     const replay=state.attempts>0;
     if(replay&&(!retrySafe(state,now())||state.transportScope!==transport.identityScope)){state.status='unknown';state.reason='uncertain-send';await persist();continue;}
     if(now()>=deadline)break;
     state.status='sending';state.reason=undefined;state.nextAttemptAt=undefined;state.firstAttemptAt||=iso(now());
     state.transportScope=transport.identityScope;
     state.attempts++;await persist();
     // Readiness and SQL may consume the remaining provider window. Recheck at dispatch.
     if(replay&&now()-Date.parse(state.firstAttemptAt)>=state.retryWindowMs){state.status='unknown';state.reason='uncertain-send';await persist();continue;}
     if(now()>=deadline){
      // This invocation has not called a provider. Keep prior uncertainty, or restore pending.
      state.attempts--;state.status=replay?'retry':'pending';if(!replay)state.firstAttemptAt=undefined;
      state.nextAttemptAt=iso(now()+60000);await persist();break;
     }
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{
      const providerId=await Promise.race([transport.send(state.envelope!),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('uncertain-send')),Math.max(1,Math.min(deps.timeoutMs||45000,45000,deadline-now())));})]);
      if(typeof providerId!=='string'||!providerId.trim()||providerId.length>256||/^(noop|skipped)$/i.test(providerId))throw new Error('uncertain-send');
      state.status='accepted';state.providerId=providerId;state.acceptedAt=iso(now());state.reason='provider-accepted';
     }catch{
      const safe=retrySafe(state,now());state.status=safe?'retry':'unknown';state.reason=safe?'safe-retry':state.attempts>=MAX_ATTEMPTS?'attempt-limit':'uncertain-send';
      if(safe)state.nextAttemptAt=iso(now()+Math.min(3600000,60000*2**(state.attempts-1)));
     }finally{if(timer)clearTimeout(timer);}
     // A lost acknowledgement leaves the durable pre-call sending intent. Do not replay here.
     await persist();
    }
    processed++;
   }finally{await deps.query('UPDATE p5_estimator_work SET lease_token=NULL,lease_until=NULL WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3',[draftId,workKey,token]);}
  }
  return {processed};
 }
 return {run};
}
