import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {isolatedPool,guardedSonnetFetch,targetedChecks} from '../scripts/model-qa-support.mjs';
import {runFixture,qualificationCallLimit,qualificationSpendLimit} from '../scripts/check-sonnet-documents.mjs';
import {hash} from '../src/core.mjs';
import {inspectSavedRun,inspectReviewRecovery} from '../scripts/inspect-sonnet-run.mjs';
import {verificationBoundarySnapshot} from '../scripts/resume-plans-verification-boundary.mjs';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const options={body:JSON.stringify({model:'claude-sonnet-5',max_tokens:1000,messages:[]})};
const url='https://api.anthropic.com/v1/messages';

test('plans qualification allowance is isolated, cumulative and hard-capped at twelve dollars',()=>{
 assert.equal(qualificationSpendLimit('short',{P5_QA_PLANS_LIMIT_USD:'12'}),1);
 assert.equal(qualificationSpendLimit('plans',{}),3);
 assert.equal(qualificationSpendLimit('plans',{P5_QA_PLANS_LIMIT_USD:'12'}),12);
 assert.throws(()=>qualificationSpendLimit('plans',{P5_QA_PLANS_LIMIT_USD:'12.01'}),/qa-plans-spend-limit-invalid/);
 assert.throws(()=>qualificationSpendLimit('plans',{P5_QA_PLANS_LIMIT_USD:'not-a-number'}),/qa-plans-spend-limit-invalid/);
});

test('plans qualification uses a cumulative 160-call secondary ceiling without changing the short-file guard',()=>{
 assert.equal(qualificationCallLimit('plans'),160);
 assert.equal(qualificationCallLimit('plans',128),128);
 assert.equal(qualificationCallLimit('short'),12);
 assert.throws(()=>qualificationCallLimit('plans',161),/qa-max-calls-invalid/);
 assert.throws(()=>qualificationCallLimit('short',160),/qa-max-calls-invalid/);
});

test('verification-boundary fingerprints detect checkpoint, evidence and job mutations',()=>{
 const document={id:'doc',digest:'source',state:'failed',error_code:'source-correction-needs-independent-verification',page_count:23};
 const jobs=[{id:'page-19',kind:'read',state:'failed',error_code:'source-correction-needs-independent-verification',attempts:4,priority:0,payload:{pages:[19]},result:{verificationCheckpoints:{'verify-19':{raw:{pages:[]}}}}}];
 const pages=[{page:19,native:{page:19,text:'source'},evidence:null}];
 const original=verificationBoundarySnapshot(document,jobs,pages);
 const changedCheckpoint=verificationBoundarySnapshot(document,[structuredClone(jobs[0])],pages);
 changedCheckpoint.verificationCheckpointSha256=verificationBoundarySnapshot(document,[{...structuredClone(jobs[0]),result:{verificationCheckpoints:{'verify-19':{raw:{pages:[{page:19}]}}}}}],pages).verificationCheckpointSha256;
 assert.notEqual(changedCheckpoint.verificationCheckpointSha256,original.verificationCheckpointSha256);
 assert.notEqual(verificationBoundarySnapshot(document,[{...jobs[0],state:'queued'}],pages).jobTopologySha256,original.jobTopologySha256);
 assert.notEqual(verificationBoundarySnapshot(document,jobs,[{...pages[0],evidence:{status:'read'}}]).pageEvidenceSha256,original.pageEvidenceSha256);
});

test('QA unknown charges pause immediately and across restart before any further network request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-budget-'));let calls=0,counts=0,pauses=0;
 const request=async u=>{if(u.endsWith('count_tokens')){counts++;return json({input_tokens:100});}calls++;throw new TypeError('Simulated interrupted response');};
 try{
  const settings={file:join(root,'cost.json'),limitUsd:1,maxCalls:10,request,onPause:()=>pauses++};
  const a=await guardedSonnetFetch(settings);await assert.rejects(a.request(url,options),e=>e.code==='qa-paused-unknown-provider-charge');assert.equal(calls,1);
  assert.ok(a.summary().estimatedUsd>.01);assert.equal(a.summary().unknownChargeRequests,1);
  assert.equal(a.summary().paused,true);assert.equal(pauses,1);
  const resumed=await guardedSonnetFetch(settings);
  await assert.rejects(resumed.request(url,options),e=>e.code==='qa-paused-unknown-provider-charge');assert.equal(calls,1);assert.equal(counts,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('known charges still enforce the estimate cap before a further generation request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-budget-'));let paid=0;
 try{
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:.02,maxCalls:10,request:async u=>u.endsWith('count_tokens')?json({input_tokens:100}):(paid++,json({usage:{input_tokens:100,output_tokens:1000}}))});
  await guard.request(url,options);
  await assert.rejects(guard.request(url,options),e=>e.code==='qa-estimated-spend-limit-reached');
  assert.equal(paid,1);assert.equal(guard.summary().paused,false);
 }finally{await rm(root,{recursive:true,force:true});}
});

