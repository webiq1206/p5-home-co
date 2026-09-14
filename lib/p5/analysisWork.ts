import {ANALYSIS_PASS_MS,READ_ALLOWANCE_MS,READ_START_MARGIN_MS,remainingBudget,ProcessingDeadlineError,isProcessingDeadline} from './processingBudget.ts';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {Client} from '@replit/object-storage';
import {analyzeBatch,AnalysisBusyError,type AnalysisFile,type AnalysisResult} from './extraction.ts';
import {prepareAnalysisFiles} from './documents.ts';
import {combineScopeExtractions,type ScopeAnswers,type ScopeExtraction} from './scope.ts';
import {query} from './database.ts';
import {readStoredBytes,ESTIMATOR_BUCKETS} from './objectStorage.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {claimWork,writeWork,releaseWork} from './workStore.ts';
import {type Draft,DraftError} from './store.ts';
import {isInstructionFile,mergeInstructions} from './instructions.ts';
import {combineCoverage} from './documentLedger.ts';
import {analysisConcurrency,analysisProgress} from './analysisProgress.ts';
import {recordEvent,describeError} from './events.ts';
import type {ProcessingStatus} from './processingStatus.ts';

export {analysisSegments} from './analysisSegments.ts';
import {analysisSegments} from './analysisSegments.ts';

type Unit={name:string;type:string;object:string;pages?:AnalysisFile['pages'];text?:string;context?:string;detailViews?:boolean;detailRegions?:AnalysisFile['detailRegions'];result?:AnalysisResult;attempts?:number;rateLimitRetries?:number;error?:string;lastCode?:string;retryAt?:number;active?:boolean};
type Job={prepared:number;units:Unit[];notes:string[];textDone?:AnalysisResult;textPrepared?:boolean;cursor?:number;expected?:{source:string;page:number}[];progress?:string;processing?:ProcessingStatus;concurrency?:number;cooldownUntil?:number};
/** Reads of one section before it is reported as unread. Each attempt may use
 * a different provider or the page's text layer, so this is several distinct
 * strategies, not the same call repeated. */
