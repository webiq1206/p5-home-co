import test from 'node:test';
import assert from 'node:assert/strict';
import {ESTIMATOR_MODEL,ESTIMATOR_PROVIDER,assertEstimatorModel,hasVerifiedAnalysis,MODEL_POLICY_VERSION} from '../../lib/p5/modelPolicy.ts';
import {analyzeBatch} from '../../lib/p5/extraction.ts';
import {requestPricing,openAiPricingRequestEnvelope} from '../../lib/p5/scopePricing.ts';
import {createEstimatorModelClient} from '../../lib/p5/estimatorModelClient.ts';
import {shortlistBook} from '../../lib/p5/bookShortlist.ts';
import {remoteDocumentId} from '../../lib/p5/documentServiceClient.ts';
import {readConfig,documentId} from '../../services/document-service/src/core.mjs';
import {requestBody,Reader} from '../../services/document-service/src/provider.mjs';
const model='claude-haiku-4-5-20251001';
const record={summary:'Replace three owner-supplied passage levers.',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:[],takeoffs:[]};
process.env.ANTHROPIC_API_KEY='synthetic-anthropic';
process.env.OPENAI_API_KEY='must-not-be-used';
process.env.P5_PRICING_LEDGER_TEST_MODE='memory';
const reply=(input:unknown,name='record_estimate',returned=model)=>Response.json({id:'msg_synthetic',model:returned,stop_reason:'tool_use',content:[{type:'tool_use',id:'tool_synthetic',name,input}],usage:{input_tokens:10,output_tokens:20}});
test('Haiku policy rejects stale OpenAI evidence and wrong returned model',()=>{
 assert.equal(ESTIMATOR_PROVIDER,'anthropic');assert.equal(ESTIMATOR_MODEL,model);
 assert.throws(()=>assertEstimatorModel('gpt-4.1'),/mismatch/);assert.throws(()=>assertEstimatorModel(undefined),/unverified/);
 assert.equal(hasVerifiedAnalysis({model:'gpt-4.1',modelPolicy:'gpt-4.1-required-form-evidence-2026-09-30'}),false);
 assert.equal(hasVerifiedAnalysis({model,modelPolicy:MODEL_POLICY_VERSION}),true);
 assert.equal(openAiPricingRequestEnvelope('audit',{},false).model,'gpt-4.1');
});
test('document extraction sends native Haiku request and attests actual response',async()=>{
 let calls=0;
 const result=await analyzeBatch('Replace three levers',[],{},async(url,init)=>{
  calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');
  const body=JSON.parse(String(init?.body));assert.equal(body.model,model);assert.equal(body.tool_choice.name,'record_scope_analysis');assert.equal(body.tools[0].strict,undefined,'avoid provider grammar rejection on full extraction schema');assert.equal(body.tools[0].input_schema.properties.instructions.type,'object');assert.equal(body.tools[0].input_schema.properties.takeoffs.type,'array');assert.equal(body.tools[0].input_schema.properties.facts.items.properties.value.minLength,1);
  return reply(record,'record_scope_analysis');
 });assert.equal(calls,1);assert.equal(result.model,model);assert.equal(result.modelPolicy,MODEL_POLICY_VERSION);
 await assert.rejects(analyzeBatch('Replace levers',[],{},async()=>reply(record,'record_scope_analysis','claude-sonnet-4-6')),/model-mismatch/);
});
test('pricing returns native tool record with verified identity and saved checkpoint',async()=>{
 const before=globalThis.fetch;let calls=0,saved=false;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(String(init?.body));assert.equal(body.model,model);assert.equal(body.tool_choice.name,'record_estimate');assert.equal(body.tools[0].strict,true,'native pricing opts into provider-enforced schema conformance');return reply({tasks:[]});};
 try{const result=await requestPricing('audit',{},false,10000,undefined,undefined,async r=>{saved=r.responseModel===model;});assert.equal(result.responseModel,model);assert.equal(result.provider,'anthropic');assert.equal(calls,1);assert.equal(saved,true);assert.deepEqual(result.value,{tasks:[]});}finally{globalThis.fetch=before;}
});
test('Haiku pricing never silently falls back to OpenAI',async()=>{
 const before=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return reply({},'record_estimate','claude-sonnet-4-6');};
 try{await assert.rejects(requestPricing('different audit',{},false,10000),/model-mismatch/);assert.equal(calls,1);}finally{globalThis.fetch=before;}
});
test('pricing research requires initial search but allows a paused search to finish',async()=>{
 const before=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));calls++;
  if(calls===1){assert.deepEqual(body.tool_choice,{type:'tool',name:'web_search'});return Response.json({id:'search_one',model,stop_reason:'pause_turn',content:[{type:'web_search_tool_result',tool_use_id:'search',content:[{type:'web_search_result',url:'https://example.com/qa-price',title:'Synthetic price source'}]}],usage:{input_tokens:1,output_tokens:1}});}
  assert.equal(body.tool_choice,undefined);assert.equal(body.messages.length,2);
  return Response.json({id:'search_two',model,stop_reason:'end_turn',content:[{type:'text',text:'{"rates":[]}'}],usage:{input_tokens:1,output_tokens:1}});
 };
 try{const result=await requestPricing('Synthetic research continuation',{},true,10000);assert.equal(calls,2);assert.deepEqual(result.sourceUrls,['https://example.com/qa-price']);}finally{globalThis.fetch=before;}
});
test('retained tool loop preserves tool results on Anthropic transport',async()=>{
 const result=await createEstimatorModelClient({request:async(url,init)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(String(init?.body));assert.equal(body.model,model);assert.equal(body.messages[0].content[0].type,'tool_result');return reply({ok:true},'finish');}}).messages.create({messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'prior',content:'done'}]}]});assert.equal(result.stop_reason,'tool_use');
});
test('book shortlist uses Haiku and preserves only known codes',async()=>{
 const result=await shortlistBook([{id:'one',description:'Door lever'}],[{code:'valid',description:'Lever',unit:'EA'}],async(url,init)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(JSON.parse(String(init?.body)).model,model);return reply({tasks:[{id:'one',codes:['valid','invented']}]},'record_shortlist');});assert.deepEqual(result.get('one'),['valid']);
});
test('document worker defaults to Haiku and verifies returned model before accepting evidence',async()=>{
 const config=readConfig({ANTHROPIC_API_KEY:'synthetic',DOCUMENT_DATABASE_URL:'isolated',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':'a'.repeat(64)})});assert.equal(config.provider,'anthropic');assert.equal(config.model,model);assert.equal(config.verifyModel,model);
 const body=requestBody('anthropic',model,'Read source',{},[],{type:'object',properties:{},required:[],additionalProperties:false},1000);assert.equal(body.body.tool_choice.type,'tool');assert.equal(body.body.model,model);
 const reader=new Reader(config,{reserve:async()=> 'slot',release:async()=>{},metric:async()=>{}},async()=>reply({},'submit_document_review','gpt-4.1'));
 await assert.rejects(reader.call({kind:'read',attempts:1},'Read',{},[],{type:'object',properties:{}},new AbortController().signal),/model-unverified/);
});

test('Haiku website and worker use identical model-specific document cache IDs',()=>{assert.equal(remoteDocumentId('p5homeco.com','qa','a'.repeat(64)),documentId('p5homeco.com','qa','a'.repeat(64)));});
