import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {Client} from '@replit/object-storage';
import {analyzeBatch,AnalysisBusyError,type AnalysisFile,type AnalysisResult} from './extraction';
import {prepareAnalysisFiles} from './documents';
import {combineScopeExtractions,type ScopeAnswers,type ScopeExtraction} from './scope';
import {query} from './database';
import {readStoredBytes,ESTIMATOR_BUCKETS} from './objectStorage';
import {ESTIMATOR_BRAND} from './brand';
import {claimWork,writeWork,releaseWork} from './workStore';
import {type Draft,DraftError} from './store';
import {isInstructionFile,mergeInstructions} from './instructions';
import {drawingDetails} from './planRendering';
import {combineCoverage} from './documentLedger';
import {analysisConcurrency,analysisProgress} from './analysisProgress';
import type {ProcessingStatus} from './processingStatus';

const UNIT_BYTES=16*1024*1024;
export async function* analysisSegments(file:AnalysisFile,startPage=0):AsyncGenerator<AnalysisFile>{
  if(file.type==='application/pdf'){
    const document=await PDFDocument.load(file.data);const count=document.getPageCount();
    if(!count||count>2000)throw new Error('This PDF needs between 1 and 2,000 pages.');
    // Do not re-open a complete high-resolution plan set for every sheet.
    // Render one isolated source page while retaining its original identity.
    const detailPage=async function*(index:number){const single=await PDFDocument.create();single.addPage((await single.copyPages(document,[index]))[0]);yield* drawingDetails({...file,data:Buffer.from(await single.save())},index+1,1);};
    const large=(i:number)=>{const p=document.getPage(i);return p.getWidth()>1200||p.getHeight()>1200;};
    for(let start=startPage;start<count;){
      if(large(start)){
        try{yield* detailPage(start);}catch(error){yield {...file,data:Buffer.alloc(0),pages:[{source:file.name,page:start+1}],nextPage:start+1,preparationError:`Page ${start+1}: detail rendering failed. ${error instanceof Error?error.message:'Review the original drawing.'}`};}
        start++;continue;
      }
      let pages=Math.min(8,count-start),data:Buffer;
      while(pages>1&&Array.from({length:pages},(_,i)=>start+i).some(large))pages--;
      while(true){
        const part=await PDFDocument.create();for(const p of await part.copyPages(document,Array.from({length:pages},(_,i)=>start+i)))part.addPage(p);
        data=Buffer.from(await part.save());
        if(data.length<=UNIT_BYTES)break;
        if(pages===1)break;
        pages=Math.max(1,Math.floor(pages/2));
      }
      if(data.length>UNIT_BYTES){try{yield* detailPage(start);}catch(error){yield {...file,data:Buffer.alloc(0),pages:[{source:file.name,page:start+1}],preparationError:`Page ${start+1}: could not prepare its high-resolution content. ${error instanceof Error?error.message:''}`,nextPage:start+1};}}
      else yield {...file,name:count<=8?file.name:`${file.name} (pages ${start+1} to ${start+pages} of ${count})`,pages:Array.from({length:pages},(_,i)=>({source:file.name,page:start+i+1})),data,nextPage:start+pages};start+=pages;
    }
  }else if(['text/plain','text/csv','application/json'].includes(file.type)){
    const text=file.data.toString('utf8');
    for(let start=0;start<text.length;start+=60000)yield {...file,name:text.length<=60000?file.name:`${file.name} (text section ${Math.floor(start/60000)+1})`,data:Buffer.from(text.slice(start,start+60000))};
  }else{
    if(file.data.length>UNIT_BYTES)throw new Error('This image needs a smaller export before automatic reading. The original is saved.');
    yield file;
  }
}
type Unit={name:string;type:string;object:string;pages?:AnalysisFile['pages'];detailViews?:boolean;result?:AnalysisResult;attempts?:number;rateLimitRetries?:number;error?:string;retryAt?:number;active?:boolean};
type Job={prepared:number;units:Unit[];notes:string[];textDone?:AnalysisResult;textPrepared?:boolean;cursor?:number;expected?:{source:string;page:number}[];progress?:string;processing?:ProcessingStatus;concurrency?:number;cooldownUntil?:number};
export function analysisWorkKey(draft:Draft,text:string,answers:ScopeAnswers){
  return `analysis:v5:${createHash('sha256').update(JSON.stringify([text,answers,draft.uploads.map(f=>[f.id,f.sha256])])).digest('hex')}`;
}
/** Each request checkpoints work before returning. Reloading resumes the same source fingerprint. */
export async function advanceAnalysis(draft:Draft,text:string,answers:ScopeAnswers,request=fetch,retryFailed=false){
  const version=createHash('sha256').update(JSON.stringify([text,answers,draft.uploads.map(f=>[f.id,f.sha256])])).digest('hex');
  const workKey=analysisWorkKey(draft,text,answers),bucketId=ESTIMATOR_BUCKETS[ESTIMATOR_BRAND.domain],client=new Client({bucketId});
  const lease=await claimWork(draft.id,workKey,{prepared:0,units:[],notes:[]},300);
  if(!lease)return {pending:true as const,progress:'Your document review is already running. Saved progress will appear shortly.'};
  const job=lease.payload as Job;
  if(retryFailed)for(const unit of job.units)if(unit.object&&(!unit.result||unit.result.extraction.documentCoverage?.complete===false)){unit.attempts=0;unit.rateLimitRetries=0;delete unit.error;delete unit.result;delete unit.retryAt;}
  // Serialize writes from concurrent readers so a late database response cannot
  // overwrite a more recent completed section.
  let saving=Promise.resolve();
  const checkpoint=()=>{saving=saving.then(()=>{
    const progress=analysisProgress(job.units,job.expected);
    const active=job.units.filter(u=>u.active);
    const phase=job.prepared<draft.uploads.length?'preparing':active.some(u=>isInstructionFile(u.name))?'instructions':progress.readSections===progress.totalSections?'cross-referencing':'reading';
    job.progress=phase==='preparing'?`Preparing file ${Math.min(job.prepared+1,draft.uploads.length)} of ${draft.uploads.length}. ${job.units.length} sections saved for reading.`:progress.message;
    job.processing={...progress,phase,message:job.progress,currentItems:active.slice(0,3).map(u=>u.name),updatedAt:new Date().toISOString()};
    return writeWork(draft.id,workKey,lease.token,job);
  });return saving;};
  try{
    if(!job.textPrepared){
      // Long typed instructions are read in full before plan sections. No silent
      // clipping to fit one provider request, and no instruction-count cap.
      const sources=[{name:'ESTIMATING-INSTRUCTIONS--Typed estimating instructions.txt',value:answers.estimatingInstructions||''},{name:'ESTIMATING-INSTRUCTIONS--Typed project scope.txt',value:text}];
      for(const source of sources.filter(s=>s.value.length>48000))for(let start=0;start<source.value.length;start+=48000){
        const object=`analysis/${ESTIMATOR_BRAND.domain}/${draft.id}/${version}/${job.units.length}`;
        const stored=await client.uploadFromBytes(object,Buffer.from(source.value.slice(start,start+48000)),{compress:false});
        if(!stored.ok)throw new DraftError('Instruction preparation was interrupted. Retry to resume.',503);
        job.units.push({name:`${source.name} (section ${Math.floor(start/48000)+1})`,type:'text/plain',object});
      }
      job.textPrepared=true;await checkpoint();
    }
    if(job.prepared<draft.uploads.length){
      const upload=draft.uploads[job.prepared];
      const [row]=await query('SELECT name,mime_type,data_base64,storage_bucket,storage_key,sha256,size_bytes FROM p5_estimator_files WHERE draft_id=$1 AND id=$2',[draft.id,upload.id]);
      if(!row)throw new DraftError('A saved project file could not be located. Please retry.',503);
      const name=draft.uploads.filter(u=>u.name===row.name).length>1?`${row.name} [${upload.id.slice(0,8)}]`:String(row.name);
      const file={name,type:String(row.mime_type),data:await readStoredBytes(row)};
      if(file.type==='application/pdf'){
        try{const pdf=await PDFDocument.load(file.data);job.expected=[...(job.expected||[]).filter(p=>p.source!==file.name),...Array.from({length:pdf.getPageCount()},(_,i)=>({source:file.name,page:i+1}))];}
        catch{job.notes.push(`${file.name}: unreadable or encrypted PDF. No pages can be claimed as analyzed.`);job.prepared++;await checkpoint();return {pending:true as const,progress:`Saved an unreadable-file exception for ${file.name}. Continuing remaining files.`};}
      }
      const {readable,manualReview}=await prepareAnalysisFiles([file]);job.notes.push(...manualReview);
      const preparedAt=Date.now();
      for(const converted of readable){
        try{
          for await(const segment of analysisSegments(converted,job.cursor||0)){
            const object=`analysis/${ESTIMATOR_BRAND.domain}/${draft.id}/${version}/${job.units.length}`;
            if(segment.preparationError){job.units.push({name:segment.name,type:segment.type,object:'',pages:segment.pages,error:segment.preparationError,attempts:2});job.cursor=segment.nextPage;await checkpoint();continue;}
            const saved=await client.uploadFromBytes(object,segment.data,{compress:false});
            if(!saved.ok)throw new DraftError('Document preparation was interrupted. Retry to resume.',503);
            job.units.push({name:segment.name,type:segment.type,object,pages:segment.pages,detailViews:segment.detailViews});
            if(segment.nextPage!==undefined){job.cursor=segment.nextPage;await checkpoint();if(Date.now()-preparedAt>20000)return {pending:true as const,progress:`Prepared through page ${job.cursor} of ${file.name}. Preparation is checkpointed.`};}
          }
        }catch(error){if(error instanceof DraftError)throw error;job.notes.push(`${file.name}: ${error instanceof Error?error.message:'Could not read this file.'} Review the original before pricing.`);}
      }
      job.prepared++;job.cursor=0;await checkpoint();
      return {pending:true as const,progress:`Prepared ${job.prepared} of ${draft.uploads.length} files. ${job.units.length} document sections ready to read.`};
    }
    const instructionUnits=job.units.filter(u=>isInstructionFile(u.name));
    const instructionPending=instructionUnits.some(u=>!u.result&&(u.attempts||0)<2);
    const waiting=(instructionPending?instructionUnits:job.units).filter(u=>!u.result&&(u.attempts||0)<2);
    if(waiting.length&&job.cooldownUntil&&job.cooldownUntil>Date.now())return {pending:true as const,progress:'The document reader reached its temporary capacity. Completed pages are saved; automatically resuming after its requested pause.',retryAfterMs:job.cooldownUntil-Date.now()};
    const pending=waiting.filter(u=>!u.retryAt||u.retryAt<=Date.now()).slice(0,job.concurrency||analysisConcurrency());
    if(waiting.length&&!pending.length)return {pending:true as const,progress:'The document reader is temporarily busy. Completed pages are saved; retrying shortly.',retryAfterMs:Math.max(1000,Math.min(...waiting.map(u=>u.retryAt||Date.now()))-Date.now())};
    if(pending.length){
      for(const unit of pending)unit.active=true;
      await checkpoint();
      await Promise.all(pending.map(async unit=>{
        unit.attempts=(unit.attempts||0)+1;
        const context={...answers};if((context.estimatingInstructions?.length||0)>48000)delete context.estimatingInstructions;
        if(instructionUnits.some(u=>u.result?.extraction.instructions))context.estimatingInstructions=[context.estimatingInstructions,JSON.stringify(mergeInstructions(instructionUnits.flatMap(u=>u.result?.extraction.instructions?[u.result.extraction.instructions]:[])))].filter(Boolean).join('\n');
        try{
          const saved=await client.downloadAsBytes(unit.object);
          if(!saved.ok)throw new DraftError('A prepared document section could not be read. Retry to resume.',503);
          unit.result=await analyzeBatch(text.length>48000?'The complete typed scope is processed in saved sections; use the interpreted scope instructions.':text,[{name:unit.name,type:unit.type,data:saved.value[0],pages:unit.pages,detailViews:unit.detailViews}],context,request,120000);delete unit.error;delete unit.retryAt;
        }catch(error){
          unit.error=`${unit.name}: automatic reading could not finish. Review this section before pricing.`;
          if(error instanceof AnalysisBusyError){
            unit.rateLimitRetries=(unit.rateLimitRetries||0)+1;
            if(unit.rateLimitRetries<8)unit.attempts=Math.max(0,(unit.attempts||1)-1);
            else unit.attempts=2;
            unit.retryAt=Date.now()+Math.max(error.retryAfterMs,Math.min(120000,10000*2**(unit.rateLimitRetries-1)));
            job.cooldownUntil=Math.max(job.cooldownUntil||0,unit.retryAt);
            job.concurrency=Math.max(1,Math.floor((job.concurrency||analysisConcurrency())/2));
          }
        }
        unit.active=false;await checkpoint();
      }));
      await checkpoint();
      return {pending:true as const,progress:analysisProgress(job.units,job.expected).message};
    }
    if(!job.units.some(u=>u.result)&&!job.textDone){
      job.textDone=await analyzeBatch(text,[],answers,request,120000);await checkpoint();
    }
    const results=job.units.flatMap(u=>u.result?[u.result]:[]);if(job.textDone)results.push(job.textDone);
    const last=results[results.length-1];
    const extraction:ScopeExtraction=combineScopeExtractions(results.map(r=>r.extraction));
    const unprocessed=job.units.filter(u=>!u.result).flatMap(u=>(u.pages||[]).map(p=>({...p,sheet:'',revision:'',status:'unreadable' as const,notes:[u.error||'Page analysis did not finish.']})));
    if(unprocessed.length){const c=extraction.documentCoverage||{pages:[],expectedPages:0,complete:false};extraction.documentCoverage={pages:[...c.pages,...unprocessed],expectedPages:c.expectedPages+unprocessed.length,complete:false};}
    if(job.expected?.length)extraction.documentCoverage=combineCoverage(extraction.documentCoverage?[extraction.documentCoverage]:[],job.expected);
    extraction.reviewNotes.push(...job.notes,...job.units.filter(u=>!u.result).map(u=>u.error||`${u.name}: unread section requires review before pricing.`));
    extraction.reviewNotes.push(...(extraction.documentCoverage?.pages.filter(p=>p.status!=='read').map(p=>`${p.source}, page ${p.page}: ${p.status}. ${p.notes.join(' ')}`)||[]));
    extraction.reviewNotes=[...new Set(extraction.reviewNotes)];
    return {pending:false as const,version,analysis:{...last,extraction,analyzedAt:new Date().toISOString()}};
  }finally{await releaseWork(draft.id,workKey,lease.token);}
}
