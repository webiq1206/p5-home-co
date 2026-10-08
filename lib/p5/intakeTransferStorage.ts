import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {Client} from '@replit/object-storage';
import {query} from './database.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {ESTIMATOR_BUCKETS,uploadObjectKey} from './objectStorage.ts';
import {claimWork,writeWork,releaseWork} from './workStore.ts';
import {copyIntakeTransferFile,publishTransferStream,TRANSFER_CHUNK_WRITE_SQL,type TransferFileProgress} from './intakeTransferFiles.ts';
import {IMPORT_KEY,TRANSFER_IMPORT_STATUS,transferredFileId,type TransferBundle} from './intakeTransferStore.ts';
import type {ScopeUpload} from './scope.ts';

const DATABASE_FILE_LIMIT=22*1024*1024;
const fileMetadata=(row:Awaited<ReturnType<typeof query>>[number]):ScopeUpload=>({id:row.id,name:row.name,type:row.mime_type,size:Number(row.size_bytes),sha256:row.sha256,status:'stored'});
const sameFile=(a:ScopeUpload,b:ScopeUpload)=>a.name===b.name&&a.type===b.type&&a.size===b.size&&a.sha256===b.sha256;
export async function importedFiles(draftId:string):Promise<ScopeUpload[]>{
 return (await query('SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 ORDER BY created_at,id',[draftId])).map(fileMetadata);
}
/** Manifest-only source access; never accepts an object path or bucket from a request.
 * The SDK does not expose ranges. On a resume we stream/skip the retained prefix,
 * which keeps memory bounded without redownloading the whole prefix for every segment. */
export async function originalTransferStream(bundle:TransferBundle,fileId:string,offset:number):Promise<Readable>{
 const file=bundle.files.find(f=>f.id===fileId);
 if(!file||!Number.isSafeInteger(offset)||offset<0||offset>=file.size||bundle.binding.sourceSite!==ESTIMATOR_BRAND.id)throw new Error('Invalid original file request.');
 const [row]=await query('SELECT * FROM p5_estimator_files WHERE draft_id=$1 AND id=$2',[bundle.binding.sourceDraftId,fileId]);
 if(!row||!sameFile(file,fileMetadata(row)))throw new Error('The original file no longer matches its sealed manifest.');
 let source:Readable;
 if(row.storage_bucket||row.storage_key){
  const bucketId=ESTIMATOR_BUCKETS[ESTIMATOR_BRAND.domain],prefix=uploadObjectKey(ESTIMATOR_BRAND.domain,bundle.binding.sourceDraftId,file.sha256!);
  if(row.storage_bucket!==bucketId||typeof row.storage_key!=='string'||!(row.storage_key===prefix||row.storage_key.startsWith(prefix+'/')))throw new Error('The original file storage ownership is invalid.');
  source=new Client({bucketId}).downloadAsStream(row.storage_key);
 }else{
  if(file.size>DATABASE_FILE_LIMIT||typeof row.data_base64!=='string'||row.data_base64.length>Math.ceil(DATABASE_FILE_LIMIT/3)*4)throw new Error('The original file storage is unavailable.');
  source=Readable.from([Buffer.from(row.data_base64,'base64')]);
 }
 return Readable.from((async function*(){
  const hash=createHash('sha256');let seen=0;
  try{
   for await(const raw of source){
    const bytes=Buffer.from(raw);hash.update(bytes);const start=seen;seen+=bytes.length;
    if(seen>file.size)throw new Error('Original file length verification failed.');
    if(seen>offset)yield bytes.subarray(Math.max(0,offset-start));
   }
   if(seen!==file.size||hash.digest('hex')!==file.sha256)throw new Error('Original file checksum verification failed.');
  }finally{source.destroy();}
 })());
}

/** Durable copy adapters use only this site's already-configured private storage.
 * No shared bucket grant or new credentials are created. The caller supplies a
 * fixed-origin, authenticated source stream, never an arbitrary download URL. */
