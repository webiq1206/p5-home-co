import {createHash} from 'node:crypto';
import {intakeReference,type IntakeSnapshot} from './intakeContract.ts';
import {INTAKE_SITES,INTAKE_RECIPIENTS} from './intakePolicy.ts';
import type {IntakeChannel} from './intakeDeliveryPolicy.ts';
import {safeEmailReplyTo} from './emailReplyTo.ts';
import {renderIntakeEmail} from './intakeEmail.ts';

export interface IntakeEmail {to:string;replyTo?:string;subject:string;text:string;html?:string;attachments:{filename:string;base64:string}[]}
export interface IntakeDeliveryEnvelope {schema:1;channel:IntakeChannel;key:string;leadKey:string;snapshotDigest:string;email?:IntakeEmail;request?:IntakeSnapshot}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** One lead across revisions; each channel/revision has a distinct immutable operation. */
export const intakeLeadKey=(projectId:string)=>'p5-intake-'+hash(projectId);
export const intakeOperationKey=(s:IntakeSnapshot,c:IntakeChannel)=>'p5-intake-'+hash(JSON.stringify([s.projectId,s.currentSite,s.revision,c]));
/** Source-compatible P5 local ingestLead projection: no price or promised deadline. */
export function intakeLocalCrmRecord(s:IntakeSnapshot){
 const site=INTAKE_SITES[s.currentSite];
 const summary=JSON.stringify({request:'Unpriced project request',revision:s.revision,originSite:s.originSite,receivingSite:s.currentSite,primaryTeam:s.routing.primaryTeam,supportingServices:s.routing.supportingServices,preferredContact:s.contact.preferredContact,scope:s.scope.text,answers:s.scope.answers,details:s.details,unresolved:s.unresolved,files:s.scope.uploads,
  staffRecord:`https://${site.domain}/api/admin/p5-intake?draftId=${s.draftId}&revision=${s.revision}`});
 if(Buffer.byteLength(summary)>90000)throw new Error('payload-review');
 return {attribution:s.details.attribution,draftId:s.draftId,contact:s.contact,scope:s.scope,brand:site.name,customer:{summary}};
}
export function intakeDeliveryEnvelope(s:IntakeSnapshot,channel:IntakeChannel,snapshotDigest:string):IntakeDeliveryEnvelope {
 const envelope:IntakeDeliveryEnvelope={schema:1,channel,key:intakeOperationKey(s,channel),leadKey:intakeLeadKey(s.projectId),snapshotDigest};
 if(channel==='crm')return {...envelope,request:s};
 const team=channel==='team',domain=INTAKE_SITES[s.currentSite].domain,reference=intakeReference(s.projectId);
 const files=s.scope.uploads.map(f=>{
  const url=new URL(`https://${domain}/api/admin/p5-intake/file`);url.searchParams.set('draftId',s.draftId);url.searchParams.set('revision',String(s.revision));url.searchParams.set('fileId',f.id);
  return {name:f.name,type:f.type,bytes:f.size,sha256:f.sha256,...(team?{authenticatedOriginal:url.href}:{})};
 });
 // A customer receives their submitted information, not private extraction/engine metadata.
 const copy={reference,revision:s.revision,savedAt:s.savedAt,origin:INTAKE_SITES[s.originSite].name,receivingSite:INTAKE_SITES[s.currentSite].name,
  primaryTeam:s.routing.teamName,supportingServices:s.routing.supportingServices,contact:s.contact,scope:s.scope.text,answers:s.scope.answers,
  desiredOutcome:s.details.desiredOutcome,workContext:s.details.workContext,budget:s.details.budget,unresolved:s.unresolved,conversation:s.details.transcript,files};
 const attachment=Buffer.from(JSON.stringify(copy,null,2));
 // Conservative local message bound. Never truncate a customer's scope or silently drop files.
 if(attachment.length>2*1024*1024)throw new Error('payload-review');
 const rendered=renderIntakeEmail(s,team,s.scope.uploads.map(f=>({name:f.name,size:f.size})));
 return {...envelope,email:{to:team?INTAKE_RECIPIENTS[s.currentSite]:s.contact.email,replyTo:team?safeEmailReplyTo(s.contact.email,INTAKE_RECIPIENTS[s.currentSite]):INTAKE_RECIPIENTS[s.currentSite],...rendered,attachments:[{filename:`${reference}-revision-${s.revision}.json`,base64:attachment.toString('base64')}]}};
}
