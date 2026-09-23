import test from 'node:test';
import assert from 'node:assert/strict';
import {hasRepairBudget,REPAIR_BUDGET_MS} from '../lib/p5/scopePricing.ts';

// Live 2026-09-23, boiseremodeling.co, "Replace the shower in the hall bathroom ... replace it with
// tile": the provider returned 429 twelve times, the repair round was skipped for want of budget, two
// real double counts (an installed tile rate plus its setting materials; backer and waterproofing
// priced twice) stayed unresolved, and the customer got a handoff instead of a price.
const minutes=(n:number)=>n*60_000;
test('waiting out a busy provider does not spend the repair budget',()=>{
  const busy=200_000; // the 429 backoff ladder: 4s + 8s + 12s + 16s + 20s x 8
  assert.equal(hasRepairBudget(minutes(1),0),true,'a quick job repairs');
  assert.equal(hasRepairBudget(REPAIR_BUDGET_MS+30_000,0),false,'a genuinely long job still stops');
  assert.equal(hasRepairBudget(REPAIR_BUDGET_MS+30_000,busy),true,'the same elapsed time, mostly spent waiting, still repairs');
  assert.equal(hasRepairBudget(REPAIR_BUDGET_MS+busy+30_000,busy),false,'waiting does not buy unlimited working time');
});
test('the budget is unchanged when nothing was spent waiting',()=>{
  for(const elapsed of [0,1000,minutes(1),REPAIR_BUDGET_MS,REPAIR_BUDGET_MS+1])
    assert.equal(hasRepairBudget(elapsed,0),elapsed<=REPAIR_BUDGET_MS,`elapsed ${elapsed}`);
});
test('a replay or fixed test clock never spends the budget',()=>{
  assert.equal(hasRepairBudget(7*60*60*1000,0),true,'a clock older than any job lifetime is not a running job');
  assert.equal(hasRepairBudget(7*60*60*1000,minutes(5)),true);
});
test('a missing or negative wait is treated as no wait, never as extra budget',()=>{
  const over=REPAIR_BUDGET_MS+30_000;
  assert.equal(hasRepairBudget(over),false);
  assert.equal(hasRepairBudget(over,-minutes(10)),false,'a negative wait cannot shorten the budget');
  assert.equal(hasRepairBudget(over,Number.NaN),false,'an unusable figure is not budget');
});
