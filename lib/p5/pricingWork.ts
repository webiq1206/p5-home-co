import {MODEL_POLICY_VERSION} from './modelPolicy.ts';
import {SERVER_BUDGET_MS,remainingBudget,withinDeadline,ProcessingDeadlineError,isProcessingDeadline} from './processingBudget.ts';
import {createHash} from 'node:crypto';
import {recordEvent} from './events.ts';
import {saveLearnedLines,readLearnedLines,learnedCostRules} from './learnedBook.ts';
import {databasePricingCache,pricingCacheEnabled} from './pricingCache.ts';
import {claimWork,writeWork,releaseWork,renewWork} from './workStore.ts';
import {priceCompleteScope,requestPricing,type PricingReply,type PricingRequest,PRICING_STAGE_MAX_MS} from './scopePricing.ts';
import {PricingPending,PricingStageTimeout,PRICING_UNAVAILABLE} from './pricingProgress.ts';
import {beginPricingRepair,type PricingRepairState} from './repairClock.ts';
import type {ReviewedScope} from './scope.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import {readRegionalRates,saveRegionalRates} from './regionalRates.ts';
import {pricingActivity,type ProcessingStatus} from './processingStatus.ts';
import type {PricingIdentity} from './pricingLedger.ts';
import {assertProjectSourceCoverage,SOURCE_COVERAGE_REQUIRED} from './documentServiceClient.ts';

export function pricingWorkKey(scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt:Date){
 const signature={modelPolicy:MODEL_POLICY_VERSION,pricingDate:pricingAt.toISOString().slice(0,10),text:scope.text,answers:scope.answers,extraction:scope.extraction,uploads:scope.uploads,uncertainFields:scope.uncertainFields,configuration};
 return 'pricing-v11-'+createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}
/** Saved replies are keyed by stage content, so independent stages may run in
 * parallel and a resumed request reuses exactly the work that finished. */
