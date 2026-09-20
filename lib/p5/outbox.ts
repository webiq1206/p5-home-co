import {estimateEmail} from './estimateEmail.ts';
import { randomUUID,createHash } from "node:crypto";
import { query } from "./database.ts";
import { ensureSchema } from "./store.ts";
import { adminRecipients,sendEmail,syncCrm,EMAIL_SUPPORTS_IDEMPOTENCY } from "./deliveryAdapter.ts";
import { customerPdf,administrativePdf,pdfFilename } from "./pdf.ts";
import { ESTIMATOR_BRAND as brand } from "./brand.ts";
export function deliveryRetryDecision(destination:string,emailIdempotent:boolean,attempts:number,createdAt:Date,now=Date.now()){
  const canRetry=destination!=="crm"&&emailIdempotent&&now-createdAt.getTime()<23*3600000&&attempts<6;
  return canRetry?"retry":"needs-review";
}
export async function enqueueSubmission(id:string,revision:number,record:any){
  const recipients=await adminRecipients();if(!recipients.length)throw new Error("No estimate administrator is configured");
  const jobs=[...recipients.map(email=>({id:randomUUID(),destination:`admin:${email}`,payload:record})),
    {id:randomUUID(),destination:`customer:${record.contact.email}`,payload:record},
    {id:randomUUID(),destination:"crm",payload:record}];
  const rows=await query(`WITH accepted AS (
    UPDATE p5_estimator_drafts SET status='submitted',submitted_at=now(),internal_estimate=$1::jsonb,customer_estimate=$2::jsonb
    WHERE id=$3 AND revision=$4 AND status='draft' RETURNING id
  ), queued AS (
    INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload)
    SELECT j.id::uuid,a.id,$4,j.destination,j.payload FROM accepted a CROSS JOIN jsonb_to_recordset($5::jsonb) AS j(id text,destination text,payload jsonb)
    ON CONFLICT(draft_id,revision,destination) DO NOTHING RETURNING id
  ) SELECT id FROM accepted`,[JSON.stringify(record.internal),JSON.stringify(record.customer),id,revision,JSON.stringify(jobs)]);
  return rows.length>0;
}
export async function deliveryStatus(id:string){
  return (await query("SELECT destination,status,attempts,last_error,provider_id FROM p5_estimator_outbox WHERE draft_id=$1 AND revision=(SELECT revision FROM p5_estimator_drafts WHERE id=$1) ORDER BY created_at",[id])).map(row=>({channel:String(row.destination).split(":")[0],status:row.status}));
}
export async function processOutbox(options:{draftId?:string;revision?:number;limit?:number}={}){
  await ensureSchema();const limit=Math.min(30,Math.max(1,options.limit||10));
  const rows=await query(`WITH due AS (
    SELECT id FROM p5_estimator_outbox WHERE status IN ('pending','retry') AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now()) AND ($1::uuid IS NULL OR draft_id=$1::uuid) AND ($3::integer IS NULL OR revision=$3::integer)
    ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED
  ) UPDATE p5_estimator_outbox SET status='sending',attempts=attempts+1,locked_until=now()+interval '4 minutes'
    WHERE id IN (SELECT id FROM due) RETURNING *`,[options.draftId||null,limit,options.revision??null]);
  const results:Record<string,string>[]=[];
  for(const row of rows){
    const record=row.payload;const destination=String(row.destination);
    const key=`p5-${row.draft_id}-${row.revision}-${createHash("sha256").update(destination).digest("hex").slice(0,20)}`;
    try{
      let providerId:string;
      if(destination==="crm")providerId=await syncCrm(record,key);
      else {
        const [kind,...address]=destination.split(":");const admin=kind==="admin";const alert=kind==="alert";
        const attachments=alert?[]:[{filename:pdfFilename(row.draft_id,admin?"administrative":"customer"),content:admin?await administrativePdf(row.draft_id,{...record.internal,contact:record.contact,brand:record.brand,estimator:record.estimator}):await customerPdf(row.draft_id,record.customer)}];
        const formatted=alert?{text:`Estimate ${row.draft_id} needs delivery review. ${record.error}\nOpen https://${brand.domain}/admin/p5-estimators to inspect the saved record. Do not resubmit the lead to retry delivery.`,html:undefined}:estimateEmail(row.draft_id,record,admin);
        providerId=await sendEmail({to:address.join(":"),subject:alert?`${brand.name}: estimate delivery needs attention (ref ${String(row.draft_id).slice(0,8)})`:admin?`${brand.name}: internal estimate record (ref ${String(row.draft_id).slice(0,8)})`:`Your ${brand.name} project estimate (ref ${String(row.draft_id).slice(0,8)})`,...formatted,attachments,key});
      }
      await query("UPDATE p5_estimator_outbox SET status='sent',provider_id=$1,sent_at=now(),locked_until=NULL,last_error=NULL WHERE id=$2 AND status='sending'",[providerId,row.id]);
      results.push({id:row.id,status:"sent"});
    }catch(error){
      const message=error instanceof Error?error.message:"Delivery failed";
      // CRM has no verified durable idempotency contract. Ambiguous acknowledgments
      // require reconciliation, not a second potentially duplicate lead.
      const status=deliveryRetryDecision(destination,EMAIL_SUPPORTS_IDEMPOTENCY,row.attempts,new Date(row.created_at));
      // The reason is otherwise visible only in the database. Addresses are reduced to the channel name.
      console.error(`[p5-delivery] ${destination.split(':')[0]} ${status} for draft ${row.draft_id} revision ${row.revision} (attempt ${row.attempts}): ${message.slice(0,200)}`);
      await query("UPDATE p5_estimator_outbox SET status=$1,last_error=$2,locked_until=NULL,next_attempt_at=now()+($3*interval '1 second') WHERE id=$4",[status,message.slice(0,500),Math.min(3600,60*2**row.attempts),row.id]);
      if(!destination.startsWith("alert:"))for(const email of await adminRecipients())await query("INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(draft_id,revision,destination) DO NOTHING",[randomUUID(),row.draft_id,row.revision,`alert:${email}`,JSON.stringify({error:message,failedDestination:destination})]);
      results.push({id:row.id,status});
    }
  }
  // A worker that died after a send is ambiguous. Resend's key permits a safe
  // retry within 23 hours; CRM/SMTP must be reconciled by an administrator.
  const interrupted=await query("SELECT id FROM p5_estimator_outbox WHERE status='sending' AND locked_until<now() AND ($1::uuid IS NULL OR draft_id=$1::uuid) AND ($2::integer IS NULL OR revision=$2::integer) LIMIT 1",[options.draftId||null,options.revision??null]);
  if(interrupted.length){
    // Queue the notification in the same statement as recovery: a worker must
    // not leave an ambiguous delivery in review without notifying staff.
    const recipients=await adminRecipients();
    if(!recipients.length)throw new Error("No administrator is configured for interrupted delivery alerts");
    await query(`WITH recovered AS (
      UPDATE p5_estimator_outbox SET status=CASE WHEN destination<>'crm' AND $1::boolean AND attempts<6 AND created_at>now()-interval '23 hours' THEN 'retry' ELSE 'needs-review' END,
        locked_until=NULL,last_error='Delivery worker interrupted; acknowledgement requires reconciliation'
      WHERE status='sending' AND locked_until<now() AND ($3::uuid IS NULL OR draft_id=$3::uuid) AND ($4::integer IS NULL OR revision=$4::integer) RETURNING id,draft_id,revision,destination
    ) INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload)
      SELECT gen_random_uuid(),r.draft_id,r.revision,'alert:'||a.email,
        jsonb_build_object('error','Delivery worker interrupted; inspect and reconcile the saved delivery record.','failedDestination',r.destination)
      FROM recovered r CROSS JOIN jsonb_array_elements_text($2::jsonb) a(email)
      WHERE r.destination NOT LIKE 'alert:%'
      ON CONFLICT(draft_id,revision,destination) DO NOTHING`,[EMAIL_SUPPORTS_IDEMPOTENCY,JSON.stringify(recipients),options.draftId||null,options.revision??null]);
  }
  return results;
}
