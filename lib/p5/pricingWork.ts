import {createHash} from 'node:crypto';
import {claimWork,writeWork,releaseWork} from './workStore';
import {priceCompleteScope,requestPricing,type PricingReply,type PricingRequest} from './scopePricing';
import {PricingPending} from './pricingProgress';
import type {ReviewedScope} from './scope';
import type {EstimatorConfiguration} from './costBook';

export async function priceSavedScope(id:string,scope:ReviewedScope,configuration:EstimatorConfiguration){
 const signature={text:scope.text,answers:scope.answers,extraction:scope.extraction,uploads:scope.uploads,uncertainFields:scope.uncertainFields,configuration};
 const workKey='pricing-v2-'+createHash('sha256').update(JSON.stringify(signature)).digest('hex');
 const claimed=await claimWork(id,workKey,{replies:[]},290);
 if(!claimed)throw new PricingPending('Your pricing check is already running. Waiting for its saved result...',10000);
 const payload=claimed.payload as {replies:PricingReply[];failures?:number};
 const persist=async()=>{try{await writeWork(id,workKey,claimed.token,payload);}catch{throw new PricingPending('Pricing progress could not be saved yet. Please retry to continue.',0);}};
 let index=0,performed=false;
 const staged:PricingRequest=async(instructions,input,search,remainingMs)=>{
  const step=index++;
  if(payload.replies[step])return payload.replies[step];
  if(performed)throw new PricingPending(search?'Scope mapped. Researching remaining item rates...':'Item rates prepared. Checking complete scope coverage...');
  let reply:PricingReply;
  try{reply=await requestPricing(instructions,input,search,remainingMs);}catch{payload.failures=(payload.failures||0)+1;await persist();throw new PricingPending('The pricing provider needs another attempt. Your completed pricing steps are saved. Please retry to continue.',payload.failures>=2?0:10000);}
  payload.failures=0;payload.replies[step]=reply;
  await persist();
  performed=true;
  return reply;
 };
 try{return await priceCompleteScope(scope,configuration,staged);}finally{await releaseWork(id,workKey,claimed.token);}
}
