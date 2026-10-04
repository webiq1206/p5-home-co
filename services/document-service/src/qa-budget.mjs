import {createHash,randomUUID} from 'node:crypto';
import {ServiceError} from './core.mjs';

// QA only. This ledger is authoritative for BOTH the website broker and reader.
// No HTTP endpoint provisions runs, bindings or permits. Ordinary customers do
// not acquire a binding and continue through their existing provider path.
export const QA_RUN='p5-acceptance-20261004';
export const QA_MODEL='claude-haiku-4-5-20251001';
export const QA_URL='https://api.anthropic.com/v1/messages';
export const QA_LIMITS=Object.freeze({historical:3250000,historicalUnknown:390000,fresh:2000000,umbrella:12000000,firstCall:450000,lot29Historical:1000000,lot29Ceiling:3000000});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hold=code=>new ServiceError('qa-'+code,422);
export const QA_DDL=`
CREATE TABLE IF NOT EXISTS p5ds_qa_runs (
 run_id text PRIMARY KEY CHECK(run_id='p5-acceptance-20261004'),
 historical_microusd bigint NOT NULL CHECK(historical_microusd=3250000),
 historical_unknown_microusd bigint NOT NULL CHECK(historical_unknown_microusd=390000),
 allowance_microusd bigint NOT NULL CHECK(allowance_microusd=2000000),
 liability_microusd bigint NOT NULL DEFAULT 0 CHECK(liability_microusd>=0),
 blocked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS p5ds_qa_projects (
 tenant text NOT NULL,project text NOT NULL,run_id text NOT NULL REFERENCES p5ds_qa_runs(run_id),
 lot29 boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant,project)
);
CREATE TABLE IF NOT EXISTS p5ds_qa_intents (
 request_hash text PRIMARY KEY,run_id text NOT NULL REFERENCES p5ds_qa_runs(run_id),
 tenant text NOT NULL,project text NOT NULL,boundary text NOT NULL,request jsonb NOT NULL,
 maximum_microusd bigint NOT NULL CHECK(maximum_microusd>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS p5ds_qa_calls (
 slot text PRIMARY KEY,run_id text NOT NULL REFERENCES p5ds_qa_runs(run_id),
 request_hash text NOT NULL UNIQUE REFERENCES p5ds_qa_intents(request_hash),
 review_note text NOT NULL,status text NOT NULL CHECK(status IN ('permitted','in_flight','settled','unknown')),
 reserved_microusd bigint NOT NULL CHECK(reserved_microusd>0),actual_microusd bigint,
 response jsonb,provider_request_id text,boundary_token text,created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,settled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS p5ds_qa_one_active ON p5ds_qa_calls(run_id)
 WHERE status IN ('permitted','in_flight');
`;

/** Conservative FULL context-window bound, not a heuristic text-token estimate.
 * Official Haiku4.5: 200K context, $1/MTok input and $5/MTok output (reviewed
 * 2026-10-04, platform.claude.com/docs/en/models/overview and /about-claude/pricing).
 * No cache writes, server tools, paid search, priority tier or alternate model.
 * Removing cache_control changes caching only; the exact resulting wire is
 * retained for native inspection BEFORE any permit can be granted.
 */
export function qaWire(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.model!==QA_MODEL)throw hold('unsupported-model');
 const allowed=new Set(['model','max_tokens','system','messages','tools','tool_choice','temperature','stream','service_tier','output_config']);
 if(Object.keys(input).some(k=>!allowed.has(k)))throw hold('unsupported-request-option');
 if(!Number.isSafeInteger(input.max_tokens)||input.max_tokens<1||input.max_tokens>48000)throw hold('output-limit');
 if(!Array.isArray(input.messages)||!input.messages.length)throw hold('messages-required');
 if(input.tools?.some(t=>!t||t.type||typeof t.name!=='string'||!t.input_schema))throw hold('server-tools-not-budgeted');
 if(input.service_tier&&!['auto','standard_only'].includes(input.service_tier))throw hold('unsupported-tier');
 const strip=value=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='cache_control').map(([k,v])=>[k,strip(v)])):value;
 const body={...strip(input),stream:false,service_tier:'standard_only'};
 // The API context cap bounds every input token, including image/schema tokens.
 const maximum=200000+input.max_tokens*5;
 if(maximum>QA_LIMITS.firstCall)throw hold('request-exceeds-call-ceiling');
 return {body,maximum};
}

