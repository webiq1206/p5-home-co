import {legalIdentityLine} from './brandIdentity.ts';
import { ESTIMATOR_BRAND as brand } from "./brand.ts";
import {buildEstimateDocument,estimateReference,type EstimateBrand} from './estimateDocument.ts';
import {renderEstimatePdf} from './estimatePdf.ts';
import {buildAdminSummary,renderAdminPdf} from './adminEstimate.ts';
/**
 * The customer PDF is the approved preliminary online estimate (estimateDocument.ts + estimatePdf.ts):
 * built from the saved estimate and its issue record, so a download, the email attachment, an admin
 * customer preview and a resend of one revision are the same document. submittedAt dates estimates
 * saved before issue records existed; it never falls back to the day the file happens to be rendered.
 */
export function customerPdf(id:string,result:Record<string,unknown>|object,submittedAt?:string|null){
  return renderEstimatePdf(buildEstimateDocument({id,result,brand:brand as unknown as EstimateBrand,submittedAt:submittedAt||null,legalLine:legalIdentityLine()}));
}
/**
 * The internal estimate record in the same template (adminEstimate.ts): status, price build-up, cost
 * by trade, one line per priced item with its source code, grouped checks and open items. The record
 * is the saved internal estimate, with the saved customer estimate under `customer` when there is one.
 */
export function administrativePdf(id:string,record:Record<string,unknown>,submittedAt?:string|null){
  return renderAdminPdf(buildAdminSummary({id,record,brand:brand as unknown as EstimateBrand,submittedAt:submittedAt||null,legalLine:legalIdentityLine()}));
}
export function pdfFilename(id:string,kind:"customer"|"administrative"){return kind==="customer"?`${brand.id}-preliminary-estimate-${estimateReference(id)}.pdf`:`${brand.id}-internal-estimate-${estimateReference(id)}.pdf`;}
