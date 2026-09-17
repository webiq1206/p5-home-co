import {ANALYSIS_PASS_MS,BACKGROUND_JOB_LIMIT_MS,PRICING_PASS_MS,PROCESSING_PAUSED,ProcessingDeadlineError,remainingBudget,isProcessingDeadline} from './processingBudget.ts';
import {recordEvent,describeError} from './events.ts';
import {isPricingPending} from './pricingProgress.ts';
import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {claimWork,writeWork,releaseWork,renewWork} from './workStore.ts';
import type {Draft} from './store.ts';
import type {ScopeAnswers} from './scope.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import type {ProcessingStatus} from './processingStatus.ts';

type Input={kind:'analysis';draft:Draft;text:string;answers:ScopeAnswers}|{kind:'pricing';draft:Draft;configuration:EstimatorConfiguration};
type Job={input:Input;state:'queued'|'running'|'complete'|'failed';progress:string;attempts:number;result?:any;retryAt?:number;retryUnits?:boolean;createdAt:string;processing?:ProcessingStatus};
const runtime=globalThis as typeof globalThis & {p5JobTimer?:ReturnType<typeof setInterval>;p5JobsRunning?:boolean;p5JobRuns?:Map<string,Promise<void>>};
const JOBS_PER_PASS=6;
/** A pass holds its lease for this long and renews it while it runs. A lease
 * that stops renewing (the instance was paused or replaced) expires and
 * another request resumes the job from its saved stages. */
const JOB_LEASE_S=150;
const JOB_RENEW_MS=30_000;
/** How long one estimator request stays open driving a job before it replies.
 * Autoscale hosts allocate CPU while a request is in flight, so the poll
 * itself is what keeps a job moving; the reply returns early when the job
 * finishes or saves new progress. */
export const JOB_HOLD_MS=Number(process.env.P5_JOB_HOLD_MS||25_000);
const jobExpired=(job:Job)=>Date.now()-Date.parse(job.createdAt)>=BACKGROUND_JOB_LIMIT_MS;
const sleep=(ms:number)=>new Promise<void>(resolve=>{setTimeout(resolve,Math.max(0,ms));});
const runs=()=>runtime.p5JobRuns||(runtime.p5JobRuns=new Map());
export async function bootEstimatorWorker(){
  if(!process.env.DATABASE_URL||process.env.NEXT_PHASE==='phase-production-build')return;
  try{await (await import('./store.ts')).ensureSchema();startEstimatorWorker();}
  catch{console.error('[p5-worker] Startup database unavailable. The next estimator request will retry initialization.');}
}
/** Durable inputs/results live in SQL. Timers only wake work; a process restart
 * never loses the queue. Neither worker kind creates delivery/CRM records.
 * A job keeps running past one browser wait: the visitor sees saved progress
 * and continues, and only repeated provider failures or the job lifetime stop it.
 * Every request that asks about a job also drives it (see JOB_HOLD_MS), so
 * progress does not depend on CPU being available between requests.
 */
export async function queuedJob(input:Input,retry=false,holdMs=JOB_HOLD_MS){
  const key='background-v1-'+createHash('sha256').update(JSON.stringify(input.kind==='analysis'?{engineVersion:11,...(process.env.P5_DOCUMENT_SERVICE_MODE==='remote'?{documentServiceProtocol:'v1',documentServiceOrigin:process.env.P5_DOCUMENT_SERVICE_URL}:{}),kind:input.kind,id:input.draft.id,text:input.text,answers:input.answers,uploads:input.draft.uploads}:{engineVersion:8,kind:input.kind,id:input.draft.id,reviewed:input.draft.reviewed,configuration:input.configuration,date:new Date().toISOString().slice(0,10)})).digest('hex');
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
  startEstimatorWorker();
  if(holdMs>0)await driveJob(input.draft.id,key,holdMs);else void ensureRunning(input.draft.id,key);
  const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[input.draft.id,key]);
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
/** Start (or join) the in-process run of one job. The run continues after the
 * request that started it replies; later requests join it and wait. */
function ensureRunning(draftId:string,workKey:string){
  const id=draftId+'/'+workKey;
  let run=runs().get(id);
  if(!run){
    run=runJob(draftId,workKey).catch(()=>{}).finally(()=>{if(runs().get(id)===run)runs().delete(id);});
    runs().set(id,run);
  }
  return run;
}
/** Keep this request open while the job runs, replying as soon as the job
 * finishes, saves new progress, or the hold elapses. */
async function driveJob(draftId:string,workKey:string,holdMs:number){
  const run=ensureRunning(draftId,workKey);
  const until=Date.now()+holdMs;
  const stamp=async()=>{const [row]=await query('SELECT max(updated_at)::text AS stamp FROM p5_estimator_work WHERE draft_id=$1',[draftId]).catch(()=>[{stamp:''}]);return String(row?.stamp||'');};
  const before=await stamp();
  let settled=false;const done=run.then(()=>{settled=true;});
  while(!settled&&Date.now()<until){
    await Promise.race([done,sleep(Math.min(2000,until-Date.now()))]);
    if(settled||Date.now()>=until)break;
    if(await stamp()!==before)break;
  }
}
/** Run passes until the job completes, fails, expires, or another instance holds it. */
async function runJob(draftId:string,workKey:string){
  for(let pass=0;pass<400;pass++){
    const next=await runPass(draftId,workKey);
    if(next===null)return;
    await sleep(next);
  }
}
/** One bounded pass over a job. Returns the delay before the next pass, or
 * null when nothing further should run here. */
