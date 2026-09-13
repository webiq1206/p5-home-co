import {SERVER_BUDGET_MS,BACKGROUND_JOB_LIMIT_MS,PRICING_PASS_MS,PROCESSING_PAUSED,ProcessingDeadlineError,remainingBudget} from './processingBudget.ts';
import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {claimWork,writeWork,releaseWork} from './workStore.ts';
import type {Draft} from './store.ts';
import type {ScopeAnswers} from './scope.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import type {ProcessingStatus} from './processingStatus.ts';

type Input={kind:'analysis';draft:Draft;text:string;answers:ScopeAnswers}|{kind:'pricing';draft:Draft;configuration:EstimatorConfiguration};
type Job={input:Input;state:'queued'|'running'|'complete'|'failed';progress:string;attempts:number;result?:any;retryAt?:number;retryUnits?:boolean;createdAt:string;processing?:ProcessingStatus};
const runtime=globalThis as typeof globalThis & {p5JobTimer?:ReturnType<typeof setInterval>;p5JobsRunning?:boolean};
const JOBS_PER_PASS=6;
const jobExpired=(job:Job)=>Date.now()-Date.parse(job.createdAt)>=BACKGROUND_JOB_LIMIT_MS;
export async function bootEstimatorWorker(){
  if(!process.env.DATABASE_URL||process.env.NEXT_PHASE==='phase-production-build')return;
  try{await (await import('./store.ts')).ensureSchema();startEstimatorWorker();}
  catch{console.error('[p5-worker] Startup database unavailable. The next estimator request will retry initialization.');}
}
/** Durable inputs/results live in SQL. Timers only wake work; a process restart
 * never loses the queue. Neither worker kind creates delivery/CRM records.
 * A job keeps running past one browser wait: the visitor sees saved progress
 * and continues, and only repeated provider failures or the job lifetime stop it.
 */
export async function queuedJob(input:Input,retry=false){
  const key='background-v1-'+createHash('sha256').update(JSON.stringify(input.kind==='analysis'?{engineVersion:11,kind:input.kind,id:input.draft.id,text:input.text,answers:input.answers,uploads:input.draft.uploads}:{engineVersion:8,kind:input.kind,id:input.draft.id,reviewed:input.draft.reviewed,configuration:input.configuration,date:new Date().toISOString().slice(0,10)})).digest('hex');
  const initial:Job={input,state:'queued',progress:input.kind==='analysis'?'Your complete document set is queued for analysis.':'Your scope is queued for pricing.',attempts:0,createdAt:new Date().toISOString()};
  await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[input.draft.id,key,JSON.stringify(initial)]);
  if(retry){
    const lease=await claimWork(input.draft.id,key,initial,30);
    if(lease){const previous=lease.payload as Job;try{
      const stale=previous.state!=='complete'&&jobExpired(previous);
      const rereadRequested=previous.state==='complete'&&input.kind==='analysis'&&previous.result?.analysis?.extraction?.reviewNotes?.length;
      if(previous.state==='failed'||stale||rereadRequested){previous.state='queued';previous.attempts=0;previous.retryAt=0;previous.retryUnits=true;previous.createdAt=new Date().toISOString();delete previous.result;}
      await writeWork(input.draft.id,key,lease.token,previous);
    }finally{await releaseWork(input.draft.id,key,lease.token);}}
  }
  const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[input.draft.id,key]);
  startEstimatorWorker();void drainEstimatorJobs();
  const job=row.payload as Job;
  if(job.state!=='complete'&&job.state!=='failed'&&jobExpired(job)){job.state='failed';job.progress=PROCESSING_PAUSED;}
  if(job.state!=='complete'&&job.state!=='failed'){
    const workKey=input.kind==='analysis'?(await import('./analysisWork.ts')).analysisWorkKey(input.draft,input.text,input.answers):(await import('./pricingWork.ts')).pricingWorkKey(input.draft.reviewed!,input.configuration,new Date(job.createdAt));
    const [detail]=await query("SELECT payload->'processing' AS processing FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",[input.draft.id,workKey]);
    if(detail?.processing){job.processing={...detail.processing,startedAt:job.createdAt};job.progress=job.processing!.message;}
  }
  if(job.state==='failed'||job.retryAt&&job.retryAt>Date.now()+2000)job.processing={...job.processing,phase:'retrying',message:job.progress,startedAt:job.createdAt,updatedAt:new Date().toISOString()};
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
    const rows=await query("SELECT draft_id,work_key FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state' IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT $1",[JOBS_PER_PASS]);
    if(rows.length>=JOBS_PER_PASS)more=true;
    await Promise.all(rows.map(async row=>{
      const lease=await claimWork(row.draft_id,row.work_key,{},600);if(!lease)return;
      const job=lease.payload as Job;
      try{
        // Each pass is bounded so progress is checkpointed and visible within
        // a browser wait; the job itself continues until it completes.
        const deadline=Math.min(Date.now()+(job.input.kind==='pricing'?PRICING_PASS_MS:SERVER_BUDGET_MS),Date.parse(job.createdAt)+BACKGROUND_JOB_LIMIT_MS);
        remainingBudget(deadline);
        if(job.retryAt&&job.retryAt>Date.now())return;
        job.state='running';await writeWork(row.draft_id,row.work_key,lease.token,job);
        if(job.input.kind==='analysis'){
          const {advanceAnalysis}=await import('./analysisWork.ts');
          const step=await advanceAnalysis(job.input.draft,job.input.text,job.input.answers,fetch,job.retryUnits,deadline);job.retryUnits=false;
          if(step.pending){job.progress=step.progress;job.retryAt=Date.now()+(step.retryAfterMs||0);more=true;}
          else{job.result=step;job.state='complete';job.progress='Document processing finished. Review the page coverage and any unreadable content.';}
        }else{
          const {priceSavedScope}=await import('./pricingWork.ts');
          const {PricingPending}=await import('./pricingProgress.ts');
          try{job.result=await priceSavedScope(job.input.draft.id,job.input.draft.reviewed!,job.input.configuration,new Date(job.createdAt),deadline);job.state='complete';job.progress='Pricing calculation saved.';}
          catch(error){if(!(error instanceof PricingPending))throw error;if(!error.retryAfterMs)throw error;job.progress=error.message;job.retryAt=Date.now()+error.retryAfterMs;more=true;}
        }
        job.attempts=0;
      }catch(error){
        if(error instanceof ProcessingDeadlineError&&!jobExpired(job)){
          // The pass ran out of time, not the work. Saved stages resume on the next pass.
          job.progress='Continuing where the previous step stopped. Completed work is saved.';job.retryAt=Date.now()+250;more=true;
        }else{
          job.attempts++;job.retryAt=Date.now()+Math.min(60000,job.attempts*10000);
          job.state=job.attempts>=3?'failed':'queued';
          job.progress=job.state==='failed'?'Processing paused after repeated failures. Completed work is saved. Use Retry to resume.':'An interrupted processing step will retry automatically; completed work is saved.';
        }
      }finally{if(job.state!=='complete'&&jobExpired(job)){job.state='failed';job.progress=PROCESSING_PAUSED;delete job.retryAt;}await writeWork(row.draft_id,row.work_key,lease.token,job);await releaseWork(row.draft_id,row.work_key,lease.token);}
    }));
  }catch{console.error('[p5-worker] Queue temporarily unavailable; persisted jobs will resume.');}
  finally{runtime.p5JobsRunning=false;if(more){const timer=setTimeout(()=>{void drainEstimatorJobs();},1000);timer.unref?.();}}
}
