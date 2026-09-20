import {createHash} from 'node:crypto';
import {ESTIMATOR_BRAND} from './brand.ts';

/**
 * A pricing reservation is deliberately separate from the stage checkpoint.
 * The checkpoint says whether a reply was saved; this ledger says whether a
 * provider charge may have happened. An unknown charge is never retried.
 */
type LedgerQuery=(statement:string,values?:unknown[])=>Promise<Record<string,any>[]>;
/** Runs every statement of one admission decision on a single connection. */
export type PricingLedgerTransaction=<T>(run:(query:LedgerQuery)=>Promise<T>)=>Promise<T>;
// The database adapter is brand-owned and is loaded only when the ledger runs,
// so pure pricing imports never open the site's database driver.
const adapter=()=>import('./database.ts');
const query:LedgerQuery=async(statement,values=[])=>(await adapter()).query(statement,values);
let configuredTransaction:PricingLedgerTransaction|undefined;
/** A brand whose database adapter has no `transaction` export may supply one here. */
export function configurePricingLedger(transaction?:PricingLedgerTransaction){configuredTransaction=transaction;}
const ledgerTransaction=async():Promise<PricingLedgerTransaction|undefined>=>{
  if(configuredTransaction)return configuredTransaction;
  // Read the optional export by a computed key so a brand that has no
  // transaction helper still builds and runs.
  const key='transaction',exported:unknown=Reflect.get(await adapter(),key);
  return typeof exported==='function'?exported as PricingLedgerTransaction:undefined;
};
export type PricingChargeState='reserved'|'settled'|'unknown'|'rejected';
export type PricingIdentity={draftId:string;customerKey:string;revision:number};
export class PricingBudgetError extends Error { code='pricing-budget-unavailable'; }
export class PricingChargeUnknownError extends Error {
  code='pricing-charge-unknown';
  constructor(message='Pricing provider acknowledgement is unknown; retry is blocked until it is reconciled.'){super(message);}
}
export const pricingFingerprint=(provider:string,instructions:string,input:unknown,search:boolean,identity?:PricingIdentity)=>{
  return createHash('sha256').update(JSON.stringify({identity:identity||null,provider,instructions,input,search})).digest('hex');
};
const configuredNumber=(name:string)=>Number(process.env[name]||'');
const inMemoryTestLedger=()=>Boolean(process.env.NODE_TEST_CONTEXT)&&process.env.P5_PRICING_LEDGER_TEST_MODE==='memory';
/**
 * P5 Home Co records every provider request. The other brands keep their
 * existing provider fallback unless a spend cap is configured or the ledger is
 * switched on explicitly. A configured cap never runs unguarded: without a
 * transactional database adapter the reservation fails closed.
 */
