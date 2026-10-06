import {createHash} from 'node:crypto';

/** Evidence only: never a pricing reply, permission to retry, or settlement. */
export type PricingCallEvidence={
 sequence:number; continuation:number; state:'dispatch-intent'|'headers-received'|'body-received'|'unknown';
 startedAt:string; observedAt:string;
 status:number|null; requestId:string|null; responseId:string|null; stopReason:string|null;
 allowanceMs:number; maxOutputTokens:number|null; maxSearchUses:number|null; maxFetchUses:number|null;
 maxFetchContentTokens:number|null;
 usage:{inputTokens:number|null;outputTokens:number|null;cacheReadTokens:number|null;cacheWriteTokens:number|null;cacheWrite5mTokens:number|null;cacheWrite1hTokens:number|null;webSearchRequests:number|null;webFetchRequests:number|null};
};
export type PricingEvidenceUpdate={kind:'call';call:PricingCallEvidence}|{kind:'accounting';state:'qa-broker'|'ledger-disabled'|'reserved'|'settled'|'rejected'|'unknown'};
export type PricingEvidenceSink=(update:PricingEvidenceUpdate)=>Promise<void>;
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const providerId=(value:unknown):string|null=>typeof value==='string'&&/^(?:(?:req|msg|resp)_[A-Za-z0-9_-]{1,150}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(value)?value:null;
const stop=(value:unknown):string|null=>typeof value==='string'?['end_turn','tool_use','pause_turn','max_tokens','max_output_tokens','stop_sequence','refusal','length','content_filter','completed','incomplete','failed','cancelled','in_progress','queued'].includes(value)?value:'unknown':null;
export function pricingCallEvidence(sequence:number,continuation:number,allowanceMs:number,body:Record<string,any>):PricingCallEvidence{
 const tools=Array.isArray(body.tools)?body.tools:[];
 const search=tools.find((tool:any)=>tool?.name==='web_search');
 const fetch=tools.find((tool:any)=>tool?.name==='web_fetch');
 const now=new Date().toISOString();
 return {sequence,continuation,state:'dispatch-intent',startedAt:now,observedAt:now,status:null,requestId:null,responseId:null,stopReason:null,allowanceMs,
  maxOutputTokens:count(body.max_tokens??body.max_output_tokens),maxSearchUses:count(search?.max_uses),maxFetchUses:count(fetch?.max_uses),maxFetchContentTokens:count(fetch?.max_content_tokens),
  usage:{inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,cacheWrite5mTokens:null,cacheWrite1hTokens:null,webSearchRequests:null,webFetchRequests:null}};
}
export function pricingResponseEvidence(call:PricingCallEvidence,response:Response,body?:any):PricingCallEvidence{
 const usage=body?.usage;
 return {...call,state:body===undefined?'headers-received':'body-received',observedAt:new Date().toISOString(),status:response.status,
  requestId:providerId(response.headers.get('request-id')||response.headers.get('x-request-id')),
  responseId:providerId(body?.id),stopReason:stop(body?.stop_reason??body?.incomplete_details?.reason??body?.status),
  usage:{inputTokens:count(usage?.input_tokens),outputTokens:count(usage?.output_tokens),cacheReadTokens:count(usage?.cache_read_input_tokens??usage?.input_tokens_details?.cached_tokens),
   cacheWriteTokens:count(usage?.cache_creation_input_tokens),cacheWrite5mTokens:count(usage?.cache_creation?.ephemeral_5m_input_tokens),cacheWrite1hTokens:count(usage?.cache_creation?.ephemeral_1h_input_tokens),webSearchRequests:count(usage?.server_tool_use?.web_search_requests),webFetchRequests:count(usage?.server_tool_use?.web_fetch_requests)}};
}
/** Hash untrusted task IDs; never retain descriptions, prompts or source text. */
export function pricingTaskEvidence(input:unknown){
 const record=input as {tasks?:unknown;taskBatch?:unknown}|null;
 const tasks=Array.isArray(record?.tasks)?record.tasks:Array.isArray(record?.taskBatch)?record.taskBatch:[];
 return {taskCount:tasks.length,taskIdsTruncated:tasks.length>256,taskIdHashes:tasks.slice(0,256).flatMap((task:any)=>typeof task?.id==='string'?[createHash('sha256').update(task.id).digest('hex')]:[])};
}
