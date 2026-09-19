// QA-only helpers. Production never imports this module or opens this database.
import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {DDL} from '../src/store.mjs';
import {collectAnthropicResponse} from '../src/anthropic-stream.mjs';
import {ServiceError,hash,stable} from '../src/core.mjs';

export async function privateJson(file,value){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 await writeFile(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});
 await rename(file+'.tmp',file);
}

/** PGlite has one connection. Hold its queue for the WHOLE SQL transaction. */
export async function isolatedPool(directory){
 const db=new PGlite(directory);await db.waitReady;
 let queue=Promise.resolve();
 const acquire=async()=>{let release;const current=new Promise(resolve=>{release=resolve;});const prior=queue;queue=current;await prior;return release;};
 const query=async(sql,params=[])=>{
  if(sql===DDL){await db.exec(sql);return {rows:[],rowCount:0};}
  const result=await db.query(sql,params);
  return {...result,rowCount:result.rowCount??(result.rows.length||result.affectedRows||0)};
 };
 return {
  query:async(sql,params)=>{const release=await acquire();try{return await query(sql,params);}finally{release();}},
  connect:async()=>{const unlock=await acquire();let released=false;return {query,release:()=>{if(!released){released=true;unlock();}}};},
  end:async()=>{const release=await acquire();try{await db.close();}finally{release();}}
 };
}

// Anthropic standard Sonnet 5 prices verified 2026-09-18. Estimates, not invoices.
// https://platform.claude.com/docs/en/about-claude/pricing
const cost=usage=>((usage.input_tokens||0)*2+(usage.output_tokens||0)*10+
 (usage.cache_creation_input_tokens||0)*2.5+(usage.cache_read_input_tokens||0)*.2)/1e6;
const safeUsage=usage=>Object.fromEntries(['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'].map(k=>[k,Number.isSafeInteger(usage?.[k])&&usage[k]>=0?usage[k]:0]));
const safeOpenAIUsage=usage=>{
 const input=Number.isSafeInteger(usage?.input_tokens)&&usage.input_tokens>=0?usage.input_tokens:0;
 const output=Number.isSafeInteger(usage?.output_tokens)&&usage.output_tokens>=0?usage.output_tokens:0;
 const cached=Number.isSafeInteger(usage?.input_tokens_details?.cached_tokens)&&usage.input_tokens_details.cached_tokens>=0&&usage.input_tokens_details.cached_tokens<=input?usage.input_tokens_details.cached_tokens:0;
 return {input_tokens:input,cached_input_tokens:cached,output_tokens:output,total_tokens:Number.isSafeInteger(usage?.total_tokens)&&usage.total_tokens>=0?usage.total_tokens:input+output};
};

// Explicit owner recovery accepts this exact historical reservation, never a new call.
export function reservationFingerprint(record){const {acknowledgement,...original}=record;return hash(stable(original));}
export function reservationAcknowledged(record){return record.acknowledgement?.action==='resume-reserved'&&record.acknowledgement.fingerprint===reservationFingerprint(record);}

/** Reserve before sending. Unknown/timeout charges retain their full reservation.
 * The provider token counter is an estimate, so this is NOT a billing hard cap. */
