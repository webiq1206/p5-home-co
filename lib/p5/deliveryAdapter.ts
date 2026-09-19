import {createTransport} from "nodemailer";
import {getSmtpConfig, assertSmtpAccepted} from "../../app/lib/notifications/smtp-config.ts";
import {peopleWithRole} from "../../app/lib/notifications/dispatch.ts";
import {ingestLead} from "../../app/lib/leads/intake.ts";
import {loadSettings} from "../../app/lib/leads/settings.ts";
import {ESTIMATOR_BRAND as brand} from "./brand.ts";
export async function adminRecipients(){return [...new Set((await peopleWithRole(["administrator"])).map(p=>p.email))];}
export const EMAIL_SUPPORTS_IDEMPOTENCY=false;
export const deliveryBrand=(record:any)=>typeof record?.brand==="string"&&record.brand.trim()?record.brand:brand.name;
export async function sendEmail(input:{to:string;subject:string;text:string;html?:string;attachments:{filename:string;content:Buffer}[];key:string}){
  const config=getSmtpConfig();
  const transport=createTransport(config.options);
  const result=await transport.sendMail({from:config.from,to:input.to,replyTo:config.replyTo,subject:input.subject,text:input.text,html:input.html,attachments:input.attachments,messageId:`<${input.key}@${brand.domain}>`});
  assertSmtpAccepted(result);
  return String(result.messageId);
}
export async function syncCrm(record:any,key:string){
  const names=record.contact.name.trim().split(/\s+/);
  const result=await ingestLead({firstName:names.shift()||null,lastName:names.join(" ")||null,email:record.contact.email,phone:record.contact.phone||null,
    brand:deliveryBrand(record),projectType:record.scope.answers.service,source:"Organic Website",sourceDetail:`p5-estimator:${record.draftId}`,
    propertyAddress:record.scope.answers.address||null,propertyCity:record.scope.answers.location||null,
    summary:record.customer.summary,externalLeadId:key,originalForm:"p5-estimator",originalCampaign:null,utm:null,receivedAt:new Date()},await loadSettings());
  if(result.status==="rejected")throw new Error("CRM rejected the estimate lead");
  if(!Number.isInteger(result.dealId)||result.dealId<=0)throw new Error("CRM duplicate acknowledgement has no resolved lead identifier; reconcile before retrying");
  return String(result.dealId);
}
