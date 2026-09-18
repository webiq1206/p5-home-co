import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {isolatedPool,guardedSonnetFetch,targetedChecks} from '../scripts/model-qa-support.mjs';
import {runFixture} from '../scripts/check-sonnet-documents.mjs';
import {hash} from '../src/core.mjs';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const options={body:JSON.stringify({model:'claude-sonnet-5',max_tokens:1000,messages:[]})};
const url='https://api.anthropic.com/v1/messages';

test('QA cost reservation persists unknown charges and stops before another paid request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-budget-'));let calls=0;
 const request=async u=>{if(u.endsWith('count_tokens'))return json({input_tokens:100});calls++;throw new TypeError('Simulated interrupted response');};
 try{
  const settings={file:join(root,'cost.json'),limitUsd:.025,maxCalls:10,request};
  const a=await guardedSonnetFetch(settings);await assert.rejects(a.request(url,options));assert.equal(calls,1);
  assert.ok(a.summary().estimatedUsd>.01);assert.equal(a.summary().unknownChargeRequests,1);
  const resumed=await guardedSonnetFetch(settings);
  await assert.rejects(resumed.request(url,options),e=>e.code==='qa-estimated-spend-limit-reached');assert.equal(calls,1);
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
 const root=await mkdtemp(join(tmpdir(),'p5-qa-flow-'));const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
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
  assert.equal(report.complete,true,report.error);assert.equal(report.pageEvidence.length,4);assert.equal(report.accuracyQualified,false);assert.equal(report.uploadMs,null);assert.equal(paid,2);
  const before=paid,cached=await runFixture(fixture,{root,key:'synthetic-test-key-no-network',request,log:()=>{}});
  assert.equal(cached.complete,true,cached.error);assert.equal(cached.runType,'resume-or-cache');assert.equal(paid,before);
  const saved=JSON.parse(await readFile(join(root,'short-'+fixture.sha256.slice(0,16),'report.json'),'utf8'));
  assert.equal(saved.stageWork.aiReadWorkMs>0,true);assert.equal(saved.cost.usage.length,2);
  assert.ok(!JSON.stringify(saved).includes('synthetic-test-key-no-network'));
 }finally{await rm(root,{recursive:true,force:true});}
});
