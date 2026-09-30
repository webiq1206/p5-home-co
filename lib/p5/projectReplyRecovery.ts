import {projectHash} from './projectRecord.ts';
import {assertEstimatorModel,ESTIMATOR_MODEL} from './modelPolicy.ts';
import type {PricingReply} from './scopePricing.ts';

/** Reuse the provider reply, never an old acceptance decision. The current
 * workflow still validates and reviews it. Conflicting saved replies are not
 * resolved by choosing the more favorable result. */
export function recoverProjectReply(rows:{work_key:string;payload:unknown}[],key:string,instructions:string,input:unknown){
 const candidates: {workKey:string;reply:PricingReply}[]=[];
 for(const row of rows){
  const saved=row.payload as {requests?:Record<string,{instructions?:string;input?:unknown}>;replies?:Record<string,PricingReply>}|null;
  const request=saved?.requests?.[key],reply=saved?.replies?.[key];
  if(!request||!Object.hasOwn(request,'input')||request.input===undefined||!reply||reply.value===undefined||request.instructions!==instructions||projectHash(request.input)!==projectHash(input))continue;
  if(projectHash({instructions:request.instructions,context:request.input,search:false})!==key)continue;
  if(reply.provider!=='openai'||reply.model!==ESTIMATOR_MODEL||!Array.isArray(reply.sourceUrls)||!Array.isArray(reply.providerRequestIds)||!reply.providerRequestIds.length||reply.providerRequestIds.some(id=>typeof id!=='string'||!id.trim()))continue;
  try{assertEstimatorModel(reply.responseModel);}catch{continue;}
  candidates.push({workKey:row.work_key,reply});
 }
 if(!candidates.length||new Set(candidates.map(candidate=>projectHash(candidate.reply))).size!==1)return null;
 return candidates[0];
}
