import test from 'node:test';
import assert from 'node:assert/strict';
import {createEstimatorModelClient,estimatorRequestBody} from '../lib/p5/estimatorModelClient.ts';
test('retained assistant history preserves tool calls, results, images and PDFs with full GPT-4.1',()=>{
 const body=estimatorRequestBody({max_tokens:16000,system:'Brand instructions',tools:[{name:'price',input_schema:{type:'object'}}],tool_choice:{type:'tool',name:'price'},messages:[
  {role:'user',content:[{type:'text',text:'Price this only'},{type:'image',source:{type:'base64',media_type:'image/png',data:'photo'}},{type:'document',source:{type:'base64',media_type:'application/pdf',data:'pdf'}}]},
  {role:'assistant',content:[{type:'tool_use',id:'call1',name:'price',input:{quantity:25}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'call1',content:'{"total":100}'}]},
 ]});
 assert.equal(body.model,'gpt-4.1');assert.equal(body.store,false);assert.equal(body.max_output_tokens,16000);
 assert.deepEqual(body.tool_choice,{type:'function',name:'price'});
 assert.equal(body.input[0].content[1].detail,'high');assert.equal(body.input[0].content[2].file_data,'data:application/pdf;base64,pdf');
 assert.deepEqual(body.input.slice(1),[{type:'function_call',call_id:'call1',name:'price',arguments:'{"quantity":25}'},{type:'function_call_output',call_id:'call1',output:'{"total":100}'}]);
 assert.throws(()=>estimatorRequestBody({messages:[{role:'user',content:[{type:'unknown'}]}]}),/unsupported/);
});
test('retained entry points validate actual replies before a tool can execute',async()=>{
 const saved=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='synthetic';
 try{
  for(const model of ['gpt-4.1-2025-04-14','gpt-4.1-mini',undefined]){
   let calls=0;
   const client=createEstimatorModelClient({request:async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).model,'gpt-4.1');return Response.json({status:'completed',model,output:[{type:'function_call',call_id:'id',name:'price',arguments:'{"quantity":25}'}],usage:{input_tokens:10,output_tokens:20}});}});
   const call=()=>client.beta.messages.stream({messages:[{role:'user',content:'Synthetic fixture'}]}).finalMessage();
   if(model==='gpt-4.1-2025-04-14'){const result=await call();assert.equal(result.stop_reason,'tool_use');assert.deepEqual(result.content[0].input,{quantity:25});assert.equal(result.usage.output_tokens,20);}else await assert.rejects(call(),/estimator-model/);
   assert.equal(calls,1);
  }
 }finally{if(saved===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=saved;}
});
