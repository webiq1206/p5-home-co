'use client';
import {useEffect,useState} from 'react';
import {processingPresentation,stageTitle,remainingRange,remainingLabel,waitSentence,type ProcessingStatus,type ProjectMaterials} from '@/lib/p5/processingStatus';
import styles from './P5Estimator.module.css';

/** "Email me when it's ready": the page records the address with the running estimate and may then close. */
export interface WaitChoice {email:string;onEmail:(email:string)=>Promise<string|null>}
/** Inline progress card. Shows completed work honestly: pages checked, the stage that is actually
 * running (named for the materials the customer provided), and a time range recomputed from the work
 * still left. Never an invented percentage or a fixed countdown. */
export default function P5ProcessingStatus({message,processing,uploadPercent,onPause,hasAttachments,materials,kind,waitChoice}:{message:string;processing?:ProcessingStatus|null;uploadPercent:number|null;onPause?:()=>void;hasAttachments?:boolean;materials?:ProjectMaterials|null;kind?:'analysis'|'pricing';waitChoice?:WaitChoice|null}){
  const [started]=useState(Date.now);
  const [clock,setClock]=useState(Date.now);
  const [choice,setChoice]=useState<'ask'|'stay'|'email'|'emailed'>('ask');
  const [email,setEmail]=useState(waitChoice?.email||'');
  const [emailError,setEmailError]=useState('');
  const [sending,setSending]=useState(false);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const elapsed=Math.max(0,Math.floor((clock-started)/1000));
  const {total,read,uploading,title:fallbackTitle,detail}=processingPresentation(message,processing,uploadPercent,hasAttachments);
  const title=uploading||!processing?fallbackTitle:stageTitle(processing,materials);
  const item=processing?.currentItems?.[0];
  // Optional on the status contract: only readers that report unread sections send it.
  const failed:string[]=(processing as {failedItems?:string[]}|null|undefined)?.failedItems||[];
  const stageStarted=processing?.stageStartedAt?Date.parse(processing.stageStartedAt):NaN;
  const stageSeconds=Number.isFinite(stageStarted)?Math.max(0,Math.floor((clock-stageStarted)/1000)):null;
  const done=processing?.completedSteps||0;
  const jobStarted=processing?.startedAt?Date.parse(processing.startedAt):started;
  const jobSeconds=Math.max(0,Math.floor((clock-(Number.isFinite(jobStarted)?jobStarted:started))/1000));
  const range=uploading||!kind?null:remainingRange(processing,materials,kind,stageSeconds||0);
  // Past the high end of a range computed at the start of the stage, say so plainly rather than guessing again.
  const fresh=uploading||!kind?null:remainingRange(processing,materials,kind,0);
  const overdue=Boolean(fresh&&stageSeconds!==null&&stageSeconds>fresh.high*1.5+30&&jobSeconds>90);
  const eta=remainingLabel(range,overdue);
  // The wait-or-email choice carries the SAME live ETA as the progress line (owner rule 2026-09-22), and
  // says plainly that it is still being worked out rather than inventing a duration.
  const assessing=Boolean(kind)&&!range&&!uploading;
  const etaSentence=waitSentence(range,assessing,overdue);
  const sendEmail=async()=>{
    if(!waitChoice)return;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setEmailError('Enter a valid email address.');return;}
    setSending(true);setEmailError('');
    try{const problem=await waitChoice.onEmail(email.trim());if(problem)setEmailError(problem);else setChoice('emailed');}
    finally{setSending(false);}
  };
  return <section className={styles.processing} aria-label="Estimate processing progress" data-testid="p5-processing">
    <div className={styles.processingHeader}><span className={styles.spinner} aria-hidden="true"/><span className={styles.eyebrow}>Working on your project</span><span className={styles.processingElapsed} aria-label="Elapsed time">{elapsed}s</span></div>
    <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p className={styles.processingMessage}>{detail}</p>{eta&&<p className={styles.processingEta} data-testid="p5-eta">{eta}</p>}</div>
    {(uploading||total>0)&&<div className={styles.processingMeter}>
      <div className={styles.processingCount}><strong>{uploading?`${uploadPercent}% uploaded`:`${read} of ${total} pages checked`}</strong><span>{uploading?'Upload':read===total?'Pages checked':'Document review'}</span></div>
      <progress max={uploading?100:total} value={uploading?uploadPercent!:read} aria-label={uploading?'File upload progress':'Original pages checked'}/>
    </div>}
    {!uploading&&!total&&(done>0||stageSeconds!==null)&&<p className={styles.processingSteps}>
      {done>0?`${done} ${done===1?'check':'checks'} completed`:'First check running'}{stageSeconds!==null?` · this step ${stageSeconds}s`:''}
    </p>}
    {item&&<p className={styles.processingFile} title={item}>{item}</p>}
    {failed.length>0&&<p className={styles.processingMessage}>Saved but not checked yet: {failed.slice(0,3).join(', ')}{failed.length>3?` and ${failed.length-3} more`:''}. Retry document reading before pricing.</p>}
    {waitChoice&&!uploading&&<div className={styles.waitChoice} data-testid="p5-wait-choice">
      {etaSentence&&<p className={styles.waitEta} data-testid="p5-wait-eta">{etaSentence}</p>}
      {choice!=='emailed'&&<p className={styles.processingMessage}>Stay here to see it when it is ready, or we will email you a link when it is finished. Your estimate keeps going either way.</p>}
      {(choice==='ask'||choice==='stay')&&<div className={styles.waitButtons}>
        <button type="button" className={styles.secondary} data-active={choice==='stay'?true:undefined} onClick={()=>setChoice('stay')}>Stay here</button>
        <button type="button" className={styles.primary} onClick={()=>setChoice('email')}>Email me when it&apos;s ready</button></div>}
      {choice==='stay'&&<p className={styles.processingMessage}>Staying here. Your estimate will appear as soon as it is ready, and you can still choose email above.</p>}
      {choice==='email'&&<div className={styles.waitEmail}>
        <label className={styles.field} htmlFor="p5-wait-email"><span>Email for your estimate</span><input id="p5-wait-email" type="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setEmailError('');}} maxLength={200} aria-invalid={emailError?true:undefined}/></label>
        {emailError&&<p className={styles.processingMessage} role="alert">{emailError}</p>}
        <div className={styles.waitButtons}><button type="button" className={styles.primary} disabled={sending} onClick={()=>{void sendEmail();}}>{sending?'Saving...':'Email me'}</button><button type="button" className={styles.secondary} onClick={()=>setChoice('stay')}>Stay here instead</button></div></div>}
      {choice==='emailed'&&<p className={styles.processingMessage} role="status"><strong>You can close this page.</strong> We will email {email.trim()} a link to your estimate when it is ready. Your project and uploads are saved.</p>}
    </div>}
    <div className={styles.processingFooter}><span>Completed checks are saved. You can come back to this page later.</span>{onPause&&<button type="button" className={styles.iconButton} onClick={onPause}>Back to project</button>}</div>
  </section>;
}
