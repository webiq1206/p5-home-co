import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,sha,RecoveryEpochLedger} from './lib/recoveryEpoch.mjs';
import {recoveryTransport,HAIKU_POLICY,recoveryRequestPolicySha256} from './lib/recoveryTransport.mjs';
const demand=(condition,code)=>{if(!condition)throw Error('recovery-request:'+code);};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function recoveryExecutionBindings(root,documents,configuration){
 demand(resolve(root,'scripts/check-p5-recovery-request.mjs')===fileURLToPath(import.meta.url),'execution-root');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 demand(git('diff','--name-only','HEAD').trim()==='','tracked-source-dirty');
 const files=git('ls-files','-z').split('\0').filter(Boolean).sort();
 demand(files.includes('scripts/check-p5-recovery-request.mjs'),'runner-not-committed');
 return {source:sha(canonical(files.map(file=>[file,sha(readFileSync(resolve(root,file)))]))),
  dependencies:sha(canonical(['package-lock.json','services/document-service/package-lock.json','services/document-service/requirements-renderer.txt'].map(file=>[file,sha(readFileSync(resolve(root,file)))]))),
  runtime:sha(canonical({node:process.version,platform:process.platform,arch:process.arch})),
  documents:sha(canonical(documents)),models:sha(canonical(HAIKU_POLICY)),configuration:sha(canonical(configuration))};
}
/** One reviewed provider request, never a scheduler or pricing acceptance claim.
 * The caller prepares the request with the unchanged pipeline in an offline pass.
 * Native review binds the exact body plus original source/configuration evidence.
 * No provisioning, retry, production DB, email, CRM, model fallback or tool execution.
 */
export async function runRecoveryRequest({mode,root=process.cwd(),bundleFile,bundleSha256,attestationFile,attestationSha256,approvalFile,approvalSha256,outputDirectory,transport=fetch}){
 demand(['preflight','execute'].includes(mode),'mode');
 const bundle=JSON.parse(readFileSync(bundleFile,'utf8')),authority=JSON.parse(readFileSync(attestationFile,'utf8'));
 demand(digest(bundleSha256)&&sha(canonical(bundle))===bundleSha256,'bundle-identity');
 demand(digest(attestationSha256)&&sha(canonical(authority))===attestationSha256,'authority-identity');
 demand(bundle.version===1&&bundle.caseId==='lot29'&&['read','review','pricing'].includes(bundle.stageId),'case-stage');
 demand(authority.historicalUpperBoundMicros===3250000&&authority.historicalLiability?.unknownHoldMicros===390000&&authority.epochCeilingMicros<=2000000,'initial-recovery-cap');
 const lot=authority.cases.find(c=>c.id==='lot29');
 demand(lot?.priorUpperBoundMicros===1000000&&lot.ceilingMicros<=3000000,'lot29-cap');
 demand(Array.isArray(bundle.documents)&&bundle.documents.length===1,'one-original-document');
 const documents=bundle.documents.map(d=>{
  demand(d.type==='application/pdf'&&digest(d.sha256),'document-manifest');
  const bytes=readFileSync(resolve(dirname(bundleFile),d.path));
  demand(sha(bytes)===d.sha256&&bytes.subarray(0,5).toString()==='%PDF-','original-document-identity');
  return {sha256:d.sha256,type:d.type};
 });
 demand(documents[0].sha256===lot.documentSha256,'case-document-binding');
 demand(digest(bundle.inputEvidenceSha256)&&bundle.configuration&&bundle.request?.model===HAIKU_POLICY.model,'request-evidence');
 const bindings=recoveryExecutionBindings(root,documents,bundle.configuration);
 demand(canonical(bindings)===canonical(authority.bindings),'execution-bindings');
 demand(!['on','true'].includes(process.env.P5_CRM_DELIVERY),'crm-must-remain-off');
 demand(process.env.P5_ESTIMATOR_PROVIDER!=='openai','runtime-provider-mismatch');
 const requestSha256=sha(canonical({...bundle.request,service_tier:HAIKU_POLICY.serviceTier}));
 const projection={version:1,attestationSha256,bundleSha256,bindings,caseId:bundle.caseId,stageId:bundle.stageId,documentSha256:lot.documentSha256,requestSha256,
  inputEvidenceSha256:bundle.inputEvidenceSha256,endpoint:HAIKU_POLICY.endpoint,model:HAIKU_POLICY.model,requestPolicySha256:recoveryRequestPolicySha256,
  maxOutputTokens:bundle.request.max_tokens,maxReservationMicros:400000+5*bundle.request.max_tokens,automaticRetries:0,maxInflight:1,crmEnabled:false};
 // Opening verifies an EXISTING provisioned ledger; this entry point cannot create it.
 const ledger=new RecoveryEpochLedger({file:authority.ledgerPath,attestation:authority,expectedSha256:attestationSha256,bindings});
 try{
  const context={caseId:bundle.caseId,stageId:bundle.stageId,documentSha256:lot.documentSha256};
  // Exercise all request checks without reading credentials or reserving/dispatching.
  const dry=recoveryTransport({ledger,context,credential:()=>{throw Error('review-preflight-no-dispatch');},transport:()=>{throw Error('unreachable');}});
  let replay=false;
  try{await dry(HAIKU_POLICY.endpoint,{method:'POST',body:JSON.stringify(bundle.request)});replay=true;}
  catch(error){if(error.message!=='review-preflight-no-dispatch')throw error;}
  const preflight={...projection,exactSavedReceipt:replay,ledger:ledger.report(),providerCallsAdded:0};
  if(mode==='preflight')return preflight;
  const approval=JSON.parse(readFileSync(approvalFile,'utf8'));
  demand(digest(approvalSha256)&&sha(canonical(approval))===approvalSha256,'review-approval-identity');
  demand(canonical(approval.request)===canonical(projection)&&digest(approval.reviewerEvidenceSha256)&&Date.parse(approval.expiresAt)>Date.now(),'review-approval-binding');
  const out=resolve(outputDirectory);
  demand(relative(out,resolve(root))!==''&&out!==dirname(authority.ledgerPath),'separate-output-directory');
  mkdirSync(out,{mode:0o700}); // exclusive: preserve every previous run
  const save=(name,value)=>writeFileSync(resolve(out,name),canonical(value),{flag:'wx',mode:0o600});
  save('request.json',{...bundle.request,service_tier:HAIKU_POLICY.serviceTier});save('preflight.json',preflight);save('review-approval.json',approval);
  const send=recoveryTransport({ledger,context,transport});
  let passed=false;
  try{
   const response=await send(HAIKU_POLICY.endpoint,{method:'POST',body:JSON.stringify(bundle.request)});
   save('response.json',await response.json());passed=true;
   return {...projection,passed:true,semanticAcceptance:false,pricingAcceptance:false,ledger:ledger.report()};
  }finally{save('result.json',{...projection,passed,semanticAcceptance:false,pricingAcceptance:false,ledger:ledger.report()});}
 }finally{ledger.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,bundleFile,bundleSha256,attestationFile,attestationSha256,approvalFile,approvalSha256,outputDirectory]=process.argv.slice(2);
 runRecoveryRequest({mode,bundleFile,bundleSha256,attestationFile,attestationSha256,approvalFile,approvalSha256,outputDirectory})
 .then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Recovery request stopped. Inspect the private ledger and saved result; no automatic retry.');process.exitCode=1;});
}
