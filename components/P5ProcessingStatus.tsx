'use client';
import {useEffect,useState} from 'react';
import {elapsedLabel,processingTitles,type ProcessingStatus} from '@/lib/p5/processingStatus';
import styles from './P5Estimator.module.css';

export default function P5ProcessingStatus({message,processing,uploadPercent}:{message:string;processing?:ProcessingStatus|null;uploadPercent:number|null}){
  const [started]=useState(Date.now);
  const [clock,setClock]=useState(Date.now);
  const [updates,setUpdates]=useState<string[]>([]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const current=processing?.message||message;
  useEffect(()=>{setUpdates(prior=>prior.at(-1)===current?prior:[...prior,current].slice(-3));},[current]);
  const reportedStart=processing?.startedAt?Date.parse(processing.startedAt):started;
  const elapsed=Math.max(0,(clock-(Number.isFinite(reportedStart)?reportedStart:started))/1000);
  const hasPages=Boolean(processing?.totalPages&&processing.totalPages>0);
  const title=uploadPercent!==null?'Uploading your files':processing?processingTitles[processing.phase]:message;
  return <div className={styles.loadingOverlay}><section className={styles.loadingCard} aria-label="Estimate processing progress">
    <span className={styles.spinner} aria-hidden="true"/>
    <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p className={styles.processingMessage}>{current!==title?current:'Your saved project is being processed.'}</p></div>
    <p className={styles.processingElapsed}>{elapsedLabel(elapsed)}</p>
    {uploadPercent!==null?<div className={styles.processingMeter}><progress max={100} value={uploadPercent} aria-label="File upload progress"/><p>{uploadPercent}% transferred. Files are marked saved only after confirmation.</p></div>:hasPages?<div className={styles.processingMeter}>
      <progress max={processing!.totalPages} value={processing!.readPages||0} aria-label="Original pages fully read"/>
      <p><strong>{processing!.readPages||0} of {processing!.totalPages} original pages read</strong></p>
      <p>Document-reading progress, not overall estimate completion.</p>
    </div>:null}
    {Boolean(processing?.currentItems?.length)&&<div className={styles.processingActivity}><h3>Working on</h3><ul>{processing!.currentItems!.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    {updates.length>1&&<div className={styles.processingActivity}><h3>Recent updates</h3><ol>{updates.slice(0,-1).reverse().map((item,i)=><li key={i}>{item}</li>)}</ol></div>}
    <p className={styles.processingFootnote}>Keep this page open for your estimate. Completed work is saved. Detailed drawings and rate research can take longer.</p>
  </section></div>;
}