export async function guardedSonnetFetch({file,limitUsd,maxCalls,maxOutputTokens=10000,request=fetch,onRequest=()=>{},onPause=()=>{},reuseResponses=false}){
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>32000)throw new ServiceError('qa-output-limit-invalid',422);
 let state;
 try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={version:1,model:'claude-sonnet-5',calls:[],tokenCountMs:0};}
 if(state.version!==1||state.model!=='claude-sonnet-5'||!Array.isArray(state.calls)||state.calls.some(c=>!Number.isFinite(c.reservedUsd)||c.reservedUsd<0))throw Error('Invalid saved QA cost ledger.');
 // A previous interrupted call may have incurred charges. Resuming the same
 // ledger must not issue more paid requests, even if its estimate is below cap.
 state.paused=Boolean(state.paused||state.calls.some(c=>['reserved','charge-unknown'].includes(c.status)&&!reservationAcknowledged(c)));
 const checkPaused=()=>{if(state.paused)throw new ServiceError('qa-paused-unknown-provider-charge',422);};
 let persistence=Promise.resolve();
 const save=()=>{const snapshot=structuredClone(state);persistence=persistence.then(()=>privateJson(file,snapshot));return persistence;};
 const reserved=()=>state.calls.reduce((sum,c)=>sum+c.reservedUsd,0);
 const guarded=async(url,options)=>{
  checkPaused();options.signal?.throwIfAborted();
  const body=JSON.parse(options.body);
  if(url!=='https://api.anthropic.com/v1/messages'||body.model!=='claude-sonnet-5'||!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>maxOutputTokens)throw new ServiceError('qa-unapproved-provider-request',422);
  const requestSha256=hash(options.body);
  const prior=reuseResponses&&state.calls.find(c=>c.requestSha256===requestSha256&&c.status==='usage-reported'&&c.httpStatus>=200&&c.httpStatus<300&&c.responseFile);
  if(prior){
   if(!/^responses[\\/]\d+\.json$/.test(prior.responseFile))throw new ServiceError('qa-invalid-response-checkpoint',422);
   const saved=JSON.parse(await readFile(join(dirname(file),prior.responseFile),'utf8'));
   if(saved.requestSha256!==requestSha256||hash(JSON.stringify(saved.request))!==requestSha256||hash(saved.responseText)!==prior.responseSha256||saved.httpStatus!==prior.httpStatus)throw new ServiceError('qa-response-checkpoint-mismatch',422);
   return new Response(saved.responseText,{status:saved.httpStatus,headers:{'content-type':'application/json'}});
  }
  if(state.calls.length>=maxCalls)throw new ServiceError('qa-request-limit-reached',422);
  const started=performance.now();
  const countBody={model:body.model,system:body.system,messages:body.messages,...(body.tools?{tools:body.tools}:{}),...(body.tool_choice?{tool_choice:body.tool_choice}:{})};
  const counted=await request('https://api.anthropic.com/v1/messages/count_tokens',{...options,body:JSON.stringify(countBody),redirect:'error'});
  if(!counted.ok)throw new ServiceError('qa-token-count-http-'+counted.status,422);
  const count=await counted.json();
  if(!Number.isSafeInteger(count.input_tokens)||count.input_tokens<0)throw new ServiceError('qa-invalid-token-count',422);
  state.tokenCountMs+=Math.round(performance.now()-started);
  checkPaused();options.signal?.throwIfAborted();
  // Include an extra schema allowance, 20% input-count headroom and 2,048 tokens.
  const inputUpper=Math.ceil(count.input_tokens*1.2)+2048+Buffer.byteLength(JSON.stringify(body.output_config||{}));
  const estimate=(inputUpper*2.5+body.max_tokens*10)/1e6;
  if(state.calls.length>=maxCalls||reserved()+estimate>limitUsd)throw new ServiceError('qa-estimated-spend-limit-reached',422);
  const record={requestSha256,reservedUsd:estimate,estimatedInputTokens:count.input_tokens,maxOutputTokens:body.max_tokens,status:'reserved'};
  state.calls.push(record);await save();let sent=false,response;
  try{
   checkPaused();options.signal?.throwIfAborted();
   onRequest(state.calls.length);sent=true;
   response=await request(url,{...options,redirect:'error'});
   record.httpStatus=response.status;
   record.requestId=response.headers.get('request-id')||null;
   await save();
   const responseText=await collectAnthropicResponse(response,{signal:options.signal,onProgress:progress=>{record.progress=progress;options.onProviderProgress?.(progress);}});
   response=new Response(responseText,{status:response.status,headers:{'content-type':'application/json'}});
   // Persist the paid reply BEFORE schema/domain validation. No headers or keys
   // are written. A rejected citation remains available for free local replay.
   const responseFile=join('responses',String(state.calls.indexOf(record)+1).padStart(4,'0')+'.json');
   await privateJson(join(dirname(file),responseFile),{version:1,requestSha256:hash(options.body),request:body,httpStatus:response.status,responseText});
   record.responseFile=responseFile;record.responseSha256=hash(responseText);
   const data=JSON.parse(responseText);
   if(data?.usage&&Number.isSafeInteger(data.usage.input_tokens)&&data.usage.input_tokens>=0&&Number.isSafeInteger(data.usage.output_tokens)&&data.usage.output_tokens>=0){
    record.usage=safeUsage(data.usage);record.estimatedActualUsd=cost(record.usage);
    record.reservedUsd=record.estimatedActualUsd;record.status='usage-reported';
   }else throw new ServiceError('qa-provider-usage-missing',422);
  }catch(error){
   if(!sent){record.status='not-sent';record.reservedUsd=0;await save();throw error;}
   record.failure={code:typeof error.code==='string'?error.code:error.name||'provider-error'};
   record.status='charge-unknown';state.paused=true;
   const paused=new ServiceError('qa-paused-unknown-provider-charge',422);
   onPause(paused);await save();throw paused;
  }
  await save();return response;
 };
 return {request:guarded,summary:()=>({model:state.model,requests:state.calls.filter(c=>c.status!=='not-sent').length,estimatedUsd:reserved(),estimatedLimitUsd:limitUsd,maxRequests:maxCalls,tokenCountMs:state.tokenCountMs,unknownChargeRequests:state.calls.filter(c=>c.status!=='not-sent'&&!c.usage).length,paused:state.paused,usage:state.calls.map(c=>c.usage).filter(Boolean),lastFailure:state.calls.at(-1)?.failure?{request:state.calls.length,...state.calls.at(-1).failure,progress:state.calls.at(-1).progress}:null,note:'Standard-price estimate with guarded reservations, not an invoice or a guaranteed billing cap. Failed calls without usage retain their reserved estimate. Unknown charges pause this ledger before further requests.'})};
}

