import {draftCredentials,readDraft,DraftError} from './store';
import {query} from './database';
import {customerPdf,pdfFilename} from './pdf';
import {failed,protectRequest} from './http';
export async function getCustomerPdf(request:Request){
  try{
    protectRequest(request);const {id,key}=draftCredentials(request);
    const draft=await readDraft(id,key);
    if(!draft||draft.status!=='submitted')throw new DraftError('Submit this project before downloading its summary.',404);
    const [record]=await query('SELECT customer_estimate FROM p5_estimator_drafts WHERE id=$1',[id]);
    if(!record?.customer_estimate)throw new DraftError('The project summary is not ready yet.',409);
    return new Response(new Uint8Array(await customerPdf(id,record.customer_estimate)),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${pdfFilename(id,'customer')}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return failed(error);}
}
