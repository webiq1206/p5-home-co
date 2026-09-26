import test from 'node:test';
import assert from 'node:assert/strict';
import {assertEstimatorModel,estimatorModelConfiguration} from '../lib/p5/modelPolicy.ts';
import {analyzeBatch} from '../lib/p5/extraction.ts';
import {requestPricing,openAiPricingRequestEnvelope} from '../lib/p5/scopePricing.ts';
import {shortlistBook} from '../lib/p5/bookShortlist.ts';
import {relevantCatalog} from '../lib/p5/catalogSelection.ts';
import {priceBookRates,PRICE_BOOK_RATEABLE} from '../lib/p5/priceBook.ts';

const variables=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_SCOPE_PROVIDER','P5_SCOPE_OPENAI_MODEL','P5_MAP_MODEL','P5_SHORTLIST_MODEL','P5_PRICING_PROVIDER','P5_PRICING_LEDGER_TEST_MODE'];
async function configured(run:()=>Promise<void>){
  const before=Object.fromEntries(variables.map(key=>[key,process.env[key]]));
  variables.forEach(key=>delete process.env[key]);
  process.env.OPENAI_API_KEY='synthetic-only';
  process.env.ANTHROPIC_API_KEY='must-not-be-used';
  process.env.P5_SCOPE_OPENAI_MODEL='gpt-4.1-mini';
  process.env.P5_SCOPE_PROVIDER='anthropic';
  process.env.P5_MAP_MODEL='gpt-4.1-nano';
  process.env.P5_SHORTLIST_MODEL='another-model';
  process.env.P5_PRICING_PROVIDER='anthropic';
  process.env.P5_PRICING_LEDGER_TEST_MODE='memory';
  try{await run();}finally{variables.forEach(key=>{if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];});}
}
test('only the required full model and documented snapshot are accepted',()=>{
  for(const model of ['gpt-4.1','gpt-4.1-2025-04-14'])assert.equal(assertEstimatorModel(model),model);
  for(const model of ['gpt-4.1-mini','gpt-4.1-nano','gpt-5','claude-sonnet-5','gpt-4.1-unverified'])assert.throws(()=>assertEstimatorModel(model),/model-mismatch/);
  for(const model of [undefined,null,''])assert.throws(()=>assertEstimatorModel(model),/model-unverified/);
});
test('legacy model settings are disclosed but cannot change estimation',()=>configured(async()=>{
  const policy=estimatorModelConfiguration();
  assert.equal(policy.model,'gpt-4.1');assert.equal(policy.fallback,false);
  assert.ok(policy.overriddenSettings.includes('P5_MAP_MODEL'));
  for(const search of [true,false]){
    const {model,body}=openAiPricingRequestEnvelope('Synthetic audit',{},search);
    assert.equal(model,'gpt-4.1');assert.equal(body.model,model);assert.equal('reasoning' in body,false);
  }
}));
test('reading rejects wrong or missing response identity without another provider call',()=>configured(async()=>{
  for(const returned of [undefined,'gpt-4.1-mini']){
    let calls=0;
    await assert.rejects(analyzeBatch('Install customer supplied trim.',[],{},async(url,init)=>{
      calls++;assert.ok(String(url).endsWith('/responses'));assert.equal(JSON.parse(String(init?.body)).model,'gpt-4.1');
      return Response.json({status:'completed',model:returned,output:[]});
    }),/estimator-model-/);
    assert.equal(calls,1);
  }
}));
test('pricing cannot use Anthropic when OpenAI is unavailable',()=>configured(async()=>{
  delete process.env.OPENAI_API_KEY;
  const before=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('must not dispatch');};
  try{await assert.rejects(requestPricing('Synthetic audit',{},false,2000),/pricing-provider-unavailable/);assert.equal(calls,0);}finally{globalThis.fetch=before;}
}));
test('semantic retrieval requests GPT-4.1 and refuses a substituted response',()=>configured(async()=>{
  await assert.rejects(shortlistBook([{id:'trim',description:'replace the baseboards'}],[{code:'PB-test',description:'Interior base molding',unit:'LF'}],async(_url,init)=>{
    assert.equal(JSON.parse(String(init?.body)).model,'gpt-4.1');
    return Response.json({model:'gpt-4.1-mini',output:[]});
  }),/model-mismatch/);
}));
test('semantic candidates are never dropped by the keyword candidate limit',()=>{
  const rates=Array.from({length:20},(_,i)=>({code:String(i),description:'Trim labor',unit:'LF',type:'Labor' as const}));
  const selected=relevantCatalog(rates,[{description:'Trim'}],2,new Set(['15','16','17']));
  assert.deepEqual(selected.map(r=>r.code),['15','16','17']);
});
test('every imported dollar-rate row is retrievable, including the final row and every service',()=>{
  const expected=new Set(PRICE_BOOK_RATEABLE.map(row=>`PB-${row[0]}`));
  for(const service of ['handyman','re10','cabinet-product','cabinet-install','kitchen','bathroom','whole-home','addition','adu','new-construction']){
    const rates=priceBookRates({service,finish:'mid-range'});
    assert.deepEqual(new Set(rates.map(rate=>rate.code)),expected);
    const final=rates.at(-1)!;assert.ok(relevantCatalog(rates,[],1,new Set([final.code])).some(selected=>selected.code===final.code));
    for(const rate of rates)assert.ok(Number.isFinite(rate.amount)&&rate.amount>=0,rate.code);
  }
});

test('remote reviews require persisted actual model evidence',async()=>{
 const {verifyDocumentModelEvidence}=await import('../lib/p5/documentServiceClient.ts');
 const proof={verified:true,requestedModel:'gpt-4.1',responseModels:['gpt-4.1-2025-04-14'],calls:4};
 assert.equal(verifyDocumentModelEvidence(proof),'gpt-4.1-2025-04-14');
 for(const value of [undefined,{...proof,verified:false},{...proof,calls:0},{...proof,responseModels:[]},{...proof,responseModels:['gpt-4.1-mini']}])assert.throws(()=>verifyDocumentModelEvidence(value));
});
test('legacy analysis identities cannot be replayed as verified results',async()=>{
 const {hasVerifiedAnalysis,MODEL_POLICY_VERSION}=await import('../lib/p5/modelPolicy.ts');
 assert.equal(hasVerifiedAnalysis({model:'gpt-4.1'}),false);
 assert.equal(hasVerifiedAnalysis({model:'gpt-4.1-mini',modelPolicy:MODEL_POLICY_VERSION}),false);
 assert.equal(hasVerifiedAnalysis({model:'gpt-4.1-2025-04-14 + gpt-4.1',modelPolicy:MODEL_POLICY_VERSION}),true);
});
