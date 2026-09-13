import {SERVER_BUDGET_MS,remainingBudget,withinDeadline,ProcessingDeadlineError,isProcessingDeadline} from './processingBudget.ts';
import {createHash} from 'node:crypto';
import {claimWork,writeWork,releaseWork,renewWork} from './workStore.ts';
import {priceCompleteScope,requestPricing,type PricingReply,type PricingRequest,PRICING_STAGE_MAX_MS} from './scopePricing.ts';
import {PricingPending,PricingStageTimeout} from './pricingProgress.ts';
import type {ReviewedScope} from './scope.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import {readRegionalRates,saveRegionalRates} from './regionalRates.ts';
import {pricingActivity,type ProcessingStatus} from './processingStatus.ts';

export function pricingWorkKey(scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt:Date){
 const signature={pricingDate:pricingAt.toISOString().slice(0,10),text:scope.text,answers:scope.answers,extraction:scope.extraction,uploads:scope.uploads,uncertainFields:scope.uncertainFields,configuration};
 return 'pricing-v10-'+createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}
/** Saved replies are keyed by stage content, so independent stages may run in
 * parallel and a resumed request reuses exactly the work that finished. */
export function pricingReplyKey(instructions:string,input:unknown,search:boolean){
 return createHash('sha256').update(JSON.stringify([instructions,search,input])).digest('hex');
}
type Payload={replies:Record<string,PricingReply>;failures?:number;regionalRates?:EstimatorConfiguration['regionalRates'];processing?:ProcessingStatus};
export async function priceSavedScope(id:string,scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt=new Date(),deadline=Date.now()+SERVER_BUDGET_MS){
 remainingBudget(deadline);
 const workKey=pricingWorkKey(scope,configuration,pricingAt);
 const claimed=await claimWork(id,workKey,{replies:{},regionalRates:await readRegionalRates(scope.answers.location||'',pricingAt)},290);
 if(!claimed)throw new PricingPending('Your pricing check is already running. Waiting for its saved result...',10000);
 const payload=claimed.payload as Payload;
 if(!payload.replies||Array.isArray(payload.replies))payload.replies={};
 configuration={...configuration,regionalRates:payload.regionalRates||[]};
 let saving=Promise.resolve();
 const persist=()=>{saving=saving.then(async()=>{try{await writeWork(id,workKey,claimed.token,payload);}catch{throw new PricingPending('Pricing progress could not be saved yet. Please retry to continue.',0);}});return saving;};
 const staged:PricingRequest=async(instructions,input,search,remainingMs)=>{
  const key=pricingReplyKey(instructions,input,search);
  const saved=payload.replies[key];if(saved)return saved;
  // A pass ends between stages, never inside one. A stage that has started
  // keeps its whole allowance and is saved, so the next pass resumes after it
  // instead of repeating it; the job lifetime bounds the total.
  remainingBudget(deadline);
  let reply:PricingReply;
  payload.processing=pricingActivity(instructions,input,search);await persist();
  const phase=payload.processing.phase;
  const allowance=search?Math.max(5000,Math.min(remainingMs,PRICING_STAGE_MAX_MS)):PRICING_STAGE_MAX_MS;
  const started=Date.now();
  const elapsed=()=>((Date.now()-started)/1000).toFixed(1);
  try{reply=await withinDeadline(()=>requestPricing(instructions,input,search,allowance),started+allowance);}
  catch(error){
   if(isProcessingDeadline(error)){console.error(`[p5-pricing] ${phase} stage exceeded its ${Math.round(allowance/1000)}s allowance after ${elapsed()}s`);throw new PricingStageTimeout();}
   // A failed published-cost search is not a reason to stop pricing: the caller may use a labeled planning average instead.
   if(search){console.error(`[p5-pricing] research failed after ${elapsed()}s: ${error instanceof Error?error.message:String(error)}`);throw new PricingStageTimeout(error instanceof Error?error.message:'pricing-search-unavailable');}
   payload.failures=(payload.failures||0)+1;await persist();
   // The failure is logged with its stage so a live host can be diagnosed from its deployment logs.
   console.error(`[p5-pricing] ${phase} failed after ${elapsed()}s (attempt ${payload.failures}): ${error instanceof Error?error.message:String(error)}`);
   throw new PricingPending('The pricing provider needs another attempt. Your completed pricing steps are saved. Please retry to continue.',payload.failures>=2?0:4000);
  }
  console.error(`[p5-pricing] ${phase} finished in ${elapsed()}s`);
  payload.failures=0;payload.replies[key]=reply;
  await persist();
  return reply;
 };
 // The saved-stage lease outlives a pass; keep it renewed while this pass runs.
 const renew=setInterval(()=>{void renewWork(id,workKey,claimed.token,290).catch(()=>{});},60_000);renew.unref?.();
 try{const priced=await priceCompleteScope(scope,configuration,staged,pricingAt,deadline);if(priced.customer.range&&priced.internal&&'costBookSnapshot' in priced.internal)await saveRegionalRates(id,scope.answers.location||'',priced.internal.costBookSnapshot?.rules||[]);return priced;}finally{clearInterval(renew);await releaseWork(id,workKey,claimed.token);}
}
