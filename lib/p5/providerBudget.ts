import {createHash,randomUUID} from 'node:crypto';
import {query} from './database.ts';

type Execute=(statement:string,values?:unknown[])=>Promise<Record<string,any>[]>;
export type QualificationReservation={idempotencyKey:string;status:'reserved'|'in_flight'|'consumed'|'released'|'unknown';reservedMicrousd:number};

const TABLES=[
 `CREATE TABLE IF NOT EXISTS p5_provider_qualification_budgets (
   run_id text PRIMARY KEY,
   allowance_microusd bigint NOT NULL CHECK(allowance_microusd>0),
   committed_microusd bigint NOT NULL DEFAULT 0 CHECK(committed_microusd>=0),
   blocked boolean NOT NULL DEFAULT false,
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now()
 )`,
 `CREATE TABLE IF NOT EXISTS p5_provider_qualification_reservations (
   idempotency_key text PRIMARY KEY,
   run_id text NOT NULL REFERENCES p5_provider_qualification_budgets(run_id),
   provider text NOT NULL,
   model text NOT NULL,
   request_hash text NOT NULL,
   reserved_microusd bigint NOT NULL CHECK(reserved_microusd>0),
   status text NOT NULL CHECK(status IN ('reserved','in_flight','consumed','released','unknown')),
   provider_request_id text,
   boundary_token text,
   created_at timestamptz NOT NULL DEFAULT now(),
   started_at timestamptz,
   settled_at timestamptz
 )`,
 `CREATE INDEX IF NOT EXISTS p5_provider_qualification_run_status ON p5_provider_qualification_reservations(run_id,status)`,
 `CREATE OR REPLACE FUNCTION p5_reserve_qualification_call(
   p_run_id text,p_idempotency_key text,p_provider text,p_model text,p_request_hash text,p_reserved_microusd bigint
 ) RETURNS TABLE(idempotency_key text,status text,reserved_microusd bigint) LANGUAGE plpgsql AS $$
 DECLARE inserted_key text;
 BEGIN
   RETURN QUERY SELECT r.idempotency_key,r.status,r.reserved_microusd
     FROM p5_provider_qualification_reservations r WHERE r.idempotency_key=p_idempotency_key;
   IF FOUND THEN RETURN; END IF;
   UPDATE p5_provider_qualification_budgets b
     SET committed_microusd=b.committed_microusd+p_reserved_microusd,updated_at=now()
     WHERE b.run_id=p_run_id AND NOT b.blocked
       AND b.committed_microusd+p_reserved_microusd<=b.allowance_microusd;
   IF NOT FOUND THEN RETURN; END IF;
   INSERT INTO p5_provider_qualification_reservations(
     idempotency_key,run_id,provider,model,request_hash,reserved_microusd,status
   ) VALUES(
     p_idempotency_key,p_run_id,p_provider,p_model,p_request_hash,p_reserved_microusd,'reserved'
   ) ON CONFLICT ON CONSTRAINT p5_provider_qualification_reservations_pkey DO NOTHING
     RETURNING p5_provider_qualification_reservations.idempotency_key INTO inserted_key;
   IF inserted_key IS NULL THEN RAISE EXCEPTION 'qualification reservation raced'; END IF;
   RETURN QUERY SELECT r.idempotency_key,r.status,r.reserved_microusd
     FROM p5_provider_qualification_reservations r WHERE r.idempotency_key=inserted_key;
 END $$`
];

