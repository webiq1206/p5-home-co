import {draftCredentials,readDraft,DraftError,requireEstimateContact} from './store.ts';
import {query} from './database.ts';
import {archivedVersion} from './estimateRevisions.ts';
import {customerPdf,pdfFilename} from './pdf.ts';
import {failed,protectRequest} from './http.ts';
export async function getCustomerPdf(request:Request){
  try{
    protectRequest(request);const {id,key}=draftCredentials(request);
    const draft=await readDraft(id,key);
    // An earlier version of a revised estimate keeps its own PDF (?version=N).
    const version=Number(new URL(request.url).searchParams.get('version'));
    if(draft&&Number.isInteger(version)&&version>0){const old=await archivedVersion(id,version);if(!old?.customer)throw new DraftError('That version was not found.',404);
      return new Response(new Uint8Array(await customerPdf(id,old.customer,old.submittedAt)),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${pdfFilename(id,'customer').replace(/.pdf$/,`-v${version}.pdf`)}"`,'Cache-Control':'private, no-store'}});}
    if(!draft||draft.status!=='submitted')throw new DraftError('Submit this project before downloading its summary.',404);
    requireEstimateContact(draft.contact);
    const [record]=await query('SELECT customer_estimate,submitted_at FROM p5_estimator_drafts WHERE id=$1',[id]);
    if(!record?.customer_estimate)throw new DraftError('The project summary is not ready yet.',409);
    return new Response(new Uint8Array(await customerPdf(id,record.customer_estimate,record.submitted_at?new Date(record.submitted_at).toISOString():null)),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${pdfFilename(id,'customer')}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return failed(error);}
}
