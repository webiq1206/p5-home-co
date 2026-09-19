import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {transaction} from '../../app/lib/db.ts';

/**
 * A pricing reservation is deliberately separate from the stage checkpoint.
 * The checkpoint says whether a reply was saved; this ledger says whether a
 * provider charge may have happened. An unknown charge is never retried.
 */
export type PricingChargeState='reserved'|'settled'|'unknown'|'rejected';
export class PricingBudgetError extends Error { code='pricing-budget-unavailable'; }
export class PricingChargeUnknownError extends Error {
  code='pricing-charge-unknown';
  constructor(message='Pricing provider acknowledgement is unknown; retry is blocked until it is reconciled.'){super(message);}
}
export const pricingFingerprint=(provider:string,instructions:string,input:unknown,search:boolean)=>{
  return createHash('sha256').update(JSON.stringify({provider,instructions,input,search})).digest('hex');
};
const configuredNumber=(name:string)=>Number(process.env[name]||'');
const inMemoryTestLedger=()=>Boolean(process.env.NODE_TEST_CONTEXT)&&process.env.P5_PRICING_LEDGER_TEST_MODE==='memory';
export const pricingReservationConfig=()=>{
  const rawBudget=process.env.P5_PRICING_BUDGET_USD;
  const rawAmount=process.env.P5_PRICING_REQUEST_RESERVATION_USD;
  const budget=configuredNumber('P5_PRICING_BUDGET_USD');
  const amount=configuredNumber('P5_PRICING_REQUEST_RESERVATION_USD');
  if(!rawBudget||!Number.isFinite(budget)||budget<=0)throw new PricingBudgetError('P5_PRICING_BUDGET_USD must be a positive configured monetary cap.');
  if(!rawAmount||!Number.isFinite(amount)||amount<=0)throw new PricingBudgetError('P5_PRICING_REQUEST_RESERVATION_USD must be a positive configured reservation.');
  return {budget,amount};
};
export function reservationDecision(remaining:number,amount:number){
  return remaining+1e-9>=amount?'reserve':'reject';
}
export async function reservePricingCharge(fingerprint:string,provider:string,maxRequests=1){
  if(inMemoryTestLedger())return {fingerprint,amount:0,state:'reserved' as const};
  const {budget,amount}=pricingReservationConfig();
  const reservation=amount*maxRequests;
  await query(`CREATE TABLE IF NOT EXISTS p5_pricing_ledger (
    fingerprint text PRIMARY KEY, provider text NOT NULL, amount numeric(12,6) NOT NULL,
    state text NOT NULL, provider_id text, last_error text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const row=await transaction(async(client)=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`p5-pricing-budget:${budget}`]);
    const existing=(await client.query('SELECT state,provider_id FROM p5_pricing_ledger WHERE fingerprint=$1',[fingerprint])).rows[0];
    if(existing?.state==='unknown')throw new PricingChargeUnknownError();
    if(existing?.state==='reserved')throw new PricingChargeUnknownError('A previous pricing attempt is still reserved; reconciliation is required before retrying.');
    if(existing?.state==='settled')throw new PricingChargeUnknownError('A completed pricing charge has no reusable saved reply; reconciliation is required before repeating it.');
    const inserted=await client.query(`WITH usage AS (
        SELECT COALESCE(SUM(amount),0)::numeric AS spent
        FROM p5_pricing_ledger WHERE state IN ('reserved','settled','unknown')
      ) INSERT INTO p5_pricing_ledger(fingerprint,provider,amount,state)
      SELECT $1,$2,$3,'reserved' WHERE (SELECT spent FROM usage)+$3 <= $4
      RETURNING fingerprint,amount,state`,[fingerprint,provider,reservation,budget]);
    if(!inserted.rows.length)throw new PricingBudgetError(`Pricing budget cannot cover the next provider reservation ($${reservation.toFixed(2)} requested; configured cap is $${budget.toFixed(2)}).`);
    return inserted.rows[0];
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