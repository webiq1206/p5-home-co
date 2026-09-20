import {PricingQualification,pricingSourceIdentity,digest} from './lib/pricingQualification.ts';

// No provider, database, credentials, or delivery imports. A documented allowance
// must be supplied as a local JSON file. Rates input/output/cached/cacheWrite are
// micro-USD per million tokens; search is micro-USD per request. Total and document
// ceilings are micro-USD ($1 = 1,000,000). There is deliberately no sample grant.
const [command,file,id,actual,evidence]=process.argv.slice(2);
if(command==='identity'){
  console.log(JSON.stringify({sourceSha256:pricingSourceIdentity(),documentLimitsUSD:{short:1,plans:3},
    allowanceRequired:['version: 1','id','approvedBy','approvalEvidence','expiresAt','totalMicros','sourceSha256',
      'models: [{endpoint, model (exact response identity), rateEvidence, rates: {input, output, cached, cacheWrite, search}, maxInputTokens, maxOutputTokens, maxSearchCalls}]'],
    blocked:'Server-tool pricing calls require an enforceable input-token bound and authoritative tool billing; they are not admitted by the current harness.'},null,2));
}else if(command==='inspect'||command==='reconcile'){
  const {readAllowance}=await import('./lib/pricingQualification.ts');
  const allowance=readAllowance(file,true);
  const q=new PricingQualification(file,`p5-verification/pricing-qualification/${digest(allowance.id)}.sqlite`,allowance.sourceSha256,'review');
  try{
    if(command==='reconcile'){
      if(!id || !actual || !evidence)throw new Error('Usage: reconcile allowance.json request-sha256 actual-micro-USD "documented billing evidence"');
      q.reconcile(id,Number(actual),evidence);
    }
    console.log(JSON.stringify(q.report(),null,2));
  }finally{q.close();}
}else throw new Error('Usage: identity | inspect allowance.json | reconcile allowance.json request-sha256 actual-micro-USD "documented billing evidence"');