export class QaBudget{
 constructor(store,config,request=fetch){this.store=store;this.config=config;this.request=request;}
 async init(){await this.store.pool.query(QA_DDL);}
 async binding(tenant,project){return (await this.store.pool.query('SELECT * FROM p5ds_qa_projects WHERE tenant=$1 AND project=$2',[tenant,project])).rows[0]||null;}
 // Server-side operator function only. Immutable singleton prevents fresh-run
 // recreation from resetting lifetime usage. Historical unknown remains held.
 async provision(projects){
  if(!Array.isArray(projects)||!projects.length||projects.some(p=>p.tenant!=='p5homeco.com'||!/^qa-paid-[a-f0-9-]{36}$/.test(p.project)))throw hold('invalid-project-binding');
  return this.store.transaction(async c=>{
   await c.query(`INSERT INTO p5ds_qa_runs(run_id,historical_microusd,historical_unknown_microusd,allowance_microusd)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[QA_RUN,QA_LIMITS.historical,QA_LIMITS.historicalUnknown,QA_LIMITS.fresh]);
   await c.query('SELECT run_id FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[QA_RUN]);
   for(const p of projects){
    await c.query('INSERT INTO p5ds_qa_projects(tenant,project,run_id,lot29) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[p.tenant,p.project,QA_RUN,!!p.lot29]);
    const prior=(await c.query('SELECT * FROM p5ds_qa_projects WHERE tenant=$1 AND project=$2',[p.tenant,p.project])).rows[0];
    if(prior.run_id!==QA_RUN||prior.lot29!==!!p.lot29)throw hold('binding-changed');
   }
  });
 }
 async capture(tenant,project,boundary,input){
  const binding=await this.binding(tenant,project);if(!binding)throw hold('binding-required');
  if(typeof boundary!=='string'||boundary.length<1||boundary.length>180)throw hold('boundary-required');
  const {body,maximum}=qaWire(input),requestHash=digest({tenant,project,boundary,body});
  await this.store.pool.query(`INSERT INTO p5ds_qa_intents(request_hash,run_id,tenant,project,boundary,request,maximum_microusd)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING`,[requestHash,binding.run_id,tenant,project,boundary,JSON.stringify(body),maximum]);
  return {binding,body,maximum,requestHash};
 }
 // Each permit is an independently reviewed exact wire. There is no automatic
 // permit issuer or caller-chosen retry slot, even when a changed prompt hashes
 // differently. A second call stops until its saved intent is inspected.
 async permit(requestHash,slot,reviewNote){
  if(!/^[a-z0-9][a-z0-9._:-]{5,120}$/.test(slot)||typeof reviewNote!=='string'||reviewNote.trim().length<30)throw hold('review-required');
  return this.store.transaction(async c=>{
   const run=(await c.query('SELECT * FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[QA_RUN])).rows[0];
   if(!run||run.blocked)throw hold('run-blocked');
   const intent=(await c.query('SELECT * FROM p5ds_qa_intents WHERE request_hash=$1 AND run_id=$2',[requestHash,QA_RUN])).rows[0];
   if(!intent)throw hold('intent-required');
   if((await c.query("SELECT 1 FROM p5ds_qa_calls WHERE run_id=$1 AND status IN ('permitted','in_flight','unknown')",[QA_RUN])).rows.length)throw hold('prior-call-held');
   const maximum=Number(intent.maximum_microusd);
   if(maximum>QA_LIMITS.firstCall||Number(run.liability_microusd)+maximum>QA_LIMITS.fresh||QA_LIMITS.historical+Number(run.liability_microusd)+maximum>QA_LIMITS.umbrella)throw hold('budget-exhausted');
   await c.query("INSERT INTO p5ds_qa_calls(slot,run_id,request_hash,review_note,status,reserved_microusd) VALUES($1,$2,$3,$4,'permitted',$5)",[slot,QA_RUN,requestHash,reviewNote,maximum]);
   await c.query('UPDATE p5ds_qa_runs SET liability_microusd=liability_microusd+$2 WHERE run_id=$1',[QA_RUN,maximum]);
  });
 }
 async begin(intent){
  return this.store.transaction(async c=>{
   const run=(await c.query('SELECT * FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[intent.binding.run_id])).rows[0];
   if(!run||run.blocked||(await c.query("SELECT 1 FROM p5ds_qa_calls WHERE run_id=$1 AND status IN ('in_flight','unknown')",[run.run_id])).rows.length)throw hold('run-held');
   const token=randomUUID();
   const result=await c.query(`UPDATE p5ds_qa_calls SET status='in_flight',started_at=now(),boundary_token=$3
    WHERE run_id=$1 AND request_hash=$2 AND status='permitted' RETURNING *`,[run.run_id,intent.requestHash,token]);
   if(result.rows.length!==1)throw hold('exact-request-review-required');
   return result.rows[0];
  });
 }
 async unknown(call){
  await this.store.transaction(async c=>{
   await c.query('SELECT run_id FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[call.run_id]);
   await c.query("UPDATE p5ds_qa_calls SET status='unknown',settled_at=now() WHERE slot=$1 AND status='in_flight'",[call.slot]);
   await c.query('UPDATE p5ds_qa_runs SET blocked=true WHERE run_id=$1',[call.run_id]);
  });
 }
 async settle(call,intent,data,requestId){
  // Persist the complete response BEFORE interpreting usage or reducing liability.
  const saved=await this.store.pool.query("UPDATE p5ds_qa_calls SET response=$2::jsonb,provider_request_id=$3 WHERE slot=$1 AND status='in_flight' AND boundary_token=$4 RETURNING slot",[call.slot,JSON.stringify(data),requestId,call.boundary_token]);
  if(saved.rows.length!==1)throw hold('receipt-not-saved');
  const u=data?.usage,valid=n=>Number.isSafeInteger(n)&&n>=0;
  if(data.model!==QA_MODEL||!requestId||!u||!valid(u.input_tokens)||!valid(u.output_tokens)||u.input_tokens>200000||u.output_tokens>intent.body.max_tokens||Number(u.cache_creation_input_tokens||0)!==0||Number(u.cache_read_input_tokens||0)!==0||u.server_tool_use&&Object.values(u.server_tool_use).some(Number))throw hold('usage-unverified');
  const actual=u.input_tokens+u.output_tokens*5;if(actual>Number(call.reserved_microusd))throw hold('usage-over-reservation');
  await this.store.transaction(async c=>{
   const run=(await c.query('SELECT * FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[call.run_id])).rows[0];
   if(run.blocked)throw hold('run-blocked');
   const changed=await c.query("UPDATE p5ds_qa_calls SET status='settled',actual_microusd=$2,settled_at=now() WHERE slot=$1 AND status='in_flight' AND boundary_token=$3 RETURNING slot",[call.slot,actual,call.boundary_token]);
   if(changed.rows.length!==1)throw hold('settlement-state-changed');
   await c.query('UPDATE p5ds_qa_runs SET liability_microusd=liability_microusd-$2+$3 WHERE run_id=$1',[call.run_id,Number(call.reserved_microusd),actual]);
  });
 }
 async dispatch(tenant,project,boundary,input,signal){
  const intent=await this.capture(tenant,project,boundary,input);
  const prior=(await this.store.pool.query("SELECT response FROM p5ds_qa_calls WHERE request_hash=$1 AND status='settled'",[intent.requestHash])).rows[0];
  if(prior?.response)return prior.response;
  if(this.config.provider!=='anthropic'||this.config.model!==QA_MODEL||!this.config.key)throw hold('resident-provider-unavailable');
  signal?.throwIfAborted();
  const call=await this.begin(intent);
  try{
   const response=await this.request(QA_URL,{method:'POST',headers:{'content-type':'application/json','x-api-key':this.config.key,'anthropic-version':'2023-06-01'},body:JSON.stringify(intent.body),redirect:'error',signal:signal||AbortSignal.timeout(180000)});
   const raw=await response.text();if(raw.length>8*1024*1024)throw hold('response-too-large');
   let data;try{data=JSON.parse(raw);}catch{throw hold('response-not-json');}
   const requestId=response.headers.get('request-id')||data.id||'';
   if(!response.ok){await this.store.pool.query('UPDATE p5ds_qa_calls SET response=$2::jsonb,provider_request_id=$3 WHERE slot=$1',[call.slot,JSON.stringify(data),requestId]);throw hold('provider-http-'+response.status);}
   await this.settle(call,intent,data,requestId);
   return data;
  }catch(error){await this.unknown(call).catch(()=>{});throw error;}
 }
}
