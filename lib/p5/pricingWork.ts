import {SERVER_BUDGET_MS,remainingBudget,withinDeadline,ProcessingDeadlineError} from './processingBudget.ts';
import {createHash} from 'node:crypto';
import {claimWork,writeWork,releaseWork} from './workStore';
import {priceCompleteScope,requestPricing,type PricingReply,type PricingRequest} from './scopePricing';
import {PricingPending,PricingStageTimeout} from './pricingProgress';
import type {ReviewedScope} from './scope';
import type {EstimatorConfiguration} from './costBook';
import {readRegionalRates,saveRegionalRates} from './regionalRates';
import {pricingActivity,type ProcessingStatus} from './processingStatus';

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
  let reply:PricingReply;
  payload.processing=pricingActivity(instructions,input,search);await persist();
  const allowance=Math.min(remainingMs,remainingBudget(deadline));
  const stageDeadline=Date.now()+allowance;
  try{reply=await withinDeadline(()=>requestPricing(instructions,input,search,allowance),stageDeadline);}
  catch(error){
   if(error instanceof ProcessingDeadlineError){if(Date.now()>=deadline-250)throw error;throw new PricingStageTimeout();}
   // A failed published-cost search is not a reason to stop pricing: the caller may use a labeled planning average instead.
   if(search)throw new PricingStageTimeout(error instanceof Error?error.message:'pricing-search-unavailable');
   payload.failures=(payload.failures||0)+1;await persist();
   throw new PricingPending('The pricing provider needs another attempt. Your completed pricing steps are saved. Please retry to continue.',payload.failures>=2?0:10000);
  }
  payload.failures=0;payload.replies[key]=reply;
  await persist();
  return reply;
 };
 try{const priced=await priceCompleteScope(scope,configuration,staged,pricingAt,deadline);if(priced.customer.range&&priced.internal&&'costBookSnapshot' in priced.internal)await saveRegionalRates(id,scope.answers.location||'',priced.internal.costBookSnapshot?.rules||[]);return priced;}finally{await releaseWork(id,workKey,claimed.token);}
}
