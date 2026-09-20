import test from 'node:test';
import assert from 'node:assert/strict';
import {pricingFingerprint,reservationDecision,pricingReservationConfig,pricingLedgerActive,configurePricingLedger,PricingBudgetError,PricingChargeUnknownError,reservePricingCharge,rejectPricingCharge,markPricingChargeUnknown,settlePricingCharge} from '../lib/p5/pricingLedger.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {requestPricing} from '../lib/p5/scopePricing.ts';

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
test('the ledger is brand-gated, opt-in elsewhere, and a configured cap never runs unguarded',async()=>{
  const names=['P5_PRICING_BUDGET_USD','P5_PRICING_REQUEST_RESERVATION_USD','P5_PRICING_LEDGER','P5_PRICING_LEDGER_TEST_MODE'] as const;
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for(const name of names)delete process.env[name];
  const p5=(ESTIMATOR_BRAND.id as string)==='p5';
  const held:string[]=[];
  try{
    configurePricingLedger(async run=>run(async statement=>{held.push(statement);return [];}));
    assert.equal(await pricingLedgerActive(),p5,'only P5 Home Co records ordinary pricing by default');
    process.env.P5_PRICING_LEDGER='on';
    assert.equal(await pricingLedgerActive(),true);
    delete process.env.P5_PRICING_LEDGER;
    process.env.P5_PRICING_BUDGET_USD='1';process.env.P5_PRICING_REQUEST_RESERVATION_USD='0.25';
    assert.equal(await pricingLedgerActive(),true,'a configured cap always activates the ledger');
    assert.equal(held.length,0,'activation alone reserves nothing');
  }finally{
    configurePricingLedger(undefined);
    for(const name of names){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});
test('a qualification policy is fail-closed before any provider request',async()=>{
  const policy={provider:'openai',noFallback:true,toolFree:true,maxOutputTokens:512,serviceTier:'default'} as const;
  await assert.rejects(()=>requestPricing('stage',{},true,5000,undefined,policy),/pricing-qualification-policy-invalid/);
  await assert.rejects(()=>requestPricing('stage',{},false,5000,undefined,{...policy,maxOutputTokens:4097}),/pricing-qualification-policy-invalid/);
  await assert.rejects(()=>requestPricing('stage',{},false,5000,undefined,{...policy,noFallback:false as unknown as true}),/pricing-qualification-policy-invalid/);
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
    await query(`INSERT INTO p5_pricing_ledger(fingerprint,provider,amount,state,active_until)
      VALUES($1,'openai',0.20,'unknown',now()-interval '1 day')`,[prefix+'unknown']);
    await assert.rejects(()=>reservePricingCharge(prefix+'unknown','openai'),PricingChargeUnknownError);
  }finally{
    await query('DELETE FROM p5_pricing_ledger WHERE fingerprint LIKE $1',[prefix+'%']);
    if(previous.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.database;
    if(previous.budget===undefined)delete process.env.P5_PRICING_BUDGET_USD;else process.env.P5_PRICING_BUDGET_USD=previous.budget;
    if(previous.amount===undefined)delete process.env.P5_PRICING_REQUEST_RESERVATION_USD;else process.env.P5_PRICING_REQUEST_RESERVATION_USD=previous.amount;
  }
});