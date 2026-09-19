import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {guardedPricingMapping} from '../scripts/guarded-pricing-mapping.mjs';

const env={P5_RUN_LIVE_PRICING:'true',P5_PRICING_QA_BUDGET_USD:'1',P5_LIVE_PRICING_SCENARIO:'mapping',P5_PRICING_PROVIDER:'anthropic',ANTHROPIC_API_KEY:'test-only-no-network'};
const url='https://api.anthropic.com/v1/messages',options={body:JSON.stringify({model:'claude-sonnet-5',max_tokens:1000,messages:[]})};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('pricing guard requires a separate explicit allowance and approved model/case before any work',async()=>{
 for(const patch of [{P5_PRICING_QA_BUDGET_USD:undefined},{P5_PRICING_QA_BUDGET_USD:'2'},{P5_PRICING_PROVIDER:'openai'},{P5_LIVE_PRICING_SCENARIO:'missing'},{P5_PRICING_MODEL:'claude-opus-5'},{P5_RUN_LIVE_PRICING:'false'}]){
  await assert.rejects(guardedPricingMapping({directory:'/path-must-not-be-opened',env:{...env,...patch},work:()=>assert.fail('Must not run')}));
 }
});

test('one pricing attempt records actual usage, persists a marker and cannot rerun after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p5-pricing-guard-'));let paid=0;
 try{
  const args={directory,env,request:async u=>u.endsWith('count_tokens')?json({input_tokens:100}):(paid++,json({usage:{input_tokens:100,output_tokens:200},content:[]})),work:async request=>{await request(url,options);return {approvedConfigurationUnchanged:true,businessWrites:0};}};
  const report=await guardedPricingMapping(args);assert.equal(report.complete,true);assert.equal(report.cost.requests,1);assert.equal(report.productionRouteQualified,false);assert.equal(report.researchQualified,false);
  assert.equal(paid,1);assert.ok(report.cost.estimatedUsd>0);
  await assert.rejects(guardedPricingMapping(args),/already attempted/);assert.equal(paid,1);
  assert.equal(JSON.parse(await readFile(join(directory,'report.json'),'utf8')).complete,true);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('unknown pricing charge stops the current sequence and preserves its reservation across restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p5-pricing-guard-'));let paid=0;
 try{
  const args={directory,env,request:async u=>{if(u.endsWith('count_tokens'))return json({input_tokens:100});paid++;throw new TypeError('Interrupted provider');},work:async request=>{try{await request(url,options);}catch{}return request(url,options);}};
  const report=await guardedPricingMapping(args);assert.equal(report.complete,false);assert.equal(report.error,'qa-paused-unknown-provider-charge');assert.equal(report.cost.paused,true);assert.ok(report.cost.estimatedUsd>0);assert.equal(paid,1);
  await assert.rejects(guardedPricingMapping(args),/already attempted/);assert.equal(paid,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const kind of ['other-provider','research','cost-cap'])test('pricing guard refuses '+kind+' before generation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p5-pricing-guard-'));let paid=0;
 try{
  const report=await guardedPricingMapping({directory,env:{...env,...(kind==='cost-cap'?{P5_PRICING_QA_BUDGET_USD:'.001'}:{})},request:async u=>{if(u.endsWith('count_tokens'))return json({input_tokens:100});paid++;assert.fail('No generation');},work:request=>request(kind==='other-provider'?'https://example.test/responses':url,kind==='research'?{body:JSON.stringify({...JSON.parse(options.body),tools:[{type:'web_search_20250305'}]})}:options)});
  assert.equal(report.complete,false);assert.equal(paid,0);assert.equal(report.cost.requests,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const kind of ['swallowed-unknown-charge','no-provider-call'])test('pricing guard cannot report success with '+kind,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p5-pricing-guard-'));
 try{
  const report=await guardedPricingMapping({directory,env,request:async u=>{if(u.endsWith('count_tokens'))return json({input_tokens:100});throw new TypeError('Interrupted provider');},work:async request=>{if(kind==='swallowed-unknown-charge')try{await request(url,options);}catch{}return {complete:true};}});
  assert.equal(report.complete,false);assert.equal(report.error,kind==='swallowed-unknown-charge'?'qa-paused-unknown-provider-charge':'pricing-qa-no-live-provider-evidence');
 }finally{await rm(directory,{recursive:true,force:true});}
});
