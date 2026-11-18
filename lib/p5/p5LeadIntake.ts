/**
 * The document estimator's leads, sent to P5 Home Co's lead system (owner decisions, 13, 17 and
 * 18 November 2026). Two things leave a brand site, both as a post to P5's public lead intake:
 *
 *  1. The visitor's unpriced PROJECT REQUEST ("Send project request"). `p5LeadIntakeTransport()` is the
 *     `crm` channel of the request delivery (intakeDelivery.ts). P5 saves a lead and a HubSpot deal in
 *     the first stage. There is no price, so nothing goes to QuickBooks.
 *  2. The ESTIMATE the team later prices and publishes for it. The brand's delivery adapter (`syncCrm`
 *     in its own lib/p5/deliveryAdapter.ts) calls `forwardEstimateToP5()`. P5 attaches it to the lead the
 *     request made and creates the QuickBooks customer and an UNSENT estimate from its figures.
 *
 * p5homeco.com does both in its own process and never posts to itself; it uses the builders here
 * (`projectRequestLead`, `projectRequestKey`, and `documentEstimate` in documentEstimateFigures.ts) so
 * the two paths cannot drift.
 *
 * Rules this file exists to keep:
 *  - CUSTOMER PRICES ONLY. `documentEstimateBody()` reads each line's customer amount and nothing else.
 *    No cost, margin, markup, profit, contingency or overhead figure, and no field of that name, is in
 *    what it returns. QuickBooks holds the customer's estimate; internal figures stay on the site.
 *  - ONE team email. The site has already emailed the team (the request's own `team` channel, or the
 *    estimate's internal record), so each post says `team_alert: "site"` and P5 sends no second email.
 *    P5 honours that only for these two forms, and for an estimate only beside readable figures: when
 *    the figures cannot be sent the lead goes without both and P5's usual "New lead" email covers it.
 *  - ONE lead per project. A request's id at P5 is its lead key (`envelope.leadKey`), the same for
 *    every revision. The estimate carries that key as `request_external_id`, and P5 attaches it to the
 *    lead that holds it, whichever brand the request was filed under.
 *  - Nothing synthetic. A QA record is never posted.
 *
 * The contract belongs to p5homeco.com (docs/lead-intake-contract.md there). This file is shared:
 * edit it in p5-home-co only and publish it with scripts/p5-sync.mjs. It imports nothing outside lib/p5.
 */
import {createHash} from 'node:crypto';
import {suppressSyntheticEstimateNotifications} from './estimatorNotifications.ts';
import {documentEstimateBody,linesByTrade,type DocumentEstimateLine} from './documentEstimateFigures.ts';
import type {IntakeDeliveryEnvelope} from './intakeDeliveryPayload.ts';
import type {IntakeDeliveryReason} from './intakeDeliveryPolicy.ts';
import type {IntakeTransport} from './intakeDelivery.ts';
import type {IntakeSnapshot} from './intakeContract.ts';
export {documentEstimate,documentEstimateBody,DOCUMENT_ESTIMATE_MAX_LINES,type DocumentEstimateBody,type DocumentEstimateLine} from './documentEstimateFigures.ts';
import {INTAKE_SITES} from './intakePolicy.ts';

/** P5's public lead intake. */
export const P5_INTAKE_URL='https://p5homeco.com/api/leads/intake';
/** How long one post may take. P5 saves the lead and answers; HubSpot and QuickBooks run there after the answer. */
export const P5_FORWARD_TIMEOUT_MS=30_000;
/** The form a published estimate is filed under, the same one P5's own document estimator uses. */
export const P5_ESTIMATOR_FORM='p5-estimator';
/** The form a visitor's unpriced project request is filed under. */
export const P5_PROJECT_REQUEST_FORM='p5-project-request';
/** The intake refuses a body above 32 KB. Kept under it with room to spare. */
export const P5_INTAKE_BODY_LIMIT_BYTES=30_000;
/**
 * Requests saved before this moment stay out of the lead system. Without it, the day this ships
 * every older request still waiting on the CRM channel would arrive in HubSpot at once as a new lead
 * with a first-contact task, weeks after the team answered it by email. A runtime may pass another
 * moment (`since`) to bring older requests in on purpose.
 */
