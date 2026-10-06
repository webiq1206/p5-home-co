// Deliberately not imported by startup, HTTP routes, workers or the website.
// Activation requires a separately reviewed authoritative accounting/draft fence.
import {createHash,randomUUID} from 'node:crypto';
import {QaBudget,QA_MODEL,QA_RUN,QA_URL} from './qa-budget.mjs';
import {ServiceError} from './core.mjs';

export const RESEARCH_LIMITS=Object.freeze({reserve:2240000,input:2200000,output:6000,searches:1,aggregate:10000000,externalFloor:7190000,qaAllocation:2810000});
const CASES=new Set(['84fe60ee-eea3-40cc-9ad1-8e7ea41aec98','4b984f15-af82-41ff-b181-e16696ea779a','62237df6-5a8a-4226-b5cc-ad4297bdf6d1','225edc58-a47d-4171-8630-72dd6abf5845','2ba6de3d-d9e5-43f0-bc48-c80a534fc6dc','df96b75c-07ec-4833-a6f2-aabe01a5bf97']);
const SLOT='restricted-research-20261006-one-request';
const fail=code=>{throw new ServiceError('qa-research-'+code,422);};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

/** One ordinary first-party request. No normalization may silently remove tools,
 * caches, retries or source content. Caller must review these exact bytes. */
export function restrictedResearchWire(input){
 if(!exactKeys(input,['model','max_tokens','system','messages','tools','tool_choice','stream','service_tier']))fail('request-options');
 if(input.model!==QA_MODEL||input.max_tokens!==6000||input.stream!==false||input.service_tier!=='standard_only')fail('request-profile');
 if(typeof input.system!=='string'||!input.system.trim())fail('system-required');
 // Text-only fresh research: reject assistant continuations, tool results,
 // cache markers, images, files and hidden content extensions at every level.
 if(!Array.isArray(input.messages)||input.messages.length!==1||!exactKeys(input.messages[0],['role','content'])||input.messages[0].role!=='user'||typeof input.messages[0].content!=='string'||!input.messages[0].content.trim())fail('fresh-text-request-required');
 if(!Array.isArray(input.tools)||input.tools.length!==1)fail('one-basic-search-required');
 const tool=input.tools[0];
 if(!exactKeys(tool,['type','name','max_uses'])||tool.type!=='web_search_20250305'||tool.name!=='web_search'||tool.max_uses!==1)fail('one-basic-search-required');
 if(!exactKeys(input.tool_choice,['type','name'])||input.tool_choice.type!=='tool'||input.tool_choice.name!=='web_search')fail('search-choice-required');
 return {model:QA_MODEL,max_tokens:6000,system:input.system,messages:[{role:'user',content:input.messages[0].content}],tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}],tool_choice:{type:'tool',name:'web_search'},stream:false,service_tier:'standard_only'};
}

function identity(value){
 if(!exactKeys(value,['tenant','draftId','revision','scopeHash','stageIdentity'])||value.tenant!=='p5homeco.com'||!CASES.has(value.draftId)||!integer(value.revision)||value.revision<1||!hex(value.scopeHash)||!hex(value.stageIdentity))fail('case-identity');
 return {tenant:value.tenant,draftId:value.draftId,revision:value.revision,scopeHash:value.scopeHash,stageIdentity:value.stageIdentity};
}
function snapshot(value,expected,now){
 if(!value||!hex(value.epoch)||!hex(value.evidenceHash)||hash(identity(value.identity))!==hash(expected.identity)||value.requestHash!==expected.requestHash||value.boundedMarker!==true||value.noProviderMarker!==false||!integer(value.externalMicrousd)||value.externalMicrousd<RESEARCH_LIMITS.externalFloor||!integer(value.qaLiabilityMicrousd)||!integer(value.observedAt)||!integer(value.expiresAt)||value.observedAt>now||now-value.observedAt>120000||value.expiresAt<=now||value.expiresAt-value.observedAt>120000)fail('accounting-unverified');
 // External amount includes historical holds and the full provider-day reserve.
 // The adapter must retain exclusive authority over all external spending AND
 // this draft revision for the entire callback. A stale receipt is insufficient.
 return value;
}

