import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-background-drain-'));
delete process.env.DATABASE_URL;
process.env.P5_JOB_HOLD_MS='0';

try{
  await cp('lib/p5',dir,{recursive:true});
  await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
  await writeFile(path.join(dir,'analysisWork.ts'),`
import {query} from './database';
export const calls:number[]=[];
let unblock:()=>void=()=>{};
let gate=new Promise<void>(resolve=>{unblock=resolve;});
export function releasePass(){unblock();}
export function analysisWorkKey(draft:any,text:string){return 'analysis-drain-'+text;}
export function analysisProgressWorkKeys(draft:any,text:string){return [analysisWorkKey(draft,text)];}
export async function advanceAnalysis(draft:any,text:string){
  const key=analysisWorkKey(draft,text);
  const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draft.id,key]);
  const stage=row?.payload?.stage||0;
  if(stage>=1)return {pending:false,analysis:{extraction:{reviewNotes:[]}}};
  calls.push(stage);
  await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload',[draft.id,key,JSON.stringify({stage:1,processing:{phase:'reading',message:'Checkpoint saved',updatedAt:new Date().toISOString()}})]);
  await gate;
  return {pending:true,progress:'Checkpoint saved',retryAfterMs:0};
}`);
  const mod=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
  const store=await mod('store'),db=await mod('database'),background=await mod('backgroundJobs'),reader=await mod('analysisWork');
  const secret=randomBytes(32).toString('hex');
  const id=randomUUID();
  const draft=await store.saveDraft(id,secret,'test',{text:'Drain checkpoint fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
  const input={kind:'analysis',draft,text:'Drain checkpoint fixture',answers:{}};

  await background.queuedJob(input,false,0);
  for(let n=0;n<50&&reader.calls.length===0;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(reader.calls.length,1,'one provider pass is in flight before drain');
  const [beforeDrain]=await db.query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[id]);

  const timedOut=await background.drainEstimatorWorker(5);
  assert.deepEqual(timedOut,{drained:false,timedOut:true,startedInFlight:1,remainingInFlight:1},'a bounded timeout reports the still-running pass truthfully');
  const [during]=await db.query("SELECT payload,lease_token FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[id]);
  assert.equal((await db.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,'analysis-drain-'+input.text]))[0].payload.stage,1,'the provider checkpoint is retained');
  assert.equal(during.payload.attempts,0,'drain does not reset or spend attempt accounting');
  assert.equal(during.payload.createdAt,beforeDrain.payload.createdAt,'drain does not restart the lifetime budget');

  await assert.rejects(()=>background.queuedJob(input,true,0),/temporarily draining/,'explicit retries are not admitted while quiescing');
  const rejectedId=randomUUID(),rejectedDraft=await store.saveDraft(rejectedId,secret,'test',{text:'Rejected admission',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
  await assert.rejects(()=>background.queuedJob({kind:'analysis',draft:rejectedDraft,text:'Rejected admission',answers:{}},false,0),/temporarily draining/);
  assert.equal((await db.query("SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[rejectedId])).length,0,'quiescence creates no new queue ledger');

  reader.releasePass();
  const drained=await background.drainEstimatorWorker(500);
  assert.equal(drained.drained,true);
  const [checkpointed]=await db.query("SELECT payload,lease_token FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[id]);
  assert.equal(checkpointed.payload.state,'running','drain preserves the resumable pending state');
  assert.equal(checkpointed.payload.attempts,0);
  assert.equal(checkpointed.payload.createdAt,beforeDrain.payload.createdAt);
  assert.equal(checkpointed.lease_token,null,'the completed pass releases its own lease');
  assert.equal(reader.calls.length,1,'quiescence does not start the next provider pass');

  background.resumeEstimatorWorker();
  await background.queuedJob(input,false,0);
  for(let n=0;n<50;n++){
    await new Promise(resolve=>setTimeout(resolve,10));
    const [row]=await db.query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[id]);
    if(row.payload.state==='complete')break;
  }
  const [resumed]=await db.query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[id]);
  assert.equal(resumed.payload.state,'complete','the saved checkpoint resumes after reopening admission');
  assert.equal(reader.calls.length,1,'resumption does not repurchase the checkpointed stage');

  const duplicateId=randomUUID();
  const duplicateDraft=await store.saveDraft(duplicateId,secret,'test',{text:'Drain duplicate fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
  const duplicateInput={kind:'analysis',draft:duplicateDraft,text:'Drain duplicate fixture',answers:{}};
  const a={input:duplicateInput,state:'queued',progress:'A',attempts:1,createdAt:new Date().toISOString()};
  const b={input:duplicateInput,state:'running',progress:'B',attempts:2,createdAt:new Date().toISOString()};
  await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb),($1,$4,$5::jsonb)',[duplicateId,'background-v1-duplicate-a',JSON.stringify(a),'background-v1-duplicate-b',JSON.stringify(b)]);
  await background.drainEstimatorJobs();
  const duplicateRows=await db.query("SELECT payload,lease_token FROM p5_estimator_work WHERE draft_id=$1 ORDER BY work_key",[duplicateId]);
  assert.deepEqual(duplicateRows.map((row:any)=>row.payload),[a,b],'ambiguous accounting ledgers fail closed without mutation');
  assert.ok(duplicateRows.every((row:any)=>row.lease_token==null));

  background.stopEstimatorWorker();
  await db.database.close();
  console.log('PASS: bounded truthful drain, admission quiescence, checkpoint retention/resumption, and ambiguous-ledger fail-closed behavior.');
}finally{
  delete process.env.P5_JOB_HOLD_MS;
  await rm(dir,{recursive:true,force:true});
}