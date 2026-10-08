import {createHash} from 'node:crypto';
import {intakeReference,type IntakeSnapshot} from './intakeContract.ts';
import {INTAKE_SITES,INTAKE_RECIPIENTS} from './intakePolicy.ts';
import type {IntakeChannel} from './intakeDeliveryPolicy.ts';

export interface IntakeEmail {to:string;subject:string;text:string;attachments:{filename:string;base64:string}[]}
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
 return {draftId:s.draftId,contact:s.contact,scope:s.scope,brand:site.name,customer:{summary}};
}
export function intakeDeliveryEnvelope(s:IntakeSnapshot,channel:IntakeChannel,snapshotDigest:string):IntakeDeliveryEnvelope {
 const envelope:IntakeDeliveryEnvelope={schema:1,channel,key:intakeOperationKey(s,channel),leadKey:intakeLeadKey(s.projectId),snapshotDigest};
 if(channel==='crm')return {...envelope,request:s};
 const team=channel==='team',domain=INTAKE_SITES[s.currentSite].domain,reference=intakeReference(s.projectId);
 const staff=new URL(`https://${domain}/api/admin/p5-intake`);staff.searchParams.set('draftId',s.draftId);staff.searchParams.set('revision',String(s.revision));
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
 const text=[`Project request ${reference}, revision ${s.revision}, is saved for review.`,
  `Receiving site: ${copy.receivingSite}. Origin: ${copy.origin}. Primary team: ${copy.primaryTeam}.`,
  `Supporting work: ${copy.supportingServices.join(', ')||'None selected'}.`,
  `Customer: ${s.contact.name}. Preferred follow-up: ${s.contact.preferredContact}.`,
  `Email: ${s.contact.email||'Not provided'}. Phone: ${s.contact.phone||'Not provided'}.`,
  '',s.scope.text.length<=12000?s.scope.text:'The complete submitted scope is in the attached request JSON.',
  '',`The attachment contains all submitted answers, the conversation and ${files.length} original-file references with exact sizes and SHA-256 hashes.`,
  ...(team?[`Complete saved revision (administrator sign-in required): ${staff.href}`,
   'Original uploads are retained, not embedded in this email. Use their authenticatedOriginal links in the attachment; these require administrator sign-in and verify the exact submitted file bytes.']:['Original uploads remain saved with your request. The attachment lists the files; it does not expose staff access links.']),
  'This is a project request, not a priced estimate. A site visit or more information may be needed. No response time is promised.',
  'This message does not confirm receipt of any other notification or CRM processing.'].join('\n');
 return {...envelope,email:{to:team?INTAKE_RECIPIENTS[s.currentSite]:s.contact.email,subject:`${team?'Project request':'Your saved project request'} ${reference} · revision ${s.revision}`,text,attachments:[{filename:`${reference}-revision-${s.revision}.json`,base64:attachment.toString('base64')}]}};
}
