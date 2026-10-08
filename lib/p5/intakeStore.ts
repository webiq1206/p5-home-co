import {createHash} from 'node:crypto';
import {INTAKE_SUBMISSION_KEY,intakeReceipt,type IntakeSnapshot,type IntakeReceipt} from './intakeContract.ts';
import {INTAKE_RECIPIENTS} from './intakePolicy.ts';
import {deliveryReason} from './intakeDeliveryPolicy.ts';

export type IntakeQuery=(statement:string,values?:unknown[])=>ReturnType<typeof import('./database.ts').query>;
export type IntakeRow=Awaited<ReturnType<IntakeQuery>>[number];
/** JSONB reorders object keys; preserve arrays while canonicalizing every object. */
export const intakeDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex');
export const snapshotKey=(revision:number)=>`intake-snapshot-v1:${revision}`;
export const deliveryKey=(revision:number)=>`intake-delivery-v1:${revision}`;
export class IntakeConflict extends Error {}

/** All state changes are one SQL statement on the existing work table. No new production DDL.
 * Immutable revision snapshot and recoverable downstream work commit together. */
export const SAVE_INTAKE_SQL=`WITH owned AS (
 SELECT id FROM p5_estimator_drafts WHERE id=$1 AND revision=$2 AND brand=$3 AND status='draft' FOR UPDATE
), available AS (
 SELECT id FROM owned WHERE NOT EXISTS (SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key='intake-transfer-lock-v2' AND payload->>'state' IS DISTINCT FROM 'cancelled')
), saved AS (
 INSERT INTO p5_estimator_work(draft_id,work_key,payload)
 SELECT id,$4,$5::jsonb FROM available ON CONFLICT(draft_id,work_key) DO NOTHING RETURNING draft_id
), delivery AS (
 INSERT INTO p5_estimator_work(draft_id,work_key,payload)
 SELECT draft_id,$6,$7::jsonb FROM saved ON CONFLICT(draft_id,work_key) DO NOTHING RETURNING draft_id
), latest AS (
 INSERT INTO p5_estimator_work(draft_id,work_key,payload)
 SELECT draft_id,$8,$5::jsonb FROM saved
 ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
 WHERE (p5_estimator_work.payload->'snapshot'->>'revision')::integer < $2
 RETURNING draft_id
) SELECT draft_id FROM saved`;

export function intakeStore(query:IntakeQuery,now=()=>new Date().toISOString()) {
  async function read(draftId:string,revision?:number):Promise<IntakeReceipt|null>{
    const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draftId,revision===undefined?INTAKE_SUBMISSION_KEY:snapshotKey(revision)]);
    if(!row?.payload?.snapshot)return null;
    const snapshot=row.payload.snapshot as IntakeSnapshot;
    const [job]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draftId,deliveryKey(snapshot.revision)]);
    const channels=job?.payload?.channels||{};
    return {...intakeReceipt(snapshot,{customer:channels.customer?.status||'pending',team:channels.team?.status||'pending',crm:channels.crm?.status||'pending'}),deliveryDetails:{customer:deliveryReason(channels.customer?.reason),team:deliveryReason(channels.team?.reason),crm:deliveryReason(channels.crm?.reason)}};
  }
  async function save(input:Omit<IntakeSnapshot,'savedAt'>):Promise<IntakeReceipt>{
    const digest=intakeDigest(input),snapshot={...input,savedAt:now()};
    const job={schema:1,projectId:input.projectId,revision:input.revision,channels:{
      customer:{status:input.contact.email?'pending':'not-requested',recipient:input.contact.email,attempts:0,reason:input.contact.email?'runtime-proof-pending':undefined},team:{status:'pending',recipient:INTAKE_RECIPIENTS[input.currentSite],attempts:0,reason:'runtime-proof-pending'},crm:{status:'pending',attempts:0,reason:'crm-contract-pending'}}};
    await query(SAVE_INTAKE_SQL,[input.draftId,input.revision,input.currentSite,snapshotKey(input.revision),JSON.stringify({digest,snapshot}),deliveryKey(input.revision),JSON.stringify(job),INTAKE_SUBMISSION_KEY]);
    const [saved]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[input.draftId,snapshotKey(input.revision)]);
    if(!saved?.payload||saved.payload.digest!==digest)throw new IntakeConflict('Your project changed before submission was confirmed. Refresh the saved project before retrying.');
    const receipt=await read(input.draftId,input.revision);
    if(!receipt)throw new Error('intake-receipt-unavailable');
    return receipt;
  }
  return {read,save};
}