for(const kind of ['missing usage','truncated body','negative usage'])test('QA pauses when a response has '+kind,async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-budget-'));let paid=0;
 try{
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:1,maxCalls:10,request:async u=>{
   if(u.endsWith('count_tokens'))return json({input_tokens:100});
   paid++;
   if(kind==='truncated body')return new Response('{"usage":');
   return json(kind==='negative usage'?{usage:{input_tokens:-1,output_tokens:20}}:{});
  }});
  await assert.rejects(guard.request(url,options),e=>e.code==='qa-paused-unknown-provider-charge');
  await assert.rejects(guard.request(url,options),e=>e.code==='qa-paused-unknown-provider-charge');
  assert.equal(paid,1);assert.equal(guard.summary().unknownChargeRequests,1);
  assert.ok(guard.summary().estimatedUsd>0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a concurrent token count cannot start generation after another request pauses the ledger',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-budget-'));let counts=0,paid=0,releaseCount,failFirst;
 let countedSecond;const secondReached=new Promise(r=>{countedSecond=r;});
 const request=async u=>{
  if(u.endsWith('count_tokens')){
   if(++counts===2){countedSecond();await new Promise(r=>{releaseCount=r;});}
   return json({input_tokens:100});
  }
  paid++;await new Promise((resolve,reject)=>{failFirst=()=>reject(new DOMException('Test timeout','TimeoutError'));});
 };
 try{
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:1,maxCalls:10,request});
  const a=assert.rejects(guard.request(url,options),e=>e.code==='qa-paused-unknown-provider-charge');
  while(!failFirst)await new Promise(r=>setTimeout(r,1));
  const b=assert.rejects(guard.request(url,options),e=>e.code==='qa-paused-unknown-provider-charge');
  await secondReached;failFirst();await a;releaseCount();await b;
  assert.equal(paid,1);assert.equal(guard.summary().requests,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('concurrent QA requests cannot exceed the request cap and cannot route to Opus',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-budget-'));let paid=0;
 try{
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:1,maxCalls:1,request:async u=>u.endsWith('count_tokens')?json({input_tokens:100}):(paid++,json({usage:{input_tokens:100,output_tokens:20}}))});
  const results=await Promise.allSettled([guard.request(url,options),guard.request(url,options)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(paid,1);
  await assert.rejects(guard.request(url,{body:JSON.stringify({model:'claude-opus-5',max_tokens:1000})}),e=>e.code==='qa-unapproved-provider-request');
  assert.equal(guard.summary().usage.length,1);assert.ok(guard.summary().estimatedUsd<.001);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('isolated SQL serializes complete transactions without using any network database',async()=>{
 const pool=await isolatedPool();
 try{
  await pool.query('CREATE TABLE test_rows(id integer)');
  const client=await pool.connect();await client.query('BEGIN');await client.query('INSERT INTO test_rows VALUES(1)');
  let done=false;const pending=pool.query('SELECT count(*)::int AS n FROM test_rows').then(v=>{done=true;return v;});
  await new Promise(r=>setTimeout(r,20));assert.equal(done,false);
  await client.query('ROLLBACK');client.release();assert.equal((await pending).rows[0].n,0);
 }finally{await pool.end();}
});

test('targeted redaction checks fail invented house area and do not claim full accuracy',()=>{
 const result={summary:'Well septic cabinetry painting appliances fireplace',facts:[{field:'sqft',value:'4000'}],pages:Array.from({length:4},(_,i)=>({page:i+1,status:'read'})),instructions:{inclusions:[],exclusions:['Land, financing and wallpaper']}};
 const checks=targetedChecks('short',result,4);
 assert.equal(checks.passed,false);assert.equal(checks.exhaustive,false);assert.equal(checks.precision,null);assert.equal(checks.recall,null);
});

test('QA runner exercises real SQL, PDF parser and pipeline, then reuses completed work with no paid calls',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p5-qa-flow-')),root=join(directory,'1234567890abcdef');const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<4;i++){const p=pdf.addPage();p.drawText('Well septic cabinetry painting appliances fireplace.',{x:40,y:740,font,size:12});p.drawText('Exclude land, financing and wallpaper.',{x:40,y:710,font,size:12});}
 const bytes=Buffer.from(await pdf.save()),fixture={id:'short',sha256:hash(bytes),pages:4,pdfBase64:bytes.toString('base64')};let paid=0;
 const request=async(u,options)=>{
  if(u.endsWith('count_tokens'))return json({input_tokens:500});paid++;
  const b=JSON.parse(options.body),input=JSON.parse(b.messages[0].content[0].text);
  const usage={input_tokens:500,output_tokens:100};
  if(b.tools){
   const result={summary:'Well septic cabinetry painting appliances fireplace',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:['Well septic cabinetry painting appliances fireplace'],exclusions:['Land, financing, wallpaper'],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:input.documents.flatMap(d=>d.pages.map(p=>({source:d.source,page:p.page,sheet:'',revision:''}))),takeoffs:[]};
   return json({stop_reason:'tool_use',usage,content:[{type:'tool_use',name:'submit_document_review',id:'synthetic-only',input:result}]});
  }
  const pages=input.pages.map(p=>({page:p.page,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[],inclusions:['Well septic cabinetry painting appliances fireplace'],exclusions:['Land, financing, wallpaper'],responsibilities:[],regions:[]}));
  return json({stop_reason:'end_turn',usage,content:[{type:'text',text:JSON.stringify({pages})}]});
 };
 try{
  const report=await runFixture(fixture,{root,key:'synthetic-test-key-no-network',request,log:()=>{}});
  assert.equal(report.complete,true,report.error);assert.equal(report.pageEvidence.length,4);assert.equal(report.accuracyQualified,false);assert.equal(report.uploadMs,null);assert.equal(paid,5);
  const before=paid,cached=await runFixture(fixture,{root,key:'synthetic-test-key-no-network',request,log:()=>{}});
  assert.equal(cached.complete,true,cached.error);assert.equal(cached.runType,'resume-or-cache');assert.equal(paid,before);
  const saved=JSON.parse(await readFile(join(root,'short-'+fixture.sha256.slice(0,16),'report.json'),'utf8'));
  assert.equal(saved.stageWork.aiReadWorkMs>0,true);assert.equal(saved.cost.usage.length,5);
  assert.ok(!JSON.stringify(saved).includes('synthetic-test-key-no-network'));
  const snapshot=async directory=>{
   const entries=[];
   for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())entries.push(...await snapshot(path));
    else {const s=await stat(path);entries.push([path,s.size,s.mtimeMs]);}
   }
   return entries.sort((a,b)=>a[0].localeCompare(b[0]));
  };
  const filesBefore=await snapshot(root),callsBefore=paid;
  const inspected=await inspectSavedRun({root:directory});
  assert.equal(inspected.pages.length,4);assert.equal(inspected.complete,true);
  assert.equal(inspected.pages[0].status,'read');assert.equal(paid,callsBefore);
  assert.deepEqual(await snapshot(root),filesBefore,'Inspection must not modify checkpoints');
  assert.ok(!JSON.stringify(inspected).includes('Well septic'),'Diagnostic console omits source text');
  // Reproduce the early-recovery path: the saved review exists even though
  // runFixture never reaches submitReview in this invocation.
  const runDirectory=join(root,'short-'+fixture.sha256.slice(0,16)),pool=await isolatedPool(join(runDirectory,'database'));
  let beforeRows;
  try{
   const read=(await pool.query("SELECT id FROM p5ds_jobs WHERE kind='read' LIMIT 1")).rows[0];
   const review=(await pool.query("SELECT id FROM p5ds_jobs WHERE kind='review'")).rows[0];
   await pool.query("UPDATE p5ds_jobs SET state='failed',error_code='qa-paused-unknown-provider-charge' WHERE id=$1",[review.id]);
   for(const [id,code,when] of [[read.id,'older-read-failure','2026-09-18T17:56:46Z'],[review.id,'latest-review-failure','2026-09-18T18:53:18Z']]){
    await pool.query("INSERT INTO p5ds_metrics(job_id,stage,duration_ms,detail,created_at) VALUES($1,'provider-failure',1,$2,$3)",[id,{code},when]);
   }
   beforeRows=(await pool.query('SELECT id,state,error_code,attempts FROM p5ds_jobs ORDER BY id')).rows;
  }finally{await pool.end();}
  const reportFile=join(runDirectory,'report.json'),ledgerFile=join(runDirectory,'cost.json');
  const priorReport=await readFile(reportFile,'utf8'),priorLedger=await readFile(ledgerFile,'utf8');
  const recovery=await runFixture(fixture,{root,key:'synthetic-test-key-no-network',request:()=>{throw Error('No network during recovery preflight');},resumeReview:true,log:()=>{}});
  assert.equal(recovery.preflightRejected,true);assert.equal(recovery.providerFailure,null);
  assert.equal(recovery.lastSavedProviderFailure.detail.code,'latest-review-failure');
  assert.equal(recovery.recoveryDiagnostic.checks.oneFailedReview,true);
  assert.ok(recovery.recoveryDiagnostic.failedChecks.includes('expectedDocument'));
  assert.equal(await readFile(reportFile,'utf8'),priorReport,'Do not overwrite paid-run history on preflight rejection');
  assert.equal(await readFile(ledgerFile,'utf8'),priorLedger);
  assert.ok(recovery.reportPath.endsWith('recovery-preflight-report.json'));
  const afterPool=await isolatedPool(join(runDirectory,'database'));
  try{assert.deepEqual((await afterPool.query('SELECT id,state,error_code,attempts FROM p5ds_jobs ORDER BY id')).rows,beforeRows);}finally{await afterPool.end();}
  const inspectionFiles=await snapshot(root);
  const diagnostic=await inspectReviewRecovery({root:directory,reportPath:reportFile});
  assert.deepEqual(diagnostic.failedChecks,recovery.recoveryDiagnostic.failedChecks);
  assert.equal(diagnostic.lastSavedProviderFailure.detail.code,'latest-review-failure');
  assert.deepEqual(await snapshot(root),inspectionFiles,'Free inspection never opens original storage for writes');
  assert.ok(!JSON.stringify(diagnostic).includes('Well septic'),'Recovery diagnostics omit source text');
  assert.ok(!JSON.stringify(diagnostic).includes('synthetic-test-key-no-network'));
  const historical=await inspectSavedRun({root:directory,reportPath:reportFile});
  assert.equal(historical.providerEvents.at(-1).code,'latest-review-failure','Read durable metrics even when the report was overwritten');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('QA runner stops after the first interruption and retains the earlier completed page',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-qa-stop-')),pdf=await PDFDocument.create();
 for(let n=0;n<4;n++)pdf.addPage().drawText('Synthetic source page. No customer information.');
 const bytes=Buffer.from(await pdf.save()),fixture={id:'short',sha256:hash(bytes),pages:4,pdfBase64:bytes.toString('base64')};let paid=0;
 const request=async(u,options)=>{
  if(u.endsWith('count_tokens'))return json({input_tokens:500});
  paid++;
  if(paid===1){
   const input=JSON.parse(JSON.parse(options.body).messages[0].content[0].text);
   const pages=input.pages.map(p=>({page:p.page,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[],inclusions:[],exclusions:['Synthetic exclusion'],responsibilities:[],regions:[]}));
   return json({stop_reason:'end_turn',usage:{input_tokens:500,output_tokens:100},content:[{type:'text',text:JSON.stringify({pages})}]});
  }
  throw new DOMException('Synthetic timeout','TimeoutError');
 };
 try{
  const report=await runFixture(fixture,{root,key:'synthetic-no-network',request,log:()=>{}});
  assert.equal(report.complete,false);assert.equal(report.error,'qa-paused-unknown-provider-charge');
  assert.equal(paid,2);assert.equal(report.cost.unknownChargeRequests,1);assert.equal(report.cost.paused,true);assert.equal(report.qaProviderSlots,1);
  const completed=report.pageEvidence.filter(p=>p.evidence);
  assert.equal(completed.length,1);assert.deepEqual(completed[0].evidence.exclusions,['Synthetic exclusion']);
  assert.ok(report.pageEvidence.length>=2&&report.pageEvidence.length<=4);
  await runFixture(fixture,{root,key:'synthetic-no-network',request,log:()=>{}});
  assert.equal(paid,2,'Saved failure must not spend again');
 }finally{await rm(root,{recursive:true,force:true});}
});
