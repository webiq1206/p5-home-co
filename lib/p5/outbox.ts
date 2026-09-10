import { randomUUID,createHash } from "node:crypto";
import { query } from "./database";
import { ensureSchema } from "./store";
import { adminRecipients,sendEmail,syncCrm,EMAIL_SUPPORTS_IDEMPOTENCY } from "./deliveryAdapter";
import { customerPdf,administrativePdf,pdfFilename } from "./pdf";
import { ESTIMATOR_BRAND as brand } from "./brand";
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
  return (await query("SELECT destination,status,attempts,last_error,provider_id FROM p5_estimator_outbox WHERE draft_id=$1 ORDER BY created_at",[id])).map(row=>({channel:String(row.destination).split(":")[0],status:row.status}));
}
export async function processOutbox(options:{draftId?:string;limit?:number}={}){
  await ensureSchema();const limit=Math.min(30,Math.max(1,options.limit||10));
  const rows=await query(`WITH due AS (
    SELECT id FROM p5_estimator_outbox WHERE status IN ('pending','retry') AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now()) AND ($1::uuid IS NULL OR draft_id=$1::uuid)
    ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED
  ) UPDATE p5_estimator_outbox SET status='sending',attempts=attempts+1,locked_until=now()+interval '4 minutes'
    WHERE id IN (SELECT id FROM due) RETURNING *`,[options.draftId||null,limit]);
  const results:Record<string,string>[]=[];
  for(const row of rows){
    const record=row.payload;const destination=String(row.destination);
    const key=`p5-${row.draft_id}-${row.revision}-${createHash("sha256").update(destination).digest("hex").slice(0,20)}`;
    try{
      let providerId:string;
      if(destination==="crm")providerId=await syncCrm(record,key);
      else {
        const [kind,...address]=destination.split(":");const admin=kind==="admin";const alert=kind==="alert";
        const attachments=alert?[]:[{filename:pdfFilename(row.draft_id,admin?"administrative":"customer"),content:admin?await administrativePdf(row.draft_id,record.internal):await customerPdf(row.draft_id,record.customer)}];
        const range=record.customer?.range;
        const text=alert?`Estimate ${row.draft_id} needs delivery review. ${record.error}\nOpen https://${brand.domain}/admin/p5-estimators to inspect the saved record. Do not resubmit the lead to retry delivery.`:
          `${brand.name}\n${admin?"Confidential internal estimate record":"Your preliminary project summary"}\nReference: ${row.draft_id}\n\n${range?`Planning range: $${range.low.toLocaleString("en-US")} to $${range.high.toLocaleString("en-US")}`:"Scope received for pricing review"}\n\n${record.customer.summary}\n\n${record.customer.message}\n${record.customer.nextStep}\n\n${record.customer.disclaimer}\n\n${brand.phone}\nhttps://${brand.domain}${brand.consultationPath}\n\n${admin?"The attached administrative PDF contains the complete internal breakdown, sources and pricing warnings. Do not send it to the customer.":"Your project summary is attached as a PDF."}`;
        providerId=await sendEmail({to:address.join(":"),subject:`${brand.name}: ${alert?"estimate delivery needs attention":admin?"internal estimate record":"your project planning summary"} ${String(row.draft_id).slice(0,8)}`,text,attachments,key});
      }
      await query("UPDATE p5_estimator_outbox SET status='sent',provider_id=$1,sent_at=now(),locked_until=NULL,last_error=NULL WHERE id=$2 AND status='sending'",[providerId,row.id]);
      results.push({id:row.id,status:"sent"});
    }catch(error){
      const message=error instanceof Error?error.message:"Delivery failed";
      // CRM has no verified durable idempotency contract. Ambiguous acknowledgments
      // require reconciliation, not a second potentially duplicate lead.
      const canRetry=destination!=="crm"&&EMAIL_SUPPORTS_IDEMPOTENCY&&Date.now()-new Date(row.created_at).getTime()<23*3600000&&row.attempts<6;
      const status=canRetry?"retry":"needs-review";
      await query("UPDATE p5_estimator_outbox SET status=$1,last_error=$2,locked_until=NULL,next_attempt_at=now()+($3*interval '1 second') WHERE id=$4",[status,message.slice(0,500),Math.min(3600,60*2**row.attempts),row.id]);
      if(!destination.startsWith("alert:"))for(const email of await adminRecipients())await query("INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(draft_id,revision,destination) DO NOTHING",[randomUUID(),row.draft_id,row.revision,`alert:${email}`,JSON.stringify({error:message,failedDestination:destination})]);
      results.push({id:row.id,status});
    }
  }
  // A worker that died after a send is ambiguous. Resend's key permits a safe
  // retry within 23 hours; CRM/SMTP must be reconciled by an administrator.
  await query(`UPDATE p5_estimator_outbox SET status=CASE WHEN destination<>'crm' AND $1::boolean AND created_at>now()-interval '23 hours' THEN 'retry' ELSE 'needs-review' END,
    locked_until=NULL,last_error='Delivery worker interrupted; acknowledgement requires reconciliation'
    WHERE status='sending' AND locked_until<now()`,[EMAIL_SUPPORTS_IDEMPOTENCY]);
  return results;
}
