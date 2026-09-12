import {createHash} from 'node:crypto';
import {query} from './database';
import {claimWork,writeWork,releaseWork} from './workStore';
import type {Draft} from './store';
import type {ScopeAnswers} from './scope';
import type {EstimatorConfiguration} from './costBook';
import type {ProcessingStatus} from './processingStatus';

type Input={kind:'analysis';draft:Draft;text:string;answers:ScopeAnswers}|{kind:'pricing';draft:Draft;configuration:EstimatorConfiguration};
type Job={input:Input;state:'queued'|'running'|'complete'|'failed';progress:string;attempts:number;result?:any;retryAt?:number;retryUnits?:boolean;createdAt:string;processing?:ProcessingStatus};
const runtime=globalThis as typeof globalThis & {p5JobTimer?:ReturnType<typeof setInterval>;p5JobsRunning?:boolean};
export async function bootEstimatorWorker(){
  if(!process.env.DATABASE_URL||process.env.NEXT_PHASE==='phase-production-build')return;
  try{await (await import('./store')).ensureSchema();startEstimatorWorker();}
  catch{console.error('[p5-worker] Startup database unavailable. The next estimator request will retry initialization.');}
}
/** Durable inputs/results live in SQL. Timers only wake work; a process restart
 * never loses the queue. Neither worker kind creates delivery/CRM records.
 */
export async function queuedJob(input:Input,retry=false){
  const key='background-v1-'+createHash('sha256').update(JSON.stringify(input.kind==='analysis'?{engineVersion:6,kind:input.kind,id:input.draft.id,text:input.text,answers:input.answers,uploads:input.draft.uploads}:{engineVersion:5,kind:input.kind,id:input.draft.id,reviewed:input.draft.reviewed,configuration:input.configuration,date:new Date().toISOString().slice(0,10)})).digest('hex');
  const initial:Job={input,state:'queued',progress:input.kind==='analysis'?'Your complete document set is queued for analysis.':'Your scope is queued for pricing.',attempts:0,createdAt:new Date().toISOString()};
  await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[input.draft.id,key,JSON.stringify(initial)]);
  if(retry){
    const lease=await claimWork(input.draft.id,key,initial,30);
    if(lease){const previous=lease.payload as Job;try{
      if(previous.state==='failed'||previous.state==='complete'&&input.kind==='analysis'&&previous.result?.analysis?.extraction?.reviewNotes?.length){previous.state='queued';previous.attempts=0;previous.retryAt=0;previous.retryUnits=true;delete previous.result;}
      await writeWork(input.draft.id,key,lease.token,previous);
    }finally{await releaseWork(input.draft.id,key,lease.token);}}
  }
  const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[input.draft.id,key]);
  startEstimatorWorker();void drainEstimatorJobs();
  const job=row.payload as Job;
  if(job.state==='running'){
    const workKey=input.kind==='analysis'?(await import('./analysisWork')).analysisWorkKey(input.draft,input.text,input.answers):(await import('./pricingWork')).pricingWorkKey(input.draft.reviewed!,input.configuration,new Date(job.createdAt));
    const [detail]=await query("SELECT payload->'processing' AS processing FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",[input.draft.id,workKey]);
    if(detail?.processing){job.processing={...detail.processing,startedAt:job.createdAt};job.progress=job.processing!.message;}
  }
  if(job.state==='failed'||job.retryAt&&job.retryAt>Date.now())job.processing={phase:'retrying',message:job.progress,startedAt:job.createdAt,updatedAt:new Date().toISOString()};
  return job;
}
export function startEstimatorWorker(){
  if(runtime.p5JobTimer||!process.env.DATABASE_URL)return;
  runtime.p5JobTimer=setInterval(()=>{void drainEstimatorJobs();},15000);
  runtime.p5JobTimer.unref?.();
  void drainEstimatorJobs();
}
export async function drainEstimatorJobs(){
  if(runtime.p5JobsRunning)return;runtime.p5JobsRunning=true;
  let more=false;
  try{
    const rows=await query("SELECT draft_id,work_key FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state' IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT 2");
    await Promise.all(rows.map(async row=>{
      const lease=await claimWork(row.draft_id,row.work_key,{},600);if(!lease)return;
      const job=lease.payload as Job;
      try{
        if(job.retryAt&&job.retryAt>Date.now())return;
        job.state='running';await writeWork(row.draft_id,row.work_key,lease.token,job);
        if(job.input.kind==='analysis'){
          const {advanceAnalysis}=await import('./analysisWork');
          const step=await advanceAnalysis(job.input.draft,job.input.text,job.input.answers,fetch,job.retryUnits);job.retryUnits=false;
          if(step.pending){job.progress=step.progress;job.retryAt=Date.now()+(step.retryAfterMs||0);more=true;}
          else{job.result=step;job.state='complete';job.progress='Document processing finished. Review the page coverage and any unreadable content.';}
        }else{
          const {priceSavedScope}=await import('./pricingWork');
          const {PricingPending}=await import('./pricingProgress');
          try{job.result=await priceSavedScope(job.input.draft.id,job.input.draft.reviewed!,job.input.configuration,new Date(job.createdAt));job.state='complete';job.progress='Pricing calculation saved.';}
          catch(error){if(!(error instanceof PricingPending))throw error;if(!error.retryAfterMs)throw error;job.progress=error.message;job.retryAt=Date.now()+error.retryAfterMs;more=true;}
        }
        job.attempts=0;
      }catch{
        job.attempts++;job.retryAt=Date.now()+Math.min(60000,job.attempts*10000);
        job.state=job.attempts>=3?'failed':'queued';
        job.progress=job.state==='failed'?'Processing paused after repeated failures. Completed work is saved. Use Retry to resume.':'An interrupted processing step will retry automatically; completed work is saved.';
      }finally{await writeWork(row.draft_id,row.work_key,lease.token,job);await releaseWork(row.draft_id,row.work_key,lease.token);}
    }));
  }catch{console.error('[p5-worker] Queue temporarily unavailable; persisted jobs will resume.');}
  finally{runtime.p5JobsRunning=false;if(more){const timer=setTimeout(()=>{void drainEstimatorJobs();},1000);timer.unref?.();}}
}
