import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptAnalysisJob,analysisRetryDelay,elapsedLabel,pricingActivity} from '../lib/p5/processingStatus.ts';
import {completeSubmission} from '../lib/p5/submitProgress.ts';
test('Live status reports actual provider operations without exposing private rates',()=>{
  const input={taskBatch:[{description:'First-floor trim',unitCost:85}],financialConfig:{profit:0.2}};
  assert.equal(pricingActivity('Inventory the complete requested construction scope.',input,false).phase,'inventory');
  const mapped=pricingActivity('You are a construction estimator checking COMPLETE scope coverage.',input,false);
  assert.equal(mapped.phase,'mapping');assert.deepEqual(mapped.currentItems,['First-floor trim']);
  assert.ok(!JSON.stringify(mapped).includes('85'));assert.ok(!JSON.stringify(mapped).includes('profit'));
  assert.equal(pricingActivity('Research published construction average costs.',{tasks:input.taskBatch},true).phase,'research');
  assert.equal(pricingActivity('Independently audit this proposed construction estimate.',input,false).phase,'verification');
});
test('Elapsed time is truthful, not an estimated countdown',()=>{
  assert.equal(elapsedLabel(5.9),'5s elapsed');assert.equal(elapsedLabel(65),'1m 05s elapsed');assert.equal(elapsedLabel(-5),'0s elapsed');
});
test('Submission polling forwards structured status and never fabricates progress',async()=>{
  const processing=pricingActivity('Inventory the complete requested construction scope.',{},false);
  let calls=0;const seen:unknown[]=[];
  await completeSubmission(async()=>++calls===1?Response.json({pending:true,message:processing.message,processing},{status:202}):Response.json({result:{range:{low:10,high:20}}}),(message,status)=>seen.push({message,status}),async()=>{});
  assert.deepEqual(seen,[{message:processing.message,status:processing}]);
});
test('Analysis polling follows server timing and cannot apply a different completed job',()=>{
  assert.equal(analysisRetryDelay(250),500);assert.equal(analysisRetryDelay(2000),2000);assert.equal(analysisRetryDelay(60000),15000);assert.equal(analysisRetryDelay(undefined),1000);
  assert.equal(acceptAnalysisJob(undefined,'job-a'),'job-a');assert.equal(acceptAnalysisJob('job-a','job-a'),'job-a');
  assert.throws(()=>acceptAnalysisJob('job-a','job-b'),/saved project changed/);
  assert.throws(()=>acceptAnalysisJob(undefined,undefined,true),/could not be matched/);
  assert.throws(()=>acceptAnalysisJob('job-a',undefined),/could not be matched/);
});
