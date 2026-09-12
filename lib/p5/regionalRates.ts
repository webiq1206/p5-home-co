import {createHash} from 'node:crypto';
import {query} from './database';
import type {CostRule} from './costBook';
export const rateLocation=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ')||'boise / treasure valley, idaho';
/** Estimated rate library is separate from the owner's verified/approved book.
 * Reuse requires current evidence AND the same locality; scope/unit compatibility
 * is independently checked by mapping and final audit, never keyword substitution.
 */
export async function readRegionalRates(location:string,now=new Date()):Promise<CostRule[]>{
  const rows=await query("SELECT DISTINCT ON (work_key) payload FROM p5_estimator_work WHERE work_key LIKE 'regional-rate-v1-%' AND payload->>'location'=$1 AND (payload->>'expiresAt')::timestamptz>$2::timestamptz ORDER BY work_key,updated_at DESC",[rateLocation(location),now.toISOString()]);
  return rows.map(r=>r.payload.rate as CostRule);
}
export async function saveRegionalRates(draftId:string,location:string,rules:CostRule[]){
  for(const rule of rules){
    if(rule.estimatingBasis!=='sourced-market-average'||!rule.evidence.provenance?.sources.length)continue;
    const identity=createHash('sha256').update(JSON.stringify([rateLocation(location),rule.description,rule.unit,rule.category,rule.evidence.provenance.sources])).digest('hex');
    const rate={...rule,id:'regional-'+identity,quantity:{fixed:1,factor:1},building:undefined,floor:undefined,scopeTaskId:undefined};
    await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[draftId,'regional-rate-v1-'+identity,JSON.stringify({location:rateLocation(location),expiresAt:rule.evidence.validUntil,rate,status:'estimated',createdFromDraft:draftId})]);
  }
}