export const pricingLedgerActive=async():Promise<boolean>=>{
  if(inMemoryTestLedger())return true;
  const capped=Boolean(process.env.P5_PRICING_BUDGET_USD||process.env.P5_PRICING_REQUEST_RESERVATION_USD);
  if(!capped&&(ESTIMATOR_BRAND.id as string)!=='p5'&&process.env.P5_PRICING_LEDGER!=='on')return false;
  if(!await ledgerTransaction())throw new PricingBudgetError('The pricing ledger requires a transactional database adapter (export transaction from lib/p5/database.ts or call configurePricingLedger).');
  return true;
};
export const pricingReservationConfig=()=>{
  const rawBudget=process.env.P5_PRICING_BUDGET_USD;
  const rawAmount=process.env.P5_PRICING_REQUEST_RESERVATION_USD;
  const budget=configuredNumber('P5_PRICING_BUDGET_USD');
  const amount=configuredNumber('P5_PRICING_REQUEST_RESERVATION_USD');
  if(!rawBudget&&!rawAmount)return null;
  if(!rawBudget||!Number.isFinite(budget)||budget<=0)throw new PricingBudgetError('P5_PRICING_BUDGET_USD must be a positive configured monetary cap when pricing reservations are enabled.');
  if(!rawAmount||!Number.isFinite(amount)||amount<=0)throw new PricingBudgetError('P5_PRICING_REQUEST_RESERVATION_USD must be a positive configured reservation when pricing reservations are enabled.');
  return {budget,amount};
};
export function reservationDecision(remaining:number,amount:number){
  return remaining+1e-9>=amount?'reserve':'reject';
}
export async function reservePricingCharge(fingerprint:string,provider:string,maxRequests=1){
  if(inMemoryTestLedger())return {fingerprint,amount:0,state:'reserved' as const};
  const config=pricingReservationConfig();
  const reservation=(config?.amount||0)*maxRequests;
  await query(`CREATE TABLE IF NOT EXISTS p5_pricing_ledger (
     fingerprint text PRIMARY KEY, provider text NOT NULL, amount numeric(12,6) NOT NULL,
     state text NOT NULL, provider_id text, last_error text, active_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await query(`ALTER TABLE p5_pricing_ledger ADD COLUMN IF NOT EXISTS active_until timestamptz`);
  const transaction=await ledgerTransaction();
  if(!transaction)throw new PricingBudgetError('The pricing ledger requires a transactional database adapter (export transaction from lib/p5/database.ts or call configurePricingLedger).');
  const row=await transaction(async(run)=>{
    if(config)await run('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`p5-pricing-budget:${config.budget}`]);
    const existing=(await run("SELECT state,provider_id,updated_at<now()-interval '3 minutes' AS stale FROM p5_pricing_ledger WHERE fingerprint=$1",[fingerprint]))[0];
    // "Never retry an unknown charge" protects a configured spending cap. With no cap
    // there is nothing to protect, and refusing the retry turned one slow provider reply
    // into a customer estimate that could never finish. The retry is recorded on the row.
    const retryable=!config&&(existing?.state==='unknown'||existing?.state==='reserved'&&existing.stale===true);
    if(existing?.state==='unknown'&&!retryable)throw new PricingChargeUnknownError();
    if(existing?.state==='reserved'&&!retryable)throw new PricingChargeUnknownError('A previous pricing attempt is still reserved; reconciliation is required before retrying.');
    if(existing?.state==='settled')throw new PricingChargeUnknownError('A completed pricing charge has no reusable saved reply; reconciliation is required before repeating it.');
    const inserted=!config
      ?existing?.state==='rejected'||retryable
        ?await run(`UPDATE p5_pricing_ledger SET provider=$2,amount=0,state='reserved',provider_id=NULL,last_error=CASE WHEN state='rejected' THEN NULL ELSE 'retried after an unacknowledged attempt (no spending cap configured)' END,active_until=NULL,updated_at=now()
          WHERE fingerprint=$1 RETURNING fingerprint,amount,state`,[fingerprint,provider])
        :await run(`INSERT INTO p5_pricing_ledger(fingerprint,provider,amount,state,active_until)
          VALUES($1,$2,0,'reserved',NULL) RETURNING fingerprint,amount,state`,[fingerprint,provider])
      :existing?.state==='rejected'
        ?await run(`WITH usage AS (
          SELECT COALESCE(SUM(amount),0)::numeric AS spent FROM p5_pricing_ledger
          WHERE (state='reserved' AND active_until>now()) OR state='unknown' OR (state='settled' AND active_until>now())
        ) UPDATE p5_pricing_ledger SET provider=$2,amount=$3,state='reserved',provider_id=NULL,last_error=NULL,active_until=now()+interval '1 hour',updated_at=now()
        WHERE fingerprint=$1 AND (SELECT spent FROM usage)+$3 <= $4 RETURNING fingerprint,amount,state`,[fingerprint,provider,reservation,config.budget])
        :await run(`WITH usage AS (
          SELECT COALESCE(SUM(amount),0)::numeric AS spent FROM p5_pricing_ledger
          WHERE (state='reserved' AND active_until>now()) OR state='unknown' OR (state='settled' AND active_until>now())
        ) INSERT INTO p5_pricing_ledger(fingerprint,provider,amount,state,active_until)
        SELECT $1,$2,$3,'reserved',now()+interval '1 hour' WHERE (SELECT spent FROM usage)+$3 <= $4
        RETURNING fingerprint,amount,state`,[fingerprint,provider,reservation,config.budget]);
    if(!inserted.length)throw new PricingBudgetError(`Pricing budget cannot cover the next provider reservation ($${reservation.toFixed(2)} requested; configured cap is $${config!.budget.toFixed(2)}).`);
    return inserted[0];
  });
  return {fingerprint,amount:Number(row.amount),state:row.state as PricingChargeState};
}
export async function recordPricingRequest(fingerprint:string,sequence:number,state:'started'|'completed'|'unknown'){
  if(inMemoryTestLedger())return;
  await query(`CREATE TABLE IF NOT EXISTS p5_pricing_ledger_requests (
    fingerprint text NOT NULL REFERENCES p5_pricing_ledger(fingerprint), sequence integer NOT NULL,
    state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(fingerprint,sequence)
  )`);
  await query(`INSERT INTO p5_pricing_ledger_requests(fingerprint,sequence,state) VALUES($1,$2,$3)
    ON CONFLICT(fingerprint,sequence) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,[fingerprint,sequence,state]);
}
export async function settlePricingCharge(fingerprint:string,providerId?:string){
  if(inMemoryTestLedger())return;
  await query("UPDATE p5_pricing_ledger SET state='settled',provider_id=$2,updated_at=now() WHERE fingerprint=$1 AND state='reserved'",[fingerprint,providerId||null]);
}
export async function markPricingChargeUnknown(fingerprint:string,error:string){
  if(inMemoryTestLedger())return;
  await query("UPDATE p5_pricing_ledger SET state='unknown',last_error=$2,updated_at=now() WHERE fingerprint=$1 AND state='reserved'",[fingerprint,error.slice(0,500)]);
}
export async function rejectPricingCharge(fingerprint:string,error:string){
  if(inMemoryTestLedger())return;
  await query("UPDATE p5_pricing_ledger SET state='rejected',last_error=$2,updated_at=now() WHERE fingerprint=$1 AND state='reserved'",[fingerprint,error.slice(0,500)]);
}