import {randomUUID} from 'node:crypto';
import {query} from './database';
import {DraftError} from './store';

/** Short database leases serialize retries across autoscale instances. No background process is required. */
export async function claimWork(draftId:string,workKey:string,initial:unknown,seconds=180){
  await query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING",[draftId,workKey,JSON.stringify(initial)]);
  const token=randomUUID();
  const [row]=await query("UPDATE p5_estimator_work SET lease_token=$3,lease_until=now()+($4 * interval '1 second'),updated_at=now() WHERE draft_id=$1 AND work_key=$2 AND (lease_until IS NULL OR lease_until<now()) RETURNING payload",[draftId,workKey,token,seconds]);
  return row?{token,payload:row.payload}:null;
}
export async function writeWork(draftId:string,workKey:string,token:string,payload:unknown,release=false){
  const rows=await query("UPDATE p5_estimator_work SET payload=$4::jsonb,updated_at=now(),lease_until=CASE WHEN $5 THEN NULL ELSE lease_until END,lease_token=CASE WHEN $5 THEN NULL ELSE lease_token END WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3 RETURNING work_key",[draftId,workKey,token,JSON.stringify(payload),release]);
  if(!rows.length)throw new DraftError('This step is being retried in another tab. Your saved progress is intact.',409);
}
export async function releaseWork(draftId:string,workKey:string,token:string){
  await query('UPDATE p5_estimator_work SET lease_until=NULL,lease_token=NULL WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3',[draftId,workKey,token]);
}
