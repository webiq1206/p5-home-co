'use client';
import {useId,useState} from 'react';
import {draftHeaders,type BrowserDraft,readJson} from '@/lib/p5/browserDraft';
import {ESTIMATOR_BRAND as brand} from '@/lib/p5/brand';
import styles from './P5Estimator.module.css';

export default function P5ReviewRequest({draft,manual=false}:{draft:BrowserDraft;manual?:boolean}){
  const id=useId();
  const [open,setOpen]=useState(false);
  const [contact,setContact]=useState({...draft.contact});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [receipt,setReceipt]=useState<{reference:string;notified:boolean}|null>(null);
  async function send(){
    if(busy||receipt)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/p5-estimator/review',{method:'POST',headers:{...draftHeaders(draft),'Content-Type':'application/json'},body:JSON.stringify(contact)});
      const data=await readJson(response);
      if(!response.ok||!data.accepted)throw new Error(data.error||'Your request could not be confirmed. Please retry or call us.');
      setReceipt(data);
    }catch(e){setError(e instanceof Error?e.message:'Your request could not be confirmed. Please call us.');}
    finally{setBusy(false);}
  }
  return <section className={styles.card} aria-label="Request a project review" onKeyDown={event=>{if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();event.stopPropagation();void send();}}}>
    {receipt?<p role="status">Request {receipt.reference} is saved. {receipt.notified?'Our team has been notified and will use your preferred contact details.':'The team notification could not be confirmed. Please call us with this reference so we can help.'}</p>:<>
      <button type="button" className={styles.primary} aria-expanded={open} aria-controls={`${id}-fields`} onClick={()=>setOpen(v=>!v)}>{manual?'Request a manual estimate':'Request a project review'}</button>
      {open&&<div id={`${id}-fields`} className={styles.panel}>
        <p className={styles.hint}>Your saved project and reference are included. Add your name and at least one way to reach you. Submitting requests human follow-up, not another automatic estimate.</p>
        {(['name','email','phone'] as const).map(key=><label key={key} className={styles.field} htmlFor={`${id}-${key}`}><span>{key==='name'?'Your name':key==='email'?'Email':'Phone'}</span><input id={`${id}-${key}`} autoComplete={key} type={key==='email'?'email':key==='phone'?'tel':'text'} value={contact[key]} maxLength={key==='name'?120:key==='email'?200:40} onChange={e=>setContact({...contact,[key]:e.target.value})}/></label>)}
        <button type="button" className={styles.primary} disabled={busy} onClick={()=>void send()}>{busy?'Sending request…':'Send review request'}</button>
        {error&&<p className={styles.fieldError} role="alert">{error}</p>}
      </div>}
    </>}
    <p className={styles.hint} style={{marginTop:12}}>Prefer to talk? <a href={`tel:${brand.phone.replace(/[^\d+]/g,'')}`}>Call {brand.phone}</a> or <a href={`mailto:${brand.email}`}>email our team</a>.</p>
  </section>;
}
