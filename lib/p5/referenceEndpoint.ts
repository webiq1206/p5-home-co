import {requireEstimatorAdmin} from "./adminAuth";
import {query} from "./database";
import {DraftError} from "./store";
import {protectRequest,limitedBody,json,failed} from "./http";
import {validateReferences,compareReference,validateComparisonLine,referenceDirectCostBudget,type ComparableSelection} from "./references.ts";
import {calculateP5Estimate} from "./pricing.ts";
import {ensureReviewSchema,currentReview} from "./manualReview";

async function schema(){
  await ensureReviewSchema();
  await query(`CREATE TABLE IF NOT EXISTS p5_estimator_reference_sets(version integer PRIMARY KEY,records jsonb NOT NULL,actor_id text NOT NULL,notes text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS p5_estimator_reference_checks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,review_id text NOT NULL,reference_version integer NOT NULL,selection jsonb NOT NULL,result jsonb NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
}
export async function getReferences(){try{
  await requireEstimatorAdmin();await schema();
  const [row]=await query("SELECT version,records,notes,created_at FROM p5_estimator_reference_sets ORDER BY version DESC LIMIT 1");
  return json(row||{version:0,records:[],notes:""});
}catch(e){return failed(e);}}
export async function putReferences(request:Request){try{
  protectRequest(request);const actor=await requireEstimatorAdmin();await schema();
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,8000000)));
  let records;try{records=validateReferences(body.references);}catch(e){throw new DraftError(e instanceof Error?e.message:"Invalid reference file.");}
  if(!Number.isInteger(body.version)||body.version<0||typeof body.notes!=="string"||body.notes.trim().length<30||body.notes.length>4000)throw new DraftError("Document the source review and provide its current version.");
  const rows=await query(`INSERT INTO p5_estimator_reference_sets(version,records,actor_id,notes)
    SELECT $1+1,$2::jsonb,$3,$4 WHERE COALESCE((SELECT MAX(version) FROM p5_estimator_reference_sets),0)=$1
    ON CONFLICT DO NOTHING RETURNING version`,[body.version,JSON.stringify(records),actor.id,body.notes.trim()]);
  if(!rows.length)throw new DraftError("The reference book changed. Reload before importing.",409);
  return json({version:rows[0].version,count:records.length});
}catch(e){return failed(e);}}
export async function postReferenceCheck(request:Request){try{
  protectRequest(request);const actor=await requireEstimatorAdmin();await schema();
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,16000)));
  const [set]=await query("SELECT version,records FROM p5_estimator_reference_sets ORDER BY version DESC LIMIT 1");
  if(!set||set.version!==body.referenceVersion)throw new DraftError("Reload the latest pricing references.",409);
  const {review}=await currentReview(body.reviewId);
  const selection=body.selection as ComparableSelection;
  const reference=validateReferences(set.records).find(r=>r.id===selection?.referenceId);
  if(!reference)throw new DraftError("Choose a saved reference.");
  const estimate=calculateP5Estimate(review.input,review.finance);
  const line=estimate.lines.find(l=>l.id===selection.costLineId);
  if(!line)throw new DraftError("Choose a cost line from the saved review.");
  const customerLinePrice=line.sellingAmount;
  let result;try{validateComparisonLine(selection,line);result={...compareReference(reference,selection,customerLinePrice),directCostBudget:referenceDirectCostBudget(selection.adjustedCustomerUnitPrice,estimate.allocations.total,estimate.targetOperatingProfit,estimate.contingencyRate),reviewedDirectUnitCost:line.unitCost};}catch(e){throw new DraftError(e instanceof Error?e.message:"Invalid comparison.");}
  await query("INSERT INTO p5_estimator_reference_checks(draft_id,review_id,reference_version,selection,result,actor_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)",[review.draft_id,review.id,set.version,JSON.stringify(selection),JSON.stringify(result),actor.id]);
  return json(result);
}catch(e){return failed(e);}}