export const PROJECT_REQUEST_LEADS_SINCE='2026-11-18T00:00:00.000Z';
/**
 * A failed post may be sent again for this long. Safe because P5 keeps one lead per brand and
 * `external_id`: a repeat of the same request makes no second lead, sends no email (`team_alert:
 * "site"`) and changes nothing in HubSpot. The intake's own test holds that.
 */
export const P5_LEAD_RETRY_WINDOW_MS=2*60*60*1000;

export interface P5IntakeOptions {
  /** Test seam. Default: the global fetch. */
  fetch?:typeof fetch;
  /** Default: the production intake. */
  url?:string;
}
export interface ForwardEstimateOptions extends P5IntakeOptions {
  /** The brand's display name exactly as the intake expects it, for example "Boise Remodeling Co". */
  brand:string;
}
export interface P5LeadIntakeTransportConfig extends P5IntakeOptions {
  /** The site's existing CRM setting (`P5_CRM_DELIVERY === 'on'`). Off means `crm-disabled`. */
  enabled:boolean;
  /** ISO moment. Requests saved before it are held. Default: `PROJECT_REQUEST_LEADS_SINCE`. */
  since?:string;
}
/** One project request as a lead: the fields both the post and P5's own in-process path use. */
export interface ProjectRequestLead {
  brand:string;name:string;email:string;phone:string;projectType:string;address:string;city:string;
  /** Plain text, bounded: what was asked, the reference and how many files. Never file contents. */
  message:string;
  form:typeof P5_PROJECT_REQUEST_FORM;
  /** The request's lead key: one per project, the same for every revision. */
  externalId:string;
  sourceDetail:string;
  /** 'email' or 'phone' when the visitor chose one. */
  contactPreference:''|'email'|'phone';
  attribution:Record<string,string>;
  savedAt:string;
}

const oneLine=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
const bodyBytes=(body:unknown)=>new TextEncoder().encode(JSON.stringify(body)).byteLength;
/** One lead across a project's revisions. The same formula as `intakeLeadKey` in intakeDeliveryPayload.ts; a test holds them equal. */
export const projectLeadKey=(projectId:string)=>'p5-intake-'+createHash('sha256').update(projectId).digest('hex');

// ---------------------------------------------------------------------------
// Identity: one lead per project
// ---------------------------------------------------------------------------

const PROJECT_ID=/^(?:p5|construction|remodeling|handyman|cabinet):[a-f\d-]{36}$/i;
const DRAFT_ID=/^[a-f\d-]{36}$/i;

/**
 * The lead key of the project request an estimate belongs to, or '' when it cannot be known.
 * The record's own `projectId` is used when it has one (stamped when the estimate is published). A
 * record without one is read as a project that began on this site (`<site>:<draftId>`), which is what
 * every project is unless it was handed to this site from another.
 */
export function projectRequestKey(record:unknown,brand:string):string{
  const source=(record&&typeof record==='object'?record:{}) as {projectId?:unknown;draftId?:unknown};
  const stamped=oneLine(source.projectId,80);
  if(PROJECT_ID.test(stamped))return projectLeadKey(stamped);
  const site=Object.entries(INTAKE_SITES).find(([,value])=>value.name===brand)?.[0];
  const draft=oneLine(source.draftId,80);
  return site&&DRAFT_ID.test(draft)?projectLeadKey(`${site}:${draft}`):'';
}

/**
 * The estimate's own id at P5: one per draft, the same for every revision of it. P5 keeps one lead
 * per brand and id, so an estimate sent again or revised is the same lead, and its new figures revise
 * the same QuickBooks estimate (while nobody has worked it) instead of adding a second one.
 */
