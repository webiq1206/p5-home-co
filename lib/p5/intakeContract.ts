import {collectAttribution} from "../../app/lib/leads/attribution.ts";
import {readQuestionMemory,questionHistoryNotes,reconcileQuestionMemory,questionTopic,type QuestionMemory} from './intakeQuestionMemory.ts';
import {INTAKE_SITES,routeIntake,type IntakeSite,type IntakeRouting,type SupportingService,SUPPORTING_SERVICES} from './intakePolicy.ts';
import type {ScopeAnswers,ScopeExtraction,ScopeUpload} from './scope.ts';
import {SCOPE_TEXT_LIMIT} from './scope.ts';
import {sameAnswer,scopeQuestions} from './adaptive.ts';
import {pageCovered} from './documentLedger.ts';
import {scopeFingerprint,normalizeScopeText} from './scopeReplacement.ts';

export type IntakeContactField='name'|'email'|'phone'|'preferredContact';
export class IntakeContactError extends Error {
 readonly fields:IntakeContactField[];
 constructor(message:string,fields:IntakeContactField[]){super(message);this.name='IntakeContactError';this.fields=fields;}
}
export interface IntakeContact {name:string;email:string;phone:string;preferredContact:'email'|'phone'|'either'}
export interface IntakeMessage {id:string;role:'user'|'assistant';text:string;at:number;kind?:string;label?:string;caption?:string;files?:string[]}
export interface IntakeDetails {attribution?:Record<string,string>;questionMemory?:QuestionMemory;desiredOutcome:string;workContext:string;budget:string;supportingServices:SupportingService[];transcript:IntakeMessage[];reviewedScopeFingerprint?:string}
export interface IntakeContext extends IntakeDetails {projectId:string;originSite:IntakeSite;currentSite:IntakeSite;version:number;contact:IntakeContact}
export interface IntakeSnapshot {schema:1;projectId:string;originSite:IntakeSite;currentSite:IntakeSite;draftId:string;revision:number;contextVersion:number;contact:IntakeContact;details:IntakeDetails;scope:{text:string;answers:ScopeAnswers;extraction:ScopeExtraction|null;uploads:ScopeUpload[]};routing:IntakeRouting;unresolved:string[];savedAt:string}
export interface IntakeReceipt {accepted:true;projectId:string;reference:string;revision:number;team:IntakeRouting;unresolved:string[];savedAt:string;delivery:{customer:string;team:string;crm:string};deliveryDetails?:{customer:string;team:string;crm:string}}
export const INTAKE_CONTEXT_KEY='intake-context-v1';
export const INTAKE_SUBMISSION_KEY='intake-submission-v1';
export const INTAKE_BODY_LIMIT=1024*1024;
export const emptyIntakeDetails=():IntakeDetails=>({desiredOutcome:'',workContext:'',budget:'',supportingServices:[],transcript:[]});
function text(value:unknown,label:string,max:number):string {
  if(typeof value!=='string'||value.length>max)throw new Error(`${label} is invalid or too long. Your saved information has not been replaced.`);
  return value.trim();
}
export function intakeContact(raw:unknown,required=true):IntakeContact {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new IntakeContactError('Enter your contact details.',['name']);
  const c=raw as Record<string,unknown>;
  const fieldText=(field:'name'|'email'|'phone',label:string,max:number)=>{try{return text(c[field]??'',label,max);}catch(error){throw new IntakeContactError((error as Error).message,[field]);}};
  const name=fieldText('name','Name',120),email=fieldText('email','Email',200).toLowerCase(),phone=fieldText('phone','Phone',40);
  const preferredContact=c.preferredContact??'either';
  if(!['email','phone','either'].includes(String(preferredContact)))throw new IntakeContactError('Choose email, phone, or either for follow-up.',['preferredContact']);
  if(required&&!name)throw new IntakeContactError('Enter your name.',['name']);
  if(required&&email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new IntakeContactError('Enter a valid email address, or leave it blank.',['email']);
  if(required&&phone&&(phone.replace(/\D/g,'').length<10||phone.replace(/\D/g,'').length>15))throw new IntakeContactError('Enter a valid phone number, or leave it blank.',['phone']);
  if(required&&!email&&!phone)throw new IntakeContactError('Add an email address or phone number so the team can respond.',['email', 'phone']);
  if(required&&preferredContact==='email'&&!email)throw new IntakeContactError('Add your email address or choose phone for follow-up.',['email']);
  if(required&&preferredContact==='phone'&&!phone)throw new IntakeContactError('Add your phone number or choose email for follow-up.',['phone']);
  return {name,email,phone,preferredContact:preferredContact as IntakeContact['preferredContact']};
}
export function intakeDetails(raw:unknown):IntakeDetails {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Project details are invalid.');
  const d=raw as Record<string,unknown>;
  const supporting=d.supportingServices??[];
  if(!Array.isArray(supporting)||supporting.length>SUPPORTING_SERVICES.length||supporting.some(s=>!(SUPPORTING_SERVICES as readonly unknown[]).includes(s)))throw new Error('Choose supporting services from the project review.');
  const messages=d.transcript??[];
  if(!Array.isArray(messages)||messages.length>500)throw new Error('This conversation is too long to save in one request. Your existing project is retained.');
  const transcript=messages.map((raw):IntakeMessage=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Conversation entry is invalid.');
    const m=raw as Record<string,unknown>;
    if(!['user','assistant'].includes(String(m.role))||!Number.isFinite(m.at))throw new Error('Conversation entry is invalid.');
    if(m.files!==undefined&&(!Array.isArray(m.files)||m.files.length>50))throw new Error('Conversation file list is invalid.');
    return {id:text(m.id,'Message identity',120),role:m.role as IntakeMessage['role'],text:text(m.text,'Message',SCOPE_TEXT_LIMIT),at:Number(m.at),
      ...(m.kind?{kind:text(m.kind,'Message kind',40)}:{}),...(m.label?{label:text(m.label,'Message label',200)}:{}),...(m.caption?{caption:text(m.caption,'Message caption',500)}:{}),
      ...(Array.isArray(m.files)?{files:m.files.map(f=>text(f,'File name',4096))}:{})};
  });
  const attribution=d.attribution&&typeof d.attribution==='object'&&!Array.isArray(d.attribution)?collectAttribution(d.attribution as Record<string,unknown>):null;
  return {...(attribution?{attribution}:{}),...(d.questionMemory!==undefined?{questionMemory:readQuestionMemory(d.questionMemory)}:{}),desiredOutcome:text(d.desiredOutcome??'','Desired outcome',4000),workContext:text(d.workContext??'','Project context',1000),budget:text(d.budget??'','Budget',500),supportingServices:[...new Set(supporting)] as SupportingService[],transcript,...(d.reviewedScopeFingerprint?{reviewedScopeFingerprint:text(d.reviewedScopeFingerprint,'Scope review',120)}:{})};
}
type IntakeScopeReview={text:string;answers:ScopeAnswers;uploads?:ScopeUpload[];intake?:Pick<IntakeDetails,'supportingServices'|'reviewedScopeFingerprint'>};
/** A freshness marker, not an authorization secret. A material change requires
 * explicit customer review; earlier intentional answers are retained, not overwritten by keywords. */
