import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {Client} from '@replit/object-storage';
import {query} from './database';
import {draftCredentials,readDraft,DraftError} from './store';
import {ESTIMATOR_BRAND} from './brand';
import {ESTIMATOR_BUCKETS,uploadObjectKey} from './objectStorage';
import {SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_CHUNK_SIZE,SCOPE_UPLOAD_HELP} from './scope';
import {verifyUpload} from './documents';
import {protectRequest,limitedBody,failed,json} from './http';
import {claimWork,releaseWork} from './workStore';

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
      const input=JSON.parse(new TextDecoder().decode(await limitedBody(request,2000)));
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
      if(!transfer.chunks[index]){
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
      if(t.complete)return json({draft:await readDraft(id,key)});
      if(Array.from({length:count},(_,i)=>i).some(i=>!t.chunks[i]))throw new DraftError('Some file segments are still missing. Continue the upload.',409);
      const hash=createHash('sha256');let size=0;let header:Buffer=Buffer.alloc(0);
      const stream=Readable.from((async function*(){
        for(let i=0;i<count;i++){
          const part=await client.downloadAsBytes(`${prefix}/${i}/${t.chunks[i]}`);
          if(!part.ok||sha(part.value[0])!==t.chunks[i])throw new Error('Saved segment verification failed. Retry this file.');
          const data=part.value[0];hash.update(data);size+=data.length;if(i===0)header=data;
          yield data;
        }
        if(size!==t.size||hash.digest('hex')!==digest)throw new Error('Complete file verification failed. Select the original file again.');
      })());
      const objectKey=uploadObjectKey(ESTIMATOR_BRAND.domain,id,digest);
      // Backpressure bounds memory to a segment; the SDK acknowledges the complete object.
      await client.uploadFromStream(objectKey,stream,{compress:false});
      // File signatures are checked without loading a large plan into memory.
      const extension=t.name.split('.').pop()?.toLowerCase();
      const office=['docx','xlsx','ods'].includes(extension||'');
      const type=office?({'docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','ods':'application/vnd.oasis.opendocument.spreadsheet'} as Record<string,string>)[extension!]:verifyUpload(t.name,header).type;
      if(office&&!header.subarray(0,2).equals(Buffer.from('PK')))throw new DraftError('This office document is damaged. Upload a fresh copy.');
      await query("INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64,storage_bucket,storage_key) VALUES($1,$2,$3,$4,$5,$6,'',$7,$8) ON CONFLICT(draft_id,sha256) DO NOTHING",[randomUUID(),id,t.name,type,t.size,digest,bucketId,objectKey]);
      await query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{complete}','true'::jsonb) WHERE draft_id=$1 AND work_key=$2",[id,workKey]);
      // Only temporary objects created by this transfer are removed, after the durable receipt exists.
      for(let i=0;i<count;i++)await client.delete(`${prefix}/${i}/${t.chunks[i]}`,{ignoreNotFound:true}).catch(()=>undefined);
      return json({draft:await readDraft(id,key)});
    }finally{await releaseWork(id,workKey,gate.token);}
  }catch(error){return failed(error);}
}
