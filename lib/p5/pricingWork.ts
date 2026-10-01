import {withSupportedServiceBook} from './planningBooks.ts';
import {MODEL_POLICY_VERSION,ESTIMATOR_MODEL,ESTIMATOR_PROVIDER} from './modelPolicy.ts';
import {pricingFailureDetails} from './pricingDiagnostics.ts';
import {ESTIMATOR_VERSION} from './version.ts';
import {SERVER_BUDGET_MS,remainingBudget,withinDeadline,ProcessingDeadlineError,isProcessingDeadline} from './processingBudget.ts';
import {createHash} from 'node:crypto';
import {recordEvent} from './events.ts';
import {saveLearnedLines,readLearnedLines,learnedCostRules,learnedResearchLeads,saveSupportedServiceBook} from './learnedBook.ts';
import {databasePricingCache,pricingCacheEnabled} from './pricingCache.ts';
import {claimWork,writeWork,releaseWork,renewWork,readSavedWorkReply} from './workStore.ts';
import {priceCompleteScope,requestPricing,type PricingReply,type PricingRequest,PRICING_STAGE_MAX_MS,RESEARCH_STAGE_MS} from './scopePricing.ts';
import {PricingPending,PricingStageTimeout,PRICING_UNAVAILABLE,isPricingPending,retryablePricingProviderError,expiredResearchFailure,savedPricingTimeoutReason} from './pricingProgress.ts';
import {beginPricingRepair,type PricingRepairState} from './repairClock.ts';
import type {ReviewedScope} from './scope.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import {readRegionalRates,saveRegionalRates} from './regionalRates.ts';
import {pricingActivity,type ProcessingStatus} from './processingStatus.ts';
import {pricingFingerprint,pricingRecoveryError,PricingChargeUnknownError,type PricingIdentity} from './pricingLedger.ts';
import {assertProjectSourceCoverage,SOURCE_COVERAGE_REQUIRED} from './documentServiceClient.ts';
import {shortlistBook,type ShortlistTask,type ShortlistRate} from './bookShortlist.ts';

export function pricingWorkKey(scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt:Date,estimatorVersion=ESTIMATOR_VERSION){
 // Persisting a recovered service must not change this job's identity and
 // repeat provider work when the next status request reads the saved policy.
 configuration=withSupportedServiceBook(configuration,scope.answers.service||'');
 const signature={estimatorVersion,modelPolicy:MODEL_POLICY_VERSION,pricingDate:pricingAt.toISOString().slice(0,10),text:scope.text,answers:scope.answers,extraction:scope.extraction,uploads:scope.uploads,uncertainFields:scope.uncertainFields,configuration};
 return 'pricing-v11-'+createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}
/** Saved replies are keyed by stage content, so independent stages may run in
 * parallel and a resumed request reuses exactly the work that finished. */
