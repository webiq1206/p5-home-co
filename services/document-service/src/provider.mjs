import {ServiceError} from './core.mjs';
import {validateSchema} from './schema.mjs';
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(signal.reason);const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});
const REVIEW_TOOL='submit_document_review';
export function requestBody(provider,model,system,input,images,schema,maxOutput,purpose='evidence'){
 const text=JSON.stringify(input);
 if(provider==='anthropic'){
  const body={model,max_tokens:maxOutput,system:[{type:'text',text:system,cache_control:{type:'ephemeral'}}],messages:[{role:'user',content:[{type:'text',text},...images.flatMap(i=>[{type:'text',text:i.label},{type:'image',source:{type:'base64',media_type:'image/png',data:Buffer.from(i.bytes).toString('base64')}}])]}]};
  // Reconciliation exceeded Anthropic's grammar budget even after enum reduction.
  // A regular client tool returns data without constrained grammar compilation.
  // No tool is executed. Its input must pass the original schema and domain checks.
  if(purpose==='review'){
   body.tools=[{name:REVIEW_TOOL,description:'Return the complete reconciled scope, evidence, quantities, exclusions and unresolved questions. This tool only submits structured data; it performs no external action. Include every required field, with empty arrays when absent.',input_schema:schema,strict:false}];
   body.tool_choice={type:'tool',name:REVIEW_TOOL,disable_parallel_tool_use:true};
   return {url:'https://api.anthropic.com/v1/messages',body,outputTool:REVIEW_TOOL};
  }
  body.output_config={format:{type:'json_schema',schema}};
  return {url:'https://api.anthropic.com/v1/messages',body};
 }
 if(provider==='gemini')return {url:`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,body:{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text},...images.flatMap(i=>[{text:i.label},{inlineData:{mimeType:'image/png',data:Buffer.from(i.bytes).toString('base64')}}])]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:maxOutput}}};
 if(provider==='openai')return {url:'https://api.openai.com/v1/responses',body:{model,store:false,instructions:system,input:[{role:'user',content:[{type:'input_text',text},...images.flatMap(i=>[{type:'input_text',text:i.label},{type:'input_image',image_url:'data:image/png;base64,'+Buffer.from(i.bytes).toString('base64'),detail:'high'}])]}],text:{format:{type:'json_schema',name:'document_evidence',strict:true,schema}},max_output_tokens:maxOutput}};
 throw new ServiceError('unsupported-provider',500);
}
export function parseReply(provider,data,outputTool){
 let text;
 if(provider==='anthropic'&&outputTool){
  if(data.stop_reason!=='tool_use')throw new ServiceError('provider-output-incomplete',422);
  const calls=(Array.isArray(data.content)?data.content:[]).filter(b=>b.type==='tool_use');
  if(calls.length!==1||calls[0].name!==outputTool||!calls[0].id)throw new ServiceError('invalid-provider-tool-output',422);
  return calls[0].input;
 }
 if(provider==='anthropic'){if(data.stop_reason!=='end_turn')throw new ServiceError('provider-output-incomplete',422);text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');}
 if(provider==='gemini'){if(data.candidates?.[0]?.finishReason!=='STOP')throw new ServiceError('provider-output-incomplete',422);text=(data.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');}
 if(provider==='openai'){if(data.status!=='completed')throw new ServiceError('provider-output-incomplete',422);text=(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');}
 try{return JSON.parse(text);}catch{throw new ServiceError('invalid-provider-json',422);}
}
export class Reader{
 constructor(config,store,request=fetch){this.config=config;this.store=store;this.request=request;}
 async call(job,system,input,images,schema,signal,verify=false){
  const c=this.config,estimated=Math.ceil((JSON.stringify(input).length+JSON.stringify(schema).length+system.length)/3)+images.reduce((n,i)=>n+Math.ceil(i.bytes.length/256),0)+c.maxOutput;
  if(estimated>c.tpm)throw new ServiceError('request-exceeds-configured-token-budget',422);
  let slot;const waitStart=performance.now();
  while(!(slot=await this.store.reserve(estimated))){signal.throwIfAborted();await sleep(250,signal);}
  const start=performance.now();
  try{
   const built=requestBody(c.provider,verify?c.verifyModel:c.model,system,input,images,schema,c.maxOutput,job.kind);
   const headers={'content-type':'application/json',...(c.provider==='anthropic'?{'x-api-key':c.key,'anthropic-version':'2023-06-01'}:c.provider==='gemini'?{'x-goog-api-key':c.key}:{authorization:`Bearer ${c.key}`})};
   const timeout=AbortSignal.timeout(c.callMs),combined=AbortSignal.any([signal,timeout]);
   const response=await this.request(built.url,{method:'POST',headers,body:JSON.stringify(built.body),signal:combined,redirect:'error'});
   if(!response.ok){
    const requested=response.headers.get('retry-after');const seconds=Number(requested);const retryMs=Number.isFinite(seconds)?Math.min(120000,Math.max(1000,seconds*1000)):Math.max(1000,Math.min(120000,Date.parse(requested||'')-Date.now()||1000));
    if(response.status===429){await this.store.cooldown(retryMs);throw new ServiceError('provider-rate-limit',429,retryMs);}
    // Provider error bodies can contain submitted source text. Do not log them.
    throw new ServiceError(`provider-http-${response.status}`,response.status===401||response.status===403?422:response.status);
   }
   const length=Number(response.headers.get('content-length')||0);if(length>8*1024*1024)throw new ServiceError('provider-response-too-large',422);
   const text=await response.text();if(text.length>8*1024*1024)throw new ServiceError('provider-response-too-large',422);
   let data;try{data=JSON.parse(text);}catch{throw new ServiceError('invalid-provider-json',422);}
   const value=validateSchema(parseReply(c.provider,data,built.outputTool),schema);
   await this.store.metric(job,job.kind==='review'?'reconciliation-provider':verify?'verify-provider':'read-provider',performance.now()-start,{provider:c.provider,model:verify?c.verifyModel:c.model,queueMs:Math.round(start-waitStart),estimatedTokens:estimated,usage:data.usage||data.usageMetadata||{}});
   return value;
  }catch(e){
   const error=e.name==='TimeoutError'||e.name==='AbortError'?new ServiceError('provider-timeout',503):e instanceof TypeError?new ServiceError('provider-network-error',503):e;
   await this.store.metric(job,'provider-failure',performance.now()-start,{provider:c.provider,queueMs:Math.round(start-waitStart),code:error.code||'provider-error'}).catch(()=>{});
   throw error;
  }
  finally{await this.store.release(slot);}
 }
}
