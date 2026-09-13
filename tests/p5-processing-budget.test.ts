import test from 'node:test';
import assert from 'node:assert/strict';
import {PROCESSING_LIMIT_MS,CLIENT_BUDGET_MS,SERVER_BUDGET_MS,ProcessingDeadlineError,remainingBudget,withinDeadline,fetchWithinDeadline} from '../lib/p5/processingBudget.ts';
import {completeSubmission} from '../lib/p5/submitProgress.ts';
import {analysisSegments} from '../lib/p5/analysisWork.ts';
import {analyzeBatch} from '../lib/p5/extraction.ts';
import {PDFDocument} from 'pdf-lib';

test('processing reserves time for the server result and browser recovery',()=>{
 assert.ok(SERVER_BUDGET_MS<CLIENT_BUDGET_MS&&CLIENT_BUDGET_MS<PROCESSING_LIMIT_MS);
 assert.equal(remainingBudget(1000,500),500);
 assert.throws(()=>remainingBudget(1000,1000),ProcessingDeadlineError);
 assert.throws(()=>remainingBudget(NaN),ProcessingDeadlineError);
});
test('a provider that never resolves cannot hold an interaction open',async()=>{
 const started=Date.now();
 await assert.rejects(withinDeadline(()=>new Promise(()=>{}),Date.now()+25),ProcessingDeadlineError);
 assert.ok(Date.now()-started<500);
});
test('response headers do not end the deadline before the body arrives',async()=>{
 let aborted=false;
 const request:typeof fetch=async(_input,init)=>{
  init?.signal?.addEventListener('abort',()=>{aborted=true;});
  return new Response(new ReadableStream({start(){}}));
 };
 await assert.rejects(fetchWithinDeadline(request,'https://fixture.invalid',{},Date.now()+25),ProcessingDeadlineError);
 assert.equal(aborted,true);
});
test('pending pricing responses share one deadline and never become a partial total',async()=>{
 let calls=0;
 await assert.rejects(completeSubmission(async()=>{calls++;return Response.json({pending:true,message:'Checking scope'},{status:202});},()=>{},async()=>{await new Promise(r=>setTimeout(r,5));},Date.now()+35),ProcessingDeadlineError);
 assert.ok(calls>1&&calls<20);
});
test('ordinary PDF pages are grouped without dropping pages or breaking resume',async()=>{
 const document=await PDFDocument.create();for(let i=0;i<9;i++)document.addPage([612,792]);
 const file={name:'nine-pages.pdf',type:'application/pdf',data:Buffer.from(await document.save())};
 const groups=[];for await(const group of analysisSegments(file))groups.push(group);
 assert.equal(groups.length,3);
 assert.deepEqual(groups.flatMap(g=>g.pages?.map(p=>p.page)),[1,2,3,4,5,6,7,8,9]);
 for(const group of groups)assert.equal((await PDFDocument.load(group.data)).getPageCount(),group.pages?.length);
 const resumed=[];for await(const group of analysisSegments(file,4))resumed.push(group);
 assert.deepEqual(resumed.flatMap(g=>g.pages?.map(p=>p.page)),[5,6,7,8,9]);
});
test('an expired extraction cannot make a paid request',async()=>{
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';let calls=0;
 try{await assert.rejects(analyzeBatch('scope',[],{},async()=>{calls++;throw new Error('unexpected');},25,Date.now()-1));assert.equal(calls,0);}
 finally{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});
