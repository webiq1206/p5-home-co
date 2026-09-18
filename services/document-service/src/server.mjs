import {createServer} from 'node:http';
import {hash,verifyHeaders,identifier,ServiceError,publicJob,elapsedMs,VERSION} from './core.mjs';
import {reviewForWebsite} from './website-review.mjs';
function reviewResponse(row){
 const response=publicJob(row);
 if(response.state==='complete'&&response.kind==='review'&&response.result)response.result=reviewForWebsite(response.result);
 return response;
}
export function makeServer(store,pipeline,config){
 let receiving=0;
 const server=createServer(async(req,res)=>{
  const send=(status,value)=>{if(res.writableEnded||res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url,'http://document-service');
   if(req.method==='GET'&&url.pathname==='/healthz'){send(200,{ok:true,version:VERSION});return;}
   const auth=verifyHeaders(config.tenants,req.method,req.url,req.headers);
   if(!await store.nonce(auth.tenant,auth.nonce))throw new ServiceError('replayed-request',401);
   if(req.method==='GET'&&url.pathname==='/readyz'){await store.pool.query('SELECT 1');send(200,{ok:true,version:VERSION,providerConfigured:true});return;}
   const parts=url.pathname.split('/').filter(Boolean);if(parts[0]!=='v1'||parts[1]!=='projects')throw new ServiceError('not-found',404);
   const project=identifier(parts[2],'project');
   let body=Buffer.alloc(0);
   if(req.method==='POST'){
    const maximum=parts[3]==='documents'?config.maxBytes:3*1024*1024;
    if(receiving>=(config.uploadSlots||4))throw new ServiceError('upload-capacity',429,1000);if(Number(req.headers['content-length']||0)>maximum)throw new ServiceError('payload-too-large',413);
    receiving++;try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maximum)throw new ServiceError('payload-too-large',413);chunks.push(chunk);}body=Buffer.concat(chunks);}finally{receiving--;}
   }
   if(hash(body)!==auth.digest)throw new ServiceError('body-integrity-failed',401);
   if(['documents','reviews'].includes(parts[3])&&parts.length===6&&parts[5]==='metrics'&&req.method==='GET'){
    send(200,await store.metrics(auth.tenant,project,identifier(parts[4]),parts[3]));return;
   }
   if(['documents','reviews'].includes(parts[3])&&parts.length===6&&parts[5]==='retry'&&req.method==='POST'){
    await store.retry(auth.tenant,project,identifier(parts[4]),parts[3]);send(202,{queued:true});return;
   }
   if(parts[3]==='documents'&&parts.length===4&&req.method==='POST'){
    if(req.headers['content-type']!=='application/pdf'||!body.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new ServiceError('pdf-required',415);
    const name=url.searchParams.get('name');if(!name||name.length>500||/[\x00-\x1F]/.test(name))throw new ServiceError('invalid-filename');
    const result=await store.putDocument(auth.tenant,project,name,body);const d=result.document;
    send(result.cached?200:202,{id:d.id,state:d.state,cached:result.cached,version:VERSION});return;
   }
   if(parts[3]==='documents'&&parts.length===5&&req.method==='GET'){
    const id=identifier(parts[4]),doc=await store.document(auth.tenant,project,id),progress=await store.documentProgress(id);
    const read=progress.read,checked=progress.checked;
    send(200,{id,state:doc.state,error:doc.error_code||undefined,progress:{totalPages:doc.page_count,parsedPages:progress.parsed,checkedPages:checked,readPages:read},elapsedMs:elapsedMs(doc),targetMs:60000,version:VERSION,
     ...(doc.state==='complete'?{coverage:{complete:read===doc.page_count,pages:await store.coverage(id)}}:{})});return;
   }
   if(parts[3]==='reviews'&&parts.length===4&&req.method==='POST'){
    let data;try{data=JSON.parse(body);}catch{throw new ServiceError('invalid-json');}
    send(202,reviewResponse(await pipeline.submitReview(auth.tenant,project,data)));return;
   }
   if(parts[3]==='reviews'&&parts.length===5&&req.method==='GET'){send(200,reviewResponse(await store.job(auth.tenant,project,identifier(parts[4]))));return;}
   throw new ServiceError('not-found',404);
  }catch(error){const status=error instanceof ServiceError?error.status:500;if(error.retryMs)res.setHeader('retry-after',String(Math.ceil(error.retryMs/1000)));send(status,{error:error instanceof ServiceError?error.code:'internal-error',retryAfterMs:error.retryMs||undefined});}
 });
 server.requestTimeout=90000;server.headersTimeout=15000;server.keepAliveTimeout=5000;return server;
}
