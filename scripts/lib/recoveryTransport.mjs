import {canonical,sha} from './recoveryEpoch.mjs';
import {collectAnthropicResponse} from '../../services/document-service/src/anthropic-stream.mjs';
import {validateSchema} from '../../services/document-service/src/schema.mjs';
export const HAIKU_POLICY=Object.freeze({version:1,endpoint:'https://api.anthropic.com/v1/messages',model:'claude-haiku-4-5-20251001',
 contextTokens:200000,maxOutputTokens:32000,inputMicrosPerToken:1,outputMicrosPerToken:5,maxCacheWriteMicrosPerToken:2,
 pricingEvidenceSha256:'245b5d0472659075015551126902de479990475fa61deb58c5fc20ef5e51a909',
 modelEvidenceSha256:'9d3c37c0d62e0d466d461fad29a3cba34e7ea54a1d313e2a2c025864acdfe7f3'});
export const recoveryRequestPolicySha256=sha(canonical(HAIKU_POLICY));
const fail=code=>{throw Error('recovery-transport:'+code);};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
/** Standard first-party Haiku only. Reserve the FULL context ceiling, including
 * image/schema input, at the highest cache-write rate, plus max_tokens output.
 * No server tools, URL images, files, beta headers, tier/geo/speed extensions,
 * compaction or retry transport. Exact receipts replay without another dispatch.
 */
export function recoveryTransport({ledger,context,transport=fetch,credential=()=>process.env.ANTHROPIC_API_KEY}){
 let stopped=false;
 return async(endpoint,init={})=>{
  if(stopped)fail('stopped-until-review');
  if(endpoint!==HAIKU_POLICY.endpoint||init.method!=='POST'||typeof init.body!=='string'||Buffer.byteLength(init.body)>32*1024*1024)fail('request-route-or-size');
  const headers=new Headers(init.headers);if(headers.has('anthropic-beta'))fail('beta-forbidden');
  let body;try{body=JSON.parse(init.body);}catch{fail('invalid-json');}
  const allowed=new Set(['model','max_tokens','messages','system','stream','tools','tool_choice','output_config','temperature','top_p','top_k','stop_sequences']);
  if(Object.keys(body).some(key=>!allowed.has(key))||body.model!==HAIKU_POLICY.model||!integer(body.max_tokens)||body.max_tokens<1||body.max_tokens>HAIKU_POLICY.maxOutputTokens)fail('unsupported-request-policy');
  if(!Array.isArray(body.messages)||!body.messages.length)fail('messages-required');
  if(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.some(tool=>tool.type||!tool.input_schema||!tool.name)))fail('server-tools-forbidden');
  function inspect(value){
   if(!value||typeof value!=='object')return;
   if(value.cache_control&&(value.cache_control.type!=='ephemeral'||Object.keys(value.cache_control).some(k=>!['type','ttl'].includes(k))||!['5m','1h',undefined].includes(value.cache_control.ttl)))fail('unsupported-cache');
   if(['document','tool_result','web_search_tool_result','server_tool_use','container_upload'].includes(value.type))fail('unsupported-content');
   if(value.type==='image'&&(!value.source||value.source.type!=='base64'||value.source.media_type!=='image/png'||typeof value.source.data!=='string'||!value.source.data.length))fail('image-source-forbidden');
   for(const item of Object.values(value))if(item&&typeof item==='object')inspect(item);
  }inspect(body.messages);inspect(body.system);
  const ctx={...context,endpoint,model:body.model,requestPolicySha256:recoveryRequestPolicySha256,requestSha256:sha(canonical(body)),
   upperBoundMicros:HAIKU_POLICY.contextTokens*HAIKU_POLICY.maxCacheWriteMicrosPerToken+body.max_tokens*HAIKU_POLICY.outputMicrosPerToken};
  const stage=ledger.stage(ctx).s;if(stage.billingBoundEvidenceSha256!==sha(canonical([HAIKU_POLICY.pricingEvidenceSha256,HAIKU_POLICY.modelEvidenceSha256])))fail('billing-evidence-binding');
  const saved=ledger.replay(ctx);if(saved)return new Response(saved.response,{headers:{'content-type':'application/json'}});
  if(ledger.report().frozen)fail('unresolved-charge-held');
  if(init.signal?.aborted)fail('cancelled-before-dispatch');
  const key=credential();if(typeof key!=='string'||!key)fail('runtime-credential-missing');
  const id=ledger.reserve(ctx);
  const signal=AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(360000)]);
  try{
   // Ignore incoming authentication; use only the existing execution-runtime key.
   const response=await transport(endpoint,{method:'POST',body:init.body,signal,redirect:'error',
    headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':key}});
   if(!response.ok)throw Error('provider-http');
   const raw=await collectAnthropicResponse(response,{signal,onProgress:init.onProviderProgress});
   const data=JSON.parse(raw),u=data.usage;
   if(data.model!==HAIKU_POLICY.model||!u||!integer(u.input_tokens)||!integer(u.output_tokens)||
    !integer(u.cache_creation_input_tokens??0)||!integer(u.cache_read_input_tokens??0)||
    u.input_tokens+(u.cache_creation_input_tokens||0)+(u.cache_read_input_tokens||0)>HAIKU_POLICY.contextTokens||u.output_tokens>body.max_tokens||
    (u.server_tool_use&&Object.values(u.server_tool_use).some(value=>value!==0))||
    (u.service_tier&&u.service_tier!=='standard'))throw Error('unverified-usage');
   // Cache writes conservatively use the higher 1-hour price, without claiming
   // exact lower-rate cache attribution that the response does not establish.
   const actualMicros=u.input_tokens+u.output_tokens*5+(u.cache_creation_input_tokens||0)*2+Math.ceil((u.cache_read_input_tokens||0)/10);
   let invalid=!['end_turn','tool_use'].includes(data.stop_reason);
   try{
    if(body.tool_choice?.type==='tool'){
     const tool=body.tools?.find(t=>t.name===body.tool_choice.name),calls=data.content?.filter(c=>c.type==='tool_use');
     if(data.stop_reason!=='tool_use'||calls?.length!==1||calls[0].name!==tool?.name||!calls[0].id)throw Error('output-tool-mismatch');
     validateSchema(calls[0].input,tool.input_schema);
    }
   }catch{invalid=true;}
   // Save the receipt and terminal freeze atomically: a crash must never make
   // incomplete/schema-invalid output replayable or release its reservation.
   const state=ledger.settle(id,{actualMicros,response:Buffer.from(raw),usageEvidenceSha256:sha(canonical(u)),stop:invalid});
   if(state!=='settled')throw Error('terminal-output-or-usage');
   return new Response(raw,{headers:{'content-type':'application/json'}});
  }catch{
   stopped=true;
   try{ledger.unknown(id);}catch{/* already settled/stopped; never release a hold */}
   fail('dispatch-held-or-stopped');
  }
 };
}
