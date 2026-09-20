import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-background-'));
delete process.env.DATABASE_URL;
// Requests drive jobs while they stay open; keep the hold short so the script observes intermediate states.
process.env.P5_JOB_HOLD_MS='200';
// The simulated read sleeps 350 ms per stage, longer than that hold, so a
// request returns while a stage is still running and the live page status is
// observable. A stage shorter than the hold completes inside it, and a
// completed job carries no in-flight status - which is correct, and left
// this script unable to observe the state it asserts.
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 await writeFile(path.join(dir,'analysisWork.ts'),`import {query} from './database';export const calls:string[]=[];export let fail=false;export function failure(value:boolean){fail=value;}export function analysisWorkKey(draft:any,text:string){return 'analysis-fixture-'+text;}export function analysisProgressWorkKeys(draft:any,text:string){return [analysisWorkKey(draft,text)];}export async function advanceAnalysis(draft:any,text:string){const key=analysisWorkKey(draft,text);const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draft.id,key]);const stage=row?.payload?.stage||0;if(stage>=2)return {pending:false,analysis:{extraction:{reviewNotes:[]}}};calls.push(text+stage);if(fail)throw new Error('Synthetic provider outage');const processing={phase:'reading',message:'Reading original pages '+(stage*8+1)+' to '+(stage*8+8),readPages:stage*8,totalPages:16,updatedAt:new Date().toISOString()};await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload',[draft.id,key,JSON.stringify({stage:stage+1,processing})]);await new Promise(r=>setTimeout(r,350));return {pending:true,progress:processing.message};}`);
 const mod=(n:string)=>import(pathToFileURL(path.join(dir,n+'.ts')).href);
 const store=await mod('store'),db=await mod('database'),background=await mod('backgroundJobs'),reader=await mod('analysisWork');
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 const draft=await store.saveDraft(id,key,'test',{text:'Queue fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const input={kind:'analysis',draft,text:'Queue fixture',answers:{}};
 assert.ok(['queued','running','complete'].includes((await background.queuedJob(input,false,0)).state),'the job is durable before any pass runs');
 const canonicalIdentity={engineVersion:11,kind:'analysis',id:draft.id,text:input.text,answers:input.answers,uploads:draft.uploads};
 const canonicalKey='background-v1-'+createHash('sha256').update(JSON.stringify(canonicalIdentity)).digest('hex');
 assert.equal((await db.query('SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,canonicalKey])).length,1,'analysis queue identity is the original configuration-independent v1 key');
 let live:any;
 for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,10));live=await background.queuedJob(input);if(live.processing?.phase==='reading')break;}
 assert.equal(live.processing.phase,'reading');assert.equal(live.processing.totalPages,16);assert.ok(live.processing.startedAt);
 // Workers progress from saved SQL without any further browser polling. A
 // running job is owned by its in-process runner while it holds the lease, so
 // a drain no longer steps it (it did before request-driven processing);
 // wait, bounded, for the runner to finish on its own.
 let complete:any;
 for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,60));await background.drainEstimatorJobs();[complete]=await db.query("SELECT payload FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND draft_id=$1",[id]);if(complete?.payload?.state==='complete')break;}
 assert.equal(complete.payload.state,'complete');assert.equal(reader.calls.length,2);
 await background.queuedJob(input);assert.equal(reader.calls.length,2,'completed work is not purchased again');
 // A recovery release briefly bound queue identity to remote mode/origin. Seed
 // only that key and verify activation under another configuration resumes its
 // exact accounting under the invariant key without deleting the old ledger.
 const migrationId=randomUUID(),migrationDraft=await store.saveDraft(migrationId,key,'test',{text:'Remote recovery queue fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const migrationInput={kind:'analysis',draft:migrationDraft,text:'Remote recovery queue fixture',answers:{}};
 const migrationIdentity={engineVersion:11,kind:'analysis',id:migrationId,text:migrationInput.text,answers:{},uploads:migrationDraft.uploads};
 const migrationKey='background-v1-'+createHash('sha256').update(JSON.stringify(migrationIdentity)).digest('hex');
 const recoveryKey='background-v1-'+createHash('sha256').update(JSON.stringify({engineVersion:11,documentServiceProtocol:'v1',documentServiceOrigin:'https://old-reader.invalid',...migrationIdentity})).digest('hex');
 const createdAt=new Date(Date.now()-12345).toISOString(),retryAt=Date.now()+100;
 const recoveryPayload={input:migrationInput,state:'complete',progress:'Previously completed remotely.',attempts:2,createdAt,retryAt,retryUnits:true,result:{analysis:{extraction:{reviewNotes:[]}}}};
 await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb)',[migrationId,recoveryKey,JSON.stringify(recoveryPayload)]);
 await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb)',[migrationId,'analysis-fixture-'+migrationInput.text,JSON.stringify({stage:2})]);
 process.env.P5_DOCUMENT_SERVICE_MODE='remote';process.env.P5_DOCUMENT_SERVICE_URL='https://new-reader.invalid';
 const migrated=await background.queuedJob(migrationInput,false,0);
 assert.equal(migrated.attempts,2);assert.equal(migrated.createdAt,createdAt);assert.equal(migrated.retryAt,retryAt);assert.equal(migrated.retryUnits,true);
 assert.equal((await db.query('SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND work_key IN ($2,$3)',[migrationId,recoveryKey,migrationKey])).length,1,'the existing recovery ledger is reused without creating a second runnable row');
 const [retainedRecovery]=await db.query('SELECT work_key,payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[migrationId,recoveryKey]);
 assert.equal(retainedRecovery.work_key,recoveryKey);assert.deepEqual(retainedRecovery.payload,recoveryPayload,'the recovery ledger remains unchanged at its original key');
 const ambiguousId=randomUUID(),ambiguousDraft=await store.saveDraft(ambiguousId,key,'test',{text:'Ambiguous recovery queue fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const ambiguousInput={kind:'analysis',draft:ambiguousDraft,text:'Ambiguous recovery queue fixture',answers:{}};
 const ambiguousPayload={...recoveryPayload,input:ambiguousInput,state:'complete',result:{analysis:{extraction:{reviewNotes:[]}}}};
 await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb),($1,$4,$3::jsonb)',[ambiguousId,'background-v1-old-origin-a',JSON.stringify(ambiguousPayload),'background-v1-old-origin-b']);
 await assert.rejects(()=>background.queuedJob(ambiguousInput,false,0),/Multiple saved processing ledgers/);
 assert.equal((await db.query("SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%'",[ambiguousId])).length,2,'ambiguous ledgers are left unchanged for reconciliation');
 delete process.env.P5_DOCUMENT_SERVICE_MODE;delete process.env.P5_DOCUMENT_SERVICE_URL;
 const interrupted={...input,text:'Interrupted queue fixture'};reader.failure(true);
 await background.queuedJob(interrupted);await new Promise(r=>setTimeout(r,30));
 for(let n=0;n<3;n++){
   await db.query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{retryAt}','0'::jsonb),lease_until=now()-interval '1 minute' WHERE work_key LIKE 'background-v1-%' AND payload->>'state' IN ('running','queued')");
   await background.drainEstimatorJobs();
 }
 const [failed]=await db.query("SELECT payload FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state'='failed'");assert.ok(failed);assert.match(failed.payload.progress,/Completed work is saved/);
 reader.failure(false);await background.queuedJob(interrupted,true);
 // The queue drains itself after a retry; give the worker a bounded moment to finish both saved stages.
 for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,60));await background.drainEstimatorJobs();const pending=await db.query("SELECT 1 FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state'<>'complete'");if(!pending.length)break;}
 assert.equal((await db.query("SELECT * FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state'<>'complete'")).length,0);
 assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,0,'processing alone never sends customer messages');
 assert.equal((await db.query('SELECT * FROM p5_estimator_work WHERE lease_token IS NOT NULL')).length,0);
 const drainId=randomUUID(),drainDraft=await store.saveDraft(drainId,key,'test',{text:'Ambiguous drain fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const drainInput={kind:'analysis',draft:drainDraft,text:'Ambiguous drain fixture',answers:{}};
 const queuedDuplicate={input:drainInput,state:'queued',progress:'Queued duplicate',attempts:1,createdAt:new Date().toISOString()};
 const runningDuplicate={input:drainInput,state:'running',progress:'Running duplicate',attempts:2,createdAt:new Date().toISOString()};
 await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb),($1,$4,$5::jsonb)',[drainId,'background-v1-drain-a',JSON.stringify(queuedDuplicate),'background-v1-drain-b',JSON.stringify(runningDuplicate)]);
 const callsBeforeDrain=reader.calls.length;
 await background.drainEstimatorJobs();await new Promise(r=>setTimeout(r,100));
 const drainRows=await db.query("SELECT work_key,payload,lease_token FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'background-v1-%' ORDER BY work_key",[drainId]);
 assert.equal(reader.calls.length,callsBeforeDrain,'drain does not advance either ambiguous analysis queue');
 assert.deepEqual(drainRows.map((row:any)=>row.payload),[queuedDuplicate,runningDuplicate],'drain leaves ambiguous payloads and attempt accounting unchanged');
 assert.ok(drainRows.every((row:any)=>row.lease_token==null),'drain does not leave an ambiguous queue claimed');
 await db.database.close();console.log('PASS: durable queue, request-driven passes, live page status, continued work without browser polling, no duplicate finished work, expired-lease recovery, failure/retry, and no delivery side effects. SQL real, AI simulated.');
}finally{await rm(dir,{recursive:true,force:true});}
