import {canonical,sha} from './recoveryEpoch.mjs';
export const pricingReplayRequestHash=(instructions,input,search)=>sha(canonical({instructions,input,search}));
export const shortlistReplayRequestHash=(tasks,rates)=>sha(canonical({tasks,rates}));
/** Replay only a pinned, ordered transcript. There is deliberately no fetch or
 * fallback argument: missing, changed or extra stages cannot trigger spending.
 * Digests establish identity, not authenticity; the runner must obtain receipts
 * from the actual qualified run, never construct expected model answers. */
export function exactPricingReplay({transcript,expectedSha256,expectedModel}){
 if(sha(canonical(transcript))!==expectedSha256||transcript.version!==1||transcript.model!==expectedModel||!Array.isArray(transcript.stages)||!Array.isArray(transcript.shortlists))throw Error('pricing-replay:identity-mismatch');
 const stages=structuredClone(transcript.stages),shortlists=structuredClone(transcript.shortlists);let next=0,shortlistNext=0;
 for(const stage of stages)if(!/^[a-f0-9]{64}$/.test(stage.requestSha256)||sha(canonical(stage.reply))!==stage.replySha256||!Array.isArray(stage.reply?.sourceUrls)||!Object.hasOwn(stage.reply,'value'))throw Error('pricing-replay:receipt-invalid');
 const request=async(instructions,input,search)=>{
  const stage=stages[next];
  if(!stage||pricingReplayRequestHash(instructions,input,search)!==stage.requestSha256)throw Error('pricing-replay:stage-mismatch');
  next++;return structuredClone(stage.reply);
 };
 const selectBook=async(tasks,rates)=>{
  const stage=shortlists[shortlistNext];
  if(!stage||shortlistReplayRequestHash(tasks,rates)!==stage.requestSha256||sha(canonical(stage.entries))!==stage.replySha256||!Array.isArray(stage.entries))throw Error('pricing-replay:shortlist-mismatch');
  const ids=new Set(tasks.map(t=>t.id)),codes=new Set(rates.map(r=>r.code));
  if(stage.entries.some(row=>!Array.isArray(row)||row.length!==2||!ids.has(row[0])||!Array.isArray(row[1])||row[1].some(code=>!codes.has(code))))throw Error('pricing-replay:shortlist-invalid');
  shortlistNext++;return new Map(structuredClone(stage.entries));
 };
 return {request,selectBook,assertComplete(){if(next!==stages.length||shortlistNext!==shortlists.length)throw Error('pricing-replay:unused-receipts');return {replayedStages:next,replayedShortlists:shortlistNext,providerNetworkCalls:0};}};
}
