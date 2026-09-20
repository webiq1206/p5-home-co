import {randomUUID} from 'node:crypto';
// The database adapter is brand-owned. It is loaded only when spend accounting
// runs, and its transaction helper is optional: a brand without one can still
// import this module, and any reservation then fails closed.
type SpendQuery=(statement:string,values?:unknown[])=>Promise<Record<string,any>[]>;
const adapter=()=>import('./database.ts');
const query:SpendQuery=async(statement,values=[])=>(await adapter()).query(statement,values);
async function transaction<T>(run:(query:SpendQuery)=>Promise<T>):Promise<T>{
  const key='transaction',exported:unknown=Reflect.get(await adapter(),key);
  if(typeof exported!=='function')throw new Error('pricing-spend-transaction-required');
  return (exported as (run:(query:SpendQuery)=>Promise<T>)=>Promise<T>)(run);
}

export type PricingSpendStatus='reserved'|'consumed'|'released'|'unknown'|'stopped';
export type PricingSpendOutcome={
  id:string|null;
  allowanceId:string;
  operationKey:string;
  amountUsd:number;
  status:PricingSpendStatus;
  remainingUsd:number|null;
  code:string;
};

const money=(value:unknown)=>Number(value||0);
const validId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
const validAmount=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=1000000;

export const PRICING_SPEND_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS p5_estimator_pricing_allowances (
    allowance_id text PRIMARY KEY,
    budget_usd numeric(14,6) NOT NULL CHECK (budget_usd>0),
    reserved_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (reserved_usd>=0),
    consumed_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (consumed_usd>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS p5_estimator_pricing_spend (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    allowance_id text NOT NULL REFERENCES p5_estimator_pricing_allowances(allowance_id),
    operation_key text NOT NULL,
    amount_usd numeric(14,6) NOT NULL CHECK (amount_usd>0),
    status text NOT NULL CHECK (status IN ('reserved','consumed','released','unknown','stopped')),
    provider text,
    model text,
    scenario text,
    stage text,
    elapsed_ms integer,
    error_code text,
    response_id text,
    returned_model text,
    service_tier text,
    input_tokens integer,
    output_tokens integer,
    cached_input_tokens integer,
    pricing_input_per_million numeric(14,6),
    pricing_output_per_million numeric(14,6),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (allowance_id,operation_key)
  )`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS response_id text`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS returned_model text`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS service_tier text`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS input_tokens integer`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS output_tokens integer`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS cached_input_tokens integer`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS pricing_input_per_million numeric(14,6)`,
  `ALTER TABLE p5_estimator_pricing_spend ADD COLUMN IF NOT EXISTS pricing_output_per_million numeric(14,6)`,
  `CREATE INDEX IF NOT EXISTS p5_estimator_pricing_spend_status ON p5_estimator_pricing_spend(allowance_id,status)`
];

let schemaReady:Promise<void>|null=null;
export function ensurePricingSpendSchema(){
  if(!schemaReady)schemaReady=(async()=>{for(const statement of PRICING_SPEND_SCHEMA)await query(statement);})().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

export function configuredPricingAllowance(env:Readonly<Record<string,string|undefined>>=process.env){
  const allowanceId=env.P5_LIVE_PRICING_ALLOWANCE_ID;
  const budgetUsd=Number(env.P5_LIVE_PRICING_ALLOWANCE_USD);
  const reserveUsd=Number(env.P5_LIVE_PRICING_RESERVE_USD);
  if(!validId(allowanceId)||!validAmount(budgetUsd)||!validAmount(reserveUsd))throw new Error('pricing-spend-configuration-required');
  if(reserveUsd>budgetUsd)throw new Error('pricing-spend-reservation-exceeds-allowance');
  return {allowanceId:allowanceId!,budgetUsd,reserveUsd};
}

export async function reservePricingSpend(input:{
  operationKey:string; provider?:string; model?:string; scenario?:string; stage?:string; reserveUsd?:number;
},env:Readonly<Record<string,string|undefined>>=process.env):Promise<PricingSpendOutcome>{
  if(!/^[A-Za-z0-9._:-]{1,240}$/.test(input.operationKey))throw new Error('pricing-spend-operation-key-invalid');
  const config=configuredPricingAllowance(env);
  const reserveUsd=input.reserveUsd==null?config.reserveUsd:Number(input.reserveUsd);
  if(!validAmount(reserveUsd)||reserveUsd-config.reserveUsd>0.000001)throw new Error('pricing-spend-reservation-invalid');
  await ensurePricingSpendSchema();
  return transaction(async tx=>{
    await tx(`INSERT INTO p5_estimator_pricing_allowances(allowance_id,budget_usd)
      VALUES($1,$2) ON CONFLICT(allowance_id) DO NOTHING`,[config.allowanceId,config.budgetUsd]);
    const [allowance]=await tx('SELECT budget_usd AS "budgetUsd",reserved_usd AS "reservedUsd",consumed_usd AS "consumedUsd" FROM p5_estimator_pricing_allowances WHERE allowance_id=$1 FOR UPDATE',[config.allowanceId]);
    if(!allowance||Math.abs(money(allowance.budgetUsd)-config.budgetUsd)>0.000001)throw new Error('pricing-spend-allowance-mismatch');
    const existing=await tx('SELECT id FROM p5_estimator_pricing_spend WHERE allowance_id=$1 AND operation_key=$2',[config.allowanceId,input.operationKey]);
    if(!existing.length){
      const debited=await tx(`UPDATE p5_estimator_pricing_allowances SET reserved_usd=reserved_usd+$2,updated_at=now()
        WHERE allowance_id=$1 AND budget_usd-reserved_usd-consumed_usd >= $2 RETURNING allowance_id`,[config.allowanceId,reserveUsd]);
      await tx(`INSERT INTO p5_estimator_pricing_spend(id,allowance_id,operation_key,amount_usd,status,provider,model,scenario,stage)
        VALUES($8,$1,$2,$3,$9,$4,$5,$6,$7)`,
        [config.allowanceId,input.operationKey,reserveUsd,input.provider||null,input.model||null,input.scenario||null,input.stage||null,randomUUID(),debited.length?'reserved':'stopped']);
    }
    const rows=await tx(`SELECT s.id,s.allowance_id AS "allowanceId",s.operation_key AS "operationKey",s.amount_usd AS "amountUsd",
      s.status,a.budget_usd-a.reserved_usd-a.consumed_usd AS "remainingUsd",
      CASE WHEN s.status='reserved' THEN 'reserved' WHEN s.status='stopped' THEN 'allowance-exhausted' ELSE 'reused' END AS code
      FROM p5_estimator_pricing_spend s JOIN p5_estimator_pricing_allowances a ON a.allowance_id=s.allowance_id
      WHERE s.allowance_id=$1 AND s.operation_key=$2`,[config.allowanceId,input.operationKey]);
    const row=rows[0];
    if(!row)throw new Error('pricing-spend-ledger-unavailable');
    return {id:String(row.id),allowanceId:String(row.allowanceId),operationKey:String(row.operationKey),amountUsd:money(row.amountUsd),status:row.status as PricingSpendStatus,remainingUsd:row.remainingUsd==null?null:money(row.remainingUsd),code:String(row.code)};
  });
}

export async function finishPricingSpend(id:string,status:Extract<PricingSpendStatus,'consumed'|'released'|'unknown'>,details:{elapsedMs?:number;errorCode?:string}={}){
  if(!/^[0-9a-f-]{20,}$/i.test(id))throw new Error('pricing-spend-id-invalid');
  await ensurePricingSpendSchema();
  const rows=await query(`WITH changed AS (
    UPDATE p5_estimator_pricing_spend SET status=$2,elapsed_ms=$3,error_code=$4,updated_at=now()
    WHERE id=$1 AND status='reserved' RETURNING allowance_id,amount_usd
  ), adjusted AS (
    UPDATE p5_estimator_pricing_allowances a SET reserved_usd=a.reserved_usd-(SELECT amount_usd FROM changed),
      consumed_usd=a.consumed_usd+CASE WHEN $2 IN ('consumed','unknown') THEN (SELECT amount_usd FROM changed) ELSE 0 END,updated_at=now()
    WHERE a.allowance_id=(SELECT allowance_id FROM changed) RETURNING a.budget_usd-a.reserved_usd-a.consumed_usd AS remaining
  ) SELECT COALESCE((SELECT remaining FROM adjusted),NULL) AS "remainingUsd"`,[id,status,details.elapsedMs==null?null:Math.max(0,Math.round(details.elapsedMs)),details.errorCode||null]);
  return rows[0]?.remainingUsd==null?null:money(rows[0].remainingUsd);
}

/**
 * Cross the paid-request boundary conservatively. Moving the reservation to
 * unknown before the network call means a process crash can never make the
 * same operation look safe to call again. Unknown spend remains charged
 * against the allowance until an operator reconciles the provider invoice.
 */
export async function beginPricingSpend(id:string){
  if(!/^[0-9a-f-]{20,}$/i.test(id))throw new Error('pricing-spend-id-invalid');
  await ensurePricingSpendSchema();
  const rows=await query(`WITH changed AS (
    UPDATE p5_estimator_pricing_spend SET status='unknown',error_code='provider-outcome-pending',updated_at=now()
    WHERE id=$1 AND status='reserved' RETURNING allowance_id,amount_usd
  ), adjusted AS (
    UPDATE p5_estimator_pricing_allowances a SET reserved_usd=a.reserved_usd-(SELECT amount_usd FROM changed),
      consumed_usd=a.consumed_usd+(SELECT amount_usd FROM changed),updated_at=now()
    WHERE a.allowance_id=(SELECT allowance_id FROM changed) RETURNING a.budget_usd-a.reserved_usd-a.consumed_usd AS remaining
  ) SELECT COALESCE((SELECT remaining FROM adjusted),NULL) AS "remainingUsd"`,[id]);
  if(rows[0]?.remainingUsd==null)throw new Error('pricing-spend-reservation-not-active');
  return money(rows[0].remainingUsd);
}

export async function confirmPricingSpend(id:string,details:{
  elapsedMs?:number;
  actualUsd?:number;
  responseId?:string;
  returnedModel?:string;
  serviceTier?:string;
  inputTokens?:number;
  outputTokens?:number;
  cachedInputTokens?:number;
  inputPerMillion?:number;
  outputPerMillion?:number;
}={}){
  if(!/^[0-9a-f-]{20,}$/i.test(id))throw new Error('pricing-spend-id-invalid');
  const actualUsd=Number(details.actualUsd);
  if(!validAmount(actualUsd))throw new Error('pricing-spend-actual-amount-invalid');
  await ensurePricingSpendSchema();
  const rows=await transaction(async tx=>{
    const [spend]=await tx(`SELECT allowance_id AS "allowanceId",amount_usd AS "amountUsd" FROM p5_estimator_pricing_spend WHERE id=$1 AND status='unknown' FOR UPDATE`,[id]);
    if(!spend)return [];
    await tx(`UPDATE p5_estimator_pricing_allowances SET consumed_usd=consumed_usd+($2-amount_usd),updated_at=now()
      FROM p5_estimator_pricing_spend WHERE p5_estimator_pricing_allowances.allowance_id=$3 AND p5_estimator_pricing_spend.id=$1`,
      [id,actualUsd,spend.allowanceId]);
    return tx(`UPDATE p5_estimator_pricing_spend SET status='consumed',amount_usd=$2,elapsed_ms=$3,error_code=NULL,
      response_id=$4,returned_model=$5,service_tier=$6,input_tokens=$7,output_tokens=$8,cached_input_tokens=$9,
      pricing_input_per_million=$10,pricing_output_per_million=$11,updated_at=now()
      WHERE id=$1 AND status='unknown' RETURNING id`,
      [id,actualUsd,details.elapsedMs==null?null:Math.max(0,Math.round(details.elapsedMs)),details.responseId||null,details.returnedModel||null,details.serviceTier||null,
       details.inputTokens==null?null:Math.max(0,Math.round(details.inputTokens)),details.outputTokens==null?null:Math.max(0,Math.round(details.outputTokens)),
       details.cachedInputTokens==null?null:Math.max(0,Math.round(details.cachedInputTokens)),details.inputPerMillion||null,details.outputPerMillion||null]);
  });
  if(!rows.length)throw new Error('pricing-spend-outcome-not-pending');
}

/** Reconcile a reservation only when local validation proves fetch was never
 * entered. The row remains as released with the explicit pre-dispatch reason. */
export async function releaseUndispatchedPricingSpend(id:string,errorCode:string){
  if(!/^[0-9a-f-]{20,}$/i.test(id)||!/^[a-z0-9-]{3,120}$/.test(errorCode))throw new Error('pricing-spend-reconciliation-invalid');
  await ensurePricingSpendSchema();
  const rows=await transaction(async tx=>{
    const [spend]=await tx(`SELECT allowance_id AS "allowanceId",amount_usd AS "amountUsd" FROM p5_estimator_pricing_spend
      WHERE id=$1 AND status='unknown' AND error_code='provider-outcome-pending' FOR UPDATE`,[id]);
    if(!spend)return [];
    await tx(`UPDATE p5_estimator_pricing_allowances SET consumed_usd=consumed_usd-$2,updated_at=now() WHERE allowance_id=$1`,[spend.allowanceId,money(spend.amountUsd)]);
    return tx(`UPDATE p5_estimator_pricing_spend SET status='released',error_code=$2,updated_at=now() WHERE id=$1 AND status='unknown' RETURNING id`,[id,errorCode]);
  });
  if(!rows.length)throw new Error('pricing-spend-reconciliation-not-pending');
}