import test from 'node:test';import assert from 'node:assert/strict';
import {completeSubmission} from '../lib/p5/submitProgress.ts';
import {PricingPending} from '../lib/p5/pricingProgress.ts';
import {priceCompleteScope} from '../lib/p5/scopePricing.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
test('Browser continues pending pricing and only accepts a final result',async()=>{
 let calls=0;const messages:string[]=[];const result=await completeSubmission(async()=>++calls<3?Response.json({pending:true,message:'Saved stage',retryAfterMs:1},{status:202}):Response.json({result:{range:{low:100,high:150}}}),m=>messages.push(m),async()=>{});
 assert.equal(calls,3);assert.equal(messages.length,2);assert.equal(result.result.range.low,100);
 await assert.rejects(()=>completeSubmission(async()=>Response.json({error:'Saved; retry later'},{status:503}),()=>{},async()=>{}),/retry later/);
});
test('HTML deployment replies and network interruptions recover without exposing parser errors',async()=>{
 let calls=0;const messages:string[]=[];const delays:number[]=[];
 const result=await completeSubmission(async()=>{
  calls++;
  if(calls===1)throw new TypeError('Failed to fetch');
  if(calls===2)return new Response('<html><head>Bad gateway</head></html>',{status:502});
  if(calls===3)return new Response('<html>Starting up</html>',{status:200});
  return Response.json({result:{range:{low:100,high:150}}});
 },message=>messages.push(message),async ms=>{delays.push(ms);});
 assert.equal(calls,4);assert.equal(result.result.range.low,100);
 assert.deepEqual(delays,[1000,2000,4000]);
 assert.ok(messages.every(message=>message.includes('project is saved')&&!/json|html|SyntaxError|Failed to fetch/.test(message)));
});
test('HTML access denials do not trigger a retry loop',async()=>{
 let calls=0;
 await assert.rejects(()=>completeSubmission(async()=>{calls++;return new Response('<html>Forbidden</html>',{status:403});},()=>{},async()=>{}),/could not be accessed/);
 assert.equal(calls,1);
});
test('research rate limits use backoff and empty searches have a bounded cooldown',async()=>{
 const {retryablePricingProviderError,expiredResearchFailure,RESEARCH_FAILURE_COOLDOWN_MS,isPricingPending}=await import('../lib/p5/pricingProgress.ts');
 assert.ok(retryablePricingProviderError(new Error('pricing-provider-unavailable:429:RATELIMIT_EXCEEDED')));
 assert.ok(retryablePricingProviderError(new Error('pricing-provider-unavailable:503:unavailable')));
 assert.equal(retryablePricingProviderError(new Error('pricing-search-unavailable')),false);
 const saved={researchFailedAt:1000,timeouts:1};
 assert.equal(expiredResearchFailure(saved,1000+RESEARCH_FAILURE_COOLDOWN_MS-1),false);
 assert.equal(expiredResearchFailure(saved,1000+RESEARCH_FAILURE_COOLDOWN_MS),true);
 assert.equal(expiredResearchFailure({value:{rates:[]}},Number.MAX_SAFE_INTEGER),false);
 assert.ok(isPricingPending(new PricingPending('Provider reservation pending',30000)));
});
test('Expected continuation never becomes an unpriced customer result',async()=>{
 const scope={text:'Synthetic',answers:{service:'handyman'},extraction:null,uploads:[],reviewedAt:'2026-09-11',corrections:[]};
 await assert.rejects(()=>priceCompleteScope(scope,EMPTY_CONFIGURATION,async()=>{throw new PricingPending();}),PricingPending);
});
