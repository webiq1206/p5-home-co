import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {query} from './database.ts';
import {ensureSchema} from './store.ts';
import {linkSecret,publicOrigin} from './estimateLinks.ts';
/**
 * Keeps estimates moving when nobody has the page open (owner request 2026-09-22: closing the page,
 * refreshing, losing connection or locking a phone must not stop a submitted estimate).
 *
 * The site runs on an autoscale host, which gives an instance CPU only while a request is in flight.
 * Until now every job advanced only while the customer's browser polled it. The driver is a request
 * the server makes to itself: it holds for DRIVE_HOLD_MS working the queue (background jobs, finished
 * submissions, queued email) and, when work remains, starts its successor shortly before it ends, so
 * the next request is already in flight when this one stops. One driver runs at a time (a lease row
 * in p5_estimator_policy); a chain stops by itself when nothing is left to do.
 */
export const DRIVE_PATH='/api/p5-estimator/drive';
export const DRIVE_HOLD_MS=Number(process.env.P5_DRIVE_HOLD_MS||24_000);
const LEASE_ID='driver-lease-v1',LEASE_S=30;
export const driveToken=()=>createHmac('sha256',linkSecret()).update('p5-drive-v1').digest('hex');
export function validDriveToken(value:string|null):boolean{
  if(!value)return false;const a=Buffer.from(value),b=Buffer.from(driveToken());
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function claimLease(token:string):Promise<boolean>{
  await query("INSERT INTO p5_estimator_policy(id,payload,updated_by) VALUES($1,'{}'::jsonb,'estimate-driver') ON CONFLICT DO NOTHING",[LEASE_ID]);
  const rows=await query("UPDATE p5_estimator_policy SET payload=jsonb_build_object('token',$2::text,'until',to_char((now()+make_interval(secs=>$3)) AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')),updated_at=now() WHERE id=$1 AND (payload->>'until' IS NULL OR (payload->>'until')::timestamptz<now() OR payload->>'token'=$2) RETURNING id",[LEASE_ID,token,LEASE_S]);
  return rows.length>0;
}
async function releaseLease(token:string){await query("UPDATE p5_estimator_policy SET payload='{}'::jsonb,updated_at=now() WHERE id=$1 AND payload->>'token'=$2",[LEASE_ID,token]).catch(()=>undefined);}
/** Work nobody may be watching: queued or running jobs, requested submissions, undelivered email. */
export async function pendingWork():Promise<{jobs:number;submissions:number;deliveries:number}>{
  const [row]=await query(`SELECT
    (SELECT count(*) FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state' IN ('queued','running'))::int AS jobs,
    (SELECT count(*) FROM p5_estimator_work WHERE work_key='submit-request-v1' AND payload->>'state'='pending')::int AS submissions,
    (SELECT count(*) FROM p5_estimator_outbox WHERE status IN ('pending','retry'))::int AS deliveries`);
  return {jobs:Number(row?.jobs||0),submissions:Number(row?.submissions||0),deliveries:Number(row?.deliveries||0)};
}
const idle=(p:{jobs:number;submissions:number;deliveries:number})=>!p.jobs&&!p.submissions&&!p.deliveries;
/** Start (or continue) the chain. Fire and forget: the request itself is what gets CPU. */
export function kickDriver(reason='kick'):void{
  if(process.env.NODE_TEST_CONTEXT||process.env.P5_ESTIMATE_DRIVER==='off')return;
  try{
    void fetch(`${publicOrigin()}${DRIVE_PATH}`,{method:'POST',headers:{'x-p5-drive':driveToken(),'x-p5-drive-reason':reason},cache:'no-store'}).then(r=>r.body?.cancel()).catch(error=>console.error(`[p5-driver] could not start the next pass: ${error instanceof Error?error.message:error}`));
  }catch(error){console.error(`[p5-driver] not started: ${error instanceof Error?error.message:error}`);}
}
export interface DriveStep {drainJobs:()=>Promise<void>;finishSubmissions:()=>Promise<number>;deliver:()=>Promise<void>}
/** One driver request. Returns what it did; kicks a successor when work remains. */
export async function runDriver(step:DriveStep,holdMs=DRIVE_HOLD_MS,kick:(reason:string)=>void=kickDriver){
  await ensureSchema();
  const token=randomUUID(),started=Date.now();
  // A predecessor releases its lease as it finishes; wait briefly for it rather than exiting.
  let claimed=false;for(let i=0;i<8&&!claimed;i++){claimed=await claimLease(token);if(!claimed)await new Promise(r=>setTimeout(r,1000));}
  if(!claimed)return {ran:false,reason:'another driver is running'};
  let kicked=false,finished=0,passes=0;
  try{
    while(Date.now()-started<holdMs){
      passes++;
      await step.drainJobs().catch(error=>console.error('[p5-driver] job pass failed:',error instanceof Error?error.message:error));
      finished+=await step.finishSubmissions().catch(error=>{console.error('[p5-driver] finishing submissions failed:',error instanceof Error?error.message:error);return 0;});
      await step.deliver().catch(error=>console.error('[p5-driver] delivery pass failed:',error instanceof Error?error.message:error));
      await claimLease(token);
      const pending=await pendingWork();
      if(idle(pending))return {ran:true,passes,finished,kicked,idle:true};
      // Start the successor while this request still holds CPU.
      if(!kicked&&Date.now()-started>holdMs-6000){kick('continue');kicked=true;}
      await new Promise(r=>setTimeout(r,1500));
    }
    if(!kicked){kick('continue');kicked=true;}
    return {ran:true,passes,finished,kicked,idle:false};
  }finally{await releaseLease(token);}
}