// OpenAI GPT-5.6 Sol short-context standard prices verified 2026-09-19.
// https://developers.openai.com/api/docs/pricing
const openAICost=usage=>((usage.input_tokens-usage.cached_input_tokens)*4+usage.cached_input_tokens*.4+usage.output_tokens*20)/1e6;

/** QA-only OpenAI guard for the configured P5 mapping qualification.
 * Input bytes are treated as input tokens before dispatch, which deliberately
 * over-reserves ordinary JSON requests and keeps the request below the model's
 * 272K-token long-context threshold without depending on a tokenizer. */
export async function guardedOpenAIFetch({file,limitUsd,maxCalls,model,request=fetch,onRequest=()=>{},onPause=()=>{},reuseResponses=false}){
 let state;
 try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={version:1,provider:'openai',model,calls:[]};}
 if(state.version!==1||state.provider!=='openai'||state.model!==model||!Array.isArray(state.calls)||state.calls.some(c=>!Number.isFinite(c.reservedUsd)||c.reservedUsd<0))throw Error('Invalid saved OpenAI QA cost ledger.');
 state.paused=Boolean(state.paused||state.calls.some(c=>['reserved','charge-unknown'].includes(c.status)));
 const checkPaused=()=>{if(state.paused)throw new ServiceError('qa-paused-unknown-provider-charge',422);};
 let persistence=Promise.resolve();
 const save=()=>{const snapshot=structuredClone(state);persistence=persistence.then(()=>privateJson(file,snapshot));return persistence;};
 const reserved=()=>state.calls.reduce((sum,c)=>sum+c.reservedUsd,0);
 const guarded=async(url,options)=>{
  checkPaused();options.signal?.throwIfAborted();
  const body=JSON.parse(options.body);
  if(url!=='https://api.openai.com/v1/responses'||body.model!==model||body.store!==false||body.tools?.length||!Number.isSafeInteger(body.max_output_tokens)||body.max_output_tokens<1||body.max_output_tokens>10000)throw new ServiceError('qa-unapproved-provider-request',422);
  const requestSha256=hash(options.body);
  const prior=reuseResponses&&state.calls.find(c=>c.requestSha256===requestSha256&&c.status==='usage-reported'&&c.httpStatus>=200&&c.httpStatus<300&&c.responseFile);
  if(prior){
   if(!/^responses[\\/]\d+\.json$/.test(prior.responseFile))throw new ServiceError('qa-invalid-response-checkpoint',422);
   const saved=JSON.parse(await readFile(join(dirname(file),prior.responseFile),'utf8'));
   if(saved.requestSha256!==requestSha256||hash(JSON.stringify(saved.request))!==requestSha256||hash(saved.responseText)!==prior.responseSha256||saved.httpStatus!==prior.httpStatus)throw new ServiceError('qa-response-checkpoint-mismatch',422);
   return new Response(saved.responseText,{status:saved.httpStatus,headers:{'content-type':'application/json','x-request-id':prior.requestId||''}});
  }
  if(state.calls.length>=maxCalls)throw new ServiceError('qa-request-limit-reached',422);
  const inputUpperTokens=Buffer.byteLength(options.body);
  if(inputUpperTokens>250000)throw new ServiceError('qa-request-exceeds-short-context-bound',422);
  const estimate=(inputUpperTokens*4+body.max_output_tokens*20)/1e6;
  if(reserved()+estimate>limitUsd)throw new ServiceError('qa-estimated-spend-limit-reached',422);
  const record={requestSha256,reservedUsd:estimate,estimatedInputTokensUpperBound:inputUpperTokens,maxOutputTokens:body.max_output_tokens,status:'reserved'};
  state.calls.push(record);await save();let sent=false,response;
  try{
   checkPaused();options.signal?.throwIfAborted();onRequest(state.calls.length);sent=true;
   response=await request(url,{...options,redirect:'error'});
   record.httpStatus=response.status;record.requestId=response.headers.get('x-request-id')||response.headers.get('request-id')||null;await save();
   const responseText=await response.text();
   const responseFile=join('responses',String(state.calls.indexOf(record)+1).padStart(4,'0')+'.json');
   await privateJson(join(dirname(file),responseFile),{version:1,requestSha256:hash(options.body),request:body,httpStatus:response.status,responseText});
   record.responseFile=responseFile;record.responseSha256=hash(responseText);
   const data=JSON.parse(responseText);
   if(!response.ok||data?.status!=='completed')throw new ServiceError('qa-provider-response-incomplete',422);
   if(data.model!==model||typeof data.service_tier!=='string'||!data.service_tier)throw new ServiceError('qa-provider-identity-mismatch',422);
   if(!record.requestId)throw new ServiceError('qa-provider-request-id-missing',422);
   if(!data?.usage||!Number.isSafeInteger(data.usage.input_tokens)||data.usage.input_tokens<0||!Number.isSafeInteger(data.usage.output_tokens)||data.usage.output_tokens<0)throw new ServiceError('qa-provider-usage-missing',422);
   record.responseModel=data.model;record.serviceTier=data.service_tier;record.usage=safeOpenAIUsage(data.usage);
   record.estimatedActualUsd=openAICost(record.usage);record.reservedUsd=record.estimatedActualUsd;record.status='usage-reported';
  }catch(error){
   if(!sent){record.status='not-sent';record.reservedUsd=0;await save();throw error;}
   record.failure={code:typeof error.code==='string'?error.code:error.name||'provider-error'};record.status='charge-unknown';state.paused=true;
   const paused=new ServiceError('qa-paused-unknown-provider-charge',422);onPause(paused);await save();throw paused;
  }
  await save();return new Response(await readFile(join(dirname(file),record.responseFile),'utf8').then(saved=>JSON.parse(saved).responseText),{status:record.httpStatus,headers:{'content-type':'application/json','x-request-id':record.requestId}});
 };
 const summary=()=>({provider:state.provider,model:state.model,requests:state.calls.filter(c=>c.status!=='not-sent').length,estimatedUsd:reserved(),estimatedLimitUsd:limitUsd,maxRequests:maxCalls,unknownChargeRequests:state.calls.filter(c=>c.status!=='not-sent'&&!c.usage).length,paused:state.paused,requestsEvidence:state.calls.filter(c=>c.status==='usage-reported').map((c,index)=>({sequence:index+1,requestId:c.requestId,requestSha256:c.requestSha256,responseSha256:c.responseSha256,responseModel:c.responseModel,serviceTier:c.serviceTier,usage:c.usage,estimatedInputTokensUpperBound:c.estimatedInputTokensUpperBound,maxOutputTokens:c.maxOutputTokens,estimatedActualUsd:c.estimatedActualUsd})),lastFailure:state.calls.at(-1)?.failure?{request:state.calls.length,...state.calls.at(-1).failure}:null,note:'Official standard-price estimate, not an invoice or guaranteed billing cap. Each request reserves a conservative input-byte upper bound plus its full output ceiling before dispatch. Unknown charges pause this ledger before further requests.'});
 return {request:guarded,summary};
}

