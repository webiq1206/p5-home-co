import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {canonical,sha} from './lib/recoveryEpoch.mjs';
import {pricingSourceIdentity} from './lib/pricingQualification.ts';
import {capturePricingDelivery} from './lib/capturedPricingDelivery.ts';

// Offline only. This command has no provider transport, allowance provisioning,
// application DB, credentials, SMTP, or CRM activation path.
const [bundleFile,expectedBundleSha256,outputDirectory]=process.argv.slice(2);
async function main(){
 assert.ok(bundleFile&&/^[a-f0-9]{64}$/.test(expectedBundleSha256||'')&&outputDirectory,
  'Usage: node --import tsx scripts/check-p5-original-plan-replay.mts PRIVATE_BUNDLE_JSON VERIFIED_CANONICAL_SHA256 NEW_OUTPUT_DIRECTORY');
 assert.notEqual(process.env.P5_CRM_DELIVERY,'on','CRM must remain off');
 assert.notEqual(process.env.P5_OBJECT_STORAGE_ENABLED,'true','Remote object storage must remain off');
 const bundle=JSON.parse(await readFile(bundleFile,'utf8'));
 assert.equal(sha(canonical(bundle)),expectedBundleSha256,'Acceptance bundle identity changed');
 assert.equal(bundle.version,1);assert.equal(bundle.sourceSha256,pricingSourceIdentity(),'Exact source/runtime/dependencies must match');
 assert.ok(Array.isArray(bundle.documents)&&bundle.documents.length>0,'Original source documents required');
 const uploads=[];
 for(const document of bundle.documents){
  assert.equal(document.type,'application/pdf');
  const data=await readFile(path.resolve(path.dirname(bundleFile),document.path));
  assert.equal(sha(data),document.sha256,'Original document hash changed');
  uploads.push({name:document.name,type:document.type,data});
 }
 const output=path.resolve(outputDirectory);await mkdir(output); // refuse to overwrite prior evidence
 const manifest=await capturePricingDelivery(null,bundle.scope,output,globalThis.fetch,{
  uploads,expectedPages:bundle.expectedPages,modelEvidence:bundle.modelEvidence,
  pricingReplay:{configuration:bundle.configuration,configurationSha256:bundle.configurationSha256,
   transcript:bundle.pricingTranscript,transcriptSha256:bundle.pricingTranscriptSha256,resultSha256:bundle.pricingResultSha256,now:bundle.pricedAt}});
 console.log(JSON.stringify({passed:true,mode:'offline-exact-replay',providerNetworkCalls:0,externalSends:0,crmEnabled:false,
  sourceFiles:manifest.sourceHashes.length,replayedStages:manifest.replayedStages,persistedAfterReopen:manifest.persistedAfterReopen,
  customerPdfSha256:manifest.customerPdfSha256,administrativePdfSha256:manifest.administrativePdfSha256}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Original-plan replay failed');process.exitCode=1;});
