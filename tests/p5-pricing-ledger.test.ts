import test from 'node:test';
import assert from 'node:assert/strict';
import {pricingFingerprint,reservationDecision,pricingReservationConfig,PricingBudgetError,PricingChargeUnknownError,reservePricingCharge,rejectPricingCharge,markPricingChargeUnknown,settlePricingCharge} from '../lib/p5/pricingLedger.ts';
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
  assert.notEqual(a,pricingFingerprint('openai','map',{task:'one'},false,{draftId:'d1',customerKey:'a',revision:1}));
  assert.notEqual(pricingFingerprint('openai','map',{task:'one'},false,{draftId:'d1',customerKey:'a',revision:1}),pricingFingerprint('openai','map',{task:'one'},false,{draftId:'d2',customerKey:'a',revision:1}));
});
test('pricing reservations are optional only when both settings are absent',()=>{
  const previous=[process.env.P5_PRICING_BUDGET_USD,process.env.P5_PRICING_REQUEST_RESERVATION_USD];
  delete process.env.P5_PRICING_BUDGET_USD;delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;
  assert.equal(pricingReservationConfig(),null);
  process.env.P5_PRICING_BUDGET_USD='1';
  assert.throws(()=>pricingReservationConfig(),PricingBudgetError);
  if(previous[0]===undefined)delete process.env.P5_PRICING_BUDGET_USD;else process.env.P5_PRICING_BUDGET_USD=previous[0];
  if(previous[1]===undefined)delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;else process.env.P5_PRICING_REQUEST_RESERVATION_USD=previous[1];
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
test('database ledger protects ordinary pricing without imposing a configured spend cap',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const previous={database:process.env.DATABASE_URL,budget:process.env.P5_PRICING_BUDGET_USD,amount:process.env.P5_PRICING_REQUEST_RESERVATION_USD};
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  delete process.env.P5_PRICING_BUDGET_USD;delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;
  const {query}=await import('../lib/p5/database.ts');
  const prefix='ordinary-ledger-test-';
  try{
    await query(`CREATE TABLE IF NOT EXISTS p5_pricing_ledger (
      fingerprint text PRIMARY KEY,provider text NOT NULL,amount numeric(12,6) NOT NULL,state text NOT NULL,
      provider_id text,last_error text,active_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
    await query('ALTER TABLE p5_pricing_ledger ADD COLUMN IF NOT EXISTS active_until timestamptz');
    await query('DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE $1',[prefix+'%']);
    const first=await reservePricingCharge(prefix+'rejected','openai');
    assert.equal(first.amount,0);
    await rejectPricingCharge(prefix+'rejected','known 400');
    assert.equal((await reservePricingCharge(prefix+'rejected','openai')).state,'reserved');
    await markPricingChargeUnknown(prefix+'rejected','timeout');
    await assert.rejects(()=>reservePricingCharge(prefix+'rejected','openai'),PricingChargeUnknownError);
    assert.equal((await reservePricingCharge(prefix+'other-customer','openai')).state,'reserved');
    await settlePricingCharge(prefix+'other-customer','provider-result');
    await assert.rejects(()=>reservePricingCharge(prefix+'other-customer','openai'),PricingChargeUnknownError);
  }finally{
    await query('DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE $1',[prefix+'%']);
    if(previous.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.database;
    if(previous.budget===undefined)delete process.env.P5_PRICING_BUDGET_USD;else process.env.P5_PRICING_BUDGET_USD=previous.budget;
    if(previous.amount===undefined)delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;else process.env.P5_PRICING_REQUEST_RESERVATION_USD=previous.amount;
  }
});
test('expired settled reservations do not create a lifetime pricing cap',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const previous={database:process.env.DATABASE_URL,budget:process.env.P5_PRICING_BUDGET_USD,amount:process.env.P5_PRICING_REQUEST_RESERVATION_USD};
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  process.env.P5_PRICING_BUDGET_USD='0.25';process.env.P5_PRICING_REQUEST_RESERVATION_USD='0.20';
  const {query}=await import('../lib/p5/database.ts');
  const prefix='window-ledger-test-';
  try{
    await query(`CREATE TABLE IF NOT EXISTS p5_pricing_ledger (
      fingerprint text PRIMARY KEY,provider text NOT NULL,amount numeric(12,6) NOT NULL,state text NOT NULL,
      provider_id text,last_error text,active_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
    await query('ALTER TABLE p5_pricing_ledger ADD COLUMN IF NOT EXISTS active_until timestamptz');
    await query('DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE $1',[prefix+'%']);
    await query(`INSERT INTO p5_pricing_ledger(fingerprint,provider,amount,state,active_until)
      VALUES($1,'openai',0.20,'settled',now()-interval '1 minute')`,[prefix+'expired']);
    assert.equal((await reservePricingCharge(prefix+'new','openai')).state,'reserved');
  }finally{
    await query('DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE $1',[prefix+'%']);
    if(previous.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.database;
    if(previous.budget===undefined)delete process.env.P5_PRICING_BUDGET_USD;else process.env.P5_PRICING_BUDGET_USD=previous.budget;
    if(previous.amount===undefined)delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;else process.env.P5_PRICING_REQUEST_RESERVATION_USD=previous.amount;
  }
});