/** Returns integer microUSD only for a complete, explicitly priced receipt.
 * An incomplete content result may settle cost but never authorizes continuation. */
export function restrictedResearchUsage(data,requestId){
 const u=data?.usage;
 if(data?.model!==QA_MODEL||typeof data.id!=='string'||!data.id||typeof requestId!=='string'||!requestId||!['end_turn','pause_turn','max_tokens','model_context_window_exceeded','refusal','tool_use','stop_sequence'].includes(data.stop_reason)||!Array.isArray(data.content))fail('receipt-unverified');
 if(!exactKeys(u,['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens','cache_creation','server_tool_use','service_tier','inference_geo']))fail('usage-unverified');
 if(!integer(u.input_tokens)||u.input_tokens>RESEARCH_LIMITS.input||!integer(u.output_tokens)||u.output_tokens>6000||u.cache_creation_input_tokens!==0||u.cache_read_input_tokens!==0||u.service_tier!=='standard')fail('usage-unverified');
 if(u.inference_geo!==undefined&&u.inference_geo!=='global')fail('usage-unverified');
 if(u.cache_creation!==undefined&&(!exactKeys(u.cache_creation,['ephemeral_5m_input_tokens','ephemeral_1h_input_tokens'])||Object.values(u.cache_creation).some(n=>n!==0)))fail('usage-unverified');
 const server=u.server_tool_use;
 if(!exactKeys(server,['web_search_requests','web_fetch_requests'])||!integer(server.web_search_requests)||server.web_search_requests>1||(server.web_fetch_requests!==undefined&&server.web_fetch_requests!==0))fail('usage-unverified');
 const actual=u.input_tokens+5*u.output_tokens+10000*server.web_search_requests;
 if(actual>RESEARCH_LIMITS.reserve)fail('usage-over-reservation');
 return actual;
}

