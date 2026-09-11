import {createTransport} from "nodemailer";
import {peopleWithRole} from "../../app/lib/notifications/dispatch.ts";
import {ingestLead} from "../../app/lib/leads/intake.ts";
import {loadSettings} from "../../app/lib/leads/settings.ts";
import {ESTIMATOR_BRAND as brand} from "./brand";
export async function adminRecipients(){return [...new Set((await peopleWithRole(["administrator"])).map(p=>p.email))];}
export const EMAIL_SUPPORTS_IDEMPOTENCY=false;
export async function sendEmail(input:{to:string;subject:string;text:string;html?:string;attachments:{filename:string;content:Buffer}[];key:string}){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASSWORD)throw new Error("Email delivery is not configured");
  const port=Number(process.env.SMTP_PORT||465);
  const transport=createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port,secure:port===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:15000,socketTimeout:25000});
  const result=await transport.sendMail({from:process.env.SMTP_FROM||`${brand.name} <${brand.email}>`,to:input.to,replyTo:brand.email,subject:input.subject,text:input.text,html:input.html,attachments:input.attachments,messageId:`<${input.key}@${brand.domain}>`});
  if(!result.accepted?.length||result.rejected?.length)throw new Error("Email was not accepted for delivery");
  return String(result.messageId);
}
export async function syncCrm(record:any,key:string){
  const names=record.contact.name.trim().split(/\s+/);
  const result=await ingestLead({firstName:names.shift()||null,lastName:names.join(" ")||null,email:record.contact.email,phone:record.contact.phone||null,
    brand:"P5 Home Co",projectType:record.scope.answers.service,source:"Organic Website",sourceDetail:`p5-estimator:${record.draftId}`,
    propertyAddress:record.scope.answers.address||null,propertyCity:record.scope.answers.location||null,
    summary:record.customer.summary,externalLeadId:key,originalForm:"p5-estimator",originalCampaign:null,utm:null,receivedAt:new Date()},await loadSettings());
  if(result.status==="rejected")throw new Error("CRM rejected the estimate lead");
  if(!Number.isInteger(result.dealId)||result.dealId<=0)throw new Error("CRM duplicate acknowledgement has no resolved lead identifier; reconcile before retrying");
  return String(result.dealId);
}