export function estimateExternalId(record:unknown,key=''):string{
  const draft=oneLine((record as {draftId?:unknown}|null)?.draftId,120);
  return `${P5_ESTIMATOR_FORM}:${draft||oneLine(key,120)}`;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** Campaign fields the intake reads by these names. Values are passed as they were saved; P5 cleans them. */
const ATTRIBUTION_FIELDS=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','fbclid','landing_page','referrer'];
/** A landing page travels as a path: the intake keeps a path and drops any other site's address. */
function landingPath(value:string):string{
  if(!/^https?:\/\//i.test(value))return value;
  try{return new URL(value).pathname;}catch{return '';}
}
function flatAttribution(saved:unknown,prefix=''):Record<string,string>{
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return {};
  const values=saved as Record<string,unknown>,fields:Record<string,string>={};
  for(const key of ATTRIBUTION_FIELDS){
    const raw=oneLine(values[key]??(key==='landing_page'?values.landingPage:undefined),300);
    const value=key==='landing_page'?landingPath(raw):raw;
    if(value)fields[prefix+key]=value;
  }
  return fields;
}
/**
 * The campaign fields a record or a request carries. Two saved shapes are read: flat names
 * (`utm_source`, `first_gclid`, ...) and a first and latest touch (`{first:{...},latest:{...}}`).
 */
function attributionFields(saved:unknown):Record<string,string>{
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return {};
  const values=saved as Record<string,unknown>;
  if(values.latest||values.first)return {...flatAttribution(values.first,'first_'),...flatAttribution(values.latest)};
  const first=Object.fromEntries(ATTRIBUTION_FIELDS.map(key=>[key,values[`first_${key}`]]));
  const source=oneLine(values.source,80);
  return {...flatAttribution(first,'first_'),...flatAttribution(values),...(source?{source}:{})};
}

// ---------------------------------------------------------------------------
// The post
// ---------------------------------------------------------------------------

/**
 * One post to the intake. Throws a short Error, with no response body and no secret in it, when P5
 * does not answer 2xx with `ok: true`, when the answer is not JSON, or when the post fails or times out.
 */
async function postToP5Intake(body:Record<string,unknown>,options:P5IntakeOptions,what:string):Promise<void>{
  let destination:URL;
  try{destination=new URL(options.url||P5_INTAKE_URL);}catch{throw new Error('P5 intake address must be a credential-free HTTPS endpoint');}
  if(destination.protocol!=='https:'||destination.username||destination.password)throw new Error('P5 intake address must be a credential-free HTTPS endpoint');
  let response:Response;
  try{
    response=await (options.fetch??fetch)(destination,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(P5_FORWARD_TIMEOUT_MS),body:JSON.stringify(body)});
  }catch(error){
    const timedOut=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');
    throw new Error(timedOut?`P5 intake did not answer in time; the ${what} was not confirmed`:`P5 intake could not be reached; the ${what} was not confirmed`);
  }
  if(!response.ok)throw new Error(`P5 intake refused the ${what} (HTTP ${response.status})`);
  let answer:unknown;
  try{answer=await response.json();}catch{throw new Error('P5 intake answer was not valid JSON');}
  if(!answer||typeof answer!=='object'||(answer as {ok?:unknown}).ok!==true)throw new Error(`P5 intake did not accept the ${what}`);
}

// ---------------------------------------------------------------------------
// 1. The published estimate
// ---------------------------------------------------------------------------

/**
 * The intake body for one published estimate. With usable figures it carries `estimate` and
 * `team_alert: "site"` (this site has already emailed the team its estimate record). Without them it
 * carries neither, so P5 sends its usual "New lead" email. A body too large for the intake keeps its
 * total and gives up detail: line descriptions first, then one line per trade, then the contract price alone.
 */
export function estimateIntakeBody(record:unknown,key:string,options:Pick<ForwardEstimateOptions,'brand'>):Record<string,unknown>{
  const source=(record&&typeof record==='object'?record:{}) as {attribution?:unknown;contact?:{name?:unknown;email?:unknown;phone?:unknown};scope?:{answers?:{service?:unknown;address?:unknown;location?:unknown}};customer?:{summary?:unknown}};
  const brand=oneLine(options.brand,80),externalId=estimateExternalId(record,key),requestKey=projectRequestKey(record,brand);
  const lead:Record<string,unknown>={
    brand,
    name:oneLine(source.contact?.name,200)||undefined,
    email:oneLine(source.contact?.email,200)||undefined,
    phone:oneLine(source.contact?.phone,60)||undefined,
    projectType:oneLine(source.scope?.answers?.service,120)||undefined,
    address:oneLine(source.scope?.answers?.address,300)||undefined,
    city:oneLine(source.scope?.answers?.location,120)||undefined,
    message:oneLine(source.customer?.summary,1500)||undefined,
    form:P5_ESTIMATOR_FORM,
    sourceDetail:externalId,
    external_id:externalId,
    ...(requestKey?{request_external_id:requestKey}:{}),
    ...attributionFields(source.attribution),
  };
  const estimate=documentEstimateBody(record);
  if(!estimate)return lead;
  const withEstimate=(lines:DocumentEstimateLine[])=>({...lead,team_alert:'site',estimate:{...estimate,lines}});
  for(const lines of [estimate.lines,estimate.lines.map(line=>{const short={...line};delete short.description;return short;}),linesByTrade(estimate.lines)]){
    const body=withEstimate(lines);
    if(bodyBytes(body)<=P5_INTAKE_BODY_LIMIT_BYTES)return body;
  }
  return withEstimate([]);
}

/**
 * Post one published estimate to P5's lead intake and return a provider id for the outbox.
 *
 * Throws a short Error (see `postToP5Intake`) when P5 does not accept it, so the outbox marks the CRM
 * job for review exactly as it does for any CRM failure. A post is safe to send again: P5 keeps one
 * lead per brand and `external_id`, and the same figures change nothing there.
 *
 * A synthetic QA record is never forwarded: it throws before any request is made. The outbox
 * suppresses such a record before it ever calls the adapter, so this is a second wall, and a thrown
 * error cannot be mistaken for a delivery.
 */
export async function forwardEstimateToP5(record:unknown,key:string,options:ForwardEstimateOptions):Promise<string>{
  if(suppressSyntheticEstimateNotifications(record))throw new Error('A synthetic QA estimate is never forwarded to P5');
  if(!oneLine(options?.brand,80))throw new Error('P5 forwarding needs the brand name');
  const body=estimateIntakeBody(record,key,options);
  if(!body.email&&!body.phone)throw new Error('P5 forwarding needs an email address or a phone number');
  await postToP5Intake(body,options,'estimate');
  return `p5-intake:${String(body.external_id)}`;
}

// ---------------------------------------------------------------------------
// 2. The visitor's project request
// ---------------------------------------------------------------------------

const PREFERRED_CONTACT:Record<string,string>={email:'Email',phone:'Phone',either:'Email or phone'};
const SUMMARY_LIMIT=3500;

/** A bounded plain-text account of the request for the lead: no price, no file contents, no storage address. */
function projectRequestSummary(s:IntakeSnapshot):string{
  const site=INTAKE_SITES[s.currentSite],files=Array.isArray(s.scope.uploads)?s.scope.uploads.length:0;
  const supporting=(s.routing.supportingServices||[]).join(', ');
  const lines=[
    `Project request${s.reference?` ${oneLine(s.reference,40)}`:''}, revision ${s.revision}, sent from ${site.domain}. No price has been given.`,
    `Team: ${oneLine(s.routing.teamName,80)}${supporting?`. Supporting services: ${oneLine(supporting,200)}`:''}`,
    PREFERRED_CONTACT[s.contact.preferredContact]?`Preferred contact: ${PREFERRED_CONTACT[s.contact.preferredContact]}`:'',
    oneLine(s.details?.desiredOutcome,600)?`What they want: ${oneLine(s.details.desiredOutcome,600)}`:'',
    oneLine(s.details?.budget,200)?`Budget: ${oneLine(s.details.budget,200)}`:'',
    oneLine(s.details?.workContext,400)?`Context: ${oneLine(s.details.workContext,400)}`:'',
    oneLine(s.scope.text,1200)?`Scope: ${oneLine(s.scope.text,1200)}`:'',
    `Files attached: ${files}`,
    (s.unresolved||[]).length?`To confirm: ${oneLine(s.unresolved.join(' '),400)}`:'',
    `Full request and files (staff sign-in): https://${site.domain}/api/admin/p5-intake?draftId=${encodeURIComponent(s.draftId)}&revision=${s.revision}`,
  ].filter(Boolean);
  return lines.join('\n').slice(0,SUMMARY_LIMIT);
}

/**
 * One request's lead fields, from the `crm` envelope the delivery worker froze. The brand is the
 * PRIMARY TEAM the request was routed to. Throws 'payload-review' when the envelope is not a request
 * this file can stand behind.
 */
export function projectRequestLead(envelope:IntakeDeliveryEnvelope):ProjectRequestLead{
  const s=envelope?.request;
  if(!s||envelope.channel!=='crm'||!PROJECT_ID.test(String(s.projectId))||envelope.leadKey!==projectLeadKey(s.projectId))throw new Error('payload-review');
  const team=Object.hasOwn(INTAKE_SITES,s.routing?.primaryTeam)?INTAKE_SITES[s.routing.primaryTeam]:null;
  if(!team||!Object.hasOwn(INTAKE_SITES,s.currentSite))throw new Error('payload-review');
  const preferred=s.contact.preferredContact;
  // Two saved shapes: p5homeco.com keeps campaign fields in the request's details, a brand site beside them.
  const saved=s as unknown as {details?:{attribution?:unknown};attribution?:unknown};
  return {
    brand:team.name,
    name:oneLine(s.contact.name,200),email:oneLine(s.contact.email,200),phone:oneLine(s.contact.phone,60),
    projectType:oneLine(s.scope.answers?.service,120),address:oneLine(s.scope.answers?.address,300),city:oneLine(s.scope.answers?.location,120),
    message:projectRequestSummary(s),
    form:P5_PROJECT_REQUEST_FORM,
    externalId:envelope.leadKey,
    sourceDetail:`${P5_PROJECT_REQUEST_FORM}:${oneLine(s.draftId,80)}`,
    contactPreference:preferred==='email'||preferred==='phone'?preferred:'',
    attribution:attributionFields(saved.details?.attribution??saved.attribution),
    savedAt:s.savedAt,
  };
}

/** The intake body for one project request: the lead, its id and `team_alert: "site"`. Never an `estimate`. */
export function projectRequestIntakeBody(envelope:IntakeDeliveryEnvelope):Record<string,unknown>{
  const lead=projectRequestLead(envelope);
  return {
    brand:lead.brand,
    name:lead.name||undefined,email:lead.email||undefined,phone:lead.phone||undefined,
    projectType:lead.projectType||undefined,address:lead.address||undefined,city:lead.city||undefined,
    message:lead.message,
    form:lead.form,
    request_kind:'quote',
    ...(lead.contactPreference?{contact_preference:lead.contactPreference}:{}),
    sourceDetail:lead.sourceDetail,
    external_id:lead.externalId,
    ...lead.attribution,
    team_alert:'site',
  };
}

/** Why a request may not go to the lead system yet, from facts alone. Null when it may. */
export function projectRequestHold(envelope:IntakeDeliveryEnvelope):IntakeDeliveryReason|null{
  try{
    if(suppressSyntheticEstimateNotifications(envelope?.request))return 'synthetic-suppressed';
    const body=projectRequestIntakeBody(envelope);
    if(!body.email&&!body.phone)return 'contact-review';
    return bodyBytes(body)<=P5_INTAKE_BODY_LIMIT_BYTES?null:'payload-review';
  }catch{return 'payload-review';}
}

/** True when the request was saved before the lead system began taking requests (`since`). */
export function projectRequestTooOld(snapshot:Pick<IntakeSnapshot,'savedAt'>,since:string=PROJECT_REQUEST_LEADS_SINCE):boolean{
  const saved=Date.parse(snapshot?.savedAt||''),start=Date.parse(since||PROJECT_REQUEST_LEADS_SINCE);
  return !Number.isFinite(saved)||saved<(Number.isFinite(start)?start:Date.parse(PROJECT_REQUEST_LEADS_SINCE));
}

/**
 * The `crm` channel of a brand site's request delivery: each saved request is posted to P5's lead
 * intake, where it becomes a lead and a HubSpot deal in the first stage.
 *
 * `validate` reads the frozen envelope only. `send` may be retried inside `P5_LEAD_RETRY_WINDOW_MS`:
 * the request's id is its lead key, so P5 answers a repeat as a duplicate and nothing is made twice.
 */
export function p5LeadIntakeTransport(config:P5LeadIntakeTransportConfig):IntakeTransport{
  const url=config.url||P5_INTAKE_URL;
  const readiness=async(snapshot:Pick<IntakeSnapshot,'savedAt'>):Promise<IntakeDeliveryReason|null>=>
    !config.enabled||projectRequestTooOld(snapshot,config.since)?'crm-disabled':null;
  return {
    retryWindowMs:P5_LEAD_RETRY_WINDOW_MS,
    identityScope:createHash('sha256').update(JSON.stringify(['p5-lead-intake-v1',url])).digest('hex'),
    readiness,
    validate:projectRequestHold,
    async send(envelope){
      const blocked=envelope.request?await readiness(envelope.request):'payload-review';
      if(blocked)throw new Error(blocked);
      const held=projectRequestHold(envelope);
      if(held)throw new Error(held);
      const body=projectRequestIntakeBody(envelope);
      await postToP5Intake(body,{fetch:config.fetch,url},'project request');
      return `p5-intake:${String(body.external_id)}`;
    },
  };
}
