import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {guardedSonnetFetch,privateJson} from './model-qa-support.mjs';

/** Proposed first live pricing qualification: one approved-rate mapping case,
 * fixed persistent ledger, direct Sonnet only, no research or provider fallback.
 * Requires a separate explicit pricing allowance; document budgets never fund it.
 * The caller must use synthetic scope and a read-only approved configuration.
 * @param {{directory:string,env?:Record<string,string|undefined>,request?:typeof fetch,work:(request:typeof fetch)=>Promise<unknown>,sourceFingerprint?:string|null}} options
 */
export async function guardedPricingMapping({directory,env=process.env,request=fetch,work,sourceFingerprint=null}){
 const budget=Number(env.P5_PRICING_QA_BUDGET_USD);
 if(env.P5_RUN_LIVE_PRICING!=='true'||!Number.isFinite(budget)||budget<=0||budget>1)throw Error('Pricing QA requires an explicit separate budget greater than zero and no more than $1.');
 if(env.P5_LIVE_PRICING_SCENARIO!=='mapping'||env.P5_PRICING_PROVIDER!=='anthropic'||(env.P5_PRICING_MODEL||'claude-sonnet-5')!=='claude-sonnet-5')throw Error('This reviewed pricing QA supports only the approved-rate mapping case through Anthropic Sonnet 5. It cannot qualify the current OpenAI route or research.');
 if(!env.ANTHROPIC_API_KEY)throw Error('The existing Anthropic runtime credential is required.');
 await mkdir(directory,{recursive:true,mode:0o700});const lock=join(directory,'running.lock');
 try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('Pricing QA is running or was interrupted. Inspect saved work.');throw e;}
 try{
  try{await readFile(join(directory,'attempt.json'));throw Error('Pricing QA was already attempted. Inspect its saved report; no paid work repeated.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const controller=new AbortController(),guard=await guardedSonnetFetch({file:join(directory,'cost.json'),limitUsd:budget,maxCalls:8,request,reuseResponses:true,onPause:e=>controller.abort(e)});
  if(guard.summary().requests)throw Error('An existing pricing ledger requires inspection before another attempt.');
  const report={test:'isolated-live-pricing-mapping',sourceFingerprint,model:'claude-sonnet-5',provider:'anthropic',scenario:'mapping',scope:'synthetic',productionRouteQualified:false,researchQualified:false,complete:false,startedAt:new Date().toISOString(),result:/** @type {unknown} */(null),error:/** @type {string|null} */(null),elapsedMs:0,cost:guard.summary()};
  await privateJson(join(directory,'attempt.json'),{...report,budgetUsd:budget});
  const started=performance.now();
  try{
   report.result=await work(async(url,options={})=>{
    if(String(url)!=='https://api.anthropic.com/v1/messages')throw Error('pricing-qa-unapproved-provider');
    const body=JSON.parse(options.body||'{}');
    if(body.tools?.length)throw Error('pricing-qa-research-not-authorized');
    return guard.request(String(url),{...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
   });
   if(guard.summary().paused)throw Error('qa-paused-unknown-provider-charge');
   if(!guard.summary().requests)throw Error('pricing-qa-no-live-provider-evidence');
   report.complete=true;
  }catch(e){report.error=typeof e.code==='string'?e.code:e instanceof Error?e.message:'pricing-qa-failed';}
  report.elapsedMs=Math.round(performance.now()-started);report.cost=guard.summary();
  report.notes=['Persistent reservations are estimates, not invoices or guaranteed billing caps. Unknown charges stop further calls.', 'No document test budget is used. Model settings must be explicit in this isolated test process; this helper does not change them.', 'This first case checks approved-rate mapping only. Unmatched work, research and published routing remain separate qualification gates.'];
  await privateJson(join(directory,'report.json'),report);return report;
 }finally{await rm(lock,{recursive:true});}
}
