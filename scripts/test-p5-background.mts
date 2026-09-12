import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-background-'));
delete process.env.DATABASE_URL;
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 await writeFile(path.join(dir,'analysisWork.ts'),`import {query} from './database';export const calls:string[]=[];export let fail=false;export function failure(value:boolean){fail=value;}export function analysisWorkKey(draft:any,text:string){return 'analysis-fixture-'+text;}export async function advanceAnalysis(draft:any,text:string){const key=analysisWorkKey(draft,text);const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draft.id,key]);const stage=row?.payload?.stage||0;if(stage>=2)return {pending:false,analysis:{extraction:{reviewNotes:[]}}};calls.push(text+stage);if(fail)throw new Error('Synthetic provider outage');const processing={phase:'reading',message:'Reading original pages '+(stage*8+1)+' to '+(stage*8+8),readPages:stage*8,totalPages:16,updatedAt:new Date().toISOString()};await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload',[draft.id,key,JSON.stringify({stage:stage+1,processing})]);await new Promise(r=>setTimeout(r,80));return {pending:true,progress:processing.message};}`);
 const mod=(n:string)=>import(pathToFileURL(path.join(dir,n+'.ts')).href);
 const store=await mod('store'),db=await mod('database'),background=await mod('backgroundJobs'),reader=await mod('analysisWork');
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 const draft=await store.saveDraft(id,key,'test',{text:'Queue fixture',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const input={kind:'analysis',draft,text:'Queue fixture',answers:{}};
 assert.equal((await background.queuedJob(input)).state,'queued');
 let live:any;
 for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,10));live=await background.queuedJob(input);if(live.processing?.phase==='reading')break;}
 assert.equal(live.processing.phase,'reading');assert.equal(live.processing.totalPages,16);assert.ok(live.processing.startedAt);
 await new Promise(r=>setTimeout(r,120));
 // Workers progress from saved SQL without any further browser polling.
 for(let n=0;n<5;n++)await background.drainEstimatorJobs();
 const [complete]=await db.query("SELECT payload FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND draft_id=$1",[id]);
 assert.equal(complete.payload.state,'complete');assert.equal(reader.calls.length,2);
 await background.queuedJob(input);assert.equal(reader.calls.length,2,'completed work is not purchased again');
 const interrupted={...input,text:'Interrupted queue fixture'};reader.failure(true);
 await background.queuedJob(interrupted);await new Promise(r=>setTimeout(r,30));
 for(let n=0;n<3;n++){
   await db.query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{retryAt}','0'::jsonb),lease_until=now()-interval '1 minute' WHERE work_key LIKE 'background-v1-%' AND payload->>'state' IN ('running','queued')");
   await background.drainEstimatorJobs();
 }
 const [failed]=await db.query("SELECT payload FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state'='failed'");assert.ok(failed);assert.match(failed.payload.progress,/Completed work is saved/);
 reader.failure(false);await background.queuedJob(interrupted,true);await new Promise(r=>setTimeout(r,120));
 for(let n=0;n<5;n++)await background.drainEstimatorJobs();
 assert.equal((await db.query("SELECT * FROM p5_estimator_work WHERE work_key LIKE 'background-v1-%' AND payload->>'state'<>'complete'")).length,0);
 assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,0,'processing alone never sends customer messages');
 assert.equal((await db.query('SELECT * FROM p5_estimator_work WHERE lease_token IS NOT NULL')).length,0);
 await db.database.close();console.log('PASS: durable queue, live page status, continued work without browser polling, no duplicate finished work, expired-lease recovery, failure/retry, and no delivery side effects. SQL real, AI simulated.');
}finally{await rm(dir,{recursive:true,force:true});}
