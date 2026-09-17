import {createHash,createHmac,randomUUID} from 'node:crypto';
import {query} from './database.ts';
import {readStoredBytes} from './objectStorage.ts';
import {claimWork,writeWork,releaseWork} from './workStore.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {validateExtraction,type ScopeAnswers,type ScopeUpload} from './scope.ts';
import {type Draft,DraftError} from './store.ts';
import {fetchWithinDeadline,remainingBudget} from './processingBudget.ts';
import type {ProcessingStatus} from './processingStatus.ts';
const VERSION='p5-documents-2026-09-17-v1';
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function documentServiceEligible(uploads:ScopeUpload[],env:Readonly<Record<string,string|undefined>>=process.env){
 const limit=Number(env.P5_DOCUMENT_SERVICE_MAX_BYTES||50*1024*1024);
 if(env.P5_DOCUMENT_SERVICE_MODE==='remote'&&(!Number.isSafeInteger(limit)||limit<=0))throw new DraftError('The document size limit needs configuration. Your files are saved.',503);
 return env.P5_DOCUMENT_SERVICE_MODE==='remote'&&uploads.length>0&&uploads.every(u=>u.status==='stored'&&u.type==='application/pdf'&&u.size>0&&u.size<=limit);
}
export function documentServiceHeaders(method:string,path:string,tenant:string,secret:string,body:Buffer,now=Date.now(),nonce:string=randomUUID()){
 const timestamp=String(now),bodyHash=digest(body);
 return {'x-p5-tenant':tenant,'x-p5-time':timestamp,'x-p5-nonce':nonce,'x-p5-body-sha256':bodyHash,'x-p5-signature':createHmac('sha256',secret).update([method,path,tenant,timestamp,nonce,bodyHash].join('\n')).digest('hex')};
}
export function remoteDocumentId(tenant:string,project:string,sha256:string){return digest(JSON.stringify([VERSION,tenant,project,sha256]));}
export async function advanceDocumentService(draft:Draft,text:string,answers:ScopeAnswers,workKey:string,request:typeof fetch,retryFailed:boolean,deadline:number){
 const tenant=ESTIMATOR_BRAND.domain;
 const secret=process.env.P5_DOCUMENT_SERVICE_KEY||'',configured=process.env.P5_DOCUMENT_SERVICE_URL||'';
 let origin:URL;try{origin=new URL(configured);}catch{throw new DraftError('The document service is not configured. Your files are saved.',503);}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||secret.length<32)throw new DraftError('The document service configuration needs attention. Your files are saved.',503);
 const base=`/v1/projects/${encodeURIComponent(draft.id)}`;
 const send=async(method:string,path:string,body:Buffer=Buffer.alloc(0),contentType='application/json')=>{
  const response=await fetchWithinDeadline(request,origin.origin+path,{method,headers:{...documentServiceHeaders(method,path,tenant,secret,body),'content-type':contentType},...(method==='POST'?{body:body as unknown as BodyInit}:{}),redirect:'error'},Math.min(deadline,Date.now()+60000));
  let value:any;try{value=await response.json();}catch{throw new DraftError('The document service returned an invalid response. Saved files are preserved.',503);}
  return {ok:response.ok,status:response.status,value};
 };
 const lease=await claimWork(draft.id,workKey,{processing:{},remote:true},150);
 if(!lease)return {pending:true as const,progress:'Your source review is already running.',retryAfterMs:1000};
 const state=lease.payload as {processing?:ProcessingStatus;remote?:boolean};
 const pending=async(progress:string,details:Partial<ProcessingStatus>={},wait=750)=>{
  state.remote=true;state.processing={phase:'reading',message:progress,updatedAt:new Date().toISOString(),...details};
  await writeWork(draft.id,workKey,lease.token,state);
  return {pending:true as const,progress,retryAfterMs:wait};
 };
 try{
  const documents:{id:string;source:string}[]=[],expectedPages=new Set<string>();let complete=true,readPages=0,totalPages=0;
  for(const upload of draft.uploads){
   remainingBudget(deadline);const id=remoteDocumentId(tenant,draft.id,upload.sha256),path=base+'/documents/'+id;
   let response=await send('GET',path);
   if(response.status===404){
    const [file]=await query('SELECT name,mime_type,data_base64,storage_bucket,storage_key,sha256,size_bytes FROM p5_estimator_files WHERE draft_id=$1 AND id=$2',[draft.id,upload.id]);
    if(!file)throw new DraftError('A saved document could not be found. Please retry.',503);
    const bytes=await readStoredBytes(file);if(digest(bytes)!==upload.sha256)throw new DraftError('A saved document failed its integrity check. Please reattach it.',422);
    response=await send('POST',base+'/documents?name='+encodeURIComponent(upload.name),bytes,'application/pdf');
   }
   if(response.status===429||response.status===503)return pending('Your documents are saved. Waiting for reader capacity.',{phase:'queued'},Math.min(10000,response.value.retryAfterMs||2000));
   if(!response.ok)throw new DraftError(`Document reading is unavailable (${response.value.error||response.status}). Your uploaded files are saved.`,503);
   if(response.value.id!==id)throw new DraftError('The document service receipt did not match this project.',503);
   if(response.value.state==='failed'){
    if(retryFailed){const retried=await send('POST',path+'/retry');if(!retried.ok)throw new DraftError('The document retry could not start. Your files are saved.',503);return pending('Retrying only the interrupted document stages.',{phase:'retrying'});}
    throw new DraftError(`Document processing needs attention (${response.value.error||'reader failure'}). Completed work is saved. Use Retry to resume.`,422);
   }
   complete&&=response.value.state==='complete';readPages+=Number(response.value.progress?.checkedPages||0);totalPages+=Number(response.value.progress?.totalPages||0);
   const source=draft.uploads.filter(u=>u.name===upload.name).length>1?`${upload.name} [${upload.id.slice(0,8)}]`:upload.name;
   // Duplicate bytes in the same project are one physical source, even when
   // uploaded twice under different names. They must not multiply quantities.
   if(documents.some(d=>d.id===id)){readPages-=Number(response.value.progress?.checkedPages||0);totalPages-=Number(response.value.progress?.totalPages||0);continue;}
   documents.push({id,source});
   if(response.value.state==='complete'){
    const coverage=response.value.coverage;
    if(!coverage?.complete||!Array.isArray(coverage.pages)||coverage.pages.length!==response.value.progress?.totalPages||coverage.pages.some((p:any,i:number)=>p.page!==i+1||p.status!=='read'))throw new DraftError('Some document pages still need verification. Your files are saved; an unchecked estimate cannot be submitted.',422);
    for(const page of coverage.pages)expectedPages.add(JSON.stringify([source,page.page]));
   }
  }
  // Queue reconciliation while pages are reading. Once receipts are stored,
  // the worker can finish even when the website or browser stops polling.
  const submitted=await send('POST',base+'/reviews',Buffer.from(JSON.stringify({documents,text,answers})));
  if(submitted.status===429)return pending('Waiting to reconcile the document evidence.',{phase:'queued'},2000);
  if(!submitted.ok||!submitted.value.id)throw new DraftError('Your documents are read, but scope reconciliation could not start. Please retry.',503);
  const review=submitted.value;
  if(review.state==='failed'){
   if(retryFailed){const retried=await send('POST',base+'/reviews/'+review.id+'/retry');if(!retried.ok)throw new DraftError('The scope retry could not start. Your source evidence is saved.',503);return pending('Retrying scope reconciliation without rereading the documents.',{phase:'cross-referencing'});}
   throw new DraftError(`Scope reconciliation needs attention (${review.error||'processing error'}). Your source documents are saved.`,422);
  }
  if(!complete)return pending(totalPages?`Checked ${readPages} of ${totalPages} pages. Reading source evidence.`:'Preparing your document source records.',{readPages,totalPages});
  if(review.state!=='complete')return pending('Matching the source evidence to your project and checking only missing details.',{phase:'cross-referencing',readPages,totalPages});
  const extraction=validateExtraction(review.result);
  const coverage=extraction.documentCoverage,seen=new Set<string>();
  if(!coverage?.complete||coverage.expectedPages!==totalPages||coverage.pages.length!==totalPages||coverage.pages.some(p=>{const key=JSON.stringify([p.source,p.page]);if(p.status!=='read'||!expectedPages.has(key)||seen.has(key))return true;seen.add(key);return false;}))throw new DraftError('The returned document coverage did not match the verified uploaded pages.',503);
  return {pending:false as const,version:digest(JSON.stringify([text,answers,draft.uploads.map(f=>[f.id,f.sha256])])),analysis:{extraction,provider:'P5 Document Service',model:VERSION,analyzedAt:new Date().toISOString()}};
 }finally{await releaseWork(draft.id,workKey,lease.token);}
}