export const MAX_READ_ATTEMPTS=Math.max(1,Number(process.env.P5_READ_ATTEMPTS||4));
const pending=(u:Unit)=>!u.result&&(u.attempts||0)<MAX_READ_ATTEMPTS;
export function analysisWorkKey(draft:Draft,text:string,answers:ScopeAnswers){
  return `analysis:v8:${createHash('sha256').update(JSON.stringify([text,answers,draft.uploads.map(f=>[f.id,f.sha256])])).digest('hex')}`;
}
/** Page numbers as compact ranges: 1-4, 7, 9-10. */
export function pageRanges(pages:number[]):string{
  const sorted=[...new Set(pages)].sort((a,b)=>a-b);const parts:string[]=[];
  for(let i=0;i<sorted.length;){let j=i;while(j+1<sorted.length&&sorted[j+1]===sorted[j]+1)j++;parts.push(i===j?String(sorted[i]):`${sorted[i]}-${sorted[j]}`);i=j+1;}
  return parts.join(', ');
}
/** One note per source document for sections that could not be read, instead of one line per page and per section. */
export function unreadNotes(units:Unit[]):string[]{
  const bySource=new Map<string,{pages:number[];codes:Set<string>;names:string[]}>();
  for(const unit of units.filter(u=>!u.result)){
    const pages=unit.pages||[];const source=pages[0]?.source||unit.name;
    const entry=bySource.get(source)||{pages:[],codes:new Set<string>(),names:[]};
    entry.pages.push(...pages.map(p=>p.page));if(unit.lastCode)entry.codes.add(unit.lastCode);if(!pages.length)entry.names.push(unit.name);
    bySource.set(source,entry);
  }
  return [...bySource.entries()].map(([source,entry])=>{
    const where=entry.pages.length?`page${entry.pages.length>1?'s':''} ${pageRanges(entry.pages)}`:entry.names.join(', ');
    const reason=entry.codes.has('provider-429')?'the document reader was at capacity':entry.codes.has('provider-timeout')||entry.codes.has('deadline')?'the reader ran out of time':entry.codes.has('preparation')?'the page could not be prepared':'the document reader returned an error';
    return `${source}: automatic reading could not finish for ${where} (${reason}). Use Retry document reading to read ${entry.pages.length>1?'them':'it'} again; unread pages are not priced.`;
  });
}
/** Each request checkpoints work before returning. Reloading resumes the same source fingerprint. */
export async function advanceAnalysis(draft:Draft,text:string,answers:ScopeAnswers,request=fetch,retryFailed=false,absoluteDeadline=Date.now()+ANALYSIS_PASS_MS){
  remainingBudget(absoluteDeadline);
  const version=createHash('sha256').update(JSON.stringify([text,answers,draft.uploads.map(f=>[f.id,f.sha256])])).digest('hex');
  const workKey=analysisWorkKey(draft,text,answers),bucketId=ESTIMATOR_BUCKETS[ESTIMATOR_BRAND.domain],client=new Client({bucketId});
  const lease=await claimWork(draft.id,workKey,{prepared:0,units:[],notes:[]},300);
  if(!lease)return {pending:true as const,progress:'Your document review is already running. Saved progress will appear shortly.'};
  const job=lease.payload as Job;
  const event=(stage:string,outcome:'ok'|'failed'|'retry',extra:Partial<Parameters<typeof recordEvent>[0]>={})=>void recordEvent({draftId:draft.id,estimator:answers.service||null,kind:'analysis',stage,outcome,...extra});
  if(retryFailed)delete job.cooldownUntil;
  if(retryFailed)for(const unit of job.units)if(unit.object&&(!unit.result||unit.result.extraction.documentCoverage?.complete===false)){unit.attempts=0;unit.rateLimitRetries=0;delete unit.error;delete unit.lastCode;delete unit.result;delete unit.retryAt;}
  // Serialize writes from concurrent readers so a late database response cannot
  // overwrite a more recent completed section.
  let saving=Promise.resolve();
  const checkpoint=()=>{saving=saving.then(()=>{
    const progress=analysisProgress(job.units,job.expected);
    const active=job.units.filter(u=>u.active);
    const phase=!active.length&&job.prepared<draft.uploads.length?'preparing':active.some(u=>isInstructionFile(u.name))?'instructions':progress.readSections===progress.totalSections?'cross-referencing':'reading';
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
    // Preparation and reading interleave: a file is prepared while earlier
    // sections are being read, so the first page is read within seconds of the
    // upload instead of after every file is prepared.
    if(job.prepared<draft.uploads.length){
      const upload=draft.uploads[job.prepared];
      const [row]=await query('SELECT name,mime_type,data_base64,storage_bucket,storage_key,sha256,size_bytes FROM p5_estimator_files WHERE draft_id=$1 AND id=$2',[draft.id,upload.id]);
      if(!row)throw new DraftError('A saved project file could not be located. Please retry.',503);
      const name=draft.uploads.filter(u=>u.name===row.name).length>1?`${row.name} [${upload.id.slice(0,8)}]`:String(row.name);
      const file={name,type:String(row.mime_type),data:await readStoredBytes(row)};
      const preparing=Date.now();
      if(file.type==='application/pdf'){
        try{const pdf=await PDFDocument.load(file.data);job.expected=[...(job.expected||[]).filter(p=>p.source!==file.name),...Array.from({length:pdf.getPageCount()},(_,i)=>({source:file.name,page:i+1}))];}
        catch(error){job.notes.push(`${file.name}: unreadable or encrypted PDF. No pages can be claimed as analyzed.`);event('prepare','failed',{file:file.name,code:'unreadable-pdf',message:error instanceof Error?error.message:String(error),durationMs:Date.now()-preparing});job.prepared++;await checkpoint();return {pending:true as const,progress:`Saved an unreadable-file exception for ${file.name}. Continuing remaining files.`};}
      }
      const {readable,manualReview}=await prepareAnalysisFiles([file]);job.notes.push(...manualReview);
      for(const note of manualReview)event('prepare','failed',{file:file.name,code:'manual-review',message:note,durationMs:Date.now()-preparing});
      const preparedAt=Date.now();let finished=true;
      for(const converted of readable){
        try{
          for await(const segment of analysisSegments(converted,job.cursor||0)){
            remainingBudget(absoluteDeadline);
            const object=`analysis/${ESTIMATOR_BRAND.domain}/${draft.id}/${version}/${job.units.length}`;
            if(segment.preparationError){job.units.push({name:segment.name,type:segment.type,object:'',pages:segment.pages,error:segment.preparationError,lastCode:'preparation',attempts:MAX_READ_ATTEMPTS});event('prepare','failed',{file:segment.name,code:'preparation',message:segment.preparationError});job.cursor=segment.nextPage;await checkpoint();continue;}
            const saved=await client.uploadFromBytes(object,segment.data,{compress:false});
            if(!saved.ok)throw new DraftError('Document preparation was interrupted. Retry to resume.',503);
            job.units.push({name:segment.name,type:segment.type,object,pages:segment.pages,text:segment.text,context:segment.context,detailViews:segment.detailViews,detailRegions:segment.detailRegions});
            if(segment.nextPage!==undefined){job.cursor=segment.nextPage;await checkpoint();if(Date.now()-preparedAt>4000||job.units.filter(pending).length>=analysisConcurrency()*2){finished=false;break;}}
          }
        }catch(error){if(error instanceof DraftError||isProcessingDeadline(error))throw error;job.notes.push(`${file.name}: ${error instanceof Error?error.message:'Could not read this file.'} Review the original before pricing.`);event('prepare','failed',{file:file.name,code:'prepare-error',message:error instanceof Error?error.message:String(error),durationMs:Date.now()-preparing});}
        if(!finished)break;
      }
      if(finished){job.prepared++;job.cursor=0;event('prepare','ok',{file:file.name,durationMs:Date.now()-preparing,meta:{sections:job.units.length}});}
      await checkpoint();
      // Prepared sections are read right away in this same pass.
    }
    const instructionUnits=job.units.filter(u=>isInstructionFile(u.name));
    const instructionPending=instructionUnits.some(pending);
    const waiting=(instructionPending?instructionUnits:job.units).filter(pending);
    if(waiting.length&&job.cooldownUntil&&job.cooldownUntil>Date.now())return {pending:true as const,progress:'The document reader reached its temporary capacity. Completed pages are saved; automatically resuming after its requested pause.',retryAfterMs:job.cooldownUntil-Date.now()};
    const ready=waiting.filter(u=>!u.retryAt||u.retryAt<=Date.now());
    if(waiting.length&&!ready.length)return {pending:true as const,progress:'The document reader is temporarily busy. Completed pages are saved; retrying shortly.',retryAfterMs:Math.max(1000,Math.min(...waiting.map(u=>u.retryAt||Date.now()))-Date.now())};
    if(ready.length){
      // Keep slots busy as individual pages finish. A slow page does not hold up
      // the next one. A read is only started when the pass can still hold it,
      // and a pass ending is never counted as a failed read.
      let position=0;
      await Promise.all(Array.from({length:Math.min(ready.length,job.concurrency||analysisConcurrency())},async()=>{
        while(position<ready.length&&Date.now()+READ_START_MARGIN_MS<absoluteDeadline&&!(job.cooldownUntil&&job.cooldownUntil>Date.now())){
        const unit=ready[position++];unit.active=true;await checkpoint();
        unit.attempts=(unit.attempts||0)+1;
        const context={...answers};if((context.estimatingInstructions?.length||0)>48000)delete context.estimatingInstructions;
        if(instructionUnits.some(u=>u.result?.extraction.instructions))context.estimatingInstructions=[context.estimatingInstructions,JSON.stringify(mergeInstructions(instructionUnits.flatMap(u=>u.result?.extraction.instructions?[u.result.extraction.instructions]:[])))].filter(Boolean).join('\n');
        const started=Date.now();
        try{
          const saved=await client.downloadAsBytes(unit.object);
          if(!saved.ok)throw new DraftError('A prepared document section could not be read. Retry to resume.',503);
          const allowance=Math.min(READ_ALLOWANCE_MS,absoluteDeadline-Date.now());
          // Later attempts read from the text layer when the page has one, so a
          // page whose bytes keep failing is still read.
          const file:AnalysisFile={name:unit.name,type:unit.type,data:saved.value[0],pages:unit.pages,text:unit.text,context:unit.context,detailViews:unit.detailViews,detailRegions:unit.detailRegions};
          const input=unit.attempts>=3&&unit.type==='application/pdf'&&unit.text?[{...file,type:'text/plain',data:Buffer.from(unit.text,'utf8'),text:undefined,name:`${unit.name} (text layer)`}]:[file];
          unit.result=await analyzeBatch(text.length>48000?'The complete typed scope is processed in saved sections; use the interpreted scope instructions.':text,input,context,request,allowance,Date.now()+allowance,{event:{draftId:draft.id,estimator:answers.service||null,file:unit.name}});
          delete unit.error;delete unit.retryAt;delete unit.lastCode;
          event('read-section','ok',{file:unit.name,provider:unit.result.provider,model:unit.result.model,durationMs:Date.now()-started,attempt:unit.attempts,fallback:unit.attempts>1});
        }catch(error){
          if(isProcessingDeadline(error)){
            // The pass ran out, not the read. Give the attempt back and let the next pass resume it.
            unit.attempts=Math.max(0,(unit.attempts||1)-1);unit.active=false;await checkpoint();break;
          }
          const detail=describeError(error);
          unit.lastCode=detail.code;
          unit.error=`${unit.name}: automatic reading could not finish (${detail.code}).`;
          // The cause is logged (never the document) so a live host explains an unreadable section.
          console.error(`[p5-analysis] section ${unit.name} failed (attempt ${unit.attempts} of ${MAX_READ_ATTEMPTS}): ${detail.message}`);
          event('read-section',(unit.attempts||0)>=MAX_READ_ATTEMPTS?'failed':'retry',{file:unit.name,code:detail.code,status:detail.status,message:detail.message,durationMs:Date.now()-started,attempt:unit.attempts,fallback:unit.attempts>1});
          if(error instanceof AnalysisBusyError){
            unit.rateLimitRetries=(unit.rateLimitRetries||0)+1;
            if(unit.rateLimitRetries<8)unit.attempts=Math.max(0,(unit.attempts||1)-1);
            else unit.attempts=MAX_READ_ATTEMPTS;
            unit.retryAt=Date.now()+Math.max(error.retryAfterMs,Math.min(120000,10000*2**(unit.rateLimitRetries-1)));
            job.cooldownUntil=Math.max(job.cooldownUntil||0,unit.retryAt);
            job.concurrency=Math.max(1,Math.floor((job.concurrency||analysisConcurrency())/2));
          }else if(pending(unit)){
            // A short, growing pause between attempts; a transient provider fault clears within it.
            unit.retryAt=Date.now()+Math.min(30000,1500*2**((unit.attempts||1)-1));
          }
        }
        unit.active=false;await checkpoint();
        }
      }));
      await checkpoint();
      if(job.prepared<draft.uploads.length||job.units.some(pending))return {pending:true as const,progress:analysisProgress(job.units,job.expected).message};
    }
    if(job.prepared<draft.uploads.length)return {pending:true as const,progress:analysisProgress(job.units,job.expected).message};
    if(!job.units.length&&!draft.uploads.length&&!job.textDone){
      job.textDone=await analyzeBatch(text,[],answers,request,Math.min(READ_ALLOWANCE_MS,absoluteDeadline-Date.now()),absoluteDeadline,{race:true,event:{draftId:draft.id,estimator:answers.service||null,file:null}});await checkpoint();
    }
    const results=job.units.flatMap(u=>u.result?[u.result]:[]);if(job.textDone)results.push(job.textDone);
    const last=results[results.length-1];
    const extraction:ScopeExtraction=combineScopeExtractions(results.map(r=>r.extraction));
    const unprocessed=job.units.filter(u=>!u.result).flatMap(u=>(u.pages||[]).map(p=>({...p,sheet:'',revision:'',status:'unreadable' as const,notes:[u.error||'Page analysis did not finish.']})));
    if(unprocessed.length){const c=extraction.documentCoverage||{pages:[],expectedPages:0,complete:false};extraction.documentCoverage={pages:[...c.pages,...unprocessed],expectedPages:c.expectedPages+unprocessed.length,complete:false};}
    if(job.expected?.length)extraction.documentCoverage=combineCoverage(extraction.documentCoverage?[extraction.documentCoverage]:[],job.expected);
    // Unread sections are reported once per document with their page ranges.
    // Pages the reader did open but found partly illegible keep their own notes.
    const failedPages=new Set(unprocessed.map(p=>JSON.stringify([p.source,p.page])));
    extraction.reviewNotes.push(...job.notes,...unreadNotes(job.units));
    extraction.reviewNotes.push(...(extraction.documentCoverage?.pages.filter(p=>p.status!=='read'&&!failedPages.has(JSON.stringify([p.source,p.page]))).map(p=>`${p.source}, page ${p.page}: ${p.status}. ${p.notes.join(' ')}`)||[]));
    extraction.reviewNotes=[...new Set(extraction.reviewNotes)];
    const unread=job.units.filter(u=>!u.result).length;
    event('complete',unread?'failed':'ok',{meta:{sections:job.units.length,unread,pages:job.expected?.length||0,files:draft.uploads.length}});
    return {pending:false as const,version,analysis:{...last,extraction,analyzedAt:new Date().toISOString()}};
  }finally{await releaseWork(draft.id,workKey,lease.token);}
}
