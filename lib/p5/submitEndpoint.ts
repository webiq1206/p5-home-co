import { query } from "./database";
import { draftCredentials,readDraft,DraftError } from "./store";
import { EMPTY_CONFIGURATION,priceReviewedScope,type EstimatorConfiguration } from "./costBook";
import { enqueueSubmission,deliveryStatus,processOutbox } from "./outbox";
import { protectRequest,json,failed,limitedBody } from "./http";
import { ESTIMATOR_BRAND as brand } from "./brand";
export async function postSubmission(request:Request){
  try{
    protectRequest(request,12);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
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
    const priced=priceReviewedScope(draft.reviewed,configuration);
    const record={draftId:id,revision:draft.revision,brand:brand.name,estimator:"p5-policy",contact:draft.contact,scope:draft.reviewed,...priced};
    const accepted=await enqueueSubmission(id,draft.revision,record);
    // Persistence is acknowledged separately from delivery. A transport failure
    // never erases the submission or tells a visitor to create a duplicate.
    await processOutbox({draftId:id,limit:12}).catch(()=>undefined);
    return json({accepted,duplicate:!accepted,id,result:priced.customer,delivery:await deliveryStatus(id)});
  }catch(error){return failed(error);}
}
