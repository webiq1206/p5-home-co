import {createHash} from 'node:crypto';
import {type IntakeSnapshot} from './intakeContract.ts';
import {INTAKE_SITES,INTAKE_RECIPIENTS} from './intakePolicy.ts';
import type {IntakeChannel} from './intakeDeliveryPolicy.ts';
import {safeEmailReplyTo} from './emailReplyTo.ts';
import {renderIntakeEmail} from './intakeEmail.ts';

export interface IntakeEmail {to:string;replyTo?:string;subject:string;text:string;html?:string;attachments:{filename:string;base64:string;contentType?:string}[]}
export interface IntakeDeliveryEnvelope {schema:1;channel:IntakeChannel;key:string;leadKey:string;snapshotDigest:string;email?:IntakeEmail;request?:IntakeSnapshot}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** One lead across revisions; each channel/revision has a distinct immutable operation. */
export const intakeLeadKey=(projectId:string)=>'p5-intake-'+hash(projectId);
export const intakeOperationKey=(s:IntakeSnapshot,c:IntakeChannel)=>'p5-intake-'+hash(JSON.stringify([s.projectId,s.currentSite,s.revision,c]));
/** Source-compatible P5 local ingestLead projection: no price or promised deadline. */
export function intakeLocalCrmRecord(s:IntakeSnapshot){
 const site=INTAKE_SITES[s.currentSite];
 const summary=JSON.stringify({request:'Unpriced project request',...(s.reference?{reference:s.reference}:{}),revision:s.revision,originSite:s.originSite,receivingSite:s.currentSite,primaryTeam:s.routing.primaryTeam,supportingServices:s.routing.supportingServices,preferredContact:s.contact.preferredContact,scope:s.scope.text,answers:s.scope.answers,details:s.details,unresolved:s.unresolved,files:s.scope.uploads,
  staffRecord:`https://${site.domain}/api/admin/p5-intake?draftId=${s.draftId}&revision=${s.revision}`});
 if(Buffer.byteLength(summary)>90000)throw new Error('payload-review');
 return {draftId:s.draftId,contact:s.contact,scope:s.scope,brand:site.name,customer:{summary}};
}
export function intakeDeliveryEnvelope(s:IntakeSnapshot,channel:IntakeChannel,snapshotDigest:string):IntakeDeliveryEnvelope {
 const envelope:IntakeDeliveryEnvelope={schema:1,channel,key:intakeOperationKey(s,channel),leadKey:intakeLeadKey(s.projectId),snapshotDigest};
 if(channel==='crm')return {...envelope,request:s};
 const team=channel==='team';
 const rendered=renderIntakeEmail(s,team,s.scope.uploads.map(f=>({name:f.name,size:f.size})));
 if(Buffer.byteLength(rendered.text)+Buffer.byteLength(rendered.html)>2*1024*1024)throw new Error('payload-review');
 // The prepare phase renders the PDF and validates originals before any send.
 return {...envelope,email:{to:team?INTAKE_RECIPIENTS[s.currentSite]:s.contact.email,replyTo:team?safeEmailReplyTo(s.contact.email,INTAKE_RECIPIENTS[s.currentSite]):INTAKE_RECIPIENTS[s.currentSite],...rendered,attachments:[]}};
}
