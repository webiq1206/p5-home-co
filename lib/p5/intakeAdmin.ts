import {createHash} from 'node:crypto';
import {DraftError} from './store.ts';
import {json,failed} from './http.ts';
import {INTAKE_SUBMISSION_KEY,type IntakeSnapshot} from './intakeContract.ts';
import {snapshotKey,deliveryKey,type IntakeQuery} from './intakeStore.ts';
import {INTAKE_SITES,type IntakeSite} from './intakePolicy.ts';
import {ESTIMATOR_BUCKETS,uploadObjectKey} from './objectStorage.ts';
import {SCOPE_FILE_LIMIT} from './scope.ts';

export interface IntakeAdminDependencies {
 site:IntakeSite;authorize:()=>Promise<unknown>;query:IntakeQuery;
 readBytes:(row:Record<string,unknown>)=>Promise<Uint8Array>;
}
const id=(value:string|null)=>{if(!value||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw new DraftError('Invalid project or file reference.');return value;};
const revision=(value:string|null)=>{if(value===null)return null;const n=Number(value);if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(n))throw new DraftError('Invalid saved revision.');return n;};

const PAGE_SIZE=100;
function pageCursor(value:string|null):{updatedAt:string;draftId:string}|null {
 if(value===null)return null;
 try{
  if(value.length>512||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
  const parsed=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
  if(!Array.isArray(parsed)||parsed.length!==2||typeof parsed[1]!=='string'||typeof parsed[0]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed[0])||!Number.isFinite(Date.parse(parsed[0])))throw new Error();
  return {updatedAt:parsed[0],draftId:id(parsed[1])};
 }catch{throw new DraftError('Invalid project list cursor. Refresh the project requests.');}
}

/** Existing site administrator authentication is required before any project query.
 * A file is available only through the exact immutable submission that includes it. */
export function intakeAdminHandlers(deps:IntakeAdminDependencies){
 async function snapshot(draftId:string,requested:number|null){
  const [row]=await deps.query(`SELECT w.payload->'snapshot' AS snapshot FROM p5_estimator_work w
   JOIN p5_estimator_drafts d ON d.id=w.draft_id
   WHERE w.draft_id=$1 AND w.work_key=$2 AND d.brand=$3 AND w.payload->'snapshot'->>'currentSite'=$3`,
   [draftId,requested===null?INTAKE_SUBMISSION_KEY:snapshotKey(requested),deps.site]);
  const value=row?.snapshot as IntakeSnapshot|undefined;
  if(!value||value.draftId!==draftId||value.currentSite!==deps.site||(requested!==null&&value.revision!==requested))throw new DraftError('Saved project request not found.',404);
  return value;
 }
 async function get(request:Request){try{
  await deps.authorize();const params=new URL(request.url).searchParams;
  if(params.has('draftId')){
   if(params.has('cursor'))throw new DraftError('A project list cursor cannot select a submitted revision.');
   const saved=await snapshot(id(params.get('draftId')),revision(params.get('revision')));
   const [job]=await deps.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[saved.draftId,deliveryKey(saved.revision)]);
   return json({snapshot:saved,delivery:job?.payload?.channels||{}});
  }
  if(params.has('revision'))throw new DraftError('Choose a project before selecting its revision.');
  const cursor=pageCursor(params.get('cursor'));
  const rows=await deps.query(`SELECT w.draft_id AS "draftId",w.payload->'snapshot'->>'projectId' AS "projectId",
   w.payload->'snapshot'->>'originSite' AS "originSite",w.payload->'snapshot'->>'currentSite' AS "currentSite",
   (w.payload->'snapshot'->>'revision')::integer AS revision,w.payload->'snapshot'->'contact' AS contact,
   w.payload->'snapshot'->'routing' AS routing,w.payload->'snapshot'->>'savedAt' AS "savedAt",
   to_char(w.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime",
   jsonb_array_length(w.payload->'snapshot'->'scope'->'uploads') AS "fileCount"
   FROM p5_estimator_work w JOIN p5_estimator_drafts d ON d.id=w.draft_id
   WHERE w.work_key=$1 AND d.brand=$2 AND w.payload->'snapshot'->>'currentSite'=$2
   AND ($3::timestamptz IS NULL OR w.updated_at<$3::timestamptz OR (w.updated_at=$3::timestamptz AND w.draft_id>$4::uuid))
   ORDER BY w.updated_at DESC,w.draft_id LIMIT 101`,[INTAKE_SUBMISSION_KEY,deps.site,cursor?.updatedAt??null,cursor?.draftId??null]);
  const page=rows.slice(0,PAGE_SIZE),last=page.at(-1);
  const nextCursor=rows.length>PAGE_SIZE&&last?Buffer.from(JSON.stringify([last.cursorTime,last.draftId])).toString('base64url'):null;
  const requests=page.map(row=>{const {cursorTime,...summary}=row;void cursorTime;return summary;});
  return json({requests,nextCursor});
 }catch(error){return failed(error);}}
 async function file(request:Request){try{
  await deps.authorize();const params=new URL(request.url).searchParams,draftId=id(params.get('draftId')),fileId=id(params.get('fileId')),rev=revision(params.get('revision'));
  if(rev===null)throw new DraftError('Choose the submitted revision for this file.');
  const saved=await snapshot(draftId,rev),expected=saved.scope.uploads.find(f=>f.id===fileId);
  if(!expected)throw new DraftError('This file is not part of the submitted project revision.',404);
  const [row]=await deps.query('SELECT id,name,mime_type,size_bytes,sha256,data_base64,storage_bucket,storage_key FROM p5_estimator_files WHERE id=$1 AND draft_id=$2',[fileId,draftId]);
  if(!row||row.name!==expected.name||row.mime_type!==expected.type||Number(row.size_bytes)!==expected.size||row.sha256!==expected.sha256||!expected.sha256||expected.size<0||expected.size>SCOPE_FILE_LIMIT)throw new DraftError('Saved file verification failed. The original request is retained.',409);
  const domain=INTAKE_SITES[deps.site].domain;
  const prefix=uploadObjectKey(domain,draftId,expected.sha256);
  if((row.storage_key||row.storage_bucket)&&(row.storage_bucket!==ESTIMATOR_BUCKETS[domain]||typeof row.storage_key!=='string'||!(row.storage_key===prefix||row.storage_key.startsWith(prefix+'/'))))throw new DraftError('Saved file location could not be verified.',409);
  const bytes=await deps.readBytes(row);
  if(bytes.byteLength!==expected.size||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new DraftError('Saved file bytes could not be verified.',409);
  return new Response(bytes as BodyInit,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${expected.name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`,'Content-Length':String(bytes.byteLength),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }catch(error){return failed(error);}}
 return {get,file};
}
