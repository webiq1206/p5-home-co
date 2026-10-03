import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,sha,provisionRecoveryEpoch} from './lib/recoveryEpoch.mjs';
import {HAIKU_POLICY as policy,recoveryRequestPolicySha256} from './lib/recoveryTransport.mjs';
import {runRecoveryRequest,recoveryExecutionBindings} from './check-p5-recovery-request.mjs';

test('exact one-request runner requires independent approval, preserves receipts and replays without dispatch',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'p5-request-fixture-'));
 const saved=Object.fromEntries(['P5_ESTIMATOR_PROVIDER','P5_CRM_DELIVERY','ANTHROPIC_API_KEY'].map(k=>[k,process.env[k]]));
 try{
  delete process.env.P5_ESTIMATOR_PROVIDER;process.env.P5_CRM_DELIVERY='off';process.env.ANTHROPIC_API_KEY='SYNTHETIC-NOT-A-KEY';
  const put=(file,value)=>writeFileSync(join(directory,file),canonical(value));
  const pdf=Buffer.from('%PDF-1.4\nSYNTHETIC IDENTITY ONLY; not a valid original plan.'),doc=sha(pdf),h=sha('SYNTHETIC TEST ONLY');
  writeFileSync(join(directory,'source.pdf'),pdf);mkdirSync(join(directory,'authority'));
  const bundle={version:1,caseId:'lot29',stageId:'review',documents:[{path:'source.pdf',type:'application/pdf',sha256:doc}],inputEvidenceSha256:h,configuration:{testOnly:true},request:{model:policy.model,max_tokens:1000,messages:[{role:'user',content:'SYNTHETIC ONLY'}]}};
  const bindings=recoveryExecutionBindings(process.cwd(),[{sha256:doc,type:'application/pdf'}],bundle.configuration);
  const a={version:1,epochId:'synthetic',umbrellaId:'synthetic',authorizationEvidence:'SYNTHETIC TEST ONLY',umbrellaMicros:12000000,crmEnabled:false,ledgerPath:join(directory,'authority','epoch.sqlite'),expiresAt:new Date(Date.now()+3600000).toISOString(),historicalUpperBoundMicros:3250000,historicalLiability:{mode:'attested-carryforward',evidenceSha256:h,description:'SYNTHETIC TEST ONLY',unknownHoldMicros:390000},oldWorkers:{state:'stopped',evidenceSha256:h,upperBoundMicros:0},epochCeilingMicros:2000000,bindings,cases:[{id:'lot29',documentSha256:doc,priorUpperBoundMicros:1000000,ceilingMicros:3000000,stages:['read','review','pricing'].map(id=>({id,envelopeMicros:id==='read'?800000:600000,maxCalls:30,endpoint:policy.endpoint,model:policy.model,requestPolicySha256:recoveryRequestPolicySha256,billingBoundEvidenceSha256:sha(canonical([policy.pricingEvidenceSha256,policy.modelEvidenceSha256]))}))}]};
  put('bundle.json',bundle);put('authority.json',a);
  const args={bundleFile:join(directory,'bundle.json'),bundleSha256:sha(canonical(bundle)),attestationFile:join(directory,'authority.json'),attestationSha256:sha(canonical(a))};
  provisionRecoveryEpoch({file:a.ledgerPath,attestation:a,expectedSha256:args.attestationSha256});
  let calls=0;const transport=async()=>{calls++;return Response.json({model:policy.model,stop_reason:'end_turn',content:[{type:'text',text:'{}'}],usage:{input_tokens:100,output_tokens:10}});};
  const preflight=await runRecoveryRequest({...args,mode:'preflight',transport});assert.equal(calls,0);assert.equal(preflight.ledger.attempts.length,0);
  const {exactSavedReceipt,ledger,providerCallsAdded,...request}=preflight;
  const approval={request,reviewerEvidenceSha256:h,expiresAt:new Date(Date.now()+600000).toISOString()};put('approval.json',approval);
  const execute={...args,mode:'execute',approvalFile:join(directory,'approval.json'),approvalSha256:sha(canonical(approval)),outputDirectory:join(directory,'result'),transport};
  await assert.rejects(runRecoveryRequest({...execute,approvalSha256:h}),/review-approval-identity/);assert.equal(calls,0);
  const result=await runRecoveryRequest(execute);assert.equal(calls,1);assert.equal(result.ledger.aggregateUpperBoundMicros,3250150);assert.equal(result.semanticAcceptance,false);
  delete process.env.ANTHROPIC_API_KEY;
  await runRecoveryRequest({...execute,outputDirectory:join(directory,'replay')});assert.equal(calls,1);
  writeFileSync(join(directory,'source.pdf'),'%PDF-CHANGED');
  await assert.rejects(runRecoveryRequest({...args,mode:'preflight',transport}),/original-document-identity/);assert.equal(calls,1);
 }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(directory,{recursive:true,force:true});}
});