export const dollarsToMicrousd=(value:string)=>{
 const amount=Number(value);
 if(!Number.isFinite(amount)||amount<=0||amount>1000)throw new Error('A positive documented qualification allowance is required.');
 return Math.round(amount*1_000_000);
};
export const qualificationRequestKey=(runId:string,provider:string,model:string,request:unknown)=>{
 const requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
 return {requestHash,idempotencyKey:createHash('sha256').update(JSON.stringify([runId,provider,model,requestHash])).digest('hex')};
};
export async function prepareQualificationBudget(runId:string,allowanceMicrousd:number,execute:Execute=query){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,120}$/.test(runId))throw new Error('Set a stable P5_LIVE_PRICING_RUN_ID before qualification.');
 for(const statement of TABLES)await execute(statement);
 await execute('ALTER TABLE p5_provider_qualification_budgets ADD COLUMN IF NOT EXISTS committed_microusd bigint NOT NULL DEFAULT 0 CHECK(committed_microusd>=0)');
 await execute('ALTER TABLE p5_provider_qualification_reservations ADD COLUMN IF NOT EXISTS boundary_token text');
 await execute(`INSERT INTO p5_provider_qualification_budgets(run_id,allowance_microusd) VALUES($1,$2)
   ON CONFLICT(run_id) DO UPDATE SET updated_at=now()
   WHERE p5_provider_qualification_budgets.allowance_microusd=EXCLUDED.allowance_microusd`,[runId,allowanceMicrousd]);
 const [budget]=await execute('SELECT allowance_microusd,blocked FROM p5_provider_qualification_budgets WHERE run_id=$1',[runId]);
 if(!budget||Number(budget.allowance_microusd)!==allowanceMicrousd)throw new Error('The documented allowance for this qualification run cannot change.');
 // A process can only leave in-flight after the network boundary was crossed.
 // On restart it becomes unknown and remains fully reserved for reconciliation.
 await execute(`WITH changed AS (
   UPDATE p5_provider_qualification_reservations SET status='unknown',settled_at=now()
   WHERE run_id=$1 AND status='in_flight' RETURNING 1
 ) UPDATE p5_provider_qualification_budgets SET blocked=true,updated_at=now()
   WHERE run_id=$1 AND EXISTS(SELECT 1 FROM changed)`,[runId]);
 const [blocked]=await execute(`SELECT b.blocked OR EXISTS(
   SELECT 1 FROM p5_provider_qualification_reservations r WHERE r.run_id=b.run_id AND r.status='unknown'
 ) AS blocked FROM p5_provider_qualification_budgets b WHERE b.run_id=$1`,[runId]);
 if(blocked?.blocked)throw new Error('Qualification stopped: a prior provider charge is unknown and requires reconciliation.');
}
export async function reserveQualificationCall(input:{runId:string;provider:string;model:string;requestHash:string;idempotencyKey:string;reservedMicrousd:number},execute:Execute=query):Promise<QualificationReservation>{
 let rows:Record<string,any>[];
 try{
   rows=await execute('SELECT * FROM p5_reserve_qualification_call($1,$2,$3,$4,$5,$6)',[input.runId,input.idempotencyKey,input.provider,input.model,input.requestHash,input.reservedMicrousd]);
 }catch(error){
   const [duplicate]=await execute('SELECT status FROM p5_provider_qualification_reservations WHERE idempotency_key=$1',[input.idempotencyKey]);
   if(duplicate)throw new Error(`Qualification stopped before provider contact: this stage is already ${duplicate.status}.`);
   throw error;
 }
 const row=rows[0];
 if(!row)throw new Error('Qualification stopped before provider contact: documented allowance is exhausted.');
 const [stored]=await execute('SELECT run_id,provider,model,request_hash,reserved_microusd,status FROM p5_provider_qualification_reservations WHERE idempotency_key=$1',[input.idempotencyKey]);
 if(!stored||stored.run_id!==input.runId||stored.provider!==input.provider||stored.model!==input.model||stored.request_hash!==input.requestHash||Number(stored.reserved_microusd)!==input.reservedMicrousd)throw new Error('Qualification stopped before provider contact: reservation identity does not match.');
 if(row.status!=='reserved')throw new Error(`Qualification stopped before provider contact: this stage is already ${row.status}.`);
 return {idempotencyKey:String(row.idempotency_key),status:row.status,reservedMicrousd:Number(row.reserved_microusd)};
}
export async function beginQualificationCall(idempotencyKey:string,execute:Execute=query){
 const boundaryToken=randomUUID();
 const rows=await execute(`UPDATE p5_provider_qualification_reservations SET status='in_flight',started_at=now(),boundary_token=$2
   WHERE idempotency_key=$1 AND status='reserved' RETURNING idempotency_key`,[idempotencyKey,boundaryToken]);
 if(rows.length!==1){
   const [stored]=await execute('SELECT status,boundary_token FROM p5_provider_qualification_reservations WHERE idempotency_key=$1',[idempotencyKey]);
   if(stored?.status!=='in_flight'||stored.boundary_token!==boundaryToken)throw new Error('Qualification reservation could not enter the provider boundary.');
 }
}
export async function settleQualificationCall(input:{idempotencyKey:string;provider:string;model:string;requestHash:string;providerRequestId:string},execute:Execute=query){
 if(!input.providerRequestId.trim())throw new Error('Qualification charge could not be settled without a provider request ID.');
 const rows=await execute(`UPDATE p5_provider_qualification_reservations SET status='consumed',provider_request_id=$2,settled_at=now()
   WHERE idempotency_key=$1 AND status='in_flight' AND provider=$3 AND model=$4 AND request_hash=$5 RETURNING idempotency_key`,
   [input.idempotencyKey,input.providerRequestId,input.provider,input.model,input.requestHash]);
 if(rows.length!==1){
   const [stored]=await execute('SELECT status,provider_request_id FROM p5_provider_qualification_reservations WHERE idempotency_key=$1',[input.idempotencyKey]);
   if(stored?.status!=='consumed'||stored.provider_request_id!==input.providerRequestId)throw new Error('Qualification charge could not be settled.');
 }
}
export async function markQualificationUnknown(runId:string,idempotencyKey:string,execute:Execute=query){
 await execute(`WITH changed AS (
   UPDATE p5_provider_qualification_reservations SET status='unknown',settled_at=now()
   WHERE idempotency_key=$2 AND status IN ('reserved','in_flight') RETURNING 1
 ) UPDATE p5_provider_qualification_budgets SET blocked=true,updated_at=now()
   WHERE run_id=$1 AND EXISTS(SELECT 1 FROM changed)`,[runId,idempotencyKey]);
}