import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {reviewForWebsite} from '../src/website-review.mjs';
import {makeServer} from '../src/server.mjs';
import {elapsedMs,publicJob,signedHeaders} from '../src/core.mjs';

const review=()=>({summary:'Synthetic scope',facts:[{field:'materials',value:'Painted trim'}],
 instructions:{inclusions:['Trim'],exclusions:['Electrical'],questions:['Remove existing trim?']},
 clarifications:[{field:'materials',question:'Who supplies the baseboard?',reason:'Supply responsibility affects material cost.'},{field:'trimLf',question:'How many linear feet?',reason:'Quantity needed.'},{field:'location',question:'Where is the project?',reason:'Location.'}],
 takeoffs:[],pages:[{source:'QA.pdf',page:1,status:'read'}]});

test('text follow-ups have independent identities; numeric and optional fields retain existing handling',()=>{
 const raw=review(),before=structuredClone(raw),projected=reviewForWebsite(raw);
 assert.deepEqual(raw,before,'saved evidence and review are not mutated');
 assert.deepEqual(projected.clarifications.map(q=>q.field),['trimLf','location']);
 assert.deepEqual(projected.instructions.questions,['Remove existing trim?','Who supplies the baseboard? Supply responsibility affects material cost.']);
 assert.deepEqual(projected.facts,before.facts);assert.deepEqual(projected.pages,before.pages);
 assert.deepEqual(projected.instructions.exclusions,before.instructions.exclusions);
 assert.deepEqual(reviewForWebsite(projected),projected,'repeat polling cannot duplicate questions');
 const duplicate=review();duplicate.instructions.questions.push('Who supplies the baseboard?');
 assert.equal(reviewForWebsite(duplicate).instructions.questions.filter(q=>q.startsWith('Who supplies')).length,1);
});

test('terminal elapsed time is frozen at completion/failure and running time continues',()=>{
 const created=Date.parse('2026-09-18T00:00:00Z'),updated=created+23000;
 for(const state of ['complete','failed']){
  const row={state,created_at:new Date(created),updated_at:new Date(updated)};
  assert.equal(elapsedMs(row,created+24*60*60*1000),23000);
  assert.equal(publicJob(row).elapsedMs,23000);assert.equal(publicJob(row).targetExceeded,false);
 }
 assert.equal(elapsedMs({state:'running',created_at:new Date(created),updated_at:new Date(updated)},created+70000),70000);
});

test('authenticated cached review GET and POST expose pending questions without provider calls or mutations',async()=>{
 const tenant='p5homeco.com',secret='synthetic-website-review-test-secret-123456789';
 const row={id:'saved-review',kind:'review',state:'complete',created_at:'2026-09-18T00:00:00Z',updated_at:'2026-09-18T00:00:23Z',result:review()};
 const before=structuredClone(row);let lookups=0,submissions=0;
 const store={modelEvidence:async()=>({verified:false,requestedModel:'gpt-4.1',responseModels:[],calls:0}),nonce:async()=>true,job:async(who,project,id)=>{assert.equal(who,tenant);assert.equal(project,'qa');assert.equal(id,row.id);lookups++;return row;}};
 const pipeline={submitReview:async(who,project)=>{assert.equal(who,tenant);assert.equal(project,'qa');submissions++;return row;}};
 const server=makeServer(store,pipeline,{tenants:{[tenant]:secret},maxBytes:1024});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,path='/v1/projects/qa/reviews';
 try{
  for(const method of ['GET','POST']){
   const endpoint=path+(method==='GET'?'/saved-review':''),body=method==='POST'?Buffer.from('{}'):Buffer.alloc(0);
   const response=await fetch(base+endpoint,{method,headers:signedHeaders(secret,method,endpoint,tenant,body),...(method==='POST'?{body}:{})});
   assert.equal(response.status,method==='GET'?200:202);
   const result=await response.json();assert.equal(result.elapsedMs,23000);
   assert.ok(result.result.instructions.questions.some(q=>q.startsWith('Who supplies the baseboard?')));
   assert.deepEqual(result.result.clarifications.map(q=>q.field),['trimLf','location']);
  }
  assert.equal((await fetch(base+path+'/saved-review')).status,401);
  assert.equal(lookups,1);assert.equal(submissions,1);assert.deepEqual(row,before);
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
});
