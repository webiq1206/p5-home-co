import {HANDOFF_ISSUE} from './scopePricing.ts';
import { query } from "./database.ts";
import { draftCredentials,readDraft,DraftError,requireEstimateContact } from "./store.ts";
import { EMPTY_CONFIGURATION,type EstimatorConfiguration } from "./costBook.ts";
import {priceSavedScope} from "./pricingWork.ts";
import {queuedJob} from './backgroundJobs.ts';
import {missingScopeFields,customerPricingQuestions} from "./missingFields.ts";
import {pricingPreflight,PREFLIGHT_MESSAGE} from './pricingPreflight.ts';
import {PricingPending,isPricingPending} from './pricingProgress.ts';
import { enqueueSubmission,deliveryStatus,processOutbox } from "./outbox.ts";
import { protectRequest,json,failed,limitedBody } from "./http.ts";
import { ESTIMATOR_BRAND as brand } from "./brand.ts";
import {customerPresentation,HIDE_CUSTOMER_UNIT_RATES} from './presentation.ts';
// Every public response uses the one customer boundary, including responses
// rebuilt from a previously saved estimate.
const publicResult=(estimate:unknown)=>customerPresentation(estimate,{hideUnitRates:HIDE_CUSTOMER_UNIT_RATES});

const DELIVERY_WAIT_MS=Number(process.env.P5_DELIVERY_WAIT_MS||25_000);
export async function postSubmission(request:Request,schedule?:(task:()=>Promise<void>)=>void){
  try{
    protectRequest(request,1000);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
    if(!draft)throw new DraftError("Draft not found.",404);
    requireEstimateContact(draft.contact);
    if(draft.status==="submitted"){
      const [row]=await query("SELECT customer_estimate FROM p5_estimator_drafts WHERE id=$1",[id]);
      // A status check after submission drives any delivery still queued; an autoscale host has no CPU between requests.
      // Delivery is scoped to this saved revision so a status check never drives another revision's queue.
      await processOutbox({draftId:id,revision:draft.revision,limit:12}).catch(()=>undefined);
      return json({accepted:false,duplicate:true,id,result:publicResult(row.customer_estimate),delivery:await deliveryStatus(id)});
    }
    const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,4000)));
    if(body.revision!==draft.revision)throw new DraftError("Save the latest scope before submitting.",409);
    if(!(brand.services as readonly string[]).includes(String(draft.answers.service)))throw new DraftError("Choose a service offered by this company.");
    if(!draft.reviewed)throw new DraftError("Review and confirm the extracted scope before submitting.");
    const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
    const configuration=(policy?.payload||EMPTY_CONFIGURATION) as EstimatorConfiguration;
    // Ask for a quantity the planning model cannot work without now, before any pricing work starts.
    const needed=pricingPreflight(draft.reviewed,configuration);
    if(needed.length)return json({pricingReviewRequired:true,needsCustomerInput:true,handoff:false,preflight:true,missingFields:needed,verificationItems:[],error:PREFLIGHT_MESSAGE},422);
    const job=body.background===true?await queuedJob({kind:'pricing',draft,configuration},body.retry===true):null;
    // A job that stopped after repeated failures is the handoff outcome: the project and contact are saved, a person completes the estimate, nothing further is needed from the visitor.
    if(job&&job.state==='failed'){console.error(`[p5-pricing] handoff for draft ${id}: ${job.progress}`);return json({pricingReviewRequired:true,needsCustomerInput:false,handoff:true,missingFields:[],verificationItems:[],error:HANDOFF_ISSUE},422);}
    if(job&&job.state!=='complete')return json({pending:true,message:job.progress,processing:job.processing,retryAfterMs:2000},202);
    // Paid pricing requests are ledgered per customer, draft and revision, so a
    // retried submission never pays for the same research twice. A request
    // priced inline (no background job) may use the route's own time allowance.
    const customerKey=`${draft.contact.email.trim().toLowerCase()}|${draft.contact.name.trim().toLowerCase()}`;
    const pricingIdentity={draftId:id,customerKey,revision:draft.revision};
    const priced=job?job.result:await priceSavedScope(id,draft.reviewed,configuration,new Date(),Date.now()+250_000,pricingIdentity);
    const publicCustomer=publicResult(priced.customer);
    if(!priced.customer.range){
      // Keep incomplete pricing available to the authenticated admin, but do
      // not submit it or create customer-email/CRM delivery records.
      const retained=await query("UPDATE p5_estimator_drafts SET internal_estimate=$2 WHERE id=$1 AND revision=$3 AND status='draft' RETURNING id",[id,JSON.stringify(priced.internal),draft.revision]);
      if(!retained.length)throw new DraftError("Your project changed during pricing. Save the latest details and retry.",409);
      const missing=('missingInformation' in priced.internal?priced.internal.missingInformation:[])||[];
      const missingFields=missingScopeFields(missing);
      const labels=missingFields.map(item=>item.label);
      const items=customerPricingQuestions(missing);
      // The reasons are logged so a live host explains an unpriced result, and the first few are shown so the visitor knows what to confirm.
      const blocks=(('warnings' in priced.internal?priced.internal.warnings:[])||[]).filter((w:{severity?:string})=>w.severity==='block').map((w:{code:string})=>w.code);
      console.error(`[p5-pricing] no range for draft ${id}: blocks=${blocks.join(',')||'none'}; missing=${missing.slice(0,6).join(' | ')||'none'}; items=${items.slice(0,4).join(' | ')||'none'}; issues=${(((priced.internal as {scopePricing?:{issues?:string[]}}).scopePricing?.issues)||[]).slice(0,6).join(' | ')||'none'}`);
      // The reply is structured so the interface can list each open item on
      // its own line and link each missing detail to its question, instead of
      // one dense paragraph.
      // Three different situations used to share one headline. A visitor with
      // questions to answer gets them; one whose scope is being finished by a
      // person is told exactly that and asked for nothing.
      const handoff=!labels.length&&!items.length;
      const detail=labels.length?'Please confirm the details below.':handoff?'':items.length?'The items below still need confirmation before a complete range can be released.':'Some scope items still need verified quantities or cost evidence.';
      const error=handoff?HANDOFF_ISSUE:`Your project is saved and remains editable. ${detail} A complete price range is required before the estimate can be finalized and emailed.`;
      return json({pricingReviewRequired:true,needsCustomerInput:labels.length>0||items.length>0,handoff,missingFields,verificationItems:handoff?[]:items.slice(0,8),error},422);
    }
    const record={draftId:id,revision:draft.revision,brand:brand.name,estimator:"p5-policy",contact:draft.contact,scope:draft.reviewed,...priced};
    const accepted=await enqueueSubmission(id,draft.revision,record);
    // Persistence is acknowledged separately from delivery. A transport failure
    // never erases the submission or tells a visitor to create a duplicate.
    const deliver=async()=>{await processOutbox({draftId:id,revision:draft.revision,limit:12}).catch(()=>undefined);};
    // An autoscale host gives a request no CPU after its response, so delivery
    // runs inside this request within a bounded wait; anything left continues
    // after the response and on the visitor's next status check.
    const started=deliver();
    await Promise.race([started,new Promise<void>(resolve=>setTimeout(resolve,DELIVERY_WAIT_MS))]);
    if(schedule)schedule(()=>started);
    return json({accepted,duplicate:!accepted,id,result:publicCustomer,delivery:await deliveryStatus(id)});
  }catch(error){if(isPricingPending(error))return error.retryAfterMs===0?json({error:error.message},503):json({pending:true,message:error.message,retryAfterMs:error.retryAfterMs},202);return failed(error);}
}
