'use client';
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import type {ComponentProps} from 'react';
import type {P5Estimator} from './P5Estimator';

const Estimator=dynamic(()=>import('./P5Estimator').then(mod=>mod.P5Estimator),{
  loading:()=> <p role="status" style={{padding:24}}>Loading your project estimator…</p>,
});

/** Keep file processing, voice and estimating code out of the initial marketing route.
 * Intersection begins loading before the card is reached. The link works without JavaScript.
 */
export function P5LazyEstimator(props:ComponentProps<typeof P5Estimator>){
  const ref=useRef<HTMLDivElement>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    if(!ref.current)return;
    if(!('IntersectionObserver' in window)){setReady(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setReady(true);observer.disconnect();}
    },{rootMargin:'300px'});
    observer.observe(ref.current);
    return ()=>observer.disconnect();
  },[]);
  return <div ref={ref} style={{minHeight:300}}>{ready?<Estimator {...props}/>:<div style={{padding:32,background:'#fff',color:'#20231f',border:'1px solid #d9ded6',borderRadius:20}}>
    <p>Describe your project, add photos or plans, and review the details before requesting a preliminary estimate.</p>
    <a href="/estimate" onClick={event=>{event.preventDefault();setReady(true);}}>Start my estimate</a>
  </div>}</div>;
}
