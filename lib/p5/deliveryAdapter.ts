import {collectAttribution,sourceFromAttribution} from "./leadAttribution.ts";
import {safeEmailReplyTo} from './emailReplyTo.ts';
import {createTransport} from "nodemailer";
import {getSmtpConfig, assertSmtpAccepted, decoratePreliminaryEstimateEmail} from "../../app/lib/notifications/smtp-config.ts";
import {peopleWithRole} from "../../app/lib/notifications/dispatch.ts";
import {ingestLead} from "../../app/lib/leads/intake.ts";
import {estimatorDeliveryMode} from "../../app/lib/leads/synthetic-qa.ts";
import {loadSettings} from "../../app/lib/leads/settings.ts";
import {ESTIMATOR_BRAND as brand} from "./brand.ts";
/** Readiness only: configuration values never leave this adapter. */
export function emailTransportReady(){try{getSmtpConfig();return true;}catch{return false;}}
export async function adminRecipients(){return [...new Set((await peopleWithRole(["administrator"])).map(p=>p.email))];}
export const EMAIL_SUPPORTS_IDEMPOTENCY=false;
export const deliveryBrand=(record:any)=>typeof record?.brand==="string"&&record.brand.trim()?record.brand:brand.name;
export async function sendEmail(input:{to:string;replyTo?:string;subject:string;text:string;html?:string;attachments:{filename:string;content:Buffer;contentType?:string}[];key:string}){
  const config=getSmtpConfig();
  const transport=createTransport(config.options);
  // The customer's preliminary estimate email gains the after-estimate wording here
  // (owner request, 16 November 2026): the Schedule now button, the adjust note and
  // the family question. Every other subject (team record, delivery alert, project
  // request, review request) is returned unchanged. The shared transport test runs
  // this file against a stub with no decorator; those messages keep their bytes.
  const message=typeof decoratePreliminaryEstimateEmail==="function"?decoratePreliminaryEstimateEmail(input):input;
  const result=await transport.sendMail({from:config.from,to:input.to,replyTo:safeEmailReplyTo(input.replyTo,config.replyTo),subject:message.subject,text:message.text,html:message.html,attachments:input.attachments,messageId:`<${input.key}@${brand.domain}>`});
  assertSmtpAccepted(result);
  return String(result.messageId);
}
export async function syncCrm(record:any,key:string){
  const mode=estimatorDeliveryMode(record.contact.name,record.contact.email);
  const names=record.contact.name.trim().split(/\s+/);
  const attribution=collectAttribution(record.attribution||{});
  // Loaded on demand, like the QuickBooks code below: the mail paths of this adapter load nothing new.
  const {projectRequestKey}=await import("./p5LeadIntake.ts");
 const result=await ingestLead({firstName:names.shift()||null,lastName:names.join(" ")||null,email:record.contact.email,phone:record.contact.phone||null,
    brand:deliveryBrand(record),projectType:record.scope.answers.service,source:sourceFromAttribution(attribution),sourceDetail:`p5-estimator:${record.draftId}`,
    propertyAddress:record.scope.answers.address||null,propertyCity:record.scope.answers.location||null,
    summary:record.customer.summary,externalLeadId:mode==='synthetic_qa'?'qa-'+key:key,originalForm:"p5-estimator",originalCampaign:attribution?.utm_campaign||null,utm:attribution,receivedAt:new Date(),
    // One lead per project (owner decision, 18 November 2026): when the visitor's project request already made a
    // lead (intakeDeliveryRuntime.ts), the estimate published for it joins that lead instead of making a second.
    // With no such lead, this changes nothing. A QA record never joins a customer's lead (ingestLead ignores it).
    requestExternalId:projectRequestKey(record,brand.name)||null},await loadSettings(),null,{estimatorDeliveryMode:mode});
  if(result.status==="rejected")throw new Error("CRM rejected the estimate lead");
  if(!Number.isInteger(result.dealId)||result.dealId<=0)throw new Error("CRM duplicate acknowledgement has no resolved lead identifier; reconcile before retrying");
  // Every estimate a website gives becomes a QuickBooks customer and an UNSENT estimate for its lead
  // (owner decision, 13 and 17 November 2026; app/lib/leads/site-estimate.ts). The lead is saved by now,
  // so this never fails the delivery: it is bounded, and the watchdog finishes what is left. A QA record
  // never reaches QuickBooks.
  if(mode!=='synthetic_qa')await documentEstimateToQuickBooks(record,result.dealId);
  return String(result.dealId);
}
/** Loaded on demand, so the mail paths of this adapter never load the QuickBooks code. */
async function documentEstimateToQuickBooks(record:unknown,dealId:number){
  try{const {createSiteEstimateFromDocument}=await import("../../app/lib/leads/site-estimate.ts");await createSiteEstimateFromDocument(record,dealId);}
  catch(error){console.error("[p5-delivery] the QuickBooks estimate was left for the retry:",error instanceof Error?error.message:"unknown error");}
}
