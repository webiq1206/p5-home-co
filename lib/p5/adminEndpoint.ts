import {timingSafeEqual} from "node:crypto";
import {requireEstimatorAdmin} from "./adminAuth";
import {query} from "./database";
import {ensureSchema,DraftError} from "./store";
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from "./costBook";
import {companyAllocation,SERVICE_MATRIX,COST_CATEGORIES} from "./pricing.ts";
import {processOutbox} from "./outbox";
import {ensureReviewSchema,saveManualReview,approveManualReview,publishManualReview,reconcileDelivery} from "./manualReview";
import {administrativePdf,customerPdf,pdfFilename} from "./pdf";
import {protectRequest,limitedBody,json,failed} from "./http";
function validId(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new DraftError("Invalid record id.");return id;}
export async function getAdminEstimates(request:Request){try{
  await requireEstimatorAdmin();await ensureReviewSchema();const url=new URL(request.url);const id=url.searchParams.get("id");
  if(id){const [row]=await query("SELECT id,brand,revision,status,payload,internal_estimate,customer_estimate,updated_at FROM p5_estimator_drafts WHERE id=$1",[validId(id)]);
    if(!row)throw new DraftError("Estimate not found.",404);
    if(url.searchParams.get("pdf")){const customer=url.searchParams.get("pdf")==="customer";
      if(customer&&!row.customer_estimate)throw new DraftError("This draft has no submitted customer summary yet.",409);
      const data=customer?await customerPdf(id,row.customer_estimate):await administrativePdf(id,{...row.internal_estimate,contact:row.payload.contact,scope:row.internal_estimate?.scope||row.payload});
      return new Response(data as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${pdfFilename(id,customer?"customer":"administrative")}"`,"Cache-Control":"no-store"}});}
    const uploads=await query("SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1",[id]);
    const deliveries=await query("SELECT id,destination,status,attempts,provider_id,last_error,created_at,sent_at FROM p5_estimator_outbox WHERE draft_id=$1",[id]);const reviews=await query("SELECT id,source_revision,input,notes,actor_id,created_at FROM p5_estimator_reviews WHERE draft_id=$1 ORDER BY created_at DESC",[id]);const history=await query("SELECT revision,record,created_at FROM p5_estimator_history WHERE draft_id=$1 ORDER BY revision DESC",[id]);const reconciliation=await query("SELECT r.* FROM p5_estimator_delivery_reviews r JOIN p5_estimator_outbox o ON r.delivery_id=o.id WHERE o.draft_id=$1 ORDER BY r.created_at",[id]);return json({estimate:row,uploads,deliveries,reviews,history,reconciliation});}
  const [policy]=await query("SELECT payload,version,updated_by,updated_at FROM p5_estimator_policy WHERE id='current'");
  const drafts=await query("SELECT id,brand,status,revision,payload->'contact' AS contact,payload->'answers'->>'service' AS service,updated_at FROM p5_estimator_drafts ORDER BY updated_at DESC LIMIT 100");
  const delivery=await query("SELECT status,count(*)::integer AS count FROM p5_estimator_outbox GROUP BY status");
  const configuration=policy?.payload||EMPTY_CONFIGURATION;
  return json({configuration,version:policy?.version||0,allocation:companyAllocation(configuration.finance),drafts,delivery,serviceMatrix:SERVICE_MATRIX});
}catch(error){return failed(error);}}
export function validateConfiguration(raw:any):EstimatorConfiguration{
  if(!raw?.finance||!Array.isArray(raw.costBooks)||raw.costBooks.length>30)throw new DraftError("Invalid estimator configuration.");
  const f=raw.finance;
  if(typeof f.annualOverhead!=="number"||!Number.isFinite(f.annualOverhead)||f.annualOverhead<420000)throw new DraftError("The official annual overhead budget is at least $420,000.");
  if(f.annualRevenue!==null&&(typeof f.annualRevenue!=="number"||!Number.isFinite(f.annualRevenue)||f.annualRevenue<=0))throw new DraftError("Enter a positive conservative annual revenue forecast.");
  if(typeof f.forecastSource!=="string"||f.forecastSource.length>4000)throw new DraftError("Document the forecast source.");
  const services=new Set();
  for(const book of raw.costBooks){
    if(!Object.hasOwn(SERVICE_MATRIX,book.service)||services.has(book.service)||!Array.isArray(book.rules)||book.rules.length>1000||!Array.isArray(book.coverage)||!Array.isArray(book.assumptions)||!Array.isArray(book.exclusions)||typeof book.verifiedScope!=="string"||!book.verifiedScope.trim())throw new DraftError("Each cost book needs a unique service, rules, coverage, assumptions, exclusions and verified scope.");
    services.add(book.service);const ids=new Set();
    for(const rule of book.rules){if(typeof rule.id!=="string"||!rule.id.trim()||ids.has(rule.id)||!(COST_CATEGORIES as readonly string[]).includes(rule.category)||!rule.evidence||typeof rule.quantity?.factor!=="number"||!Number.isFinite(rule.quantity.factor)||rule.quantity.factor<=0||typeof rule.unitCost!=="number"||!Number.isFinite(rule.unitCost)||rule.unitCost<=0)throw new DraftError("Invalid or duplicate cost-book rule.");ids.add(rule.id);}
  }
  return raw as EstimatorConfiguration;
}
export async function putAdminPolicy(request:Request){try{
  protectRequest(request);const actor=await requireEstimatorAdmin();await ensureSchema();
  const raw=JSON.parse(new TextDecoder().decode(await limitedBody(request,2000000)));const configuration=validateConfiguration(raw.configuration);
  if(!Number.isInteger(raw.version)||raw.version<0)throw new DraftError("Configuration version is required.");
  configuration.finance.reviewedAt=new Date().toISOString();configuration.finance.approvedBy=[actor.email];
  const rows=await query(`INSERT INTO p5_estimator_policy(id,payload,updated_by) SELECT 'current',$1::jsonb,$2 WHERE $3=0
    ON CONFLICT DO NOTHING RETURNING version`,[JSON.stringify(configuration),actor.id,raw.version]);
  if(!rows.length){const updated=await query("UPDATE p5_estimator_policy SET payload=$1::jsonb,updated_by=$2,updated_at=now(),version=version+1 WHERE id='current' AND version=$3 RETURNING version",[JSON.stringify(configuration),actor.id,raw.version]);if(!updated.length)throw new DraftError("Configuration changed. Reload before saving.",409);}
  return json({saved:true});
}catch(error){return failed(error);}}
export async function postAdminAction(request:Request){try{
  protectRequest(request);const actor=await requireEstimatorAdmin();await ensureSchema();const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,2000000)));
  if(body.action==="process-delivery")return json({results:await processOutbox({draftId:body.id?validId(body.id):undefined})});
  if(body.action==="save-review")return json(await saveManualReview({...body,id:validId(body.id)},actor));
  if(body.action==="approve-review")return json(await approveManualReview(body,actor));
  if(body.action==="publish-review"){
    const result=await publishManualReview(body,actor);
    await processOutbox({limit:12}).catch(()=>undefined);
    return json(result);
  }
  if(body.action==="reconcile-delivery")return json(await reconcileDelivery({...body,deliveryId:validId(body.deliveryId)},actor));
  throw new DraftError("Unknown administrator action.");
}catch(error){return failed(error);}}
export async function getAdminUpload(request:Request){try{
  await requireEstimatorAdmin();await ensureSchema();const id=validId(new URL(request.url).searchParams.get("id")||"");
  const [file]=await query("SELECT name,mime_type,data_base64 FROM p5_estimator_files WHERE id=$1",[id]);if(!file)throw new DraftError("File not found.",404);
  return new Response(Buffer.from(file.data_base64,"base64") as BodyInit,{headers:{"Content-Type":file.mime_type,"Content-Disposition":`attachment; filename="${String(file.name).replace(/[^a-zA-Z0-9._-]/g,"_")}"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}catch(error){return failed(error);}}
export async function runDeliveryCron(request:Request){try{
  const expected=process.env.CRON_SECRET;if(!expected)throw new DraftError("Delivery scheduler is not configured.",503);
  const supplied=request.headers.get("authorization")||"";const a=Buffer.from(supplied);const b=Buffer.from(`Bearer ${expected}`);if(a.length!==b.length||!timingSafeEqual(a,b))throw new DraftError("Unauthorized",401);
  return json({results:await processOutbox({limit:30})});
}catch(error){return failed(error);}}
