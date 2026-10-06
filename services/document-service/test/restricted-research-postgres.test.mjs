import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {QA_DDL,QA_MODEL,QA_RUN} from '../src/qa-budget.mjs';
import {RestrictedResearch} from '../src/restricted-research.mjs';

test('disposable PostgreSQL serializes competing research admissions and dispatches', {skip:!process.env.DOCUMENT_TEST_DATABASE_URL,timeout:90000},async()=>{
 const url=new URL(process.env.DOCUMENT_TEST_DATABASE_URL);
 // This test must never target a production URL, even if the wrong variable is
 // supplied. CI already provisions this named ephemeral loopback database.
 assert.ok(['postgres:','postgresql:'].includes(url.protocol));assert.equal(url.search,'');assert.equal(url.hash,'');
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/p5_documents_test');
 const {default:pg}=await import('pg');
 const admin=new pg.Pool({connectionString:url.href});
 const schema='qa_research_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^qa_research_[a-f0-9]{32}$/);
 let pool,release;let calls=0;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool=new pg.Pool({connectionString:url.href,options:`-c search_path=${schema}`,max:5});
  const store={pool,async transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}};
  await pool.query(QA_DDL);await pool.query(await readFile(new URL('../migrations/manual/20261006-restricted-research.sql',import.meta.url),'utf8'));
  const identity={tenant:'p5homeco.com',draftId:'4b984f15-af82-41ff-b181-e16696ea779a',revision:5,scopeHash:'a'.repeat(64),stageIdentity:'b'.repeat(64)};
  await pool.query('INSERT INTO p5ds_qa_runs(run_id,historical_microusd,historical_unknown_microusd,allowance_microusd) VALUES($1,3250000,390000,2000000)',[QA_RUN]);
  await pool.query('INSERT INTO p5ds_qa_projects(tenant,project,run_id) VALUES($1,$2,$3)',[identity.tenant,'qa-paid-'+identity.draftId,QA_RUN]);
  const body={model:QA_MODEL,max_tokens:6000,system:'Original complete fixture scope.',messages:[{role:'user',content:'Fixture evidence, not a real project.'}],tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}],tool_choice:{type:'tool',name:'web_search'},stream:false,service_tier:'standard_only'};
  const withVerifiedFence=async(expected,work)=>{
   // Deliberately no fake serialization here: the database run lock and active
   // index, not this fixture adapter, must enforce the competing operations.
   const liability=(await pool.query('SELECT liability_microusd FROM p5ds_qa_runs WHERE run_id=$1',[QA_RUN])).rows[0];
   const now=Date.now();return work({identity,requestHash:expected.requestHash,boundedMarker:true,noProviderMarker:false,epoch:'c'.repeat(64),evidenceHash:'d'.repeat(64),externalMicrousd:7190000,qaLiabilityMicrousd:Number(liability.liability_microusd),observedAt:now,expiresAt:now+120000});
  };
  let started;const begun=new Promise(r=>started=r),waiting=new Promise(r=>release=r);
  const budget=new RestrictedResearch(store,{provider:'anthropic',model:QA_MODEL,key:'fixture-only'},{enabled:true,withVerifiedFence,request:async()=>{calls++;started();await waiting;return Response.json({id:'msg_fixture',model:QA_MODEL,stop_reason:'pause_turn',content:[],usage:{input_tokens:2200000,output_tokens:6000,cache_creation_input_tokens:0,cache_read_input_tokens:0,server_tool_use:{web_search_requests:1},service_tier:'standard'}},{headers:{'request-id':'req_fixture'}});}});
  const approvals=await Promise.allSettled(Array.from({length:3},()=>budget.reserve(identity,body,'Independent fixture review of exact complete scope, source and atomic reserve.')));
  assert.equal(approvals.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(Number((await pool.query('SELECT liability_microusd FROM p5ds_qa_runs WHERE run_id=$1',[QA_RUN])).rows[0].liability_microusd),2240000);
  const first=budget.dispatch(identity,body);await Promise.race([begun,first]);
  await assert.rejects(budget.dispatch(identity,body),/prior-call-held/);assert.equal(calls,1);release();await first;
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM p5ds_qa_calls WHERE status='settled'")).rows[0].n,1);
  assert.equal((await budget.dispatch(identity,body)).replayed,true);assert.equal(calls,1);
 }finally{
  release?.();await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});
