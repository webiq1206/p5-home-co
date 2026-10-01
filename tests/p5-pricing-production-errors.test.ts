import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {requestPricingWith,reconcileResearchReply,type PricingReply} from '../lib/p5/scopePricing.ts';
import {configurePricingLedger,pricingRecoveryError,PricingChargeUnknownError,reservePricingCharge,pricingFingerprint} from '../lib/p5/pricingLedger.ts';
import {retryablePricingProviderError} from '../lib/p5/pricingProgress.ts';
import {pricingFailureDetails} from '../lib/p5/pricingDiagnostics.ts';
import {ESTIMATOR_MODEL,ESTIMATOR_PROVIDER} from '../lib/p5/modelPolicy.ts';

test('production pricing error and checkpoint paths with isolated SQL and controlled transport',async t=>{
 const names=['DATABASE_URL','ANTHROPIC_API_KEY','P5_PRICING_LEDGER_TEST_MODE','P5_PRICING_BUDGET_USD','P5_PRICING_REQUEST_RESERVATION_USD'] as const;
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const priorFetch=globalThis.fetch,priorPool=globalThis.__p5Pool;
 const db=new PGlite();let sqlCalls=0;
 // Exercise actual reservation and persistence SQL. This single-request test
 // does not qualify concurrent admission; PGlite lacks advisory locks.
 globalThis.__p5Pool={query:async(statement:string,values:unknown[]=[])=>{sqlCalls++;return db.query(statement,values);}} as unknown as typeof globalThis.__p5Pool;
 configurePricingLedger(async run=>db.transaction(async tx=>run(async(statement,values=[])=>statement.includes('pg_advisory_xact_lock')?[]:(await tx.query(statement,values)).rows)));
 process.env.DATABASE_URL='isolated-test-only';process.env.ANTHROPIC_API_KEY='synthetic-test-only';
 delete process.env.P5_PRICING_LEDGER_TEST_MODE;delete process.env.P5_PRICING_BUDGET_USD;delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;
 const failure=async(name:string)=>{try{await requestPricingWith('anthropic',name,{},true,10000);assert.fail('Expected a controlled failure');}catch(error){assert.ok(error instanceof PricingChargeUnknownError);return error;}};
 try{
  await t.test('an uncapped 429 retains uncertainty, request ID and actual backoff classification',async()=>{
   let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'synthetic-private-provider-detail'}},{status:429,headers:{'request-id':'req_controlled_429'}});};
   const error=await failure('controlled-429');
   assert.equal(calls,1);assert.equal(retryablePricingProviderError(error),true);
   assert.deepEqual(pricingFailureDetails(error),[{code:'pricing-charge-unknown',status:null,requestId:null},{code:'provider-http-429',status:429,requestId:'req_controlled_429'}]);
   const rows=await db.query('SELECT state,last_error FROM p5_pricing_ledger WHERE fingerprint=$1',[pricingFingerprint('anthropic','controlled-429',{},true)]);
   assert.equal(rows.rows[0].state,'unknown');assert.match(String(rows.rows[0].last_error),/429/);
   assert.ok(!JSON.stringify(pricingFailureDetails(error)).includes('synthetic-private'));
   process.env.P5_PRICING_BUDGET_USD='1';process.env.P5_PRICING_REQUEST_RESERVATION_USD='0.01';
   assert.equal(pricingRecoveryError(error),error);assert.equal(retryablePricingProviderError(error),false);
   await assert.rejects(()=>reservePricingCharge(pricingFingerprint('anthropic','controlled-429',{},true),'anthropic'),PricingChargeUnknownError);
   assert.equal(calls,1,'a capped unknown charge cannot dispatch another request');
   delete process.env.P5_PRICING_BUDGET_USD;delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;
  });
  await t.test('memory transport tests preserve the same wrapper and cause as production',async()=>{
   process.env.P5_PRICING_LEDGER_TEST_MODE='memory';const before=sqlCalls;
   const error=await failure('memory-429');
   assert.equal(retryablePricingProviderError(error),true);assert.equal(pricingFailureDetails(error)[1].status,429);
   assert.equal(sqlCalls,before);delete process.env.P5_PRICING_LEDGER_TEST_MODE;
  });
  await t.test('completed research is checkpointed before a failing formatter and remains reusable',async()=>{
   let calls=0;let checkpoint:PricingReply|undefined;
   const model=ESTIMATOR_PROVIDER==='anthropic'?ESTIMATOR_MODEL:'claude-sonnet-5';
   globalThis.fetch=async()=>{calls++;return Response.json({id:'msg_saved_research',model,stop_reason:'end_turn',content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://example.com/cabinet-screws'}]},{type:'text',text:'Completed research report about cabinet mounting screws.'}]});};
   const result=await requestPricingWith('anthropic','research-checkpoint',{},true,10000,{},undefined,undefined,async reply=>{checkpoint=structuredClone(reply);});
   assert.equal(calls,1);assert.equal(result.value,null);assert.equal(checkpoint?.sourceReport,result.sourceReport);
   const rows=await db.query('SELECT state,provider_id FROM p5_pricing_ledger WHERE fingerprint=$1',[pricingFingerprint('anthropic','research-checkpoint',{},true)]);
   assert.deepEqual(rows.rows,[{state:'settled',provider_id:'msg_saved_research'}]);
   let formats=0;
   await assert.rejects(()=>reconcileResearchReply(result,[],async(_instructions,input,search)=>{formats++;assert.equal(search,false);assert.equal((input as {report:string}).report,result.sourceReport);throw new Error('controlled-format-failure');},()=>10000),/controlled-format-failure/);
   assert.equal(formats,1);assert.equal(calls,1);assert.equal(checkpoint?.sourceReport,'Completed research report about cabinet mounting screws.');
  });
  await t.test('reservation uncertainty without a provider cause cannot be classified as retryable',()=>{
   const error=new PricingChargeUnknownError();assert.equal(pricingRecoveryError(error),error);assert.equal(retryablePricingProviderError(error),false);
   const cyclic=new Error('private response');cyclic.cause=cyclic;
   assert.deepEqual(pricingFailureDetails(cyclic),[{code:'request-failed',status:null,requestId:null}]);
  });
 }finally{
  globalThis.fetch=priorFetch;globalThis.__p5Pool=priorPool;configurePricingLedger();
  for(const name of names){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}
  await db.close();
 }
});
