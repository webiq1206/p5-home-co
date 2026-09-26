import type {AnalysisFile} from './extraction.ts';
import {ESTIMATOR_MODEL} from './modelPolicy.ts';
/** Drawings and text use the same required full GPT-4.1 model. */
export const isDrawingUnit=(files:readonly AnalysisFile[])=>files.some(f=>Boolean(f.detailViews)||/detail regions|detail views|supplied whole/i.test(f.name));
export function openAiReadModel(_configured:string,_files:readonly AnalysisFile[]):string{return ESTIMATOR_MODEL;}
/** Rate-limit replies (429) from the managed OpenAI connection arrive in bursts; wait briefly and resend. */
export const RATE_LIMIT_RETRIES=Number(process.env.P5_READ_429_RETRIES||3);
export const rateLimitWaitMs=(attempt:number,retryAfterHeader:string|null)=>{
  const header=retryAfterHeader&&/^\d+(\.\d+)?$/.test(retryAfterHeader)?Number(retryAfterHeader)*1000:0;
  return Math.max(header,Math.min(8000,1500*2**attempt))+Math.floor(Math.random()*500);
};

/** Provider outages pause durable work; they never change the required model. */
export function preferredReadProvider(_files:readonly AnalysisFile[],_configured=process.env.P5_SCOPE_PROVIDER):'OpenAI'|'Anthropic'{return 'OpenAI';}
