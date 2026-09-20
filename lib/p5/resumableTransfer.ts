import {SCOPE_CHUNK_SIZE,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP} from './scope.ts';
import {requireDraftReceipt,readJson} from './browserDraft.ts';
import {fileDigest} from './fileDigest.ts';
const digest=async(data:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
/** Retry only unacknowledged segments. Receipts and checksums are verified before clearing local files. */
export async function transferLargeFiles(files:File[],headers:Record<string,string>,progress:(percent:number)=>void,request=fetch,signal?:AbortSignal){
  // Admission runs on metadata only, before any file data is read or hashed.
  if(!files.length||files.length>SCOPE_FILE_COUNT||files.some(f=>!f.size||f.size>SCOPE_FILE_LIMIT)||files.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new Error(SCOPE_UPLOAD_HELP);
  const total=files.reduce((n,f)=>n+f.size,0);let completed=0;let receipt:unknown;
  const expected:Array<{hash:string;size:number;name:string}>=[];
  const send=async(url:string,body:BodyInit,contentType:string)=>{
    let lastConnectionError:unknown;
    for(let attempt=0;attempt<3;attempt++){
      signal?.throwIfAborted();
      try{
        const timeout=AbortSignal.timeout(240000);
        const response=await request(url,{method:'POST',headers:{...headers,'Content-Type':contentType},body,signal:signal?AbortSignal.any([signal,timeout]):timeout});
        // Gateways commonly answer transient failures with HTML, not JSON.
        if(!response.ok&&[409,429,502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel().catch(()=>undefined);await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
        const data=await readJson(response);
        if(!response.ok)throw new Error(data.error||'Your upload could not be confirmed. Retry to resume the saved segments.');
        return data;
      }catch(error){
        // A customer cancellation is final; only connection failures are retried.
        if(signal?.aborted||error instanceof Error&&!['TypeError','TimeoutError','AbortError'].includes(error.name))throw error;
        lastConnectionError=error;
        if(attempt<2)await new Promise(r=>setTimeout(r,1000*(attempt+1)));
      }
    }
    throw new Error('Your upload connection was interrupted. Retry to resume the saved segments.',{cause:lastConnectionError});
  };
  for(const file of files){
    const hash=await fileDigest(file,signal),base=`/api/p5-estimator/upload?sha256=${hash}`;
    expected.push({hash,size:file.size,name:file.name});
    const status=await send(`${base}&action=start`,JSON.stringify({name:file.name,size:file.size}),'application/json');
    if(status.chunkSize!==SCOPE_CHUNK_SIZE)throw new Error('The upload settings changed. Reload to continue.');
    if(!status.chunks||typeof status.chunks!=='object'||Array.isArray(status.chunks)||typeof status.complete!=='boolean')throw new Error('The saved upload checkpoint could not be read. Your file is still on this device. Retry to resume.');
    if(!status.complete)for(let offset=0,index=0;offset<file.size;offset+=SCOPE_CHUNK_SIZE,index++){
      signal?.throwIfAborted();
      const data=await file.slice(offset,offset+SCOPE_CHUNK_SIZE).arrayBuffer();
      if(data.byteLength!==Math.min(SCOPE_CHUNK_SIZE,file.size-offset))throw new Error(`${file.name}: upload segment was not fully read. Select the original file again.`);
      const checksum=await digest(data);
      if(status.chunks[index]!==checksum){
        const ack=await send(`${base}&action=part&part=${index}&checksum=${checksum}`,new Uint8Array(data),'application/octet-stream');
        if(ack.part!==index||ack.checksum!==checksum)throw new Error('An upload segment was not confirmed. Please retry.');
      }
      progress(Math.min(99,Math.round((completed+offset+data.byteLength)/total*100)));
    }
    receipt=await send(`${base}&action=finish`,'','application/json');
    const saved=requireDraftReceipt(receipt);
    // Every file sent so far must still be in the cumulative receipt, not only the latest.
    for(const sent of expected)if(!saved.uploads.some(f=>f.sha256===sent.hash&&f.size===sent.size))throw new Error(`${sent.name}: upload was not confirmed. Retry to resume.`);
    completed+=file.size;progress(Math.min(99,Math.round(completed/total*100)));
  }
  return receipt;
}
