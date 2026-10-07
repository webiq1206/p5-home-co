import {randomUUID} from 'node:crypto';
import {query} from './database.ts';
import {DraftError} from './store.ts';
import {withQaWriteFence} from './qaOperationFence.ts';

/** Short database leases serialize retries across autoscale instances. No background process is required. */
export async function claimWork(...args:Parameters<typeof claimWorkImpl>){return withQaWriteFence(args[0],()=>claimWorkImpl(...args));}
async function claimWorkImpl(draftId:string,workKey:string,initial:unknown,seconds=180){
  await query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING",[draftId,workKey,JSON.stringify(initial)]);
  const token=randomUUID();
  const [row]=await query("UPDATE p5_estimator_work SET lease_token=$3,lease_until=now()+($4 * interval '1 second'),updated_at=now() WHERE draft_id=$1 AND work_key=$2 AND (lease_until IS NULL OR lease_until<now()) RETURNING payload",[draftId,workKey,token,seconds]);
  return row?{token,payload:row.payload}:null;
}
export async function writeWork(...args:Parameters<typeof writeWorkImpl>){return withQaWriteFence(args[0],()=>writeWorkImpl(...args));}
async function writeWorkImpl(draftId:string,workKey:string,token:string,payload:unknown,release=false){
  const rows=await query("UPDATE p5_estimator_work SET payload=$4::jsonb,updated_at=now(),lease_until=CASE WHEN $5 THEN NULL ELSE lease_until END,lease_token=CASE WHEN $5 THEN NULL ELSE lease_token END WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3 RETURNING work_key",[draftId,workKey,token,JSON.stringify(payload),release]);
  if(!rows.length)throw new DraftError('This step is being retried in another tab. Your saved progress is intact.',409);
}
/** Extend a held lease; a pass that stops renewing lets another instance resume the saved stages. */
export async function renewWork(draftId:string,workKey:string,token:string,seconds:number){
  await withQaWriteFence(draftId,()=>query("UPDATE p5_estimator_work SET lease_until=now()+($4 * interval '1 second') WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3",[draftId,workKey,token,seconds]));
}
export async function releaseWork(draftId:string,workKey:string,token:string){
  await withQaWriteFence(draftId,()=>query('UPDATE p5_estimator_work SET lease_until=NULL,lease_token=NULL WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3',[draftId,workKey,token]));
}

/** Server-owned snapshot and revision records only, scoped to one draft. The
 * caller must verify the complete work hash before reusing a pricing date. */
export async function readPricingSnapshots(draftId:string){
 return query(`SELECT w.work_key,w.payload,d.revision,d.payload->'contact' AS contact,d.updated_at AS revision_started_at
   FROM p5_estimator_work w JOIN p5_estimator_drafts d ON d.id=w.draft_id
   WHERE w.draft_id=$1 AND w.work_key LIKE 'pricing-v11-%'
     AND jsonb_typeof(w.payload->'pricingAt')='string'
   ORDER BY w.payload->>'pricingAt',w.work_key`,[draftId]);
}

/** Exact content-addressed provider replies survive a new job/release key.
 * Only this draft is searched; callers supply the full policy/content hash. */
export const SAVED_WORK_REPLY_QUERY = `
 SELECT reply FROM (
   SELECT w.updated_at, w.payload->'replies'->k.key AS reply
   FROM p5_estimator_work w CROSS JOIN jsonb_array_elements_text($2::jsonb) AS k(key)
   WHERE w.draft_id=$1 AND w.payload->'replies' ? k.key
 ) saved
 WHERE COALESCE(reply->>'timeouts','0')='0'
   AND COALESCE(reply->>'timedOut','false')<>'true'
   AND COALESCE(reply->>'outputLimited','false')<>'true'
   AND jsonb_typeof(reply->'sourceUrls')='array'
   AND ((reply ? 'value' AND reply->'value'<>'null'::jsonb)
     OR length(btrim(COALESCE(reply->>'sourceReport','')))>0)
 ORDER BY updated_at DESC LIMIT 1`;
export async function readSavedWorkReply(draftId:string,keys:string[]):Promise<unknown>{
 const rows=await query(SAVED_WORK_REPLY_QUERY,[draftId,JSON.stringify(keys)]);
 return rows[0]?.reply;
}