/** Independent targeted source checks. They are NOT exhaustive accuracy scoring. */
export function targetedChecks(id,result,pages){
 const checks=[{name:'Every source page verified',pass:result.pages?.length===pages&&result.pages.every((p,i)=>p.page===i+1&&p.status==='read')}];
 if(id==='short'){
  const included=[result.summary,...(result.instructions?.inclusions||[]),...(result.takeoffs||[]).map(t=>t.description)].join(' ');
  for(const [name,pattern] of [['Well',/\bwell\b/i],['Septic',/\bseptic\b/i],['Cabinetry',/\bcabinet/i],['Painting',/\bpaint/i],['Appliances',/\bappliance/i],['Fireplace',/\bfireplace/i]])checks.push({name:name+' scope retained',pass:pattern.test(included)});
  checks.push({name:'Redacted house/garage area not invented',pass:!(result.facts||[]).some(f=>['sqft','garageSqft'].includes(f.field))});
  const exclusions=(result.instructions?.exclusions||[]).join(' ');
  checks.push({name:'Land and financing excluded',pass:/\bland\b/i.test(exclusions)&&/\bfinanc/i.test(exclusions)});
  checks.push({name:'Specialty coatings remain excluded',pass:/wallpaper|limewash|decorative plaster|specialty coatings/i.test(exclusions)});
 }
 if(id==='plans'){
  checks.push({name:'Scanned electrical sheet identity retained',pass:/\bA5\.1\b/i.test(result.pages?.find(p=>p.page===10)?.sheet||'')});
  // Independently read from original page 1, A0.0, Building Data. These
  // expectations are not generated from the model's answer. Keep conditioned,
  // garage and outdoor areas separate; repeated plan references are not sums.
  for(const [field,expected,name] of [['sqft',3019,'Conditioned area'],['garageSqft',836,'Garage area'],['coveredOutdoorSqft',557,'Covered outdoor area'],['stories',2,'Story count']]){
   const facts=(result.facts||[]).filter(f=>f.field===field);
   checks.push({name:name+' matches original cover sheet',expected,pass:facts.length>0&&facts.every(f=>typeof f.value==='string'&&/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(f.value)&&Number(f.value)===expected)&&!(result.conflicts||[]).some(c=>c.field===field)});
  }
 }
 return {exhaustive:false,precision:null,recall:null,quantityAccuracy:null,checks,passed:checks.every(c=>c.pass),note:'Targeted checks derived from the original source, independent of the extracting model. Full facts/quantities/responsibilities/revisions still need review; confidence scores are not accuracy.'};
}
