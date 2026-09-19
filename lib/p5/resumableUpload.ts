import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {Client} from '@replit/object-storage';
import {query} from './database.ts';
import {draftCredentials,readDraft,DraftError} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {ESTIMATOR_BUCKETS,uploadObjectKey} from './objectStorage.ts';
import {SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_CHUNK_SIZE,SCOPE_UPLOAD_HELP} from './scope.ts';
import {verifyUpload,checkOfficeArchiveRanges} from './documents.ts';
import {protectRequest,limitedBody,failed,json} from './http.ts';
import {claimWork,releaseWork} from './workStore.ts';

const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
type Transfer={name:string;size:number;digest:string;chunks:Record<string,string>;complete?:boolean};
export async function postUpload(request:Request){
  try{
    protectRequest(request,5000);
    const {id,key}=draftCredentials(request),draft=await readDraft(id,key);
    if(!draft)throw new DraftError('Save your project before uploading.',404);
    if(draft.status!=='draft')throw new DraftError('Start a new project to add files.',409);
    if(process.env.P5_OBJECT_STORAGE_ENABLED!=='true')throw new DraftError('Large-file storage is unavailable. Your files are still on this device.',503);
    const url=new URL(request.url),digest=url.searchParams.get('sha256')||'',action=url.searchParams.get('action');
    if(!/^[a-f0-9]{64}$/.test(digest))throw new DraftError('Invalid file checksum.');
    const workKey=`upload:${digest}`,bucketId=ESTIMATOR_BUCKETS[ESTIMATOR_BRAND.domain],client=new Client({bucketId});
    const prefix=`transfers/${ESTIMATOR_BRAND.domain}/${id}/${digest}`;
    if(action==='start'){
      const body=await limitedBody(request,2000);let input:any;
      try{input=JSON.parse(new TextDecoder().decode(body));}catch{throw new DraftError('The upload request is not valid JSON. Select the file again.');}
      if(!input||typeof input!=='object'||Array.isArray(input))throw new DraftError('Invalid upload request.');
      if(typeof input.name!=='string'||input.name.length>180||!Number.isInteger(input.size)||input.size<=0||input.size>SCOPE_FILE_LIMIT)throw new DraftError(SCOPE_UPLOAD_HELP,413);
      const gate=await claimWork(id,'upload-admission',{},30);
      if(!gate)throw new DraftError('Another file is being prepared. Please retry.',409);
      try{
        const existing=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,workKey]);
        if(existing.length){const t=existing[0].payload as Transfer;if(t.size!==input.size)throw new DraftError('This file changed. Select it again.',409);return json({chunkSize:SCOPE_CHUNK_SIZE,chunks:t.chunks,complete:Boolean(t.complete)});}
        const pending=await query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'upload:%'",[id]);
        const fresh=await readDraft(id,key);
        const unfinished=pending.map(r=>r.payload as Transfer).filter(t=>!fresh!.uploads.some(f=>f.sha256===t.digest));
        if(fresh!.uploads.length+unfinished.length>=SCOPE_FILE_COUNT||fresh!.uploads.reduce((n,f)=>n+f.size,0)+unfinished.reduce((n,t)=>n+t.size,0)+input.size>SCOPE_BATCH_LIMIT)throw new DraftError(SCOPE_UPLOAD_HELP,413);
        const name=input.name.replace(/[\u0000-\u001f/\\]/g,'_');
        await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[id,workKey,JSON.stringify({name,size:input.size,digest,chunks:{}})]);
        return json({chunkSize:SCOPE_CHUNK_SIZE,chunks:{},complete:false});
      }finally{await releaseWork(id,'upload-admission',gate.token);}
    }
    const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,workKey]);
    if(!row)throw new DraftError('Prepare this file before sending its data.',404);
    const transfer=row.payload as Transfer,count=Math.ceil(transfer.size/SCOPE_CHUNK_SIZE);
    if(action==='part'){
      const index=Number(url.searchParams.get('part')),expected=url.searchParams.get('checksum')||'';
      if(!Number.isInteger(index)||index<0||index>=count||!url.searchParams.has('part')||!/^[a-f0-9]{64}$/.test(expected))throw new DraftError('Invalid upload segment.');
      if(transfer.chunks[index]&&transfer.chunks[index]!==expected)throw new DraftError('The selected file changed during upload.',409);
      const data=Buffer.from(await limitedBody(request,SCOPE_CHUNK_SIZE));
      if(data.length!==Math.min(SCOPE_CHUNK_SIZE,transfer.size-index*SCOPE_CHUNK_SIZE)||sha(data)!==expected)throw new DraftError('This upload segment did not arrive intact. Please retry.',422);
      // A completed transfer has already removed temporary chunks. Do not recreate them.
      if(transfer.complete)return json({part:index,checksum:expected});
      const retained=transfer.chunks[index]?await client.downloadAsBytes(`${prefix}/${index}/${expected}`):null;
      if(!retained?.ok||sha(retained.value[0])!==expected){
        const saved=await client.uploadFromBytes(`${prefix}/${index}/${expected}`,data,{compress:false});
        if(!saved.ok)throw new DraftError('This upload segment could not be saved. Please retry.',503);
        await query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,ARRAY['chunks',$3],to_jsonb($4::text)),updated_at=now() WHERE draft_id=$1 AND work_key=$2",[id,workKey,String(index),expected]);
      }
      return json({part:index,checksum:expected});
    }
    if(action!=='finish')throw new DraftError('Unknown upload action.');
    const gate=await claimWork(id,workKey,transfer,300);
    if(!gate)throw new DraftError('This file is being confirmed. Please retry.',409);
    try{
      const t=gate.payload as Transfer;
      const savedDraft=await readDraft(id,key);
      if(t.complete||savedDraft?.uploads.some(f=>f.sha256===digest&&f.size===t.size)){
        // Recover a crash after the file receipt committed but before its transfer checkpoint.
        if(!t.complete)await query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{complete}','true'::jsonb) WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3",[id,workKey,gate.token]);
        for(const [i,checksum] of Object.entries(t.chunks))await client.delete(`${prefix}/${i}/${checksum}`,{ignoreNotFound:true}).catch(()=>undefined);
        return json({draft:savedDraft});
      }
      if(Array.from({length:count},(_,i)=>i).some(i=>!t.chunks[i]))throw new DraftError('Some file segments are still missing. Continue the upload.',409);
      const readChunk=async(i:number)=>{
        const part=await client.downloadAsBytes(`${prefix}/${i}/${t.chunks[i]}`);
        if(!part.ok||part.value[0].length!==Math.min(SCOPE_CHUNK_SIZE,t.size-i*SCOPE_CHUNK_SIZE)||sha(part.value[0])!==t.chunks[i]){
          // The next client resume must resend this chunk instead of trusting its old receipt.
          await query("UPDATE p5_estimator_work SET payload=payload #- ARRAY['chunks',$4],updated_at=now() WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3",[id,workKey,gate.token,String(i)]);
          throw new DraftError('A saved upload segment needs to be sent again. Retry to resume your upload.',503);
        }
        return part.value[0];
      };
      // Check signatures and Office archive bounds before creating a final storage object.
      const header=await readChunk(0),extension=t.name.split('.').pop()?.toLowerCase();
      const office=['docx','xlsx','ods'].includes(extension||'');
      let type:string;
      try{
        if(office){
          // Keep a small bounded cache: central-directory and local headers often
          // alternate. One cache entry would repeatedly download entire chunks.
          const cache=new Map<number,Buffer>([[0,header]]);
          await checkOfficeArchiveRanges(t.size,async(offset,length)=>{
            const parts:Buffer[]=[];
            while(length){const index=Math.floor(offset/SCOPE_CHUNK_SIZE);let cached=cache.get(index);if(!cached){cached=await readChunk(index);cache.set(index,cached);if(cache.size>3)cache.delete(cache.keys().next().value!);}
              const start=offset%SCOPE_CHUNK_SIZE,n=Math.min(length,cached.length-start);if(n<=0)throw new Error('Damaged office document.');parts.push(cached.subarray(start,start+n));offset+=n;length-=n;}
            return Buffer.concat(parts);
          });
          type=({'docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','ods':'application/vnd.oasis.opendocument.spreadsheet'} as Record<string,string>)[extension!];
        }else type=verifyUpload(t.name,header).type;
      }catch(error){if(error instanceof DraftError)throw error;throw new DraftError(error instanceof Error?error.message:'This file could not be validated.',422);}
      const hash=createHash('sha256');let size=0;
      const stream=Readable.from((async function*(){
        for(let i=0;i<count;i++){
          const data=await readChunk(i);hash.update(data);size+=data.length;
          yield data;
        }
        if(size!==t.size||hash.digest('hex')!==digest)throw new Error('Complete file verification failed. Select the original file again.');
      })());
      // Lease-specific objects cannot overwrite or delete another finisher's valid file.
      const objectKey=`${uploadObjectKey(ESTIMATOR_BRAND.domain,id,digest)}/${gate.token}`;
      let referenced=false;
      try{
        // The SDK listens to destination errors, but not errors from this source stream.
        // Observe both so a lost chunk rejects instead of crashing or hanging the request.
        let timer:ReturnType<typeof setTimeout>|undefined;
        const sourceFailure=new Promise<never>((_,reject)=>{stream.once('error',reject);timer=setTimeout(()=>{stream.destroy(new Error('Upload finalization timed out. Retry to resume.'));},240000);});
        try{await Promise.race([client.uploadFromStream(objectKey,stream,{compress:false}),sourceFailure]);}finally{clearTimeout(timer);}
        const inserted=await query("WITH owned AS (SELECT d.id FROM p5_estimator_drafts d JOIN p5_estimator_work w ON w.draft_id=d.id WHERE d.id=$2 AND d.status='draft' AND w.work_key=$9 AND w.lease_token=$10 AND w.lease_until>now() FOR UPDATE OF d,w) INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64,storage_bucket,storage_key) SELECT $1,owned.id,$3,$4,$5,$6,'',$7,$8 FROM owned ON CONFLICT(draft_id,sha256) DO NOTHING RETURNING storage_key",[randomUUID(),id,t.name,type,t.size,digest,bucketId,objectKey,workKey,gate.token]);
        referenced=inserted.length>0;
        if(!referenced){
          const saved=await readDraft(id,key);
          if(!saved?.uploads.some(f=>f.sha256===digest))throw new DraftError('This project changed while the file was saving. Your completed work is intact.',409);
        }
      }finally{
        // An INSERT may have committed even if its acknowledgement was lost.
        if(!referenced){
          const retained=await query('SELECT id FROM p5_estimator_files WHERE storage_key=$1',[objectKey]);
          if(!retained.length)await client.delete(objectKey,{ignoreNotFound:true}).catch(()=>undefined);
        }
      }
      await query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{complete}','true'::jsonb) WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3",[id,workKey,gate.token]);
      // Only temporary objects created by this transfer are removed, after the durable receipt exists.
      for(let i=0;i<count;i++)await client.delete(`${prefix}/${i}/${t.chunks[i]}`,{ignoreNotFound:true}).catch(()=>undefined);
      return json({draft:await readDraft(id,key)});
    }finally{await releaseWork(id,workKey,gate.token);}
  }catch(error){return failed(error);}
}