export function intakeReviewFingerprint(scope:IntakeScopeReview){
 return scopeFingerprint(JSON.stringify({text:normalizeScopeText(scope.text),answers:Object.fromEntries(Object.entries(scope.answers).sort(([a],[b])=>a.localeCompare(b))),supporting:[...(scope.intake?.supportingServices||[])].sort(),files:(scope.uploads||[]).map(f=>({name:f.name,size:f.size,sha256:f.sha256})).sort((a,b)=>String(a.sha256).localeCompare(String(b.sha256)))}));
}
export function intakeScopeReviewed(scope:IntakeScopeReview){return scope.intake?.reviewedScopeFingerprint===intakeReviewFingerprint(scope);}
/** Only actual unanswered questions and observed reading gaps become outstanding details. */
export function intakeUnresolved(scope:{answers:ScopeAnswers;extraction:ScopeExtraction|null;uploads?:ScopeUpload[];analyzedUploads?:Array<{sha256:string;size:number}>;text?:string;transcript?:IntakeMessage[];intake?:Pick<IntakeDetails,'supportingServices'|'questionMemory'>;wizard?:{skipped:Array<keyof ScopeAnswers>;resolutions?:ScopeAnswers}},labels:Record<string,{label:string}>):string[] {
  const memory=reconcileQuestionMemory(scope);
  return [...new Set([
    ...questionHistoryNotes(memory),
    ...(scope.wizard?.skipped||[]).filter(f=>!scope.answers[f]?.trim()).map(f=>`${labels[f]?.label||f}: not known yet.`),
    ...(scope.extraction?.conflicts||[]).filter(c=>!scope.wizard?.resolutions?.[c.field]||!sameAnswer(c.field,scope.wizard.resolutions[c.field]!,scope.answers[c.field]||'')).map(c=>c.explanation),
    ...(scope.extraction?.reviewNotes||[]),
    ...scopeQuestions(scope.answers,scope.extraction,[],scope.wizard?.skipped||[]).filter(question=>question.instructionId&&!['laborHours','projectMonths'].includes(question.field)).flatMap(question=>{const topic=questionTopic(question,scope.answers);return topic&&memory.entries.some(e=>e.topic===topic)?[]:[topic?`Team to review: ${topic.replaceAll('-', ' ')}.`:'Team to review additional notes in the supplied materials.'];}),
    ...(scope.extraction?.documentCoverage?.pages||[]).filter(page=>!pageCovered(page)).map(page=>`${page.source}, page ${page.page}: ${page.status}; ${page.notes.join(' ')}`),
    ...(scope.uploads||[]).filter(file=>!scope.extraction||!file.sha256||!scope.analyzedUploads?.some(read=>read.sha256===file.sha256&&read.size===file.size)).map(file=>`${file.name}: saved; automatic reading of these exact file bytes is not confirmed.`),
    ...(scope.answers.exclusions?.trim()&&scope.intake?.supportingServices.length?[`Confirm the selected supporting work (${scope.intake.supportingServices.join(', ')}) against these exclusions: ${scope.answers.exclusions.trim()}`]:[]),
  ])];
}
export function intakeReference(projectId:string){return 'P5-'+projectId.split(':').at(-1)!.replace(/-/g,'').slice(0,10).toUpperCase();}
export function intakeReceipt(snapshot:IntakeSnapshot,delivery:IntakeReceipt['delivery']):IntakeReceipt {
  return {accepted:true,projectId:snapshot.projectId,reference:intakeReference(snapshot.projectId),revision:snapshot.revision,team:snapshot.routing,unresolved:snapshot.unresolved,savedAt:snapshot.savedAt,delivery};
}
export function requireIntakeReceipt(value:unknown):IntakeReceipt {
  const r=value as IntakeReceipt;
  if(!r||r.accepted!==true||typeof r.projectId!=='string'||typeof r.reference!=='string'||!Number.isInteger(r.revision)||r.revision<1||!r.team||!Object.hasOwn(INTAKE_SITES,r.team.primaryTeam)||!Array.isArray(r.unresolved)||!r.savedAt||!r.delivery)throw new Error('The saved request could not be confirmed. Your details are retained. Retry to check the same request.');
  return r;
}
export function snapshotRouting(site:IntakeSite,answers:ScopeAnswers,details:IntakeDetails,context?:Parameters<typeof routeIntake>[3]){return routeIntake(site,answers.service||'',details.supportingServices,context);}
