import { query } from "./database";
import { draftCredentials,readDraft,DraftError } from "./store";
import { EMPTY_CONFIGURATION,type EstimatorConfiguration } from "./costBook";
import {priceSavedScope} from "./pricingWork";
import {queuedJob} from './backgroundJobs';
import {SCOPE_FIELDS} from "./scope";
import {PricingPending} from "./pricingProgress";
import { enqueueSubmission,deliveryStatus,processOutbox } from "./outbox";
import { protectRequest,json,failed,limitedBody } from "./http";
import { ESTIMATOR_BRAND as brand } from "./brand";
export async function postSubmission(request:Request){
  try{
    protectRequest(request,1000);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
    if(!draft)throw new DraftError("Draft not found.",404);
    if(draft.status==="submitted"){
      const [row]=await query("SELECT customer_estimate FROM p5_estimator_drafts WHERE id=$1",[id]);
      return json({accepted:false,duplicate:true,id,result:row.customer_estimate,delivery:await deliveryStatus(id)});
    }
    const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,4000)));
    if(body.revision!==draft.revision)throw new DraftError("Save the latest scope before submitting.",409);
    if(!(brand.services as readonly string[]).includes(String(draft.answers.service)))throw new DraftError("Choose a service offered by this company.");
    if(!draft.reviewed)throw new DraftError("Review and confirm the extracted scope before submitting.");
    if(draft.contact.name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact.email))throw new DraftError("Enter your name and a valid email address.");
    if(draft.contact.phone&&draft.contact.phone.replace(/\D/g,"").length<10)throw new DraftError("Enter a valid phone number or leave it blank.");
    const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
    const configuration=(policy?.payload||EMPTY_CONFIGURATION) as EstimatorConfiguration;
    const job=body.background===true?await queuedJob({kind:'pricing',draft,configuration},body.retry===true):null;
    if(job&&job.state!=='complete')return json({pending:job.state!=='failed',message:job.progress,processing:job.processing,retryAfterMs:2000,...(job.state==='failed'?{error:job.progress}:{})},job.state==='failed'?503:202);
    const priced=job?job.result:await priceSavedScope(id,draft.reviewed,configuration);
    if(!priced.customer.range){
      // Keep incomplete pricing available to the authenticated admin, but do
      // not submit it or create customer-email/CRM delivery records.
      const retained=await query("UPDATE p5_estimator_drafts SET internal_estimate=$2 WHERE id=$1 AND revision=$3 AND status='draft' RETURNING id",[id,JSON.stringify(priced.internal),draft.revision]);
      if(!retained.length)throw new DraftError("Your project changed during pricing. Save the latest details and retry.",409);
      const missing=('missingInformation' in priced.internal?priced.internal.missingInformation:[])||[];
      const labels=Object.entries(SCOPE_FIELDS).filter(([key])=>missing.some((item:string)=>item.startsWith(`Missing quantity: ${key}`)||item.startsWith(`Missing cost condition: ${key}`))).map(([,field])=>field.label);
      return json({pricingReviewRequired:true,error:`Your project is saved and remains editable. ${labels.length?`Please confirm: ${labels.slice(0,5).join('; ')}.`:'Some scope items still need verified quantities or cost evidence.'} A complete price range is required before the estimate can be finalized and emailed.`},422);
    }
    const record={draftId:id,revision:draft.revision,brand:brand.name,estimator:"p5-policy",contact:draft.contact,scope:draft.reviewed,...priced};
    const accepted=await enqueueSubmission(id,draft.revision,record);
    // Persistence is acknowledged separately from delivery. A transport failure
    // never erases the submission or tells a visitor to create a duplicate.
    await processOutbox({draftId:id,limit:12}).catch(()=>undefined);
    return json({accepted,duplicate:!accepted,id,result:priced.customer,delivery:await deliveryStatus(id)});
  }catch(error){if(error instanceof PricingPending)return error.retryAfterMs===0?json({error:error.message},503):json({pending:true,message:error.message,retryAfterMs:error.retryAfterMs},202);return failed(error);}
}