export function pricingReplyKey(instructions:string,input:unknown,search:boolean){
 return createHash('sha256').update(JSON.stringify([MODEL_POLICY_VERSION,instructions,search,input])).digest('hex');
}
/** A completed research stage is a prose report before JSON normalization. */
export function reusableSavedPricingReply(value:unknown):value is PricingReply{
 if(!value||typeof value!=='object')return false;
 const reply=value as PricingReply&{timeouts?:number;timedOut?:boolean;outputLimited?:boolean};
 return !reply.timeouts&&!reply.timedOut&&!reply.outputLimited&&Array.isArray(reply.sourceUrls)
   &&(reply.value!==null&&reply.value!==undefined||typeof reply.sourceReport==='string'&&reply.sourceReport.trim().length>0);
}
type RequestFailure={attempt:number;failedAt:string;causes:ReturnType<typeof pricingFailureDetails>};
type RequestTrace={fingerprint:string;provider:string;model:string;stage:string;attempt:number;startedAt:string;failedAt?:string;causes?:ReturnType<typeof pricingFailureDetails>;failures:RequestFailure[]};
type Payload=PricingRepairState&{replies:Record<string,PricingReply>;requests?:Record<string,RequestTrace>;shortlists?:Record<string,Record<string,string[]>>;failures?:number;completed?:number;regionalRates?:EstimatorConfiguration['regionalRates'];researchLeads?:EstimatorConfiguration['researchLeads'];processing?:ProcessingStatus;pricingAt?:string;busyWaitMs?:number};
export async function priceSavedScope(id:string,scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt=new Date(),deadline=Date.now()+SERVER_BUDGET_MS,identity?:PricingIdentity){
 // P5 and Construction price only a project whose every source page was verified;
 // the other brands return a partial read for manual review instead.
 if(SOURCE_COVERAGE_REQUIRED)assertProjectSourceCoverage(scope.uploads,scope.extraction);
 remainingBudget(deadline);
 await saveSupportedServiceBook(configuration,scope.answers.service||'');
 const workKey=pricingWorkKey(scope,configuration,pricingAt);
 const [regional,learned]=await Promise.all([readRegionalRates(scope.answers.location||'',pricingAt),readLearnedLines()]);
 const claimed=await claimWork(id,workKey,{replies:{},researchLeads:learnedResearchLeads(learned,scope.answers.service||'',{location:scope.answers.location||'',finish:scope.answers.finish}),regionalRates:[...regional,...learnedCostRules(learned,scope.answers.service||'',{location:scope.answers.location||'',finish:scope.answers.finish},pricingAt)]},290);
 if(!claimed)throw new PricingPending('Your pricing check is already running. Waiting for its saved result...',10000);
 const payload=claimed.payload as Payload;
 // Freeze the pricing timestamp across requests. Rate freshness and generated
 // evidence dates must not drift merely because the customer resumed a draft.
 if(payload.pricingAt)pricingAt=new Date(payload.pricingAt);
 else payload.pricingAt=pricingAt.toISOString();
 if(!payload.replies||Array.isArray(payload.replies))payload.replies={};
 configuration={...configuration,researchLeads:payload.researchLeads||[],regionalRates:(payload.regionalRates||[]).filter(rule=>rule.estimatingBasis==='sourced-market-average')};
 let saving=Promise.resolve();
 const persist=()=>{saving=saving.then(async()=>{try{await writeWork(id,workKey,claimed.token,payload);}catch{throw new PricingPending('Pricing progress could not be saved yet. Please retry to continue.',0);}});return saving;};
 // A new shortlist changes the mapping request hash even when the scope is
 // unchanged. Persist it before mapping so retries reuse finished work and
 // retain their actual attempt counts. An empty fallback is stable too.
 const selectBook=async(tasks:readonly ShortlistTask[],rates:readonly ShortlistRate[])=>{
  const key=createHash('sha256').update(JSON.stringify([MODEL_POLICY_VERSION,tasks,rates])).digest('hex');
  const saved=payload.shortlists?.[key];
  if(saved)return new Map(Object.entries(saved));
  remainingBudget(deadline);
  const selected=await shortlistBook(tasks,rates);
  payload.shortlists={...payload.shortlists,[key]:Object.fromEntries(selected)};
  await persist();
  return selected;
 };
 const ordinals:Record<string,number>={};
 const staged:PricingRequest=async(instructions,input,search)=>{
  const activity=pricingActivity(instructions,input,search);
  // Keep old positions only to retain timeout counts during migration. A
  // successful reply requires an exact request identity, including evidence,
  // quantities, rates and instructions, regardless of execution order.
  const ordinal=(ordinals[activity.phase]=(ordinals[activity.phase]||0)+1);
  // Mapping batches are keyed by WHAT they map, not by the order they ran in.
  // They now run concurrently, and a batch that times out is split in half
  // and retried; positional keys would make those halves collide with saved
  // replies of other batches. These old keys are used for timeout counts only.
  const batch=(input as {taskBatch?:{id:string}[];repairInstruction?:string}|null);
  const batchIds=activity.phase==='mapping'&&Array.isArray(batch?.taskBatch)?batch!.taskBatch.map(t=>t.id).sort():null;
  const positional=batchIds?`mapping:${batch?.repairInstruction?'repair:':''}${createHash('sha256').update(JSON.stringify(batchIds)).digest('hex').slice(0,24)}`:`${activity.phase}#${ordinal}`;
  const legacy=pricingReplyKey(instructions,input,search);
  const key=`content-v1:${legacy}`;
  const oldTimeout=payload.replies[positional] as (PricingReply&{timeouts?:number})|undefined;
  let saved=payload.replies[key]||payload.replies[legacy]||(oldTimeout?.timeouts?oldTimeout:undefined);
  if(!reusableSavedPricingReply(saved)){
    const prior=await readSavedWorkReply(id,[key,legacy]);
    if(reusableSavedPricingReply(prior)){saved=prior;payload.replies[key]=prior;await persist();}
  }
  if(saved&&!(search&&expiredResearchFailure(saved))){
    // Large mapping batches keep their smaller saved children. Deadline
    // failures, including research, retry under the persisted attempt limit.
    const timeouts=(saved as {timeouts?:number}).timeouts||0;
    const timeoutReason=savedPricingTimeoutReason(saved,search,Boolean(batchIds&&batchIds.length>3));
    if(timeoutReason)throw new PricingStageTimeout(timeoutReason);
    if(!timeouts&&reusableSavedPricingReply(saved))return saved;
  }
  // A pass ends between stages, never inside one. A stage that has started
  // keeps its whole allowance and is saved, so the next pass resumes after it
  // instead of repeating it; the job lifetime bounds the total.
  remainingBudget(deadline);
  // Corrective inputs have different fingerprints. Bound failed dispatches
  // across the whole saved job, so changing inputs cannot reset recovery.
  const failedDispatches=Object.values(payload.requests||{}).reduce((sum,trace)=>sum+(trace.failures?.length||0),0);
  if(failedDispatches>=12)throw new PricingPending('Your project and completed work are saved. Automatic pricing recovery reached its limit and needs review.',0,true);
  let reply:PricingReply;
  // Stamp when THIS stage started and how many have finished, so a long
  // research call still visibly moves instead of sitting on one label.
  payload.processing={...activity,completedSteps:payload.completed||0,stageStartedAt:new Date().toISOString()};await persist();
  const phase=activity.phase;
  // The pass deadline admits a stage; it must not shrink an admitted search
  // to the last few seconds of the pass. Its completed reply is checkpointed.
  const allowance=search?Math.max(5000,Math.min(RESEARCH_STAGE_MS,PRICING_STAGE_MAX_MS)):PRICING_STAGE_MAX_MS;
  const started=Date.now();
  // Persist the exact link before dispatch. A response hash alone cannot be
  // inverted into the separately hashed charge-ledger identity after failure.
  payload.requests||={};
  const trace:RequestTrace={fingerprint:pricingFingerprint(ESTIMATOR_PROVIDER,instructions,input,search,identity),provider:ESTIMATOR_PROVIDER,model:ESTIMATOR_MODEL,stage:phase,attempt:(payload.requests[key]?.attempt||0)+1,startedAt:new Date(started).toISOString(),failures:[...(payload.requests[key]?.failures||[])]};
  payload.requests[key]=trace;await persist();
  const elapsed=()=>((Date.now()-started)/1000).toFixed(1);
  const checkpoint=async(completedReply:PricingReply)=>{
    const counted=reusableSavedPricingReply(payload.replies[key]);
    payload.replies[key]=completedReply;
    if(!counted)payload.completed=(payload.completed||0)+1;
    if(payload.processing)payload.processing={...payload.processing,completedSteps:payload.completed};
    await persist();
  };
  try{reply=await withinDeadline(()=>requestPricing(instructions,input,search,allowance,identity,undefined,checkpoint),started+allowance);}
  catch(error){
   trace.failedAt=new Date().toISOString();trace.causes=pricingFailureDetails(error);
   trace.failures.push({attempt:trace.attempt,failedAt:trace.failedAt,causes:trace.causes});
   await persist();
   const root=trace.causes.at(-1)!;
   void recordEvent({draftId:id,estimator:scope.answers.service||null,kind:'pricing',stage:`price-${phase}`,provider:trace.provider,model:trace.model,code:root.code,status:root.status,durationMs:Date.now()-started,attempt:trace.attempt,outcome:'failed',meta:{checkpointKey:key,ledgerFingerprint:trace.fingerprint,causes:trace.causes}});
   // A deadline or accounting failure may race the durable checkpoint. Never
   // replace an already completed response with a timeout marker or buy it again.
   const completedReply=payload.replies[key];
   if(reusableSavedPricingReply(completedReply)){await persist();return completedReply;}
   error=pricingRecoveryError(error);
   // An unresolved reservation is not an empty search and cannot improve by
   // waiting through a research cooldown. Preserve its trace and stop safely.
   if(error instanceof PricingChargeUnknownError)throw new PricingPending('Your project is saved, but this pricing request needs review before it can continue.',0,true);
   if(isPricingPending(error))throw error;
   if(isProcessingDeadline(error)){
    console.error(`[p5-pricing] ${phase} stage exceeded its ${Math.round(allowance/1000)}s allowance after ${elapsed()}s`);
    // Every timed-out stage is remembered with a count, so a replay never
    // repeats the identical oversized call: research falls back, a mapping
    // batch is halved by the caller, other stages pause and resume.
    const prior=(saved as unknown as {timeouts?:number}|undefined)?.timeouts||0;
    payload.replies[key]={value:null,sourceUrls:[],timedOut:true,timeouts:prior+1} as unknown as PricingReply;await persist();
    throw new PricingStageTimeout(prior+1>=3?'pricing-stage-exhausted':'pricing-stage-timeout');
   }
   // Remember unavailable searches instead of paying for identical failed
   // requests on every job poll. A later attempt may retry after a cooldown.
   // Rate limits and outages reach the bounded backoff below, never this path.
   if(search&&!retryablePricingProviderError(error)){
    payload.replies[key]={value:null,sourceUrls:[],timedOut:true,timeouts:1,researchFailedAt:Date.now()} as unknown as PricingReply;await persist();
    console.error(`[p5-pricing] research failed after ${elapsed()}s: ${error instanceof Error?error.message:String(error)}`);
    throw new PricingStageTimeout(error instanceof Error?error.message:'pricing-search-unavailable');
   }
   const message=error instanceof Error?error.message:String(error);
   if(/^pricing-check-incomplete:(?:max_tokens|max_output_tokens)$/.test(message)){
    const prior=(saved as {timeouts?:number}|undefined)?.timeouts||0;
    payload.replies[key]={value:null,sourceUrls:[],timeouts:prior+1,outputLimited:phase==='verification'} as unknown as PricingReply;
    await persist();
    void recordEvent({draftId:id,estimator:scope.answers.service||null,kind:'pricing',stage:`price-${phase}`,durationMs:Date.now()-started,outcome:'retry',message}).catch(()=>{});
    throw new PricingStageTimeout(prior+1>=3?'pricing-stage-exhausted':'pricing-stage-output-limit');
   }
   void recordEvent({draftId:id,estimator:scope.answers.service||null,kind:'pricing',stage:`price-${phase}`,durationMs:Date.now()-started,outcome:'retry',message}).catch(()=>{});
   // Batches run side by side, so one provider hiccup arrives as several failures in the same
   // second. They are one event: counting each ended an 18-item job in under a second.
   const state=payload as unknown as {failures?:number;lastFailureAt?:number;busyWaits?:number;busyWaitMs?:number};
   const burst=Date.now()-(state.lastFailureAt||0)<5000;state.lastFailureAt=Date.now();
   const busy=retryablePricingProviderError(error);
   if(busy&&(state.busyWaits||0)<12){
    if(!burst)state.busyWaits=(state.busyWaits||0)+1;
    // A provider rate limit usually clears in tens of seconds, so a 20 s ceiling retried too early
    // and spent the ladder without ever waiting long enough. Jitter keeps parallel batches, which
    // fail in the same second, from returning in the same second too.
    const step=Math.min(45000,5000*(state.busyWaits||1));
    const wait=Math.round(step*(1+Math.random()*0.2));
    // Remembered so the repair budget can be measured in worked time. Waiting out a busy provider
    // once cost the repair round that removes double counts, and with it the whole estimate.
    if(!burst)state.busyWaitMs=(state.busyWaitMs||0)+wait;
    await persist();console.error(`[p5-pricing] ${phase}: provider busy (${message.slice(0,60)}); waiting before continuing.`);
    throw new PricingPending('Preparing your estimate. Your completed steps are saved.',wait);}
   if(!burst)payload.failures=(payload.failures||0)+1;await persist();
   // The failure is logged with its stage so a live host can be diagnosed from its deployment logs.
   console.error(`[p5-pricing] ${phase} failed after ${elapsed()}s (attempt ${payload.failures}): ${message}`);
   // A refusal every configured provider will repeat (billing block, bad request) ends the job honestly instead of retrying for minutes.
   if(/^pricing-provider-unavailable(:4(0[0-3]|0[5-9]|1\d|2[0-8])\b|:anthropic-blocked|$)/.test(message))throw new PricingPending(PRICING_UNAVAILABLE,0,true);
   // Repeated failures of a stage end the job as a handoff rather than parking it: a person completes the estimate and the visitor is told so.
   if((payload.failures||0)>=4)throw new PricingPending(PRICING_UNAVAILABLE,0,true);
   throw new PricingPending('The pricing provider needs another attempt. Your completed pricing steps are saved. Continuing automatically.',(payload.failures||0)>=2?250:4000);
  }
  console.error(`[p5-pricing] ${phase} finished in ${elapsed()}s`);
  // Per-stage timings in the events log, so speed is reported as measured p50/p95 by stage.
  void recordEvent({draftId:id,estimator:scope.answers.service||null,kind:'pricing',stage:`price-${phase}`,durationMs:Date.now()-started,outcome:'ok',meta:{search:Boolean(search),repair:Boolean((input as {repairInstruction?:string}|null)?.repairInstruction)}}).catch(()=>{});
  payload.failures=0;
  await checkpoint(reply);
  return reply;
 };
 // The saved-stage lease outlives a pass; keep it renewed while this pass runs.
 const renew=setInterval(()=>{void renewWork(id,workKey,claimed.token,290).catch(()=>{});},60_000);renew.unref?.();
 try{const priced=await priceCompleteScope(scope,configuration,staged,pricingAt,deadline,pricingCacheEnabled()?databasePricingCache():undefined,payload.busyWaitMs||0,()=>beginPricingRepair(payload,persist,payload.busyWaitMs||0),selectBook);if(priced.customer.range&&priced.internal&&'costBookSnapshot' in priced.internal){await saveRegionalRates(id,scope.answers.location||'',priced.internal.costBookSnapshot?.rules||[]);await saveLearnedLines(priced.internal.costBookSnapshot?.rules||[],scope.answers.service||'',id,{location:scope.answers.location||'',finish:scope.answers.finish},pricingAt).catch(error=>{console.error('[p5-book] learned lines could not be saved:',error instanceof Error?error.message:error);throw new PricingPending('Your estimate is priced. Saving its new cost-book rates before completing the estimate.',4000);});}return priced;}finally{clearInterval(renew);await releaseWork(id,workKey,claimed.token);}
}
