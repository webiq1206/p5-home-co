import test from 'node:test';
import assert from 'node:assert/strict';
import {pricingFingerprint,reservationDecision,PricingBudgetError,PricingChargeUnknownError,reservePricingCharge} from '../lib/p5/pricingLedger.ts';
import {deliveryBrand} from '../lib/p5/deliveryAdapter.ts';
import {deliveryRetryDecision} from '../lib/p5/outbox.ts';

test('pricing reservations reject when the configured remainder cannot cover a request',()=>{
  assert.equal(reservationDecision(0.24,0.25),'reject');
  assert.equal(reservationDecision(0.25,0.25),'reserve');
  assert.equal(reservationDecision(1,0.25),'reserve');
});
test('pricing fingerprints are stable and distinguish provider/request identity',()=>{
  const a=pricingFingerprint('openai','map',{task:'one'},false);
  assert.equal(a,pricingFingerprint('openai','map',{task:'one'},false));
  assert.notEqual(a,pricingFingerprint('anthropic','map',{task:'one'},false));
  assert.notEqual(a,pricingFingerprint('openai','map',{task:'two'},false));
});
test('unknown charge and budget errors remain explicit typed stops',()=>{
  assert.equal(new PricingBudgetError().code,'pricing-budget-unavailable');
  assert.equal(new PricingChargeUnknownError().code,'pricing-charge-unknown');
  assert.match(new PricingChargeUnknownError('A completed pricing charge already exists without a reusable saved result; repeating it is blocked.').message,/repeating it is blocked/);
});
test('delivery preserves the record brand and only defaults for old records',()=>{
  assert.equal(deliveryBrand({brand:'Remodeling Co'}),'Remodeling Co');
  assert.equal(deliveryBrand({brand:''}),'P5 Home Co');
  assert.equal(deliveryBrand({}),'P5 Home Co');
});
test('ambiguous delivery never retries CRM or non-idempotent email',()=>{
  const now=Date.now();
  assert.equal(deliveryRetryDecision('crm',true,1,new Date(now)),'needs-review');
  assert.equal(deliveryRetryDecision('customer:x',false,1,new Date(now)),'needs-review');
  assert.equal(deliveryRetryDecision('customer:x',true,1,new Date(now)),'retry');
  assert.equal(deliveryRetryDecision('customer:x',true,1,new Date(now-24*3600000)),'needs-review');
  assert.equal(deliveryRetryDecision('customer:x',true,6,new Date(now)),'needs-review');
});
test('database admission serializes distinct fingerprints at the configured cap',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const previous={database:process.env.DATABASE_URL,budget:process.env.P5_PRICING_BUDGET_USD,amount:process.env.P5_PRICING_REQUEST_RESERVATION_USD};
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  process.env.P5_PRICING_BUDGET_USD='0.25';
  process.env.P5_PRICING_REQUEST_RESERVATION_USD='0.20';
  const {query}=await import('../lib/p5/database.ts');
  try{
    await query('CREATE TABLE IF NOT EXISTS p5_pricing_ledger (fingerprint text PRIMARY KEY, provider text NOT NULL, amount numeric(12,6) NOT NULL, state text NOT NULL, provider_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())');
    await query("DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE 'concurrency-test-%'");
    const results=await Promise.allSettled([
      reservePricingCharge('concurrency-test-a','openai'),
      reservePricingCharge('concurrency-test-b','openai'),
    ]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.filter(result=>result.status==='rejected'&&result.reason instanceof PricingBudgetError).length,1);
  }finally{
    await query("DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE 'concurrency-test-%'");
    if(previous.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.database;
    if(previous.budget===undefined)delete process.env.P5_PRICING_BUDGET_USD;else process.env.P5_PRICING_BUDGET_USD=previous.budget;
    if(previous.amount===undefined)delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;else process.env.P5_PRICING_REQUEST_RESERVATION_USD=previous.amount;
  }
});