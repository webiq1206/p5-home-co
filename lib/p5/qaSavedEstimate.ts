import {ROBOTS_TAG} from '../../app/lib/privacy.ts';
import {query} from './database.ts';
import {readQaContinuationSnapshot} from './qaContinuation.ts';
import {QA_CASES} from './qaCases.ts';
import {DraftError} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {legalIdentityLine} from './brandIdentity.ts';
import {buildEstimateDocument,estimateReference} from './estimateDocument.ts';
import {customerPresentation,HIDE_CUSTOMER_UNIT_RATES} from './presentation.ts';
import {customerPdf,pdfFilename} from './pdf.ts';
import type {QaSavedEstimateView} from './qaSavedEstimateView.ts';

if(typeof window!=='undefined')throw new Error('Saved QA estimates are server-only.');

type Read=typeof query;
type RecordValue=Record<string,unknown>;
const record=(value:unknown):value is RecordValue=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const cleanName=(value:string)=>value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
const validDate=(value:unknown):value is string=>typeof value==='string'&&value.trim()!==''&&Number.isFinite(Date.parse(value));
function syntheticContact(value:unknown,name:string){
  return record(value)&&Object.keys(value).every(key=>['name','email','phone'].includes(key))
    &&typeof value.name==='string'&&/^\[QA\](?:\s|$)/i.test(value.name)&&value.name===name
    &&value.email===''&&value.phone==='';
}

/** This read-only release is bound to the existing Case1 revision 6. */
export function savedEstimateRevision(value:unknown):6{
  const revision=typeof value==='string'&&/^[1-9]\d*$/.test(value)?Number(value):value;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)throw new DraftError('An exact saved estimate revision is required.',400);
  if(revision!==6)throw new DraftError('Only the existing saved case 1 revision 6 is available here.',409);
  return revision;
}

async function verifiedSavedEstimate(name:unknown,requestedRevision:unknown,read:Read){
  if(name!=='case-1')throw new DraftError('Only the existing synthetic case 1 is available here.',404);
  const revision=savedEstimateRevision(requestedRevision);
  const {identity,row,draft}=await readQaContinuationSnapshot(name,read);
  if(identity.id!==QA_CASES['case-1'][0]||draft.status!=='submitted'||draft.revision!==revision)throw new DraftError('This exact submitted estimate revision is not available.',409);
  if(row.busy||row.run.blocked!==false||!Array.isArray(row.held)||row.held.length)throw new DraftError('The saved estimate is unavailable while QA work or uncertain charges remain.',409);
  const saved:unknown=row.draft.customer;
  if(!record(saved)||!record(saved.range)||!Number.isFinite(saved.range.low)||!Number.isFinite(saved.range.high)
    ||Number(saved.range.low)<0||Number(saved.range.high)<Number(saved.range.low)
    ||typeof saved.summary!=='string'||!saved.summary.trim()||!Array.isArray(saved.lineItems)||!saved.lineItems.length
    ||!Array.isArray(saved.categoryRanges))throw new DraftError('The saved customer result could not be verified.',409);
  const issue=saved.issue;
  const contact=draft.contact;
  if(!record(issue)||issue.brandId!==ESTIMATOR_BRAND.id||issue.revision!==revision||issue.reference!==estimateReference(identity.id)
    ||!validDate(issue.issuedAt)||!validDate(row.draft.submittedAt))throw new DraftError('The saved estimate issue could not be verified.',409);
  if(!syntheticContact(contact,contact.name)||!syntheticContact(issue.contact,cleanName(contact.name))
    ||(Object.hasOwn(saved,'contact')&&!syntheticContact(saved.contact,cleanName(contact.name))))throw new DraftError('Saved estimate synthetic contact safeguards failed.',409);
  if((issue.sources!==undefined&&(!Array.isArray(issue.sources)||issue.sources.length))||draft.reviewed?.uploads?.length)throw new DraftError('Only the existing typed synthetic estimate is available.',409);
  const delivery:unknown=row.delivery;
  if(!Array.isArray(delivery)||!delivery.length||delivery.some(receipt=>!record(receipt)||receipt.revision!==revision
    ||receipt.status!=='suppressed'||receipt.suppressed!==true||receipt.untouched!==true||receipt.matchesSaved!==true))throw new DraftError('A matching suppressed delivery receipt is required.',409);
  const result=customerPresentation(saved,{hideUnitRates:HIDE_CUSTOMER_UNIT_RATES});
  if(result.lineItems.length!==saved.lineItems.length||result.categoryRanges.length!==saved.categoryRanges.length)throw new DraftError('The saved customer result contains invalid pricing.',409);
  const submittedAt=new Date(row.draft.submittedAt).toISOString();
  const document=buildEstimateDocument({id:identity.id,result:saved,brand:ESTIMATOR_BRAND,submittedAt,legalLine:legalIdentityLine()});
  const view:QaSavedEstimateView={case:'case-1',label:identity.label,id:identity.id,revision,result,document,delivery:delivery.map(()=>({channel:'suppressed',status:'suppressed'}))};
  return {view,saved,submittedAt};
}

/** One atomic SELECT, then a customer-only projection. No draft key is read. */
export async function inspectQaSavedEstimate(name:unknown,revision:unknown,read:Read=query):Promise<QaSavedEstimateView>{
  return (await verifiedSavedEstimate(name,revision,read)).view;
}

/** Reuses the same verifier and saved input as the preview, never reprices. */
export async function qaSavedEstimatePdf(name:unknown,revision:unknown,read:Read=query):Promise<Response>{
  const {view,saved,submittedAt}=await verifiedSavedEstimate(name,revision,read);
  return new Response(new Uint8Array(await customerPdf(view.id,saved,submittedAt)),{headers:{
    'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${pdfFilename(view.id,'customer')}"`,
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':ROBOTS_TAG,
  }});
}
