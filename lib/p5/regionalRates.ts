import {query} from './database.ts';
import type {CostRule} from './costBook.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {rateLocation,reusableUnitRate} from './unitRates.ts';
export {rateLocation} from './unitRates.ts';
/** Estimated rate library is separate from the owner's verified/approved book.
 * Reuse requires current evidence AND the same locality; scope/unit compatibility
 * is independently checked by mapping and final audit, never keyword substitution.
 */
export async function readRegionalRates(location:string,now=new Date()):Promise<CostRule[]>{
  const rows=await query("SELECT DISTINCT ON (w.work_key) w.payload FROM p5_estimator_work w JOIN p5_estimator_drafts d ON d.id=w.draft_id WHERE w.work_key LIKE 'regional-rate-v3-%' AND d.brand=$1 AND w.payload->>'location'=$2 AND w.payload->>'expiresAt'>$3 ORDER BY w.work_key,w.updated_at DESC LIMIT 200",[ESTIMATOR_BRAND.id,rateLocation(location),now.toISOString()]);
  return rows.flatMap(r=>{try{const rate=reusableUnitRate(r.payload.rate,location,now);return rate?[rate]:[];}catch{return [];}});
}
export async function saveRegionalRates(draftId:string,location:string,rules:CostRule[],now=new Date()){
  for(const rule of rules){
    const rate=reusableUnitRate(rule,location,now);if(!rate)continue;
    await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[draftId,'regional-rate-v3-'+rate.id,JSON.stringify({location:rateLocation(location),expiresAt:rate.evidence.validUntil,rate,status:'estimated',createdFromDraft:draftId})]);
  }
}
