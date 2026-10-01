import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAttemptReport,projectStageErrorCode} from '../lib/p5/projectDiagnostics.ts';
import {PricingChargeUnknownError} from '../lib/p5/pricingLedger.ts';
test('staff diagnostics preserve the actual failed candidate and do not attest legacy revision metadata',()=>{
 const result=projectAttemptReport({work_key:'work',payload:{startedAt:'today',requests:{key:{instructions:'Contract: p5-project-review-v4. secret instruction',input:{stage:'scope-with-questions',record:{summary:'actual candidate'},headers:{authorization:'secret'}},startedAt:'today'}},replies:{key:{value:{findings:['actual defect']},model:'required-model'}}}});
 assert.equal(result.draftRevision,null);assert.equal(result.status,'unfinished');
 assert.deepEqual(result.stages[0].candidate,{summary:'actual candidate'});assert.deepEqual(result.stages[0].response,{findings:['actual defect']});
 assert.ok(!JSON.stringify(result).includes('secret'));
});
test('provider interruption reasons survive the ledger wrapper without exposing raw provider errors',()=>{
 assert.equal(projectStageErrorCode(new PricingChargeUnknownError(undefined,{cause:new Error('pricing-check-incomplete:max_output_tokens')})),'provider-incomplete:max_output_tokens');
 assert.equal(projectStageErrorCode(new PricingChargeUnknownError(undefined,{cause:new Error('secret upstream response')})),'pricing-charge-unknown');
 assert.equal(projectStageErrorCode(new Error('secret upstream response')),'stage-request-failed');
});
