import {createHash} from 'node:crypto';
import {draftCredentials,readDraft,DraftError} from './store.ts';
import {query} from './database.ts';
import {protectRequest,limitedBody,json,failed} from './http.ts';
import {adminRecipients,sendEmail} from './deliveryAdapter.ts';
import {ESTIMATOR_BRAND as brand} from './brand.ts';
import {estimateReference} from './estimateDocument.ts';

export function reviewContact(input:Record<string,unknown>){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new DraftError('Enter your contact details.');
  const name=String(input.name||'').trim();
  const email=String(input.email||'').trim().toLowerCase();
  const phone=String(input.phone||'').trim();
  if(name.length<2||name.length>120)throw new DraftError('Enter your name.');
  if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200))throw new DraftError('Enter a valid email address.');
  if(phone&&(phone.replace(/\D/g,'').length<10||phone.length>40))throw new DraftError('Enter a valid phone number.');
  if(!email&&!phone)throw new DraftError('Add an email address or phone number so we can respond.');
  return {name,email,phone};
}

/** Explicitly requested human follow-up, separate from pricing and estimate delivery.
 * The authenticated saved scope stays server-side. No draft key or personal data goes in a URL.
 * A unique revision request prevents repeated clicks from sending duplicate notifications.
 * An interrupted or uncertain delivery is never automatically sent again (SMTP is not idempotent).
 */
export function projectReviewHandler(dependencies={readDraft,query,adminRecipients,sendEmail}){
 const {readDraft,query,adminRecipients,sendEmail}=dependencies;
 return async function requestProjectReview(request:Request){
  try{
    protectRequest(request,10);
    const {id,key}=draftCredentials(request);
    const draft=await readDraft(id,key);
    if(!draft||draft.brand!==brand.id)throw new DraftError('Save your project before requesting a review.',404);
    const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,2048)));
    const contact=reviewContact(body);
    const reference=estimateReference(id);
    await query(`CREATE TABLE IF NOT EXISTS p5_estimator_review_requests (
      draft_id uuid NOT NULL, revision integer NOT NULL, contact jsonb NOT NULL,
      scope jsonb NOT NULL, status text NOT NULL DEFAULT 'saved', created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(draft_id,revision))`);
    const accepted=await query(`INSERT INTO p5_estimator_review_requests(draft_id,revision,contact,scope)
      VALUES($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT(draft_id,revision) DO NOTHING RETURNING draft_id`,
      [id,draft.revision,JSON.stringify(contact),JSON.stringify({text:draft.text,answers:draft.answers,uploads:draft.uploads.map(f=>({id:f.id,name:f.name}))})]);
    if(accepted.length){
      // Commit the durable request before attempting notification. Claim exactly once.
      const claimed=await query(`UPDATE p5_estimator_review_requests SET status='sending'
        WHERE draft_id=$1 AND revision=$2 AND status='saved' RETURNING draft_id`,[id,draft.revision]);
      if(claimed.length){
        try{
          const recipients=await adminRecipients();
          if(!recipients.length)throw new Error('review-notification-unconfigured');
          for(const to of recipients)await sendEmail({to,subject:`Project review requested: ${reference}`,attachments:[],
            key:createHash('sha256').update(`review:${id}:${draft.revision}:${to}`).digest('hex'),
            text:[`${brand.name}: customer requested a project review.`, `Reference: ${reference}`, `Draft ID: ${id}`, `Revision: ${draft.revision}`,
              `Name: ${contact.name}`, `Email: ${contact.email||'Not supplied'}`, `Phone: ${contact.phone||'Not supplied'}`,
              '', 'Saved project description:',draft.text,'','Saved details:',JSON.stringify(draft.answers,null,2),
              '',`Files: ${draft.uploads.map(f=>f.name).join(', ')||'None'}`,
              'Review the saved project in the estimator administration area. This request is not a completed price or contract.'].join('\n')});
          await query(`UPDATE p5_estimator_review_requests SET status='sent' WHERE draft_id=$1 AND revision=$2`,[id,draft.revision]);
        }catch{
          await query(`UPDATE p5_estimator_review_requests SET status='needs-review' WHERE draft_id=$1 AND revision=$2`,[id,draft.revision]);
        }
      }
    }
    const [saved]=await query(`SELECT status FROM p5_estimator_review_requests WHERE draft_id=$1 AND revision=$2`,[id,draft.revision]);
    return json({accepted:true,reference,notified:saved?.status==='sent'});
  }catch(error){return failed(error);}
 };
}
export const requestProjectReview=projectReviewHandler();
