import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {Client} from '@replit/object-storage';
import {analyzeBatch,type AnalysisFile,type AnalysisResult} from './extraction';
import {prepareAnalysisFiles} from './documents';
import {combineScopeExtractions,type ScopeAnswers,type ScopeExtraction} from './scope';
import {query} from './database';
import {readStoredBytes,ESTIMATOR_BUCKETS} from './objectStorage';
import {ESTIMATOR_BRAND} from './brand';
import {claimWork,writeWork,releaseWork} from './workStore';
import {type Draft,DraftError} from './store';

const UNIT_BYTES=16*1024*1024;
export async function* analysisSegments(file:AnalysisFile):AsyncGenerator<AnalysisFile>{
  if(file.type==='application/pdf'){
    const document=await PDFDocument.load(file.data);const count=document.getPageCount();
    if(!count||count>2000)throw new Error('This PDF needs between 1 and 2,000 pages.');
    for(let start=0;start<count;){
      let pages=Math.min(8,count-start),data:Buffer;
      while(true){
        const part=await PDFDocument.create();for(const p of await part.copyPages(document,Array.from({length:pages},(_,i)=>start+i)))part.addPage(p);
        data=Buffer.from(await part.save());
        if(data.length<=UNIT_BYTES)break;
        if(pages===1)throw new Error(`Page ${start+1} contains more image data than automatic reading supports. Export that sheet as an optimized PDF or clear image.`);
        pages=Math.max(1,Math.floor(pages/2));
      }
      yield {...file,name:count<=8?file.name:`${file.name} (pages ${start+1} to ${start+pages} of ${count})`,data};start+=pages;
    }
  }else if(['text/plain','text/csv','application/json'].includes(file.type)){
    const text=file.data.toString('utf8');
    for(let start=0;start<text.length;start+=60000)yield {...file,name:text.length<=60000?file.name:`${file.name} (text section ${Math.floor(start/60000)+1})`,data:Buffer.from(text.slice(start,start+60000))};
  }else{
    if(file.data.length>UNIT_BYTES)throw new Error('This image needs a smaller export before automatic reading. The original is saved.');
    yield file;
  }
}
type Unit={name:string;type:string;object:string;result?:AnalysisResult;attempts?:number;error?:string};
type Job={prepared:number;units:Unit[];notes:string[];textDone?:AnalysisResult};
/** Each request checkpoints work before returning. Reloading resumes the same source fingerprint. */
export async function advanceAnalysis(draft:Draft,text:string,answers:ScopeAnswers,request=fetch,retryFailed=false){
  const version=createHash('sha256').update(JSON.stringify([text,answers,draft.uploads.map(f=>[f.id,f.sha256])])).digest('hex');
  const workKey=`analysis:v2:${version}`,bucketId=ESTIMATOR_BUCKETS[ESTIMATOR_BRAND.domain],client=new Client({bucketId});
  const lease=await claimWork(draft.id,workKey,{prepared:0,units:[],notes:[]},180);
  if(!lease)return {pending:true as const,progress:'Your document review is already running. Saved progress will appear shortly.'};
  const job=lease.payload as Job;
  if(retryFailed)for(const unit of job.units)if(!unit.result){unit.attempts=0;delete unit.error;}
  const checkpoint=()=>writeWork(draft.id,workKey,lease.token,job);
  try{
    if(job.prepared<draft.uploads.length){
      const upload=draft.uploads[job.prepared];
      const [row]=await query('SELECT name,mime_type,data_base64,storage_bucket,storage_key,sha256,size_bytes FROM p5_estimator_files WHERE draft_id=$1 AND id=$2',[draft.id,upload.id]);
      if(!row)throw new DraftError('A saved project file could not be located. Please retry.',503);
      const file={name:String(row.name),type:String(row.mime_type),data:await readStoredBytes(row)};
      const {readable,manualReview}=await prepareAnalysisFiles([file]);job.notes.push(...manualReview);
      for(const converted of readable){
        try{
          for await(const segment of analysisSegments(converted)){
            const object=`analysis/${ESTIMATOR_BRAND.domain}/${draft.id}/${version}/${job.units.length}`;
            const saved=await client.uploadFromBytes(object,segment.data,{compress:false});
            if(!saved.ok)throw new DraftError('Document preparation was interrupted. Retry to resume.',503);
            job.units.push({name:segment.name,type:segment.type,object});
          }
        }catch(error){if(error instanceof DraftError)throw error;job.notes.push(`${file.name}: ${error instanceof Error?error.message:'Could not read this file.'} Review the original before pricing.`);}
      }
      job.prepared++;await checkpoint();
      return {pending:true as const,progress:`Prepared ${job.prepared} of ${draft.uploads.length} files. ${job.units.length} document sections ready to read.`};
    }
    const pending=job.units.filter(u=>!u.result&&(u.attempts||0)<2).slice(0,3);
    if(pending.length){
      await Promise.all(pending.map(async unit=>{
        const saved=await client.downloadAsBytes(unit.object);
        if(!saved.ok)throw new DraftError('A prepared document section could not be read. Retry to resume.',503);
        unit.attempts=(unit.attempts||0)+1;
        try{unit.result=await analyzeBatch(text,[{name:unit.name,type:unit.type,data:saved.value[0]}],answers,request,120000);delete unit.error;}
        catch{unit.error=`${unit.name}: automatic reading could not finish. Review this section before pricing.`;}
      }));
      await checkpoint();
      const read=job.units.filter(u=>u.result).length;
      return {pending:true as const,progress:`Read ${read} of ${job.units.length} document sections. Matching measurements and project details.`};
    }
    if(!job.units.some(u=>u.result)&&!job.textDone){
      job.textDone=await analyzeBatch(text,[],answers,request,120000);await checkpoint();
    }
    const results=job.units.flatMap(u=>u.result?[u.result]:[]);if(job.textDone)results.push(job.textDone);
    const last=results[results.length-1];
    const extraction:ScopeExtraction=combineScopeExtractions(results.map(r=>r.extraction));
    extraction.reviewNotes.push(...job.notes,...job.units.filter(u=>!u.result).map(u=>u.error||`${u.name}: unread section requires review before pricing.`));
    return {pending:false as const,version,analysis:{...last,extraction,analyzedAt:new Date().toISOString()}};
  }finally{await releaseWork(draft.id,workKey,lease.token);}
}
