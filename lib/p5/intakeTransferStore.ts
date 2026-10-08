import {createHash} from 'node:crypto';
import type {IntakeQuery} from './intakeStore.ts';
import {intakeSite,INTAKE_SITES,type IntakeSite} from './intakePolicy.ts';
import {SCOPE_FILE_COUNT,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,type ScopeUpload} from './scope.ts';
import {isOperatorQaCase} from './qaCases.ts';

export const TRANSFER_KEY='intake-transfer-lock-v2';
export const IMPORT_KEY='intake-import-v2';
export const TRANSFER_ADMISSION_MS=30*60*1000;
export const TRANSFER_SOURCE_STATUS='intake-transferring';
export const TRANSFER_IMPORT_STATUS='intake-importing';
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const digest=/^[a-f\d]{64}$/;
export class IntakeTransferConflict extends Error {}
export interface TransferBinding {
 transferId:string;projectId:string;sourceSite:IntakeSite;destinationSite:IntakeSite;sourceOrigin:string;
 sourceDraftId:string;sourceRevision:number;destinationDraftId:string;destinationKeyHash:string;grantHash:string;
}
export interface TransferBundle {schema:2;binding:TransferBinding;payload:Record<string,unknown>;files:ScopeUpload[];digest:string}
export interface TransferReadyReceipt {schema:2;state:'ready';binding:TransferBinding;digest:string;destinationRevision:number;files:ScopeUpload[];readyAt:string}
export interface TransferSource {
 schema:2;binding:TransferBinding;state:'freezing'|'prepared'|'importing'|'acknowledged'|'cancelled';expiresAt:string;
 bundle?:TransferBundle;receipt?:TransferReadyReceipt;
}
interface TransferImport {schema:2;state:'importing'|'ready';bundle:TransferBundle;receipt?:TransferReadyReceipt}

export const transferSecretHash=(secret:string)=>createHash('sha256').update(secret).digest('hex');
export const transferOrigin=(site:IntakeSite)=>`https://${INTAKE_SITES[site].domain}`;
/** Source labels disambiguate duplicate names using the first eight upload-id
 * characters. Keep that evidence label while allocating a distinct destination
 * storage identity, including transfers back to a site holding the original. */
