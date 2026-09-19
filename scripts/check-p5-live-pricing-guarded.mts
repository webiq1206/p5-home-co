import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {guardedPricingMapping} from '../services/document-service/scripts/guarded-pricing-mapping.mjs';

// No defaults grant spending permission or change the selected provider. The
// owner must authorize this separate pricing allowance before runtime execution.
const originalFetch=globalThis.fetch;
async function main(){
 const fingerprint=createHash('sha256');
 for(const file of ['lib/p5/scopePricing.ts','lib/p5/costBook.ts','lib/p5/pricing.ts','lib/p5/brand.ts','scripts/check-p5-live-pricing.mts','scripts/check-p5-live-pricing-guarded.mts','services/document-service/scripts/guarded-pricing-mapping.mjs','services/document-service/scripts/pricing-mapping-checks.mjs','services/document-service/scripts/model-qa-support.mjs'])fingerprint.update(await readFile(new URL('../'+file,import.meta.url)));
 const report=await guardedPricingMapping({directory:resolve('p5-verification','guarded-pricing-mapping-v1'),sourceFingerprint:fingerprint.digest('hex'),request:originalFetch,
  work:async(request:typeof fetch)=>{
   globalThis.fetch=request;
   try{const {runLivePricing}=await import('./check-p5-live-pricing.mts');return await runLivePricing();}
   finally{globalThis.fetch=originalFetch;}
  }});
 console.log(JSON.stringify({complete:report.complete,error:report.error,model:report.model,scenario:report.scenario,elapsedMs:report.elapsedMs,cost:report.cost,productionRouteQualified:false,researchQualified:false}));
 if(!report.complete)process.exitCode=1;
}
main().then(()=>process.exit(Number(process.exitCode||0))).catch(error=>{console.error(error instanceof Error?error.message:'Guarded pricing QA failed');process.exit(1);});