export class RestrictedResearch {
 constructor(store,config,{enabled=false,withVerifiedFence,request=fetch,now=Date.now}={}){
  this.store=store;this.config=config;this.enabled=enabled===true;this.fence=withVerifiedFence;this.request=request;this.now=now;this.legacy=new QaBudget(store,config,request);
 }
 enabledOnly(){if(!this.enabled||typeof this.fence!=='function')fail('disabled');}
 async locked(c,id,s){
  const run=(await c.query('SELECT * FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[QA_RUN])).rows[0];
  if(!run||run.blocked||Number(run.historical_microusd)!==3250000||Number(run.historical_unknown_microusd)!==390000||Number(run.allowance_microusd)!==2000000)fail('run-held');
  const binding=(await c.query('SELECT run_id FROM p5ds_qa_projects WHERE tenant=$1 AND project=$2',[id.tenant,'qa-paid-'+id.draftId])).rows[0];
  if(binding?.run_id!==QA_RUN)fail('binding-required');
  const calls=(await c.query('SELECT status,reserved_microusd,actual_microusd FROM p5ds_qa_calls WHERE run_id=$1',[QA_RUN])).rows;
  let liability=0;
  for(const call of calls){
   const reserve=Number(call.reserved_microusd),actual=Number(call.actual_microusd);
   if(!integer(reserve)||reserve===0||!['permitted','in_flight','unknown','settled'].includes(call.status)||(call.status==='settled'&&(call.actual_microusd===null||!integer(actual)||actual>reserve)))fail('ledger-unverified');
   liability+=call.status==='settled'?actual:reserve;
  }
  if(!integer(liability)||liability!==Number(run.liability_microusd)||liability!==s.qaLiabilityMicrousd)fail('liability-changed');
  if(liability>RESEARCH_LIMITS.qaAllocation||s.externalMicrousd+liability>RESEARCH_LIMITS.aggregate)fail('budget-exhausted');
  return {run,calls,liability};
 }
 /** Operator-only source API: no HTTP route or startup caller exists. The
  * migration creates a singleton authorization record, never a replacement run.
  * Legacy allowance/check remains unchanged; this exception reserves in the SAME
  * calls/run ledger, under the SAME row lock and unique active-call index. */
 async reserve(rawIdentity,input,reviewNote){
  this.enabledOnly();const id=identity(rawIdentity),body=restrictedResearchWire(input);
  if(typeof reviewNote!=='string'||reviewNote.trim().length<40)fail('review-required');
  const requestHash=hash({identity:id,body}),boundary='restricted-research:'+hash(id);
  const expected=freeze({identity:id,body,requestHash});
  return this.fence(expected,async supplied=>{
   const s=freeze(structuredClone(snapshot(supplied,expected,this.now())));
   return this.store.transaction(async c=>{
    const {calls,liability}=await this.locked(c,id,s);
    snapshot(s,expected,this.now());
    if(calls.some(call=>call.status!=='settled'))fail('prior-call-held');
    if(liability+RESEARCH_LIMITS.reserve>RESEARCH_LIMITS.qaAllocation||s.externalMicrousd+liability+RESEARCH_LIMITS.reserve>RESEARCH_LIMITS.aggregate)fail('budget-exhausted');
    await c.query('INSERT INTO p5ds_qa_intents(request_hash,run_id,tenant,project,boundary,request,maximum_microusd) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[requestHash,QA_RUN,id.tenant,'qa-paid-'+id.draftId,boundary,JSON.stringify(body),RESEARCH_LIMITS.reserve]);
    await c.query(`INSERT INTO p5ds_qa_research_admission(run_id,request_hash,identity,accounting_epoch,evidence_hash,external_microusd,observed_at_ms,expires_at_ms) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,[QA_RUN,requestHash,JSON.stringify(id),s.epoch,s.evidenceHash,s.externalMicrousd,s.observedAt,s.expiresAt]);
    await c.query("INSERT INTO p5ds_qa_calls(slot,run_id,request_hash,review_note,status,reserved_microusd) VALUES($1,$2,$3,$4,'permitted',$5)",[SLOT,QA_RUN,requestHash,reviewNote,RESEARCH_LIMITS.reserve]);
    await c.query('UPDATE p5ds_qa_runs SET liability_microusd=liability_microusd+$2 WHERE run_id=$1',[QA_RUN,RESEARCH_LIMITS.reserve]);
    return {requestHash,maximum:RESEARCH_LIMITS.reserve};
   });
  });
 }
 async dispatch(rawIdentity,input,signal){
  this.enabledOnly();const id=identity(rawIdentity),body=restrictedResearchWire(input),requestHash=hash({identity:id,body});
  // Reuse an exact settled receipt independently of spend-only approval expiry,
  // external accounting changes, provider availability or unrelated unknown holds.
  const prior=(await this.store.pool.query(`SELECT a.identity,i.request,c.response,c.provider_request_id,c.actual_microusd,c.reserved_microusd
   FROM p5ds_qa_research_admission a JOIN p5ds_qa_intents i ON i.request_hash=a.request_hash
   JOIN p5ds_qa_calls c ON c.request_hash=a.request_hash
   WHERE a.run_id=$1 AND a.request_hash=$2 AND c.slot=$3 AND c.status='settled'`,[QA_RUN,requestHash,SLOT])).rows[0];
  if(prior){
   if(hash(identity(prior.identity))!==hash(id)||hash(restrictedResearchWire(prior.request))!==hash(body)||Number(prior.reserved_microusd)!==RESEARCH_LIMITS.reserve||restrictedResearchUsage(prior.response,prior.provider_request_id)!==Number(prior.actual_microusd))fail('saved-receipt-unverified');
   return {response:prior.response,replayed:true};
  }
  if(this.config.provider!=='anthropic'||this.config.model!==QA_MODEL||!this.config.key)fail('resident-provider-unavailable');
  const expected=freeze({identity:id,body,requestHash});
  return this.fence(expected,async supplied=>{
   const s=freeze(structuredClone(snapshot(supplied,expected,this.now())));
   const call=await this.store.transaction(async c=>{
    const {calls}=await this.locked(c,id,s);
    snapshot(s,expected,this.now());
    const admission=(await c.query('SELECT * FROM p5ds_qa_research_admission WHERE run_id=$1 AND request_hash=$2',[QA_RUN,requestHash])).rows[0];
    if(!admission||hash(identity(admission.identity))!==hash(id)||admission.accounting_epoch!==s.epoch||admission.evidence_hash!==s.evidenceHash||Number(admission.external_microusd)!==s.externalMicrousd||Number(admission.expires_at_ms)<=this.now())fail('admission-stale');
    if(calls.some(call=>call.status==='unknown'||call.status==='in_flight'))fail('prior-call-held');
    const saved=(await c.query('SELECT * FROM p5ds_qa_calls WHERE slot=$1 AND request_hash=$2',[SLOT,requestHash])).rows[0];
    if(saved?.status==='settled')return saved;
    if(saved?.status!=='permitted'||Number(saved.reserved_microusd)!==RESEARCH_LIMITS.reserve)fail('exact-permit-required');
    const intent=(await c.query('SELECT request,maximum_microusd FROM p5ds_qa_intents WHERE request_hash=$1',[requestHash])).rows[0];
    if(!intent||hash(restrictedResearchWire(intent.request))!==hash(body)||Number(intent.maximum_microusd)!==RESEARCH_LIMITS.reserve)fail('intent-changed');
    signal?.throwIfAborted();
    return (await c.query("UPDATE p5ds_qa_calls SET status='in_flight',started_at=now(),boundary_token=$2 WHERE slot=$1 AND status='permitted' RETURNING *",[SLOT,randomUUID()])).rows[0];
   });
   if(call.status==='settled')return {response:call.response,replayed:true};
   try{
    // Exactly one native fetch: no SDK, proxy, redirect, retry or continuation.
    const timeout=AbortSignal.timeout(180000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await this.request(QA_URL,{method:'POST',headers:{'content-type':'application/json','x-api-key':this.config.key,'anthropic-version':'2023-06-01'},body:JSON.stringify(body),redirect:'error',signal:combined});
    const raw=await response.text();if(raw.length>8*1024*1024)fail('response-too-large');
    const data=JSON.parse(raw),requestId=response.headers.get('request-id');
    const receipt=await this.store.pool.query("UPDATE p5ds_qa_calls SET response=$2::jsonb,provider_request_id=$3 WHERE slot=$1 AND status='in_flight' AND boundary_token=$4 RETURNING slot",[SLOT,JSON.stringify(data),requestId,call.boundary_token]);
    if(receipt.rows.length!==1)fail('receipt-not-saved');
    if(!response.ok)fail('provider-http-'+response.status);
    const actual=restrictedResearchUsage(data,requestId);
    await this.store.transaction(async c=>{
     const run=(await c.query('SELECT * FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[QA_RUN])).rows[0];
     if(!run||run.blocked||!integer(Number(run.liability_microusd))||Number(run.liability_microusd)<RESEARCH_LIMITS.reserve)fail('run-held');
     const changed=await c.query("UPDATE p5ds_qa_calls SET status='settled',actual_microusd=$2,settled_at=now() WHERE slot=$1 AND status='in_flight' AND boundary_token=$3 RETURNING slot",[SLOT,actual,call.boundary_token]);
     if(changed.rows.length!==1)fail('settlement-state-changed');
     await c.query('UPDATE p5ds_qa_runs SET liability_microusd=liability_microusd-$2+$3 WHERE run_id=$1',[QA_RUN,RESEARCH_LIMITS.reserve,actual]);
    });
    // Accounting settlement is not source-quality or estimate acceptance.
    return {response:data,replayed:false};
   }catch(error){await this.legacy.unknown(call).catch(()=>{});throw error;}
  });
 }
}
