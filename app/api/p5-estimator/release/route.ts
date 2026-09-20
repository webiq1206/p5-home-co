import {ESTIMATOR_VERSION,estimatorRelease} from '@/lib/p5/version';
import {query} from '@/lib/p5/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Counts only: which pricing data this deployment's own database holds. No rates, amounts or names. */
async function policySummary(){
  try{
    const [row]=await query("SELECT version,updated_at,payload FROM p5_estimator_policy WHERE id='current'");
    if(!row)return {present:false};
    const payload=row.payload||{};
    return {present:true,version:row.version,updatedAt:row.updated_at,planningRates:Array.isArray(payload.planningCatalog?.rates)?payload.planningCatalog.rates.length:0,planningVersion:payload.planningCatalog?.version||null,costBooks:(payload.costBooks||[]).map((book:{service?:string;mode?:string;rules?:unknown[]})=>`${book.service}:${book.mode||'rules'}:${(book.rules||[]).length}`)};
  }catch{return {present:null};}
}
export async function GET(){return Response.json({version:ESTIMATOR_VERSION,...estimatorRelease(),policy:await policySummary()},{headers:{'cache-control':'no-store'}});}
