import {createHash,randomUUID} from "node:crypto";
import {query} from "./database";
import {DraftError,ensureSchema} from "./store";
import {EMPTY_CONFIGURATION} from "./costBook";
import {calculateP5Estimate,customerEstimate,type PricingInput,type OwnerApproval} from "./pricing.ts";
import {adminRecipients} from "./deliveryAdapter";
import {ESTIMATOR_BRAND as brand} from "./brand";

type Actor={id:string;email:string};
export async function ensureReviewSchema(){
  await ensureSchema();
  await query(`CREATE TABLE IF NOT EXISTS p5_estimator_reviews (id text PRIMARY KEY,draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id),source_revision integer NOT NULL,input jsonb NOT NULL,finance jsonb NOT NULL,notes text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS p5_estimator_approvals(id uuid PRIMARY KEY,revision text NOT NULL,owner text NOT NULL,actor_id text NOT NULL,reason text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),UNIQUE(revision,owner))`);
  await query(`CREATE TABLE IF NOT EXISTS p5_estimator_history(draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id),revision integer NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(draft_id,revision))`);
  await query(`CREATE TABLE IF NOT EXISTS p5_estimator_delivery_reviews(id uuid PRIMARY KEY,delivery_id uuid NOT NULL REFERENCES p5_estimator_outbox(id),actor_id text NOT NULL,decision text NOT NULL,evidence text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
}
function canonical(value:any):any {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));return value;}
function fingerprint(id:string,revision:number,input:PricingInput,finance:unknown,notes:string){return createHash("sha256").update(JSON.stringify(canonical({id,revision,input:{...input,revision:undefined},finance,notes}))).digest("hex");}
async function approvalsFor(revision:string):Promise<OwnerApproval[]>{
  return (await query("SELECT id,owner,reason,approved_at FROM p5_estimator_approvals WHERE revision=$1",[revision])).map(a=>({owner:a.owner,recordId:a.id,writtenReason:a.reason,approvedAt:new Date(a.approved_at).toISOString(),estimateRevision:revision}));
}
function calculate(input:PricingInput,finance:any,approvals:OwnerApproval[]){try{return calculateP5Estimate(input,finance,approvals);}catch(e){throw new DraftError(e instanceof Error?e.message:"Invalid direct-cost review.");}}
export async function saveManualReview(body:any,actor:Actor){
  await ensureReviewSchema();
  const [draft]=await query("SELECT * FROM p5_estimator_drafts WHERE id=$1",[body.id]);
  if(!draft)throw new DraftError("Project not found.",404);
  if(body.expectedRevision!==draft.revision)throw new DraftError("This project changed. Reload its latest revision before reviewing.",409);
  if(typeof body.notes!=="string"||body.notes.trim().length<20||body.notes.length>12000)throw new DraftError("Document your scope, upload, allowance, exclusion and risk review.");
  if(!(brand.services as readonly string[]).includes(body.input?.service))throw new DraftError("Choose a service offered by this company.");
  const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
  const finance=policy?.payload?.finance||EMPTY_CONFIGURATION.finance;
  const input={...body.input} as PricingInput;
  const declaredUrgency=draft.payload.answers?.urgency;
  if(declaredUrgency==="emergency"||declaredUrgency==="priority"&&input.urgency!=="emergency")input.urgency=declaredUrgency;
  const id=fingerprint(draft.id,draft.revision,input,finance,body.notes.trim());input.revision=id;
  const estimate=calculate(input,finance,await approvalsFor(id));
  await query("INSERT INTO p5_estimator_reviews(id,draft_id,source_revision,input,finance,notes,actor_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) ON CONFLICT(id) DO NOTHING",[id,draft.id,draft.revision,JSON.stringify(input),JSON.stringify(finance),body.notes.trim(),actor.id]);
  return {reviewId:id,estimate};
}
async function currentReview(id:string){
  const [review]=await query("SELECT * FROM p5_estimator_reviews WHERE id=$1",[id]);if(!review)throw new DraftError("Saved review not found.",404);
  const [draft]=await query("SELECT * FROM p5_estimator_drafts WHERE id=$1",[review.draft_id]);
  const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
  const finance=policy?.payload?.finance||EMPTY_CONFIGURATION.finance;
  if(!draft||draft.revision!==review.source_revision||fingerprint(draft.id,draft.revision,review.input,finance,review.notes)!==review.id)throw new DraftError("The project or financial forecast changed. Save and approve a new review.",409);
  return {review,draft,finance};
}
export async function approveManualReview(body:any,actor:Actor){
  await ensureReviewSchema();const {review,finance}=await currentReview(body.reviewId);
  const email=actor.email.toLowerCase();
  const nick=process.env.P5_OWNER_NICK_EMAIL?.toLowerCase(),jared=process.env.P5_OWNER_JARED_EMAIL?.toLowerCase();
  if(!nick||!jared||nick===jared)throw new DraftError("Two distinct authenticated owner accounts must be configured.",409);
  const owner=email===nick?"Nick":email===jared?"Jared":null;
  if(!owner)throw new DraftError("Only a configured owner can record this approval.",403);
  if(!["strategic-value","low-risk","repeatable-scope","supplier-pricing","pipeline-benefit"].includes(body.exception)||typeof body.reason!=="string"||body.reason.trim().length<30||body.reason.length>4000)throw new DraftError("Document a permitted exception with supporting evidence. Competitive pressure alone is insufficient.");
  await query("INSERT INTO p5_estimator_approvals(id,revision,owner,actor_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(revision,owner) DO NOTHING",[randomUUID(),review.id,owner,actor.id,`${body.exception}: ${body.reason.trim()}`]);
  return {reviewId:review.id,estimate:calculate(review.input,finance,await approvalsFor(review.id))};
}
export async function publishManualReview(body:any,actor:Actor){
  await ensureReviewSchema();const {review,draft,finance}=await currentReview(body.reviewId);
  if(body.confirmed!==true)throw new DraftError("Confirm the reviewed costs, uploads, allowances, exclusions and warning dispositions before publication.");
  const estimate=calculate(review.input,finance,await approvalsFor(review.id));
  if(!estimate.publishable)throw new DraftError("Resolve all blocking pricing warnings and required owner approvals before publication.",409);
  const contact=draft.payload.contact;
  if(!contact?.name?.trim()||!/^\S+@\S+\.\S+$/.test(contact.email||""))throw new DraftError("A valid customer contact is required before publication.");
  const uploads=await query("SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 ORDER BY created_at",[draft.id]);
  const scope=draft.payload.reviewed||{text:draft.payload.text,answers:draft.payload.answers,extraction:draft.payload.extraction,uploads};
  const customer=customerEstimate(estimate,review.input.scopeSummary);
  const internal={...estimate,scope,contact,manualReview:{id:review.id,input:review.input,notes:review.notes,reviewedBy:review.actor_id,publishedBy:actor.id,publishedAt:new Date().toISOString()}};
  const revision=draft.revision+1;
  const record={draftId:draft.id,revision,brand:brand.name,estimator:"p5-policy",contact,scope,internal,customer};
  const recipients=await adminRecipients();if(!recipients.length)throw new DraftError("No estimate administrator is configured.",503);
  // An existing CRM acknowledgement must be reconciled as an update until its
  // upstream update/idempotency contract is verified. Never create a second lead.
  const [priorCrm]=await query("SELECT status,provider_id FROM p5_estimator_outbox WHERE draft_id=$1 AND destination='crm' ORDER BY revision DESC LIMIT 1",[draft.id]);
  const jobs=[...recipients.map(email=>({id:randomUUID(),destination:`admin:${email}`,payload:record,status:"pending"})),{id:randomUUID(),destination:`customer:${contact.email}`,payload:record,status:"pending"},{id:randomUUID(),destination:"crm",payload:record,status:priorCrm?"needs-review":"pending"}];
  const rows=await query(`WITH accepted AS (
    UPDATE p5_estimator_drafts SET revision=revision+1,status='submitted',submitted_at=now(),updated_at=now(),internal_estimate=$1::jsonb,customer_estimate=$2::jsonb
    WHERE id=$3 AND revision=$4 AND NOT EXISTS(SELECT 1 FROM p5_estimator_outbox WHERE draft_id=$3 AND status='sending') AND COALESCE((SELECT payload->'finance' FROM p5_estimator_policy WHERE id='current'),$9::jsonb)=$8::jsonb RETURNING id
  ), superseded AS (
    UPDATE p5_estimator_outbox SET status='superseded',last_error='A newer reviewed result replaces this undelivered revision.' WHERE draft_id IN (SELECT id FROM accepted) AND revision<$6 AND status IN ('pending','retry')
  ), history AS (
    INSERT INTO p5_estimator_history(draft_id,revision,record) SELECT id,$4,$5::jsonb FROM accepted ON CONFLICT DO NOTHING
  ), queued AS (
    INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload,status,last_error)
    SELECT j.id::uuid,a.id,$6,j.destination,j.payload,j.status,CASE WHEN j.status='needs-review' THEN 'Update the linked CRM record and reconcile its acknowledgement; do not create another lead.' ELSE NULL END
    FROM accepted a CROSS JOIN jsonb_to_recordset($7::jsonb) AS j(id text,destination text,payload jsonb,status text)
    ON CONFLICT(draft_id,revision,destination) DO NOTHING
  ) SELECT id FROM accepted`,[JSON.stringify(internal),JSON.stringify(customer),draft.id,draft.revision,JSON.stringify({payload:draft.payload,internal:draft.internal_estimate,customer:draft.customer_estimate}),revision,JSON.stringify(jobs),JSON.stringify(finance),JSON.stringify(EMPTY_CONFIGURATION.finance)]);
  if(!rows.length)throw new DraftError("Another review was published first. Reload the saved project.",409);
  return {published:true,revision,result:customer,crmNeedsReview:Boolean(priorCrm)};
}
export async function reconcileDelivery(body:any,actor:Actor){
  await ensureReviewSchema();
  if(typeof body.evidence!=="string"||body.evidence.trim().length<30||body.evidence.length>8000)throw new DraftError("Record the provider lookup, outcome and supporting evidence before reconciliation.");
  if(!["confirmed-sent","confirmed-not-sent"].includes(body.decision))throw new DraftError("Choose the verified provider outcome.");
  if(body.decision==="confirmed-sent"&&(typeof body.providerId!=="string"||!body.providerId.trim()||body.providerId.length>500))throw new DraftError("Enter the confirmed email or CRM record identifier.");
  const [row]=await query("SELECT * FROM p5_estimator_outbox WHERE id=$1",[body.deliveryId]);
  if(!row||row.status!=="needs-review")throw new DraftError("This delivery is not awaiting reconciliation. Reload its status.",409);
  if(row.destination==="crm"&&body.decision==="confirmed-not-sent"){
    const [linked]=await query("SELECT id FROM p5_estimator_outbox WHERE draft_id=$1 AND destination='crm' AND status='sent' LIMIT 1",[row.draft_id]);
    if(linked)throw new DraftError("A CRM lead already exists. Update that record and confirm its identifier instead of creating a duplicate.",409);
  }
  const status=body.decision==="confirmed-sent"?"sent":"pending";
  const rows=await query(`WITH changed AS (
    UPDATE p5_estimator_outbox SET status=$1,provider_id=$2,last_error=NULL,locked_until=NULL,next_attempt_at=now(),sent_at=CASE WHEN $1='sent' THEN now() ELSE NULL END WHERE id=$3 AND status='needs-review' RETURNING id
  ) INSERT INTO p5_estimator_delivery_reviews(id,delivery_id,actor_id,decision,evidence) SELECT $4,id,$5,$6,$7 FROM changed RETURNING id`,[status,body.decision==="confirmed-sent"?body.providerId.trim():null,row.id,randomUUID(),actor.id,body.decision,body.evidence.trim()]);
  if(!rows.length)throw new DraftError("Delivery status changed. Reload before reconciling.",409);
  return {saved:true,status};
}
