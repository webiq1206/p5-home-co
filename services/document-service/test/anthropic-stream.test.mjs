import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectAnthropicResponse,responseDeadline} from '../src/anthropic-stream.mjs';
import {Reader} from '../src/provider.mjs';
import {providerCallLimit,ServiceError} from '../src/core.mjs';
import {guardedSonnetFetch,privateJson,reservationFingerprint} from '../scripts/model-qa-support.mjs';

const start={type:'message_start',message:{type:'message',id:'msg-test',content:[],usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:50}}};
const finish=[{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:7}},{type:'message_stop'}];
const textEvents=[start,{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'{"ok":true}'}},...finish];
const encode=events=>events.map(e=>'event: '+e.type+'\r\ndata: '+JSON.stringify(e)+'\r\n\r\n').join('');
function stream(events,{delay=0,bytes=false}={}){
 const chunks=bytes?[...new TextEncoder().encode(encode(events))].map(n=>Uint8Array.of(n)):events.map(e=>new TextEncoder().encode(encode([e])));
 let index=0,timer,cancelled=false;
 return new Response(new ReadableStream({pull(controller){return new Promise(resolve=>{const send=()=>{if(!cancelled){if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close();}resolve();};if(delay)timer=setTimeout(send,delay);else send();});},cancel(){cancelled=true;clearTimeout(timer);}}),{headers:{'content-type':'text/event-stream','request-id':'req-test'}});
}

test('SSE reconstructs unicode across byte/CRLF boundaries and cumulative usage',async()=>{
 const events=structuredClone(textEvents);events[2].delta.text='{"label":"café 🌲"}';
 events.splice(events.length-1,0,{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:9}});
 const data=JSON.parse(await collectAnthropicResponse(stream(events,{bytes:true})));
 assert.equal(data.content[0].text,'{"label":"café 🌲"}');assert.equal(data.usage.input_tokens,100);assert.equal(data.usage.output_tokens,9);assert.equal(data.usage.cache_read_input_tokens,50);
});
test('forced tool input is assembled only after every JSON fragment arrives',async()=>{
 const events=[start,{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool-1',name:'submit_document_review',input:{}}},
  {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"pages":'}},
  {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'[1,2]}' }},
  finish[0],{...finish[1],delta:{stop_reason:'tool_use'}},finish[2]];
 assert.deepEqual(JSON.parse(await collectAnthropicResponse(stream(events))).content[0].input,{pages:[1,2]});
});
test('truncated, out-of-order and provider error streams never become success',async()=>{
 for(const [events,code] of [[textEvents.slice(0,-1),'incomplete'],[textEvents.slice(1),'invalid-stream'],[[...textEvents.slice(0,2),{type:'error',error:{type:'overloaded_error'}}],'overloaded']])
  await assert.rejects(collectAnthropicResponse(stream(events)),new RegExp(code));
});
test('idle, total and parent deadlines cancel the body and remain distinguishable',async()=>{
 for(const reason of ['idle','total','parent']){
  const parent=new AbortController(),deadline=responseDeadline(parent.signal,reason==='idle'?30:1000,reason==='total'?60:1000);
  let cancelled=false,interval;
  const body=new ReadableStream({start(c){if(reason==='total')interval=setInterval(()=>c.enqueue(new TextEncoder().encode(encode([{type:'ping'}]))),5);},cancel(){cancelled=true;clearInterval(interval);}});
  const task=collectAnthropicResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),{signal:deadline.signal,onProgress:deadline.touch});
  if(reason==='parent')parent.abort(new ServiceError('test-parent-abort',422));
  try{await assert.rejects(task,new RegExp(reason==='parent'?'test-parent-abort':'provider-'+reason+'-timeout'));assert.equal(cancelled,true);}finally{deadline.close();clearInterval(interval);}
 }
});
test('Reader and QA guard complete one active response beyond the idle timeout with final usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-stream-long-'));let calls=0,counts=0,released=0;
 const config={provider:'anthropic',model:'claude-sonnet-5',verifyModel:'claude-sonnet-5',key:'private',callMs:1000,streamMs:5000,maxOutput:1024,tpm:600000};
 const metrics=[];
 try{
  const guard=await guardedSonnetFetch({file:join(root,'cost.json'),limitUsd:1,maxCalls:2,request:async(url,options)=>{
   if(url.endsWith('count_tokens')){counts++;return new Response('{"input_tokens":100}');}
   calls++;assert.equal(JSON.parse(options.body).stream,true);return stream(textEvents,{delay:250});
  }});
  const reader=new Reader(config,{reserve:async()=>1,release:async()=>released++,metric:async(...args)=>metrics.push(args)},guard.request);
  const began=performance.now(),result=await reader.call({kind:'read'},'',{},[],{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},new AbortController().signal);
  assert.deepEqual(result,{ok:true});assert.ok(performance.now()-began>config.callMs);assert.equal(calls,1);assert.equal(counts,1);assert.equal(released,1);
  assert.equal(guard.summary().unknownChargeRequests,0);assert.equal(guard.summary().usage[0].output_tokens,7);
  assert.equal(metrics[0][3].stream.complete,true);assert.equal(metrics[0][3].stream.requestId,'req-test');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('partial usage retains its full reservation, progress and cause and pauses after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-stream-partial-'));let calls=0;
 try{
  const settings={file:join(root,'cost.json'),limitUsd:1,maxCalls:5,request:async url=>{calls++;return url.endsWith('count_tokens')?new Response('{"input_tokens":100}'):stream(textEvents.slice(0,-1));}};
  let guard=await guardedSonnetFetch(settings);
  const options={body:JSON.stringify({model:'claude-sonnet-5',max_tokens:1024,stream:true,messages:[]})};
  await assert.rejects(guard.request('https://api.anthropic.com/v1/messages',options),/qa-paused/);
  const ledger=JSON.parse(await readFile(settings.file,'utf8')),record=ledger.calls[0];
  assert.equal(record.status,'charge-unknown');assert.equal(record.usage,undefined);assert.equal(record.progress.observedUsage.output_tokens,7);assert.equal(record.progress.complete,false);assert.equal(record.failure.code,'provider-stream-incomplete');assert.ok(record.reservedUsd>.01);
  guard=await guardedSonnetFetch(settings);await assert.rejects(guard.request('https://api.anthropic.com/v1/messages',options),/qa-paused/);assert.equal(calls,2);
  // Explicitly acknowledge only this unchanged historical reservation.
  record.acknowledgement={action:'resume-reserved',fingerprint:reservationFingerprint(record)};ledger.paused=false;await privateJson(settings.file,ledger);
  guard=await guardedSonnetFetch(settings);assert.equal(guard.summary().paused,false);assert.equal(guard.summary().estimatedUsd,record.reservedUsd);
  await assert.rejects(guard.request('https://api.anthropic.com/v1/messages',options),/qa-paused/);assert.equal(calls,4);
  assert.equal(guard.summary().paused,true);assert.equal(guard.summary().unknownChargeRequests,2);
  guard=await guardedSonnetFetch(settings);assert.equal(guard.summary().paused,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('provider lease horizon covers streaming while other providers keep their original deadline',()=>{
 assert.equal(providerCallLimit({provider:'anthropic',callMs:40000}),120000);
 assert.equal(providerCallLimit({provider:'openai',callMs:40000}),40000);
});
