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
test('Expected continuation never becomes an unpriced customer result',async()=>{
 const scope={text:'Synthetic',answers:{service:'handyman'},extraction:null,uploads:[],reviewedAt:'2026-09-11',corrections:[]};
 await assert.rejects(()=>priceCompleteScope(scope,EMPTY_CONFIGURATION,async()=>{throw new PricingPending();}),PricingPending);
});
