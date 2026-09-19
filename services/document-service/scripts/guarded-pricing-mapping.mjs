import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {guardedOpenAIFetch,guardedSonnetFetch,privateJson} from './model-qa-support.mjs';

/** Proposed first live pricing qualification: one approved-rate mapping case,
 * fixed persistent ledger, direct Sonnet only, no research or provider fallback.
 * Requires a separate explicit pricing allowance; document budgets never fund it.
 * The caller must use synthetic scope and a read-only approved configuration.
 * @param {{directory:string,env?:Record<string,string|undefined>,request?:typeof fetch,work:(request:typeof fetch)=>Promise<unknown>,sourceFingerprint?:string|null}} options
 */
export async function guardedPricingMapping({directory,env=process.env,request=fetch,work,sourceFingerprint=null}){
 const budget=Number(env.P5_PRICING_QA_BUDGET_USD);
 if(env.P5_RUN_LIVE_PRICING!=='true'||!Number.isFinite(budget)||budget<=0||budget>1)throw Error('Pricing QA requires an explicit separate budget greater than zero and no more than $1.');
 if(env.P5_LIVE_PRICING_SCENARIO!=='mapping'||!['anthropic','openai'].includes(env.P5_PRICING_PROVIDER))throw Error('This reviewed pricing QA supports only the approved-rate mapping case through an explicit configured provider. It cannot qualify research.');
 const provider=env.P5_PRICING_PROVIDER;
 const model=provider==='anthropic'?(env.P5_PRICING_MODEL||'claude-sonnet-5'):(env.P5_PRICING_OPENAI_MODEL||env.P5_SCOPE_OPENAI_MODEL||'gpt-4.1');
 if(provider==='anthropic'&&model!=='claude-sonnet-5')throw Error('The Anthropic qualification supports only Claude Sonnet 5.');
 if(provider==='openai'&&model!=='gpt-5.6-sol')throw Error('The OpenAI qualification supports only the configured GPT-5.6 Sol route.');
 if(provider==='anthropic'&&!env.ANTHROPIC_API_KEY||provider==='openai'&&!env.OPENAI_API_KEY)throw Error(`The existing ${provider} runtime credential is required.`);
 await mkdir(directory,{recursive:true,mode:0o700});const lock=join(directory,'running.lock');
 try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('Pricing QA is running or was interrupted. Inspect saved work.');throw e;}
 try{
   let zeroSpendRecovery=false;
   try{
    const previousAttempt=JSON.parse(await readFile(join(directory,'attempt.json'),'utf8'));
    if(env.P5_PRICING_QA_RESUME_ZERO_SPEND!=='true')throw Error('Pricing QA was already attempted. Inspect its saved report; no paid work repeated.');
    const previousReport=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
    if(previousReport.complete||previousReport.cost?.requests!==0||previousReport.cost?.paused||previousReport.cost?.unknownChargeRequests||!['ERR_MODULE_NOT_FOUND'].includes(previousReport.error))throw Error('Only an inspected zero-request local preflight failure can resume this pricing allowance.');
    await privateJson(join(directory,'zero-spend-recovery.json'),{version:1,action:'resume-zero-spend-local-preflight',createdAt:new Date().toISOString(),previousAttempt,previousReport});
    zeroSpendRecovery=true;
   }catch(e){if(e.code!=='ENOENT')throw e;}
   const controller=new AbortController(),guard=provider==='anthropic'
    ?await guardedSonnetFetch({file:join(directory,'cost.json'),limitUsd:budget,maxCalls:8,request,reuseResponses:true,onPause:e=>controller.abort(e)})
    :await guardedOpenAIFetch({file:join(directory,'cost.json'),limitUsd:budget,maxCalls:4,model,request,reuseResponses:true,onPause:e=>controller.abort(e)});
  if(guard.summary().requests)throw Error('An existing pricing ledger requires inspection before another attempt.');
   const report={test:'isolated-live-pricing-mapping',sourceFingerprint,model,provider,scenario:'mapping',scope:'synthetic',productionRouteQualified:false,researchQualified:false,complete:false,startedAt:new Date().toISOString(),billing:provider==='openai'?{source:'https://developers.openai.com/api/docs/pricing',verifiedOn:'2026-09-19',context:'short',inputUsdPerMillion:4,cachedInputUsdPerMillion:.4,outputUsdPerMillion:20,longContextThresholdTokens:272000}:{source:'https://platform.claude.com/docs/en/about-claude/pricing',verifiedOn:'2026-09-19',inputUsdPerMillion:2,outputUsdPerMillion:10},result:/** @type {unknown} */(null),error:/** @type {string|null} */(null),elapsedMs:0,cost:guard.summary()};
   await privateJson(join(directory,zeroSpendRecovery?'resumed-attempt.json':'attempt.json'),{...report,budgetUsd:budget,zeroSpendRecovery});
  const started=performance.now();
  try{
    report.result=await work(async(url,options={})=>{
     const allowed=provider==='anthropic'?'https://api.anthropic.com/v1/messages':'https://api.openai.com/v1/responses';
     if(String(url)!==allowed)throw Error('pricing-qa-unapproved-provider');
    const body=JSON.parse(options.body||'{}');
    if(body.tools?.length)throw Error('pricing-qa-research-not-authorized');
    return guard.request(String(url),{...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
   });
   if(guard.summary().paused)throw Error('qa-paused-unknown-provider-charge');
   if(!guard.summary().requests)throw Error('pricing-qa-no-live-provider-evidence');
    report.complete=true;report.productionRouteQualified=provider==='openai';
  }catch(e){report.error=typeof e.code==='string'?e.code:e instanceof Error?e.message:'pricing-qa-failed';}
  report.elapsedMs=Math.round(performance.now()-started);report.cost=guard.summary();
   report.notes=['Persistent reservations are estimates, not invoices or guaranteed billing caps. Unknown charges stop further calls.', 'No document test budget is used. Model settings are explicit in this isolated test process; this helper does not change ordinary production settings.', 'This case checks approved-rate inventory, mapping, audit and presentation capture only. Unmatched work and research remain separate qualification gates.'];
  await privateJson(join(directory,'report.json'),report);return report;
 }finally{await rm(lock,{recursive:true});}
}