export async function importTransferFile(bundle:TransferBundle,file:ScopeUpload,readSource:(offset:number)=>Promise<AsyncIterable<Uint8Array>>):Promise<ScopeUpload>{
 const b=bundle.binding;if(b.destinationSite!==ESTIMATOR_BRAND.id||!bundle.files.some(f=>f.id===file.id&&sameFile(f,file)))throw new Error('Invalid destination file ownership.');
 const existing=(await importedFiles(b.destinationDraftId)).find(f=>f.sha256===file.sha256);
 if(existing){if(!sameFile(existing,file))throw new Error('The destination file metadata conflicts with its original.');return existing;}
 const objectStorage=process.env.P5_OBJECT_STORAGE_ENABLED==='true';
 if(!objectStorage&&file.size>DATABASE_FILE_LIMIT)throw new Error('Large-file storage must be available at the destination before this transfer can continue. The original is retained.');
 const workKey=`intake-copy-v2:${b.transferId}:${file.sha256}`,bucketId=ESTIMATOR_BUCKETS[ESTIMATOR_BRAND.domain];
 const client=objectStorage?new Client({bucketId}):null;
 const prefix=`intake-transfers/${ESTIMATOR_BRAND.domain}/${b.destinationDraftId}/${b.transferId}/${file.sha256}`;
 const lease=await claimWork(b.destinationDraftId,workKey,{chunks:[]},240);
 if(!lease)throw new Error('This file is already being copied. Resume shortly to check its saved progress.');
 type Location={data_base64:string;storage_bucket:string|null;storage_key:string|null};
 try{
  return await copyIntakeTransferFile<Location>(file,lease.payload as TransferFileProgress,{
   readSource,
   readChunk:async(index,sha256)=>{
    if(client){const result=await client.downloadAsBytes(`${prefix}/${index}/${sha256}`);if(!result.ok)throw new Error('A saved copy segment is unavailable.');return result.value[0];}
    const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[b.destinationDraftId,`${workKey}:chunk:${index}:${sha256}`]);
    if(typeof row?.payload?.data!=='string')throw new Error('A saved copy segment is unavailable.');return Buffer.from(row.payload.data,'base64');
   },
   writeChunk:async(index,sha256,bytes)=>{
    if(client){const result=await client.uploadFromBytes(`${prefix}/${index}/${sha256}`,Buffer.from(bytes),{compress:false});if(!result.ok)throw new Error('A copy segment could not be saved.');return;}
    const rows=await query(TRANSFER_CHUNK_WRITE_SQL,[b.destinationDraftId,`${workKey}:chunk:${index}:${sha256}`,JSON.stringify({data:Buffer.from(bytes).toString('base64')}),workKey,lease.token]);
    if(!rows.length)throw new Error('The file-copy lease expired. Its completed work is retained; resume the same transfer.');
   },
   checkpoint:progress=>writeWork(b.destinationDraftId,workKey,lease.token,progress),
   publish:async bytes=>{
    if(!client){const parts:Buffer[]=[];let size=0;for await(const part of bytes){size+=part.byteLength;if(size>DATABASE_FILE_LIMIT)throw new Error('Database file storage limit exceeded.');parts.push(Buffer.from(part));}return {data_base64:Buffer.concat(parts).toString('base64'),storage_bucket:null,storage_key:null};}
    const objectKey=`${uploadObjectKey(ESTIMATOR_BRAND.domain,b.destinationDraftId,file.sha256!)}/${lease.token}`;
    await publishTransferStream(bytes,stream=>client.uploadFromStream(objectKey,stream,{compress:false}));
    return {data_base64:'',storage_bucket:bucketId,storage_key:objectKey};
   },
   register:async location=>{
    await query(`WITH owned AS (
      SELECT d.id FROM p5_estimator_drafts d JOIN p5_estimator_work w ON w.draft_id=d.id
       JOIN p5_estimator_work copy ON copy.draft_id=d.id
      WHERE d.id=$2 AND d.status=$10 AND d.key_hash=$11 AND w.work_key=$12 AND w.payload->'bundle'->>'digest'=$13
       AND copy.work_key=$14 AND copy.lease_token=$15 AND copy.lease_until>now() FOR UPDATE OF d,copy
     ) INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64,storage_bucket,storage_key)
      SELECT $1,id,$3,$4,$5,$6,$7,$8,$9 FROM owned ON CONFLICT(draft_id,sha256) DO NOTHING`,
     [transferredFileId(file.id,b.destinationDraftId),b.destinationDraftId,file.name,file.type,file.size,file.sha256,location.data_base64,location.storage_bucket,location.storage_key,TRANSFER_IMPORT_STATUS,b.destinationKeyHash,IMPORT_KEY,bundle.digest,workKey,lease.token]);
    const saved=(await importedFiles(b.destinationDraftId)).find(f=>f.sha256===file.sha256);
    if(!saved||!sameFile(saved,file))throw new Error('The copied original has not been durably registered. Resume to reconcile it.');return saved;
   },
  });
 }finally{await releaseWork(b.destinationDraftId,workKey,lease.token);}
}
