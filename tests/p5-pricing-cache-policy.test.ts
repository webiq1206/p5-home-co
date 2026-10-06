import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {priceDetailedScope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {QaPaidHold} from '../lib/p5/qaPaid.ts';
import {answerEntries,configurationIdentity,reusableResolution,type PricingCache,type PricingCacheEntry,type PricingCacheKeys} from '../lib/p5/pricingCache.ts';
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from '../lib/p5/costBook.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {ESTIMATOR_VERSION} from '../lib/p5/version.ts';
import {MODEL_POLICY_VERSION} from '../lib/p5/modelPolicy.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const now=new Date('2026-10-06T12:00:00Z'),stamp=now.toISOString();
const scope:ReviewedScope={text:'Retain the existing 24 SF countertop; temporarily remove and reinstall it. No new countertop.',answers:{service:'change-order',location:'Boise',countertopSqft:'24',exclusions:'New countertop'},extraction:null,uploads:[],reviewedAt:stamp,corrections:[]};
const configuration:EstimatorConfiguration={...EMPTY_CONFIGURATION,costBooks:[{service:'change-order',rules:[],coverage:[],assumptions:[],exclusions:[],verifiedScope:'Synthetic cache-migration fixture only',reviewedAt:stamp}]};

// Freeze the OLD cache-key contract, including both lookup paths. The test
// deliberately does not import current fingerprint functions or know their
// new namespaces: it checks actual reuse behavior through pricing instead.
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oldText=scope.text.toLowerCase();
const oldKeys:PricingCacheKeys={
 fingerprint:hash(['p5-price-v2',MODEL_POLICY_VERSION,ESTIMATOR_VERSION,ESTIMATOR_BRAND.id,oldText,answerEntries(scope),[],[],configurationIdentity(configuration)]),
 document:hash(['p5-price-doc-v2',ESTIMATOR_VERSION,ESTIMATOR_BRAND.id,scope.answers.service,oldText,[],[],configurationIdentity(configuration)]),
};
const legacy:PricingCacheEntry={
 answers:answerEntries(scope),
 resolution:{replaceBase:true,completeScopeVerified:true,assumptions:[],issues:[],rules:[{id:'old-counter',scopeTaskId:'counter',description:'Synthetic old permanent countertop removal proposal',unit:'LF',quantity:{fixed:24,factor:1},unitCost:12,category:'subcontractors',priceBasis:'direct-cost',estimatingBasis:'owner-average-cost',evidence:{basis:'owner-estimating-schedule',reference:'Synthetic legacy fixture: PB-02-41-07, 24 SF copied into LF',verifiedAt:stamp,validUntil:'2027-01-01T00:00:00Z'}}]},
 auditTrail:{tasks:[{id:'counter',description:'Temporarily remove and reinstall the retained countertop.',evidence:scope.text,existingLineIds:['old-counter'],additions:[],researchDescription:'',issues:[]}]},
};

for(const route of ['exact','document'] as const)test('a legacy completed '+route+' cache hit must re-enter current pricing',async()=>{
 assert.equal(reusableResolution(legacy.resolution),true,'this fixture must be an otherwise reusable completed price');
 // Model the actual store's exact-ID query followed by its same-project
 // document fallback. The document case has an unrelated exact ID, so a
 // change to only one cache namespace cannot accidentally pass both cases.
 const row={id:'price-cache:'+(route==='exact'?oldKeys.fingerprint:'another-old-conversation'),document:route==='document'?oldKeys.document:undefined,entry:structuredClone(legacy)};
 const original=structuredClone(row);
 const lookup=(keys:PricingCacheKeys)=>row.id==='price-cache:'+keys.fingerprint||row.document===keys.document?row.entry:null;
 assert.equal(lookup(oldKeys),row.entry,'the saved old key really finds this completed entry');
 const calls={loads:0,hits:0,saves:0,freshStages:0,network:0};
 const cache:PricingCache={async load(keys){calls.loads++;const hit=lookup(keys);if(hit)calls.hits++;return hit?structuredClone(hit):null;},async save(){calls.saves++;assert.fail('no replacement completed price is fabricated');}};
 const boundary=new QaPaidHold('synthetic-no-provider-boundary');
 const request:PricingRequest=async(_instructions,input,search)=>{
  calls.freshStages++;assert.equal(search,false);
  assert.ok(input&&typeof input==='object'&&'original' in input&&'priorTaskDescriptions' in input,'a cache miss must enter ordinary scope inventory');
  throw boundary;
 };
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async()=>{calls.network++;throw new Error('Cache migration test must not use the network');};
 try{
  await assert.rejects(priceDetailedScope(scope,configuration,request,now,Date.now()+30_000,cache),error=>error===boundary,'the old total must not return before the current pricing boundary');
 }finally{globalThis.fetch=previousFetch;}
 assert.deepEqual(calls,{loads:1,hits:0,saves:0,freshStages:1,network:0});
 assert.deepEqual(row,original,'migration changes lookup eligibility, never the saved historical entry');
});
