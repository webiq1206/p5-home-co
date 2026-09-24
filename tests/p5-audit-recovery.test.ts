import test from 'node:test';
import assert from 'node:assert/strict';
import {requestPricingAudit,hasRepairBudget,REPAIR_BUDGET_MS,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {PricingStageTimeout} from '../lib/p5/pricingProgress.ts';
import {beginPricingRepair,type PricingRepairState} from '../lib/p5/repairClock.ts';

const tasks=Array.from({length:4},(_,i)=>({id:`task-${i}`,description:`Work in room ${i}`}));
const input={original:{text:'All four rooms, with shared demolition and cleanup.'},tasks,existingLines:[{id:'shared-line',quantity:4}],priorPricingIssues:['Shared demolition may overlap.']};
test('a truncated audit splits coverage without dropping original scope, shared costs or unresolved findings',async()=>{
  const calls:string[][]=[];
  const request:PricingRequest=async(_instructions,value)=>{
    const part=value as typeof input&{auditTaskSubset?:boolean;allTaskDescriptions?:typeof tasks};
    calls.push(part.tasks.map(task=>task.id));
    assert.deepEqual(part.original,input.original);assert.deepEqual(part.existingLines,input.existingLines);
    assert.deepEqual(part.priorPricingIssues,input.priorPricingIssues);
    if(part.tasks.length>2)throw new PricingStageTimeout('pricing-stage-output-limit');
    assert.equal(part.auditTaskSubset,true);assert.deepEqual(part.allTaskDescriptions,tasks);
    return {value:{coveredTaskIds:part.tasks.map(task=>task.id),issues:['shared-line duplicates demolition.'],notes:[],resolvedIssues:[]},sourceUrls:[]};
  };
  const result=await requestPricingAudit(request,input,()=>60000);
  assert.deepEqual(calls.map(call=>call.length),[4,2,2]);
  assert.deepEqual(result.value,{coveredTaskIds:tasks.map(task=>task.id),issues:['shared-line duplicates demolition.'],notes:[],resolvedIssues:[]});
});
test('a subset cannot claim another subset passed, and incomplete single-task output remains a failure',async()=>{
  const request:PricingRequest=async(_instructions,value)=>{
    const part=value as typeof input;
    if(part.tasks.length>1)throw new Error('pricing-check-incomplete:max_tokens');
    return {value:{coveredTaskIds:tasks.map(task=>task.id).filter(id=>id!==part.tasks[0].id),issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  };
  assert.deepEqual((await requestPricingAudit(request,input,()=>60000)).value,{coveredTaskIds:[],issues:[],notes:[],resolvedIssues:[]});
  let calls=0;
  await assert.rejects(requestPricingAudit(async()=>{calls++;throw new Error('pricing-check-incomplete:max_output_tokens');},{...input,tasks:[tasks[0]]},()=>60000),/pricing-stage-exhausted/);
  assert.equal(calls,1,'an unsplittable audit is not retried indefinitely');
});
test('provider and schema failures do not trigger additional audit requests',async()=>{
  let calls=0;
  await assert.rejects(requestPricingAudit(async()=>{calls++;throw new Error('pricing-provider-unavailable:401');},input,()=>60000),/401/);
  assert.equal(calls,1);
  await assert.rejects(requestPricingAudit(async()=>({value:{coveredTaskIds:'all'},sourceUrls:[]}),input,()=>60000));
});
test('repair starts after first-pass work and its saved window survives a resumed job',async()=>{
  const state:PricingRepairState={};let saves=0;let stored='';
  const first=await beginPricingRepair(state,async()=>{saves++;stored=JSON.stringify(state);},200000,600000);
  assert.equal(hasRepairBudget(0),true,'ten minutes of first-pass work does not spend this window');
  const resumed=JSON.parse(stored) as PricingRepairState;
  const second=await beginPricingRepair(resumed,async()=>{saves++;},230000,600000+REPAIR_BUDGET_MS+10000);
  assert.deepEqual(second,first);assert.equal(saves,1,'resume cannot renew the repair clock');
  assert.equal(hasRepairBudget(REPAIR_BUDGET_MS+10000,230000-second.busyWaitMs),true,'only backoff during repair is excluded');
  assert.equal(hasRepairBudget(REPAIR_BUDGET_MS+40000,230000-second.busyWaitMs),false,'the saved repair window still expires');
});
