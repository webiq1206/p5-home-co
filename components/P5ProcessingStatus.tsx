'use client';
import {useEffect,useState} from 'react';
import {processingTitles,type ProcessingStatus} from '@/lib/p5/processingStatus';
import styles from './P5Estimator.module.css';

export default function P5ProcessingStatus({message,processing,uploadPercent,onPause}:{message:string;processing?:ProcessingStatus|null;uploadPercent:number|null;onPause?:()=>void}){
  const [started]=useState(Date.now);
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const elapsed=Math.max(0,Math.floor((clock-started)/1000));
  const total=processing?.totalPages||0;
  const read=Math.min(total,processing?.readPages||0);
  const uploading=uploadPercent!==null;
  const title=uploading?'Saving your files':processing?.phase==='reading'&&!total?'Understanding your project':processing?processingTitles[processing.phase]:message.replace(/\.+$/,'');
  const item=processing?.currentItems?.[0];
  const detail=uploading?'Keep this tab open until your files are saved.':total&&read<total?'Checking dimensions, notes and included work.':processing?.phase==='retrying'?'Your progress is saved while the connection recovers.':'Checking your scope so we only ask for missing details.';
  return <section className={styles.loadingCard} aria-label="Estimate processing progress" data-testid="p5-processing">
    <div className={styles.processingHeader}><span className={styles.spinner} aria-hidden="true"/><span className={styles.eyebrow}>Working on your project</span><span className={styles.processingElapsed} aria-label="Elapsed time">{elapsed}s</span></div>
    <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p className={styles.processingMessage}>{detail}</p></div>
    {(uploading||total>0)&&<div className={styles.processingMeter}>
      <div className={styles.processingCount}><strong>{uploading?`${uploadPercent}% uploaded`:`${read} of ${total} pages checked`}</strong><span>{uploading?'Upload':read===total?'Pages checked':'Document review'}</span></div>
      <progress max={uploading?100:total} value={uploading?uploadPercent:read} aria-label={uploading?'File upload progress':'Original pages fully read'}/>
    </div>}
    {item&&<p className={styles.processingFile} title={item}>{item}</p>}
    <div className={styles.processingFooter}><span>Completed checks are saved.</span>{onPause&&<button type="button" onClick={onPause}>Back to project</button>}</div>
  </section>;
}