async function runPass(draftId:string,workKey:string):Promise<number|null>{
  const lease=await claimWork(draftId,workKey,{},JOB_LEASE_S);if(!lease)return null;
  const job=lease.payload as Job;
  if(!job.input||job.state==='complete'||job.state==='failed'){await releaseWork(draftId,workKey,lease.token);return null;}
  if(job.retryAt&&job.retryAt>Date.now()){const wait=job.retryAt-Date.now();await releaseWork(draftId,workKey,lease.token);return Math.min(wait,60_000);}
  const renew=setInterval(()=>{void renewWork(draftId,workKey,lease.token,JOB_LEASE_S).catch(()=>{});},JOB_RENEW_MS);renew.unref?.();
  let again:number|null=null;
  try{
    // Each pass is bounded so progress is checkpointed and visible within
    // a browser wait; the job itself continues until it completes.
    const deadline=Math.min(Date.now()+(job.input.kind==='pricing'?PRICING_PASS_MS:ANALYSIS_PASS_MS),Date.parse(job.createdAt)+BACKGROUND_JOB_LIMIT_MS);
    remainingBudget(deadline);
    job.state='running';await writeWork(draftId,workKey,lease.token,job);
    if(job.input.kind==='analysis'){
      const {advanceAnalysis}=await import('./analysisWork.ts');
      const step=await advanceAnalysis(job.input.draft,job.input.text,job.input.answers,fetch,job.retryUnits,deadline);job.retryUnits=false;
      if(step.pending){job.progress=step.progress;job.retryAt=Date.now()+(step.retryAfterMs||0);again=step.retryAfterMs||0;}
      else{job.result=step;job.state='complete';job.progress='Document processing finished. Review the page coverage and any unreadable content.';}
    }else{
      const {priceSavedScope}=await import('./pricingWork.ts');
      try{job.result=await priceSavedScope(job.input.draft.id,job.input.draft.reviewed!,job.input.configuration,new Date(job.createdAt),deadline);job.state='complete';job.progress='Pricing calculation saved.';}
      catch(error){
        if(!isPricingPending(error))throw error;
        if(error.fatal){job.state='failed';job.progress=error.message;job.attempts=3;again=null;console.error(`[p5-worker] pricing stopped: ${error.message}`);void recordEvent({draftId,estimator:job.input.draft.answers?.service||null,kind:'pricing',stage:'job',code:'fatal',message:error.message,outcome:'failed'});}
        else if(typeof error.retryAfterMs!=='number')throw error;
        else{job.progress=error.message;job.retryAt=Date.now()+error.retryAfterMs;again=error.retryAfterMs;}
      }
    }
    job.attempts=0;
  }catch(error){
    if(isProcessingDeadline(error)&&!jobExpired(job)){
      // The pass ran out of time, not the work. Saved stages resume on the next pass.
      job.progress='Continuing where the previous step stopped. Completed work is saved.';job.retryAt=Date.now()+250;again=250;
    }else{
      job.attempts++;job.retryAt=Date.now()+Math.min(60000,job.attempts*10000);
      job.state=job.attempts>=3?'failed':'queued';
      job.progress=job.state==='failed'?'Processing paused after repeated failures. Completed work is saved. Use Retry to resume.':'An interrupted processing step will retry automatically; completed work is saved.';
      again=job.state==='failed'?null:job.retryAt-Date.now();
      console.error(`[p5-worker] ${job.input.kind} pass failed (attempt ${job.attempts}): ${error instanceof Error?error.message:String(error)}`);
      const detail=describeError(error);
      void recordEvent({draftId,estimator:job.input.draft.answers?.service||null,kind:job.input.kind,stage:'job-pass',code:detail.code,status:detail.status,message:detail.message,attempt:job.attempts,outcome:job.state==='failed'?'failed':'retry'});
    }
  }finally{
    clearInterval(renew);
    if(job.state!=='complete'&&jobExpired(job)){job.state='failed';job.progress=PROCESSING_PAUSED;delete job.retryAt;again=null;void recordEvent({draftId,estimator:job.input.draft.answers?.service||null,kind:job.input.kind,stage:'job',code:'expired',message:'Job lifetime exceeded before completion.',outcome:'failed'});}
    try{await writeWork(draftId,workKey,lease.token,job);}catch{again=null;}
    await releaseWork(draftId,workKey,lease.token);
  }
  return again;
}
/** Timer-driven sweep for jobs nobody is asking about (a closed tab). Each
 * job it finds runs the same in-process loop that requests join. */
export async function drainEstimatorJobs(){
  if(runtime.p5JobsRunning)return;runtime.p5JobsRunning=true;
  try{
    const rows=await query("SELECT draft_id,work_key FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state' IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT $1",[JOBS_PER_PASS]);
    await Promise.all(rows.map(row=>ensureRunning(row.draft_id,row.work_key)));
  }catch{console.error('[p5-worker] Queue temporarily unavailable; persisted jobs will resume.');}
  finally{runtime.p5JobsRunning=false;}
}
