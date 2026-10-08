"use client";
import {P5AddressInput} from './P5AddressInput';
import type {ReactNode,Ref} from 'react';
import type {BrowserDraft} from '../lib/p5/browserDraft';
import {INTAKE_COPY,SUPPORTING_SERVICES,intakeSite,routeIntake} from '../lib/p5/intakePolicy';
import {intakeUnresolved,intakeScopeReviewed,type IntakeContact,type IntakeReceipt} from '../lib/p5/intakeContract';
import {SCOPE_FIELDS,type ScopeField} from '../lib/p5/scope';
import styles from './P5Estimator.module.css';

const serviceLabel=(value:string)=>({kitchen:'Kitchen remodel',bathroom:'Bathroom remodel',remodel:'Interior remodel','whole-home':'Whole-home remodel',addition:'Home addition','new-construction':'New home','cabinet-product':'Cabinets, supply only','cabinet-install':'Cabinet installation',handyman:'Home repairs',re10:'Inspection repairs',adu:'ADU : team to confirm','change-order':'Change to an existing project',rush:'Urgent work : team to confirm'}[value]||value);
export function P5IntakeReview({draft,brandId,id,confirmed,onConfirm,onContact,onPreference,onAnswer,onText,onSupporting,onScopeReview,details,error,headingRef,confirmationRef,contactNameRef,contactEmailRef}:{
  draft:BrowserDraft;brandId:string;id:string;confirmed:boolean;onConfirm:(value:boolean)=>void;
  onContact:(field:keyof BrowserDraft['contact'],value:string)=>void;onPreference:(value:IntakeContact['preferredContact'])=>void;
  onAnswer:(field:ScopeField,value:string)=>void;onText:(value:string)=>void;onSupporting:(value:string[])=>void;
  onScopeReview:(value:boolean)=>void;
  details:ReactNode;error:ReactNode;headingRef:Ref<HTMLDivElement>;confirmationRef:Ref<HTMLInputElement>;contactNameRef:Ref<HTMLInputElement>;contactEmailRef:Ref<HTMLInputElement>;
}){
  const site=intakeSite(brandId)||'p5',routing=routeIntake(site,draft.answers.service||'',draft.intake?.supportingServices);
  const unresolved=[...new Set([...routing.unresolved,...intakeUnresolved(draft,SCOPE_FIELDS),...(draft.analysisWarning?[draft.analysisWarning]:[])])];
  return <>
    <div className={styles.stageHeading} ref={headingRef}><h2 tabIndex={-1} data-stage-heading>Review your project</h2><p className={styles.lead}>Check your scope, files and contact details. Unknown details can stay open for the team to review.</p></div>
    <section className={styles.card} aria-label="Project summary">
      <label className={styles.field} htmlFor={`${id}-intake-scope`}><span>Your project description</span><textarea id={`${id}-intake-scope`} rows={5} value={draft.text} onChange={e=>onText(e.target.value)}/></label>
      <label className={styles.field} htmlFor={`${id}-intake-service`}><span>What best describes the whole project?</span><select id={`${id}-intake-service`} value={draft.answers.service||''} onChange={e=>onAnswer('service',e.target.value)}><option value="">Not sure : help me choose</option>{SCOPE_FIELDS.service.options.map(value=><option key={value} value={value}>{serviceLabel(value)}</option>)}</select></label>
      <details className={styles.editDetails}><summary>Add or edit optional project details</summary><p className={styles.hint}>Your description and files are already included. You do not need to repeat them here.</p>
      <P5AddressInput id={`${id}-intake-location`} value={Object.hasOwn(draft.answers,'address')?draft.answers.address||'':draft.answers.location||''} onChange={value=>onAnswer(Object.hasOwn(draft.answers,'address')?'address':'location',value)}/>
      {(['desiredOutcome','schedule','workContext','budget'] as const).map(field=><label className={styles.field} key={field} htmlFor={`${id}-intake-${field}`}><span>{field==='budget'?'Budget range':SCOPE_FIELDS[field].label} <span className={styles.optional}>(if known)</span></span><textarea id={`${id}-intake-${field}`} rows={2} value={draft.answers[field]||''} onChange={e=>onAnswer(field,e.target.value)} placeholder={field==='schedule'?'A target date, a deadline, or not sure yet':field==='workContext'?'Existing home, addition, or new construction':field==='budget'?'A target or range, if you have one':'What would a successful project change for you?'}/></label>)}
      </details>
      {details}
    </section>
    <section className={styles.card} aria-label="Project team"><h3>{intakeScopeReviewed(draft)?'Primary team':'Suggested primary team'}: {routing.teamName}</h3><p className={styles.hint}>{site==='p5'?'Your request stays with P5 Home Co. One primary team coordinates the supporting work.':routing.handoff?`This project type belongs with ${routing.teamName}. Review the whole scope before continuing there with your saved conversation, contact details and files.`:'This team will review your whole project.'}</p>
      <details className={styles.editDetails}><summary>Supporting work, if included</summary><div>{SUPPORTING_SERVICES.map(value=><label key={value} className={styles.check}><input type="checkbox" checked={routing.supportingServices.includes(value)} onChange={e=>onSupporting(e.target.checked?[...routing.supportingServices,value]:routing.supportingServices.filter(v=>v!==value))}/><span>{value.replaceAll('-',' ')}</span></label>)}</div></details>
      <p className={styles.hint}>Included supporting work: {routing.supportingServices.map(value=>value.replaceAll('-',' ')).join(', ')||'None selected'}</p>
      <label className={styles.field} htmlFor={`${id}-intake-exclusions`}><span>Work to leave out or keep unchanged (if known)</span><textarea id={`${id}-intake-exclusions`} rows={2} value={draft.answers.exclusions||''} onChange={e=>onAnswer('exclusions',e.target.value)}/></label>
      {!intakeScopeReviewed(draft)&&<p role="status">Check the project type, supporting work and exclusions against your current description. Earlier choices are retained for you to review.</p>}
      <label className={styles.check}><input type="checkbox" checked={intakeScopeReviewed(draft)} onChange={e=>onScopeReview(e.target.checked)}/><span>I checked the whole project type, supporting work and exclusions against this description.</span></label>
    </section>
    <section className={styles.card} aria-label="Saved project files"><h3>Files for review</h3>{draft.uploads?.length?<ul className={styles.files}>{draft.uploads.map(file=><li key={file.id}><span>{file.name}</span><small>Saved for review</small></li>)}</ul>:<p className={styles.hint}>No files attached. You can add photos, plans, an inspection report or scope documents below.</p>}{unresolved.length>0&&<><h3 style={{marginTop:16}}>Details still to confirm</h3><ul className={styles.bullets}>{unresolved.map((item,index)=><li key={index}>{item}</li>)}</ul></>}</section>
    <section className={styles.card} aria-label="Contact details"><h3>How should the team reach you?</h3><p className={styles.hint}>Share your email and phone number so we can discuss your project and send your estimate. You can provide either one and choose how we contact you. An email address also lets us send a confirmation copy.</p>
      <div className={styles.contactGrid}>{([['name','Your name','text'],['email','Email','email'],['phone','Phone','tel']] as const).map(([field,label,type])=><label key={field} className={styles.field} htmlFor={`${id}-contact-${field}`}><span>{label}</span><input ref={field==='name'?contactNameRef:field==='email'?contactEmailRef:undefined} id={`${id}-contact-${field}`} autoComplete={field} type={type} value={draft.contact[field]} maxLength={field==='name'?120:field==='email'?200:40} onChange={e=>onContact(field,e.target.value)}/></label>)}</div>
      <label className={styles.field} htmlFor={`${id}-preferred-contact`}><span>Preferred contact method</span><select id={`${id}-preferred-contact`} value={draft.intake?.contact.preferredContact||'either'} onChange={e=>onPreference(e.target.value as IntakeContact['preferredContact'])}><option value="either">Email or phone</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
      <label className={styles.check}><input ref={confirmationRef} type="checkbox" checked={confirmed} onChange={e=>onConfirm(e.target.checked)}/><span>These details reflect my project. I understand the team will review them before preparing an estimate.</span></label>
    </section>
    {error}
  </>;
}
const statusLabel=(value:string)=>({pending:'Pending',blocked:'Awaiting configuration review',sending:'In progress',retry:'Retry pending',accepted:'Provider accepted',received:'Receipt verified',confirmed:'Confirmed',unknown:'Outcome needs checking',failed:'Needs attention','not-requested':'No email requested',suppressed:'Test delivery suppressed'}[value]||'Pending review');
export function P5IntakeReceipt({receipt,headingRef}:{receipt:IntakeReceipt;headingRef:Ref<HTMLDivElement>}){
  return <>
    <div ref={headingRef} className={styles.stageHeading}><p className={styles.eyebrow}>Request {receipt.reference}</p><h2 tabIndex={-1} data-stage-heading>Your project request is saved</h2><p className={styles.lead}>{receipt.team.teamName} is the primary team for this request.</p></div>
    <section className={styles.card}><h3>What happens next</h3><p>{INTAKE_COPY.next}</p>{receipt.unresolved.length>0&&<><h3 style={{marginTop:16}}>Details still to confirm</h3><ul className={styles.bullets}>{receipt.unresolved.map((item,index)=><li key={index}>{item}</li>)}</ul></>}</section>
    <ul className={styles.deliveryList} aria-label="Request status"><li>Project request<span>Saved</span></li><li>Customer confirmation<span>{statusLabel(receipt.delivery.customer)}</span></li><li>Team notification<span>{statusLabel(receipt.delivery.team)}</span></li></ul>
    {receipt.deliveryDetails&&<ul className={styles.bullets}>{(['customer','team'] as const).filter(channel=>receipt.deliveryDetails?.[channel]).map(channel=><li key={channel}>{channel==='customer'?'Customer confirmation':'Team notification'}: {receipt.deliveryDetails![channel]}</li>)}</ul>}
    <p className={styles.hint}>Your request is recorded even if a notification is pending. You do not need to submit it again.</p>
  </>;
}
