'use client';
import {useEffect,useState} from 'react';
import {processingTitles,type ProcessingStatus} from '@/lib/p5/processingStatus';
import styles from './P5Estimator.module.css';

/** Inline progress card. Shows completed work honestly: pages checked, the
 * current stage and elapsed time. Never an invented percentage. */
export default function P5ProcessingStatus({message,processing,uploadPercent,onPause}:{message:string;processing?:ProcessingStatus|null;uploadPercent:number|null;onPause?:()=>void}){
  const [started]=useState(Date.now);
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const elapsed=Math.max(0,Math.floor((clock-started)/1000));
  const total=processing?.totalPages||0;
  const read=Math.min(total,processing?.readPages||0);
  const uploading=uploadPercent!==null;
  const title=uploading?'Saving your files':processing&&['reading','cross-referencing'].includes(processing.phase)&&!total?'Understanding your project':processing?processingTitles[processing.phase]:message.replace(/\.+$/,'');
  const item=processing?.currentItems?.[0];
  // Seconds THIS stage has been running. Total elapsed says nothing about
  // whether anything is still happening; a step clock that keeps moving does.
  const stageStarted=processing?.stageStartedAt?Date.parse(processing.stageStartedAt):NaN;
  const stageSeconds=Number.isFinite(stageStarted)?Math.max(0,Math.floor((clock-stageStarted)/1000)):null;
  const done=processing?.completedSteps||0;
  // No invented percentage and no guessed ETA: a long stage is simply said to
  // be long, so a slow published-cost lookup never reads as a hung page.
  const patience=stageSeconds!==null&&stageSeconds>=45?'This step is still running. Detailed scopes can take a couple of minutes here, and every finished step is already saved.':'';
  const detail=uploading?'Keep this tab open until your files are saved.':total&&read<total?'Checking dimensions, notes and included work on each page.':processing?.phase==='retrying'?'Your progress is saved while the connection recovers.':processing?.message||'Checking your scope so we only ask about what is missing.';
  return <section className={styles.processing} aria-label="Estimate processing progress" data-testid="p5-processing">
    <div className={styles.processingHeader}><span className={styles.spinner} aria-hidden="true"/><span className={styles.eyebrow}>Working on your project</span><span className={styles.processingElapsed} aria-label="Elapsed time">{elapsed}s</span></div>
    <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p className={styles.processingMessage}>{detail}</p></div>
    {(uploading||total>0)&&<div className={styles.processingMeter}>
      <div className={styles.processingCount}><strong>{uploading?`${uploadPercent}% uploaded`:`${read} of ${total} pages checked`}</strong><span>{uploading?'Upload':read===total?'Pages checked':'Document review'}</span></div>
      <progress max={uploading?100:total} value={uploading?uploadPercent:read} aria-label={uploading?'File upload progress':'Original pages fully read'}/>
    </div>}
    {!uploading&&!total&&(done>0||stageSeconds!==null)&&<p className={styles.processingSteps}>
      {done>0?`${done} ${done===1?'check':'checks'} completed`:'First check running'}{stageSeconds!==null?` · this step ${stageSeconds}s`:''}
    </p>}
    {item&&<p className={styles.processingFile} title={item}>{item}</p>}
    {patience&&<p className={styles.processingMessage}>{patience}</p>}
    <div className={styles.processingFooter}><span>Completed checks are saved. You can come back to this page later.</span>{onPause&&<button type="button" className={styles.iconButton} onClick={onPause}>Back to project</button>}</div>
  </section>;
}
