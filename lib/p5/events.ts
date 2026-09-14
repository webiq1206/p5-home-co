import {query} from './database.ts';
import {ESTIMATOR_BRAND} from './brand.ts';

/** One durable record per processing outcome so a live failure can be traced
 * without host log access: which site and estimator, which file and stage,
 * which provider and model, the sanitized error, duration, attempt number,
 * whether a fallback ran, and whether the step finally succeeded. Document
 * contents are never stored here. */
export interface EstimatorEvent {
  draftId?:string|null;
  /** Service the visitor chose (re10, kitchen, ...) or unknown. */
  estimator?:string|null;
  kind:'analysis'|'pricing'|'upload'|'draft'|'submit'|'delivery';
  stage:string;
  file?:string|null;
  provider?:string|null;
  model?:string|null;
  status?:number|null;
  /** Short machine code such as provider-timeout, provider-400, invalid-extraction. */
  code?:string|null;
  message?:string|null;
  durationMs?:number|null;
  attempt?:number|null;
  fallback?:boolean;
  outcome:'ok'|'failed'|'retry';
  meta?:Record<string,unknown>|null;
}
export const EVENTS_TABLE_SQL=`CREATE TABLE IF NOT EXISTS p5_estimator_events (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), draft_id uuid, brand text NOT NULL, estimator text, kind text NOT NULL, stage text NOT NULL, file text, provider text, model text, status integer, code text, message text, duration_ms integer, attempt integer, fallback boolean NOT NULL DEFAULT false, outcome text NOT NULL, meta jsonb)`;
export const EVENTS_INDEX_SQL=`CREATE INDEX IF NOT EXISTS p5_estimator_events_draft ON p5_estimator_events(draft_id,created_at)`;
const clip=(value:unknown,max:number)=>{const text=typeof value==='string'?value:value==null?null:String(value);return text==null?null:text.replace(/\s+/g,' ').trim().slice(0,max)||null;};
/** Redact anything that looks like a credential before a message is stored or printed. */
export function sanitizeEventMessage(value:unknown):string|null{
  const text=clip(value,600);
  return text?text.replace(/(?:sk|key|token|bearer)[-_ ][A-Za-z0-9_-]{8,}/gi,'[redacted]'):null;
}
let schemaReady:Promise<void>|null=null;
export function ensureEventsSchema(){
  if(!schemaReady)schemaReady=(async()=>{await query(EVENTS_TABLE_SQL);await query(EVENTS_INDEX_SQL);})().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}
/** Record an event. Never throws and never blocks the caller for long: the
 * console line is written immediately and the row is inserted best-effort. */
export function recordEvent(event:EstimatorEvent):Promise<void>{
  const row={
    draftId:event.draftId&&/^[a-f0-9-]{36}$/i.test(event.draftId)?event.draftId:null,brand:ESTIMATOR_BRAND.domain,estimator:clip(event.estimator,60),kind:event.kind,stage:clip(event.stage,80)||'unknown',
    file:clip(event.file,200),provider:clip(event.provider,40),model:clip(event.model,80),status:Number.isInteger(event.status)?event.status:null,code:clip(event.code,80),message:sanitizeEventMessage(event.message),
    durationMs:Number.isFinite(event.durationMs as number)?Math.round(event.durationMs as number):null,attempt:Number.isInteger(event.attempt)?event.attempt:null,fallback:Boolean(event.fallback),outcome:event.outcome,meta:event.meta||null,
  };
  console.error(`[p5-event] ${JSON.stringify(row)}`);
  if(!process.env.DATABASE_URL)return Promise.resolve();
  return ensureEventsSchema().then(()=>query('INSERT INTO p5_estimator_events(draft_id,brand,estimator,kind,stage,file,provider,model,status,code,message,duration_ms,attempt,fallback,outcome,meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)',[row.draftId,row.brand,row.estimator,row.kind,row.stage,row.file,row.provider,row.model,row.status,row.code,row.message,row.durationMs,row.attempt,row.fallback,row.outcome,row.meta?JSON.stringify(row.meta):null])).then(()=>undefined).catch(error=>{console.error(`[p5-event] not stored: ${error instanceof Error?error.message:String(error)}`);});
}
/** Recent events for one draft, newest first. Messages are already sanitized. */
export async function draftEvents(draftId:string,limit=60){
  if(!process.env.DATABASE_URL)return [];
  try{await ensureEventsSchema();return await query('SELECT id,created_at AS "createdAt",estimator,kind,stage,file,provider,model,status,code,message,duration_ms AS "durationMs",attempt,fallback,outcome,meta FROM p5_estimator_events WHERE draft_id=$1 ORDER BY id DESC LIMIT $2',[draftId,limit]);}
  catch{return [];}
}
/** Site-wide recent failures for the administrator. */
export async function recentFailures(limit=200){
  await ensureEventsSchema();
  return query("SELECT id,created_at AS \"createdAt\",draft_id AS \"draftId\",estimator,kind,stage,file,provider,model,status,code,message,duration_ms AS \"durationMs\",attempt,fallback,outcome,meta FROM p5_estimator_events WHERE outcome<>'ok' ORDER BY id DESC LIMIT $1",[limit]);
}
/** Classify a thrown error into a short code and status for an event. */
export function describeError(error:unknown):{code:string;status:number|null;message:string}{
  const message=error instanceof Error?error.message:String(error);
  const name=error instanceof Error?error.name:'';
  if(name==='ProcessingDeadlineError'||/ProcessingDeadline/.test(name))return {code:'deadline',status:null,message};
  if(name==='TimeoutError'||name==='AbortError'||/timed? ?out|aborted/i.test(message))return {code:'provider-timeout',status:null,message};
  const status=message.match(/\((\d{3})\)/)?.[1];
  if(message==='analysis-busy')return {code:'provider-429',status:429,message};
  if(status)return {code:`provider-${status}`,status:Number(status),message};
  if(/invalid|Invalid/.test(message))return {code:'invalid-extraction',status:null,message};
  if(/database-timeout|persistence-unconfigured/.test(message))return {code:'database',status:null,message};
  return {code:message.split(':')[0].slice(0,60)||'error',status:null,message};
}
