import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {SCOPE_CHUNK_SIZE,SCOPE_FILE_LIMIT,type ScopeUpload} from './scope.ts';

export interface TransferFileProgress {chunks:Array<{size:number;sha256:string}>}
export interface TransferFileAdapter<Location> {
 readSource(offset:number):Promise<AsyncIterable<Uint8Array>>;
 readChunk(index:number,sha256:string):Promise<Uint8Array>;
 writeChunk(index:number,sha256:string,bytes:Uint8Array):Promise<void>;
 checkpoint(progress:TransferFileProgress):Promise<void>;
 publish(bytes:AsyncIterable<Uint8Array>):Promise<Location>;
 register(location:Location):Promise<ScopeUpload>;
}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const validDigest=(value:unknown)=>typeof value==='string'&&/^[a-f\d]{64}$/.test(value);

/** Repairing a corrupt retained chunk must replace those bytes, but only under
 * the active copy lease. A stale worker cannot alter the next owner's recovery. */
export const TRANSFER_CHUNK_WRITE_SQL=`WITH owned AS (
 SELECT draft_id FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$4
  AND lease_token=$5 AND lease_until>now() FOR UPDATE
 ) INSERT INTO p5_estimator_work(draft_id,work_key,payload)
 SELECT draft_id,$2,$3::jsonb FROM owned
 ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
 RETURNING work_key`;

export async function publishTransferStream(bytes:AsyncIterable<Uint8Array>,publish:(stream:Readable)=>Promise<unknown>,timeoutMs=180000){
 const stream=Readable.from(bytes);let timer:ReturnType<typeof setTimeout>|undefined;
 const failed=new Promise<never>((_,reject)=>{
  stream.once('error',reject);
  timer=setTimeout(()=>{const error=new Error('Final storage confirmation timed out. Resume this transfer.');reject(error);stream.destroy(error);},timeoutMs);
 });
 try{await Promise.race([publish(stream),failed]);}finally{clearTimeout(timer);stream.destroy();}
}

/** Copy one manifest-owned original with bounded memory and durable segment checkpoints.
 * Only verified complete segments survive interruption. Reopening checks retained bytes,
 * repairs a missing/corrupt segment, and resumes at its original offset. No file receipt
 * is registered until the complete original digest and the final storage write succeed. */
export async function copyIntakeTransferFile<Location>(file:ScopeUpload,initial:TransferFileProgress,adapter:TransferFileAdapter<Location>):Promise<ScopeUpload>{
 if(!Number.isSafeInteger(file.size)||file.size<1||file.size>SCOPE_FILE_LIMIT||!validDigest(file.sha256)
   ||!Array.isArray(initial.chunks)||initial.chunks.length>Math.ceil(file.size/SCOPE_CHUNK_SIZE))throw new Error('Invalid transfer file identity.');
 let progress:TransferFileProgress={chunks:initial.chunks.map(c=>({...c}))};
 const hash=createHash('sha256');let offset=0;
 const persist=()=>adapter.checkpoint({chunks:progress.chunks.map(c=>({...c}))});
 for(let i=0;i<progress.chunks.length;i++){
  const chunk=progress.chunks[i];let bytes:Uint8Array|null=null;
  try{bytes=await adapter.readChunk(i,chunk.sha256);}catch{}
  if(!validDigest(chunk.sha256)||chunk.size!==Math.min(SCOPE_CHUNK_SIZE,file.size-offset)||!bytes||bytes.byteLength!==chunk.size||sha(bytes)!==chunk.sha256){
   progress={chunks:progress.chunks.slice(0,i)};await persist();break;
  }
  offset+=bytes.byteLength;hash.update(bytes);
 }
 if(offset<file.size){
  const source=await adapter.readSource(offset);
  let pending=new Uint8Array(Math.min(SCOPE_CHUNK_SIZE,file.size-offset)),used=0;
  for await(const bytes of source){
   if(!(bytes instanceof Uint8Array)||offset+used+bytes.byteLength>file.size)throw new Error('The source file exceeded its saved manifest.');
   let at=0;
   while(at<bytes.byteLength){
    const n=Math.min(pending.length-used,bytes.byteLength-at);pending.set(bytes.subarray(at,at+n),used);used+=n;at+=n;
    if(used===pending.length){
     const checksum=sha(pending),index=progress.chunks.length;
     await adapter.writeChunk(index,checksum,pending);
     progress.chunks.push({size:pending.length,sha256:checksum});await persist();hash.update(pending);offset+=pending.length;
     pending=new Uint8Array(Math.min(SCOPE_CHUNK_SIZE,file.size-offset));used=0;
    }
   }
  }
  if(used||offset!==file.size)throw new Error('The original file transfer was interrupted. Resume to continue from its saved segments.');
 }
 if(hash.digest('hex')!==file.sha256){
  progress={chunks:[]};await persist();throw new Error('The complete file checksum did not match. Its original is retained; retry the copy.');
 }
 let consumed=false;
 const verified=(async function*(){
  const finalHash=createHash('sha256');let size=0;
  for(let i=0;i<progress.chunks.length;i++){
   const chunk=progress.chunks[i],bytes=await adapter.readChunk(i,chunk.sha256);
   if(bytes.byteLength!==chunk.size||sha(bytes)!==chunk.sha256)throw new Error('A saved file segment changed before final storage. Resume the transfer.');
   finalHash.update(bytes);size+=bytes.byteLength;yield bytes;
  }
  if(size!==file.size||finalHash.digest('hex')!==file.sha256)throw new Error('Final file verification failed.');consumed=true;
 })();
 const location=await adapter.publish(verified);
 if(!consumed)throw new Error('The complete storage write was not confirmed.');
 const receipt=await adapter.register(location);
 if(!receipt?.id||receipt.name!==file.name||receipt.type!==file.type||receipt.size!==file.size||receipt.sha256!==file.sha256||receipt.status!=='stored')throw new Error('The destination file receipt did not match the original.');
 return receipt;
}
