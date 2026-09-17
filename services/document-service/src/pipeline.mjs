import {jobId,groupPages,ServiceError,validateEvidence,stable} from './core.mjs';
import {parsePdf} from './parser.mjs';
import {EVIDENCE_SCHEMA,REVIEW_SCHEMA,READER_SYSTEM,VERIFIER_SYSTEM,REVIEW_SYSTEM,validateReview} from './contracts.mjs';
export class Pipeline{
 constructor(store,reader,config,parser=parsePdf){this.store=store;this.reader=reader;this.config=config;this.parser=parser;}
 async enqueueRead(job,pages){const numbers=pages.map(p=>p.page);await this.store.enqueue(this.store.pool,{id:jobId(job.tenant,job.project,'read',[job.document_id,numbers]),tenant:job.tenant,project:job.project,documentId:job.document_id,kind:'read',priority:job.priority,payload:{pages:numbers}});}
 async prepare(job,signal){
  const start=performance.now(),doc=await this.store.document(job.tenant,job.project,job.document_id,true);let count=0,buffer=[];
  const cachedPages=await this.store.pages(doc.id);
  const emit=async()=>{if(buffer.length){await this.enqueueRead(job,buffer);buffer=[];}};
  await this.parser(doc.bytes,{maxPages:this.config.maxPages,timeoutMs:this.config.parseMs,signal,skipPages:cachedPages.map(p=>p.page),
   onManifest:async n=>{count=n;job.priority=n<=4?0:5;await this.store.manifest(job,n);},
   onPage:async page=>{
    signal.throwIfAborted();await this.store.putPage(job,page);
    await this.store.metric(job,'page-parse',page.parseMs,{page:page.page,nativeMs:page.nativeMs,renderMs:page.renderMs});
    if(buffer.length&&(page.kind!=='text'||buffer.reduce((n,p)=>n+p.text.length,0)+page.text.length>24000))await emit();
    buffer.push(page);if(buffer.length>=4||page.kind!=='text')await emit();
    await this.store.progress(job,{phase:'preparing',parsedPages:page.page,totalPages:count,message:'Preparing native text, page layout and visual evidence.'});
   }});
  await emit();
  // Reconstruct deterministic batches after a restart, reusing cached native pages.
  if(cachedPages.length)for(const pages of groupPages((await this.store.pages(doc.id)).map(p=>p.native)))await this.enqueueRead(job,pages);
  await this.store.metric(job,'native-parse',performance.now()-start,{pages:count,bytes:Number(doc.size_bytes)});
  await this.store.complete(job,{pages:count},async c=>{await c.query("UPDATE p5ds_documents SET state='prepared',updated_at=now() WHERE id=$1 AND state!='failed'",[doc.id]);await this.store.finalize(doc.id,c);});
 }
 async read(job,signal){
  const requested=await this.store.pages(job.document_id,job.payload.pages,true);
  if(requested.length!==job.payload.pages.length)throw new ServiceError('missing-prepared-page',503);
  const stored=requested.filter(p=>!p.evidence);
  if(!stored.length){await this.store.complete(job,{cached:true},c=>this.store.finalize(job.document_id,c));return;}
  const input=stored.map(p=>({...p.native,image:undefined,spans:undefined}));
  // Positions are durable in the source record. The reader sees row-preserving
  // text and an overview; detailed positions are sent only with a crop check.
  const images=stored.map(p=>({label:`Original page ${p.page}; overview, not proof of fine-detail legibility.`,bytes:p.image}));
  let reply;
  try{reply=validateEvidence(await this.reader.call(job,READER_SYSTEM,{pages:input},images,EVIDENCE_SCHEMA,signal),input);}
  catch(e){
   if(stored.length>1&&['provider-output-incomplete','invalid-provider-json','invalid-provider-schema','incomplete-page-manifest','invalid-page-record','quote-not-in-source'].includes(e.code)){
    for(const p of stored)await this.enqueueRead(job,[p.native]);await this.store.complete(job,{splitIntoPages:true,reason:e.code});return;
   }throw e;
  }
  let original;
  for(let i=0;i<reply.pages.length;i++){
   const page=reply.pages[i],source=stored.find(p=>p.page===page.page);const needs=page.regions.length||[...page.facts,...page.items].some(f=>['visual','calculated'].includes(f.basis));
   if(needs){
    const crops=[];
    if(page.regions.length&&!original)original=await this.store.document(job.tenant,job.project,job.document_id,true);
    for(const region of page.regions){await this.parser(original.bytes,{maxPages:this.config.maxPages,timeoutMs:this.config.parseMs,signal,crop:{page:page.page,region},onPage:p=>{crops.push({label:`Original page ${page.page}, normalized crop ${JSON.stringify(region)}`,bytes:p.image});}});}
    const inputPage={...source.native,image:undefined};
    const verification=validateEvidence(await this.reader.call(job,VERIFIER_SYSTEM,{pages:[inputPage],prior:page},[{label:`Original page ${page.page}`,bytes:source.image},...crops],EVIDENCE_SCHEMA,signal,true),[inputPage]);
    const checked=verification.pages[0];
    // Each prior supported statement must survive or be listed as a correction.
    // Preserve both versions when a verifier disagrees; do not silently pick one.
    const contradictions=[];
    for(const f of page.facts){const match=checked.facts.find(v=>v.field===f.field&&v.value===f.value);if(!match){checked.facts.push(f);contradictions.push(`Verify conflicting ${f.field}: ${f.value}`);}}
    for(const item of page.items){if(!checked.items.some(v=>v.id===item.id&&v.quantity===item.quantity&&v.unit===item.unit&&v.component===item.component)){checked.items.push(item);contradictions.push(`Reconcile item ${item.id} against its source.`);}}
    if(contradictions.length){checked.status='partial';checked.notes.push(...contradictions);}
    if(checked.regions.length){checked.status='partial';checked.notes.push('Some detail regions still require confirmation.');}
    reply.pages[i]=checked;
   }
  }
  await this.store.complete(job,{pages:reply.pages.map(p=>p.page)},async c=>{
   for(const p of reply.pages)await c.query('UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2 AND evidence IS NULL',[job.document_id,p.page,JSON.stringify(p)]);
   await this.store.finalize(job.document_id,c);
  });
 }
 async submitReview(tenant,project,payload){
  if(!Array.isArray(payload.documents)||!payload.documents.length||payload.documents.length>50||typeof payload.text!=='string'||payload.text.length>2*1024*1024||!payload.answers||typeof payload.answers!=='object'||Array.isArray(payload.answers))throw new ServiceError('invalid-review-input');
  const seen=new Set(),ids=new Set();for(const ref of payload.documents){if(!ref||typeof ref.id!=='string'||typeof ref.source!=='string'||!ref.source.trim()||ref.source.length>500||seen.has(ref.source)||ids.has(ref.id))throw new ServiceError('ambiguous-source-name');seen.add(ref.source);ids.add(ref.id);await this.store.document(tenant,project,ref.id);}
  const id=jobId(tenant,project,'review',payload);
  await this.store.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['p5ds-quota:'+tenant]);
   const existing=await c.query('SELECT id FROM p5ds_jobs WHERE id=$1',[id]);if(existing.rowCount)return;
   const queued=await c.query("SELECT count(*)::int AS n FROM p5ds_jobs WHERE tenant=$1 AND kind='review' AND state IN ('queued','running')",[tenant]);if(queued.rows[0].n>=this.config.maxQueue)throw new ServiceError('review-queue-full',429,5000);
   await this.store.enqueue(c,{id,tenant,project,kind:'review',payload,priority:2});
  });return this.store.job(tenant,project,id);
 }
 async review(job,signal){
  const docs=[],manifest=[];
  for(const ref of job.payload.documents){
   const doc=await this.store.document(job.tenant,job.project,ref.id);if(doc.state==='failed')throw new ServiceError('source-reading-failed',422);
   if(doc.state!=='complete')throw new ServiceError('source-reading-pending',503,1000);
   const pages=await this.store.pages(doc.id);
   for(const p of pages){if(!p.evidence)throw new ServiceError('source-reading-pending',503,1000);manifest.push({source:ref.source,page:p.page,sheet:p.evidence.sheet,revision:p.evidence.revision,status:p.evidence.status,notes:p.evidence.notes});}
   docs.push({source:ref.source,pages:pages.map(p=>({page:p.page,evidence:p.evidence,nativeText:p.native.text}))});
  }
  const input={text:job.payload.text,answers:job.payload.answers,documents:docs};
  // No context window clipping or page sampling. Explicit capacity failures
  // remain diagnosable; a larger context model or smaller project is required.
  if(JSON.stringify(input).length>1800000)throw new ServiceError('review-context-capacity',422);
  await this.store.progress(job,{phase:'cross-referencing',totalPages:manifest.length,readPages:manifest.filter(p=>p.status==='read').length,message:'Reconciling source evidence with your requested scope.'});
  const result=validateReview(await this.reader.call(job,REVIEW_SYSTEM,input,[],REVIEW_SCHEMA,signal),manifest);
  await this.store.complete(job,result);
 }
 async run(job){
  const controller=new AbortController(),age=Date.now()-new Date(job.created_at).getTime();
  if(age>=this.config.jobMs){await this.store.fail({...job,attempts:3},new ServiceError('job-deadline-exceeded',422));return;}
  const timer=setTimeout(()=>controller.abort(),this.config.jobMs-age);
  const renew=setInterval(async()=>{try{if(!await this.store.renew(job))controller.abort();}catch{controller.abort();}},20000);
  try{await this.store.metric(job,'queue',Math.max(0,Date.now()-new Date(job.attempts===1?job.created_at:job.available_at).getTime()),{kind:job.kind,attempt:job.attempts});if(job.kind==='parse')await this.prepare(job,controller.signal);else if(job.kind==='read')await this.read(job,controller.signal);else await this.review(job,controller.signal);}
  catch(error){await this.store.fail(job,error).catch(()=>{});console.error(JSON.stringify({event:'document-job',id:job.id,stage:job.kind,code:error.code||'internal-processing-error'}));}
  finally{clearTimeout(timer);clearInterval(renew);}
 }
 start(){
  let stopped=false;const runs=new Set();let ticking=false;let lastCleanup=0;
  const tick=async()=>{if(stopped||ticking)return;ticking=true;try{
   if(Date.now()-lastCleanup>60000){await this.store.cleanup();lastCleanup=Date.now();}
   for(const [kinds,limit] of [[['parse'],this.config.parserSlots],[['read','review'],this.config.slots]]){
    while([...runs].filter(x=>kinds.includes(x.kind)).length<limit){const job=await this.store.claim(kinds);if(!job)break;const item={kind:job.kind,promise:null};runs.add(item);item.promise=this.run(job).finally(()=>runs.delete(item));}
   }
  }catch{console.error(JSON.stringify({event:'document-scheduler',code:'database-unavailable'}));}finally{ticking=false;}};
  const interval=setInterval(()=>void tick(),250);void tick();
  return async()=>{stopped=true;clearInterval(interval);await Promise.allSettled([...runs].map(r=>r.promise));};
 }
}