export function transferredFileId(sourceFileId:string,destinationDraftId:string){
 if(!uuid.test(sourceFileId)||!uuid.test(destinationDraftId))throw new IntakeTransferConflict('Invalid transferred file identity.');
 const value=sourceFileId.slice(0,8).toLowerCase()+transferSecretHash(`p5-intake-file-v2:${sourceFileId.toLowerCase()}:${destinationDraftId.toLowerCase()}`).slice(0,24);
 return `${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`;
}
export function requireTransferBinding(value:TransferBinding):TransferBinding {
 if(!value||!uuid.test(value.transferId)||!uuid.test(value.sourceDraftId)||!uuid.test(value.destinationDraftId)||value.sourceDraftId===value.destinationDraftId
   ||!intakeSite(value.sourceSite)||!intakeSite(value.destinationSite)||value.sourceSite===value.destinationSite
   ||![`https://${INTAKE_SITES[value.sourceSite].domain}`,`https://www.${INTAKE_SITES[value.sourceSite].domain}`].includes(value.sourceOrigin)
   ||!Number.isSafeInteger(value.sourceRevision)||value.sourceRevision<1||!digest.test(value.destinationKeyHash)||!digest.test(value.grantHash)
   ||typeof value.projectId!=='string'||!/^((p5|construction|remodeling|handyman|cabinet):)[a-f\d-]{36}$/i.test(value.projectId)
   ||Object.keys(value).length!==10)throw new IntakeTransferConflict('Invalid project transfer identity.');
 return value;
}
// jsonb does not preserve object insertion order. Hash the same canonical representation on both sites.
const transferDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)).digest('hex');
const equalBinding=(a:TransferBinding,b:TransferBinding)=>transferDigest(a)===transferDigest(b);
function requireFiles(files:ScopeUpload[]) {
 if(!Array.isArray(files)||files.length>SCOPE_FILE_COUNT||new Set(files.map(f=>f.sha256)).size!==files.length
   ||files.some(f=>!uuid.test(f.id)||typeof f.name!=='string'||!f.name||f.name.length>4096||typeof f.type!=='string'||f.type.length>200||!digest.test(f.sha256||'')||!Number.isSafeInteger(f.size)||f.size<1||f.size>SCOPE_FILE_LIMIT)
   ||files.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new IntakeTransferConflict('The saved file manifest is invalid.');
}
function bundleDigest(bundle:Omit<TransferBundle,'digest'>){return transferDigest(bundle);}
export function requireTransferBundle(bundle:TransferBundle):TransferBundle {
 requireTransferBinding(bundle?.binding);requireFiles(bundle.files);
 if(bundle.schema!==2||!bundle.payload||Array.isArray(bundle.payload)||typeof bundle.payload!=='object'||JSON.stringify(bundle.payload).length>32*1024*1024
   ||bundle.digest!==bundleDigest({schema:2,binding:bundle.binding,payload:bundle.payload,files:bundle.files}))throw new IntakeTransferConflict('The project transfer snapshot failed verification.');
 return bundle;
}
function sameFiles(expected:ScopeUpload[],actual:ScopeUpload[]){
 return expected.length===actual.length&&expected.every(f=>actual.some(a=>a.name===f.name&&a.type===f.type&&a.size===f.size&&a.sha256===f.sha256));
}
export function requireTransferReceipt(receipt:TransferReadyReceipt,bundle:TransferBundle):TransferReadyReceipt {
 if(!receipt||receipt.schema!==2||receipt.state!=='ready'||!equalBinding(receipt.binding,bundle.binding)||receipt.digest!==bundle.digest
   ||!Number.isSafeInteger(receipt.destinationRevision)||receipt.destinationRevision<1||!Number.isFinite(Date.parse(receipt.readyAt)))throw new IntakeTransferConflict('The destination has not confirmed this complete project.');
 requireFiles(receipt.files);if(!sameFiles(bundle.files,receipt.files))throw new IntakeTransferConflict('The destination file manifest is incomplete.');return receipt;
}

/** Existing draft/work rows provide the durable ownership state. The source is frozen before
 * sealing files, so file writers must acquire the draft lock and require status='draft'.
 * This module performs no network I/O and cannot infer destination success from a browser claim. */
export function intakeTransferStore(query:IntakeQuery,now=()=>Date.now()) {
 const readSource=async(id:string):Promise<TransferSource|null>=>{
  const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,TRANSFER_KEY]);return row?.payload||null;
 };
 async function ownedSource(binding:TransferBinding){
  requireTransferBinding(binding);const source=await readSource(binding.sourceDraftId);
  if(!source||!equalBinding(source.binding,binding))throw new IntakeTransferConflict('This transfer does not match the saved project.');return source;
 }
 async function prepare(binding:TransferBinding):Promise<TransferSource>{
  requireTransferBinding(binding);
  if(isOperatorQaCase(binding.sourceDraftId)||isOperatorQaCase(binding.destinationDraftId))throw new IntakeTransferConflict('Operator QA projects cannot be transferred through public intake.');
  const prior=await readSource(binding.sourceDraftId);
  if(prior?.state==='cancelled'&&equalBinding(prior.binding,binding))throw new IntakeTransferConflict('This transfer was cancelled. Prepare a new transfer.');
  const value:TransferSource={schema:2,binding,state:'freezing',expiresAt:new Date(now()+TRANSFER_ADMISSION_MS).toISOString()};
  await query(`WITH frozen AS (
   UPDATE p5_estimator_drafts SET status=$4,updated_at=now()
   WHERE id=$1 AND revision=$2 AND brand=$3 AND status='draft'
    AND COALESCE(payload->'intake'->>'projectId',brand||':'||id::text)=$8
    AND NOT EXISTS (SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$5
      AND (payload->>'state' IS DISTINCT FROM 'cancelled' OR payload->'binding'->>'transferId' IS NOT DISTINCT FROM $7)) RETURNING id
  ) INSERT INTO p5_estimator_work(draft_id,work_key,payload)
   SELECT id,$5,$6::jsonb FROM frozen
   ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
   WHERE p5_estimator_work.payload->>'state'='cancelled' AND p5_estimator_work.payload->'binding'->>'transferId'<>$7`,
   [binding.sourceDraftId,binding.sourceRevision,binding.sourceSite,TRANSFER_SOURCE_STATUS,TRANSFER_KEY,JSON.stringify(value),binding.transferId,binding.projectId]);
  const saved=await ownedSource(binding);
  if(saved.state==='cancelled')throw new IntakeTransferConflict('This transfer was cancelled. Prepare a new transfer.');return saved;
 }
 async function seal(binding:TransferBinding):Promise<TransferSource>{
  const source=await ownedSource(binding);if(source.state!=='freezing'){
   if(!source.bundle||source.state==='cancelled')throw new IntakeTransferConflict('This project transfer is not available.');return source;
  }
  // A separate statement sees every file commit that completed before the freeze obtained its lock.
  const [draft]=await query('SELECT payload,status,revision,brand FROM p5_estimator_drafts WHERE id=$1',[binding.sourceDraftId]);
  if(draft?.status!==TRANSFER_SOURCE_STATUS||draft.revision!==binding.sourceRevision||draft.brand!==binding.sourceSite)throw new IntakeTransferConflict('The source project changed before it was frozen.');
  if((draft.payload?.intake?.projectId||`${draft.brand}:${binding.sourceDraftId}`)!==binding.projectId)throw new IntakeTransferConflict('The project identity does not match its original saved request.');
  const restrictions=await query("SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND work_key IN ('qa-no-provider-v1','qa-bounded-provider-v1')",[binding.sourceDraftId]);
  if(restrictions.length){await cancel(binding);throw new IntakeTransferConflict('This restricted QA project must remain in its original workspace. Its provider and contact restrictions are preserved.');}
  const submissions=await query("SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND (work_key IN ('intake-submission-v1','submit-request-v1') OR work_key LIKE 'version-v1:%') LIMIT 1",[binding.sourceDraftId]);
  const [outboxTable]=await query("SELECT to_regclass('public.p5_estimator_outbox') AS table_name");
  const delivered=outboxTable?.table_name?await query('SELECT draft_id FROM p5_estimator_outbox WHERE draft_id=$1 LIMIT 1',[binding.sourceDraftId]):[];
  const [historyTable]=await query("SELECT to_regclass('public.p5_estimator_history') AS table_name");
  const history=historyTable?.table_name?await query('SELECT draft_id FROM p5_estimator_history WHERE draft_id=$1 LIMIT 1',[binding.sourceDraftId]):[];
  const [reviewTable]=await query("SELECT to_regclass('public.p5_estimator_review_requests') AS table_name");
  const reviews=reviewTable?.table_name?await query('SELECT draft_id FROM p5_estimator_review_requests WHERE draft_id=$1 LIMIT 1',[binding.sourceDraftId]):[];
  if(submissions.length||reviews.length||delivered.length||history.length){
   await cancel(binding);
   throw new IntakeTransferConflict('This project already has a submitted request. Contact its assigned team to change responsibility; its existing request is retained.');
  }
  const rows=await query('SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 ORDER BY created_at,id',[binding.sourceDraftId]);
  const files:ScopeUpload[]=rows.map(f=>({id:f.id,name:f.name,type:f.mime_type,size:Number(f.size_bytes),sha256:f.sha256,status:'stored'}));requireFiles(files);
  const base={schema:2 as const,binding,payload:draft.payload,files};const bundle:TransferBundle={...base,digest:bundleDigest(base)};requireTransferBundle(bundle);
  await query(`UPDATE p5_estimator_work SET payload=payload || $3::jsonb,updated_at=now()
   WHERE draft_id=$1 AND work_key=$2 AND payload->>'state'='freezing' AND payload->'binding'=$4::jsonb`,
   [binding.sourceDraftId,TRANSFER_KEY,JSON.stringify({state:'prepared',bundle}),JSON.stringify(binding)]);
  const saved=await ownedSource(binding);if(!saved.bundle||saved.state==='cancelled')throw new IntakeTransferConflict('This transfer was cancelled before copying began.');return saved;
 }
 async function claim(binding:TransferBinding):Promise<TransferBundle>{
  await ownedSource(binding);
  const [row]=await query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{state}','"importing"'::jsonb),updated_at=now()
   WHERE draft_id=$1 AND work_key=$2 AND payload->'binding'=$3::jsonb
    AND payload->>'state' IN ('prepared','importing') AND (payload->>'expiresAt')::timestamptz>$4::timestamptz RETURNING payload`,
   [binding.sourceDraftId,TRANSFER_KEY,JSON.stringify(binding),new Date(now()).toISOString()]);
  if(!row?.payload?.bundle)throw new IntakeTransferConflict('This transfer needs to be resumed from the original project. Its saved work is retained.');return requireTransferBundle(row.payload.bundle);
 }
 async function cancel(binding:TransferBinding):Promise<void>{
  await ownedSource(binding);
  const rows=await query(`WITH cancelled AS (
   UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{state}','"cancelled"'::jsonb),updated_at=now()
   WHERE draft_id=$1 AND work_key=$2 AND payload->'binding'=$3::jsonb AND payload->>'state' IN ('freezing','prepared','cancelled') RETURNING draft_id
  ) UPDATE p5_estimator_drafts SET status='draft',updated_at=now() WHERE id IN (SELECT draft_id FROM cancelled) AND status IN ($4,'draft') RETURNING id`,
   [binding.sourceDraftId,TRANSFER_KEY,JSON.stringify(binding),TRANSFER_SOURCE_STATUS]);
  if(!rows.length)throw new IntakeTransferConflict('Copying has already begun. Resume the same transfer; the original cannot be reopened while destination ownership is uncertain.');
 }
 /** Safely retire a seed whose prepare response never arrived. Incrementing the
  * exact source revision serializes against an in-flight prepare: its old revision
  * can no longer freeze the draft, even if it began before this statement. */
 async function abandon(sourceDraftId:string,transferId:string,sourceRevision:number){
  if(!uuid.test(sourceDraftId)||!uuid.test(transferId)||!Number.isSafeInteger(sourceRevision)||sourceRevision<1)throw new IntakeTransferConflict('Invalid transfer attempt.');
  const key=`intake-transfer-abandoned-v2:${transferId}`;
  const [prior]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[sourceDraftId,key]);
  if(prior?.payload?.sourceRevision===sourceRevision)return;
  const source=await readSource(sourceDraftId);
  if(source?.binding.transferId===transferId){
   if(source.binding.sourceRevision!==sourceRevision)throw new IntakeTransferConflict('The transfer revision changed.');
   await cancel(source.binding);return;
  }
  const rows=await query(`WITH retired AS (
   UPDATE p5_estimator_drafts SET revision=CASE WHEN revision=$2 THEN revision+1 ELSE revision END,updated_at=now()
   WHERE id=$1 AND status='draft' AND revision>=$2
    AND NOT EXISTS(SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$3 AND payload->>'state' IS DISTINCT FROM 'cancelled') RETURNING id
  ) INSERT INTO p5_estimator_work(draft_id,work_key,payload)
   SELECT id,$4,$5::jsonb FROM retired ON CONFLICT(draft_id,work_key) DO NOTHING RETURNING draft_id`,
   [sourceDraftId,sourceRevision,TRANSFER_KEY,key,JSON.stringify({transferId,sourceRevision,cancelled:true})]);
  if(rows.length)return;
  const latest=await readSource(sourceDraftId);
  if(latest?.binding.transferId===transferId&&latest.binding.sourceRevision===sourceRevision){await cancel(latest.binding);return;}
  const [saved]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[sourceDraftId,key]);
  if(saved?.payload?.sourceRevision===sourceRevision)return;
  throw new IntakeTransferConflict('A different transfer or saved submission is active. Its recovery is retained; reload the saved project before continuing.');
 }
 /** Renewal requires the source draft credential at the route boundary. Expiry never cancels ownership. */
 async function renew(binding:TransferBinding){
  await ownedSource(binding);
  const rows=await query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{expiresAt}',to_jsonb($4::text)),updated_at=now()
   WHERE draft_id=$1 AND work_key=$2 AND payload->'binding'=$3::jsonb AND payload->>'state' IN ('freezing','prepared','importing') RETURNING payload`,
   [binding.sourceDraftId,TRANSFER_KEY,JSON.stringify(binding),new Date(now()+TRANSFER_ADMISSION_MS).toISOString()]);
  if(!rows.length)throw new IntakeTransferConflict('This transfer can no longer be renewed.');return rows[0].payload as TransferSource;
 }
 const readImport=async(id:string):Promise<TransferImport|null>=>{
  const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,IMPORT_KEY]);return row?.payload||null;
 };
 async function beginImport(bundle:TransferBundle):Promise<TransferImport>{
  requireTransferBundle(bundle);const b=bundle.binding;
  if(isOperatorQaCase(b.sourceDraftId)||isOperatorQaCase(b.destinationDraftId))throw new IntakeTransferConflict('Operator QA projects cannot be imported through public intake.');
  const prior=bundle.payload.intake as Record<string,unknown>|undefined;
  const payload={...bundle.payload,reviewed:null,intake:{...prior,projectId:b.projectId,currentSite:b.destinationSite,originSite:prior?.originSite||b.sourceSite,version:1}};
  const imported:TransferImport={schema:2,state:'importing',bundle};
  await query(`WITH created AS (
   INSERT INTO p5_estimator_drafts(id,key_hash,brand,revision,status,payload)
   VALUES($1,$2,$3,1,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id
  ) INSERT INTO p5_estimator_work(draft_id,work_key,payload) SELECT id,$6,$7::jsonb FROM created`,
   [b.destinationDraftId,b.destinationKeyHash,b.destinationSite,TRANSFER_IMPORT_STATUS,JSON.stringify(payload),IMPORT_KEY,JSON.stringify(imported)]);
  const saved=await readImport(b.destinationDraftId);
  if(!saved||!equalBinding(saved.bundle.binding,b)||saved.bundle.digest!==bundle.digest)throw new IntakeTransferConflict('The destination identity is already in use. No existing project was replaced.');return saved;
 }
 async function completeImport(bundle:TransferBundle):Promise<TransferReadyReceipt>{
  requireTransferBundle(bundle);const b=bundle.binding,imported=await readImport(b.destinationDraftId);
  if(!imported||!equalBinding(imported.bundle.binding,b)||imported.bundle.digest!==bundle.digest)throw new IntakeTransferConflict('The imported project identity changed.');
  if(imported.receipt)return requireTransferReceipt(imported.receipt,bundle);
  const rows=await query('SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 ORDER BY created_at,id',[b.destinationDraftId]);
  const files:ScopeUpload[]=rows.map(f=>({id:f.id,name:f.name,type:f.mime_type,size:Number(f.size_bytes),sha256:f.sha256,status:'stored'}));requireFiles(files);
  if(!sameFiles(bundle.files,files))throw new IntakeTransferConflict('Some original files have not been copied and verified yet. Resume the transfer.');
  const receipt:TransferReadyReceipt={schema:2,state:'ready',binding:b,digest:bundle.digest,destinationRevision:1,files,readyAt:new Date(now()).toISOString()};
  // Import file writes are immutable, restricted to this bundle, and serialized on this same row.
  await query(`WITH ready AS (
   UPDATE p5_estimator_drafts SET status='draft',updated_at=now()
   WHERE id=$1 AND status=$2 AND key_hash=$3 AND revision=1 RETURNING id
  ) UPDATE p5_estimator_work SET payload=payload || $5::jsonb,updated_at=now()
   WHERE draft_id IN (SELECT id FROM ready) AND work_key=$4 AND payload->'bundle'->>'digest'=$6`,
   [b.destinationDraftId,TRANSFER_IMPORT_STATUS,b.destinationKeyHash,IMPORT_KEY,JSON.stringify({state:'ready',receipt}),bundle.digest]);
  const saved=await readImport(b.destinationDraftId);if(!saved?.receipt)throw new IntakeTransferConflict('The complete transfer could not be confirmed.');return requireTransferReceipt(saved.receipt,bundle);
 }
 /** The caller must obtain this receipt by an authenticated fetch from the fixed destination,
  * with redirects disabled. Never pass a receipt supplied by a browser here. */
 async function acknowledge(binding:TransferBinding,verified:TransferReadyReceipt){
  const source=await ownedSource(binding);if(!source.bundle)throw new IntakeTransferConflict('No transfer snapshot exists.');requireTransferReceipt(verified,source.bundle);
  const rows=await query(`WITH acknowledged AS (
   UPDATE p5_estimator_work SET payload=payload || $4::jsonb,updated_at=now()
   WHERE draft_id=$1 AND work_key=$2 AND payload->'binding'=$3::jsonb AND payload->>'state' IN ('importing','acknowledged') RETURNING draft_id
  ) UPDATE p5_estimator_drafts SET status='intake-transferred',updated_at=now()
   WHERE id IN (SELECT draft_id FROM acknowledged) AND status IN ($5,'intake-transferred') RETURNING id`,
   [binding.sourceDraftId,TRANSFER_KEY,JSON.stringify(binding),JSON.stringify({state:'acknowledged',receipt:verified}),TRANSFER_SOURCE_STATUS]);
  if(!rows.length)throw new IntakeTransferConflict('The transfer acknowledgement does not match the active transfer.');return verified;
 }
 return {readSource,prepare,seal,claim,cancel,abandon,renew,readImport,beginImport,completeImport,acknowledge};
}
