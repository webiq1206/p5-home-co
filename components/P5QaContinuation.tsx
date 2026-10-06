'use client';
import {useEffect,useState} from 'react';
import P5EstimateDetails from './P5EstimateDetails';
import type {QaContinuationView} from '@/lib/p5/qaContinuation';

const endpoint='/api/admin/p5-estimators/qa-continuation';
const dollars=(micros:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(micros/1000000);
export default function P5QaContinuation({caseName,onSaved}:{caseName:string;onSaved?:(saved:boolean)=>void}){
  const [view,setView]=useState<QaContinuationView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[answer,setAnswer]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch(`${endpoint}?case=${encodeURIComponent(caseName)}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error||'QA state is unavailable.');return value;})
      .then(value=>{if(!controller.signal.aborted){setView(value);onSaved?.(value.pdf===true);}})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Inspection failed.');});
    return()=>controller.abort();
  },[caseName,refresh,onSaved]);
  const current=view?.case===caseName?view:null;
  async function act(action:string){
    if(!current||busy||current.blocked)return;
    setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({case:caseName,token:current.token,action,...(action==='answer'?{questionId:current.question?.id,answer}:{})})});
      const value=await response.json();if(!response.ok)throw new Error(value.error||'The QA action could not finish. Inspect the retained state.');setView(value);onSaved?.(value.pdf===true);setAnswer('');
    }catch(failure){setView(null);setError(failure instanceof Error?failure.message:'The action stopped. Inspect its saved state.');}
    finally{setBusy(false);}
  }
  return <section aria-label="Controlled QA continuation" style={{borderTop:'1px solid #aaa',marginTop:24,paddingTop:16}}>
    <h2>Continue the synthetic estimate</h2>
    <p>Each action preserves the existing case. Provider work requires approval of the exact request shown below. Customer, team and CRM delivery are suppressed.</p>
    <button type="button" disabled={busy} onClick={()=>{setView(null);setError('');setRefresh(value=>value+1);}} style={{minHeight:44}}>Inspect continuation</button>
    {error&&<p role="alert">{error}</p>}
    {busy&&<p role="status">Running the explicitly approved stage. Saved progress and charge holds remain protected.</p>}
    {!current&&!error&&<p role="status">Inspecting the existing case…</p>}
    {current&&<>
      <p>Revision {current.revision} · Next stage: {current.stage}</p>
      <p>QA allowance: {dollars(current.qaAllowance)}. Charged or reserved: {dollars(current.qaLiability)}. Overall authorized test ceiling: {dollars(current.overallCap)}, including prior spending.</p><p>This is the existing QA allowance, not verified remaining headroom under the overall ceiling. Reconcile historical spending and unresolved holds before any paid approval.</p>
      {current.accounting&&<p>Historical run reserve: {dollars(current.accounting.historical)}, including {dollars(current.accounting.historicalUnknownIncluded)} held for unknown historical charges. QA call counts: {current.accounting.permitted} permitted, {current.accounting.inFlight} in flight, {current.accounting.unknown} unknown.</p>}
      {current.fields.length>0&&<details><summary>Structured fixture facts</summary><dl>{current.fields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></details>}
      {current.blocked?<p role="status">{current.blocked}</p>:current.intent?<>
        <p>Request: {current.intent.requestHash}</p><p>Stage identity: {current.intent.boundary}</p>
        <p>Model: {current.intent.model}. Maximum: {dollars(current.intent.maximum)}. State: {current.intent.status}.</p>
        {current.intent.status==='settled'?<button type="button" disabled={busy} onClick={()=>void act('continue')} style={{minHeight:44}}>Continue from settled work ($0)</button>:<button type="button" disabled={busy||!['captured','permitted'].includes(current.intent.status)} onClick={()=>void act('approve')} style={{minHeight:44}}>Approve up to {dollars(current.intent.maximum)} and continue</button>}
      </>:current.stage==='details'&&current.question?<>
        <label htmlFor="qa-current-answer">{current.question.prompt}</label>
        <textarea id="qa-current-answer" value={answer} disabled={busy} onChange={event=>setAnswer(event.target.value)} maxLength={4000} rows={3} style={{display:'block',width:'100%',fontSize:16}}/>
        {current.question.options.length>0&&<p>Available choices: {current.question.options.join(', ')}</p>}
        <button type="button" disabled={busy||!answer.trim()} onClick={()=>void act('answer')} style={{minHeight:44}}>Save fixture answer or prepare its request ($0)</button>
      </>:current.stage!=='saved'&&<button type="button" disabled={busy} onClick={()=>void act('prepare')} style={{minHeight:44}}>{current.stage==='review'?'Confirm fixture facts and prepare review ($0)':`Prepare next ${current.stage} stage ($0)`}</button>}
      {current.lastOutcome&&<p role="status">{current.lastOutcome}</p>}
      {current.result&&<P5EstimateDetails result={current.result}/>}
      {current.pdf&&<p><a href={`${endpoint}?case=${encodeURIComponent(caseName)}&pdf=1&revision=${current.revision}`}>Download saved QA estimate PDF</a></p>}
    </>}
  </section>;
}
