
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReviewFactBasis} from '../src/review-basis.mjs';
import {Reader} from '../src/provider.mjs';
import {readConfig} from '../src/core.mjs';
const source=(basis='stated',value='3019')=>({source:'plans.pdf',pages:[{page:1,evidence:{facts:[{field:'sqft',value,evidence:'verified exact excerpt',basis}]}}]});
const fact=(extra={})=>({field:'sqft',value:'3019',confidence:.99,source:'plans.pdf, page 1',evidence:'model paraphrase',...extra});
test('only exact unanimous verified facts restore missing basis and canonical source citation',()=>{
 const raw={facts:[fact()],reviewNotes:[]},before=JSON.stringify(raw);
 const result=normalizeReviewFactBasis(raw,{documents:[source()]});
 assert.equal(result.facts[0].basis,'stated');assert.equal(result.facts[0].evidence,'verified exact excerpt');
 assert.equal(result.facts[0].source,'plans.pdf, page 1');assert.equal(JSON.stringify(raw),before);
});
test('unmatched, uncertain, conflicting and unrelated-document facts remain inferred at low confidence',()=>{
 for(const documents of [[],[source('uncertain')],[source('stated','3000')],[{...source(),pages:[...source().pages,...source('stated','3000').pages]}],[{...source(),source:'unrelated.pdf'},{...source(),source:'other.pdf'}]]){
  const result=normalizeReviewFactBasis({facts:[fact()],reviewNotes:[]},{documents});
  assert.equal(result.facts[0].basis,'inferred');assert.equal(result.facts[0].confidence,.2);
  assert.equal(result.facts[0].value,'3019');assert.match(result.reviewNotes[0],/cannot populate pricing answers automatically/);
 }
});
test('explicit basis, invalid values and other required fields are never rewritten to manufacture schema success',()=>{
 for(const basis of ['calculated',null,'unsupported']){
  const raw={facts:[fact({basis})],reviewNotes:[]};assert.deepEqual(normalizeReviewFactBasis(raw,{documents:[source()]}),raw);
 }
 const missing={facts:[{field:'sqft',confidence:2}],reviewNotes:[]};
 const result=normalizeReviewFactBasis(missing,{documents:[]});assert.ok(!Object.hasOwn(result.facts[0],'value'));
});
test('production review reserves its larger output budget while ordinary reading keeps its own ceiling',async()=>{
 const config=readConfig({DOCUMENT_PROVIDER:'anthropic',DOCUMENT_MODEL:'claude-sonnet-5',DOCUMENT_VERIFY_MODEL:'claude-sonnet-5',ANTHROPIC_API_KEY:'synthetic',DOCUMENT_DATABASE_URL:'postgres://synthetic',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':'a'.repeat(64)})});
 assert.equal(config.maxOutput,10000);assert.equal(config.reviewMaxOutput,32000);assert.equal(config.streamMs,360000);assert.equal(config.jobMs,900000);
 const reservations=[],bodies=[];
 const reader=new Reader(config,{reserve:async n=>{reservations.push(n);return 'slot';},release:async()=>{},metric:async()=>{}},async(_url,options)=>{
  const body=JSON.parse(options.body);bodies.push(body);
  return Response.json({stop_reason:body.tools?'tool_use':'end_turn',content:body.tools?[{type:'tool_use',id:'1',name:'submit_document_review',input:{ok:true}}]:[{type:'text',text:'{"ok":true}'}]});
 });
 for(const kind of ['read','review'])await reader.call({kind},'',{},[],{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},new AbortController().signal);
 assert.equal(bodies[0].max_tokens,10000);assert.equal(bodies[1].max_tokens,32000);assert.equal(reservations[1]-reservations[0],22000);
});
