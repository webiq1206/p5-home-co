import test from 'node:test';
import assert from 'node:assert/strict';
import {elapsedLabel,pricingActivity} from '../lib/p5/processingStatus.ts';
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