export function pricingReplyKey(instructions:string,input:unknown,search:boolean){
 return createHash('sha256').update(JSON.stringify([MODEL_POLICY_VERSION,instructions,search,input])).digest('hex');
}
type Payload=PricingRepairState&{replies:Record<string,PricingReply>;failures?:number;completed?:number;regionalRates?:EstimatorConfiguration['regionalRates'];processing?:ProcessingStatus;pricingAt?:string;busyWaitMs?:number};
export async function priceSavedScope(id:string,scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt=new Date(),deadline=Date.now()+SERVER_BUDGET_MS,identity?:PricingIdentity){
 // Construction prices only a project whose every source page was verified;
 // the other brands return a partial read for manual review instead.
 if(SOURCE_COVERAGE_REQUIRED)assertProjectSourceCoverage(scope.uploads,scope.extraction);
 remainingBudget(deadline);
 const workKey=pricingWorkKey(scope,configuration,pricingAt);
 const [regional,learned]=await Promise.all([readRegionalRates(scope.answers.location||'',pricingAt),readLearnedLines()]);
 const claimed=await claimWork(id,workKey,{replies:{},regionalRates:[...regional,...learnedCostRules(learned,scope.answers.service||'',{location:scope.answers.location||'',finish:scope.answers.finish},pricingAt)]},290);
 if(!claimed)throw new PricingPending('Your pricing check is already running. Waiting for its saved result...',10000);
 const payload=claimed.payload as Payload;
 // Freeze the pricing timestamp across requests. Rate freshness and generated
 // evidence dates must not drift merely because the customer resumed a draft.
 if(payload.pricingAt)pricingAt=new Date(payload.pricingAt);
 else payload.pricingAt=pricingAt.toISOString();
 if(!payload.replies||Array.isArray(payload.replies))payload.replies={};
 configuration={...configuration,regionalRates:payload.regionalRates||[]};
 let saving=Promise.resolve();
 const persist=()=>{saving=saving.then(async()=>{try{await writeWork(id,workKey,claimed.token,payload);}catch{throw new PricingPending('Pricing progress could not be saved yet. Please retry to continue.',0);}});return saving;};
 const ordinals:Record<string,number>={};
 const staged:PricingRequest=async(instructions,input,search,remainingMs)=>{
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
  const saved=payload.replies[key]||payload.replies[legacy]||(oldTimeout?.timeouts?oldTimeout:undefined);
  if(saved){
    // Research uses its existing allowance fallback and large mapping batches
    // keep their smaller saved children. A small batch or another stage must
    // actually retry, or replaying its timeout marker loops forever without
    // advancing the attempt count. Only actual provider timeouts count.
    const timeouts=(saved as {timeouts?:number}).timeouts||0;
    if((saved as {outputLimited?:boolean}).outputLimited)throw new PricingStageTimeout('pricing-stage-output-limit');
    if(timeouts>=3)throw new PricingStageTimeout('pricing-stage-exhausted');
    if(timeouts&&(search||(batchIds&&batchIds.length>3)))throw new PricingStageTimeout('pricing-stage-timeout');
    if(!timeouts)return saved;
  }
  // A pass ends between stages, never inside one. A stage that has started
  // keeps its whole allowance and is saved, so the next pass resumes after it
  // instead of repeating it; the job lifetime bounds the total.
  remainingBudget(deadline);
  let reply:PricingReply;
  // Stamp when THIS stage started and how many have finished, so a long
  // research call still visibly moves instead of sitting on one label.
  payload.processing={...activity,completedSteps:payload.completed||0,stageStartedAt:new Date().toISOString()};await persist();
  const phase=activity.phase;
  const allowance=search?Math.max(5000,Math.min(remainingMs,PRICING_STAGE_MAX_MS)):PRICING_STAGE_MAX_MS;
  const started=Date.now();
  const elapsed=()=>((Date.now()-started)/1000).toFixed(1);
  try{reply=await withinDeadline(()=>requestPricing(instructions,input,search,allowance,identity),started+allowance);}
  catch(error){
   if(isProcessingDeadline(error)){
    console.error(`[p5-pricing] ${phase} stage exceeded its ${Math.round(allowance/1000)}s allowance after ${elapsed()}s`);
    // Every timed-out stage is remembered with a count, so a replay never
    // repeats the identical oversized call: research falls back, a mapping
    // batch is halved by the caller, other stages pause and resume.
    const prior=(saved as unknown as {timeouts?:number}|undefined)?.timeouts||0;
    payload.replies[key]={value:null,sourceUrls:[],timedOut:true,timeouts:prior+1} as unknown as PricingReply;await persist();
    throw new PricingStageTimeout(prior+1>=3?'pricing-stage-exhausted':'pricing-stage-timeout');
   }
   // A failed published-cost search is not a reason to stop pricing: the caller may use a labeled planning average instead.
   if(search){console.error(`[p5-pricing] research failed after ${elapsed()}s: ${error instanceof Error?error.message:String(error)}`);throw new PricingStageTimeout(error instanceof Error?error.message:'pricing-search-unavailable');}
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
   const busy=/^pricing-provider-unavailable:(?:429|5\d\d)\b/.test(message);
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
  payload.failures=0;payload.replies[key]=reply;payload.completed=(payload.completed||0)+1;
  if(payload.processing)payload.processing={...payload.processing,completedSteps:payload.completed};
  await persist();
  return reply;
 };
 // The saved-stage lease outlives a pass; keep it renewed while this pass runs.
 const renew=setInterval(()=>{void renewWork(id,workKey,claimed.token,290).catch(()=>{});},60_000);renew.unref?.();
 try{const priced=await priceCompleteScope(scope,configuration,staged,pricingAt,deadline,pricingCacheEnabled()?databasePricingCache():undefined,payload.busyWaitMs||0,()=>beginPricingRepair(payload,persist,payload.busyWaitMs||0));if(priced.customer.range&&priced.internal&&'costBookSnapshot' in priced.internal){await saveRegionalRates(id,scope.answers.location||'',priced.internal.costBookSnapshot?.rules||[]);await saveLearnedLines(priced.internal.costBookSnapshot?.rules||[],scope.answers.service||'',id,{location:scope.answers.location||'',finish:scope.answers.finish},pricingAt).catch(error=>console.error('[p5-book] learned lines were not saved:',error instanceof Error?error.message:error));}return priced;}finally{clearInterval(renew);await releaseWork(id,workKey,claimed.token);}
}
