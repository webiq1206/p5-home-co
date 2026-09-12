import {createHash} from 'node:crypto';
import {claimWork,writeWork,releaseWork} from './workStore';
import {priceCompleteScope,requestPricing,type PricingReply,type PricingRequest} from './scopePricing';
import {PricingPending} from './pricingProgress';
import type {ReviewedScope} from './scope';
import type {EstimatorConfiguration} from './costBook';
import {readRegionalRates,saveRegionalRates} from './regionalRates';
import {pricingActivity,type ProcessingStatus} from './processingStatus';

export function pricingWorkKey(scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt:Date){
 const signature={pricingDate:pricingAt.toISOString().slice(0,10),text:scope.text,answers:scope.answers,extraction:scope.extraction,uploads:scope.uploads,uncertainFields:scope.uncertainFields,configuration};
 return 'pricing-v6-'+createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}
export async function priceSavedScope(id:string,scope:ReviewedScope,configuration:EstimatorConfiguration,pricingAt=new Date()){
 const workKey=pricingWorkKey(scope,configuration,pricingAt);
 const claimed=await claimWork(id,workKey,{replies:[],regionalRates:await readRegionalRates(scope.answers.location||'',pricingAt)},290);
 if(!claimed)throw new PricingPending('Your pricing check is already running. Waiting for its saved result...',10000);
 const payload=claimed.payload as {replies:PricingReply[];failures?:number;regionalRates?:EstimatorConfiguration['regionalRates'];processing?:ProcessingStatus};
 configuration={...configuration,regionalRates:payload.regionalRates||[]};
 const persist=async()=>{try{await writeWork(id,workKey,claimed.token,payload);}catch{throw new PricingPending('Pricing progress could not be saved yet. Please retry to continue.',0);}};
 let index=0,performed=false;
 const staged:PricingRequest=async(instructions,input,search,remainingMs)=>{
  const step=index++;
  if(payload.replies[step])return payload.replies[step];
  if(performed)throw new PricingPending(search?'Scope progress saved. Researching remaining item rates...':'Pricing progress saved. Continuing the scope and coverage checks...');
  let reply:PricingReply;
  payload.processing=pricingActivity(instructions,input,search);await persist();
  try{reply=await requestPricing(instructions,input,search,remainingMs);}catch{payload.failures=(payload.failures||0)+1;await persist();throw new PricingPending('The pricing provider needs another attempt. Your completed pricing steps are saved. Please retry to continue.',payload.failures>=2?0:10000);}
  payload.failures=0;payload.replies[step]=reply;
  await persist();
  performed=true;
  return reply;
 };
 try{const priced=await priceCompleteScope(scope,configuration,staged,pricingAt);if(priced.customer.range&&priced.internal&&'costBookSnapshot' in priced.internal)await saveRegionalRates(id,scope.answers.location||'',priced.internal.costBookSnapshot?.rules||[]);return priced;}finally{await releaseWork(id,workKey,claimed.token);}
}
