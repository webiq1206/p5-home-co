'use client';
import {useEffect,useState} from 'react';
import type {QaReadingInspection} from '@/lib/p5/qaSavedReading';
import P5QaContinuation from './P5QaContinuation';

const cases=[['remodel','Remodel'],['kitchen','Kitchen'],['case-1','Synthetic case 1'],['case-4','Synthetic case 4'],['case-5','Synthetic case 5'],['case-6','Synthetic case 6']];
const endpoint='/api/admin/p5-estimators/qa-recovery';
export default function P5QaSavedReading({initialCase}:{initialCase?:string}){
  const [selected,setSelected]=useState(()=>cases.some(([value])=>value===initialCase)?initialCase!:'remodel');
  const [inspection,setInspection]=useState<QaReadingInspection|null>(null);
  const [submitted,setSubmitted]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch(`${endpoint}?case=${encodeURIComponent(selected)}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'This saved reading could not be inspected.');return data;})
      .then(data=>{if(!controller.signal.aborted)setInspection(data);})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Inspection failed.');});
    return()=>controller.abort();
  },[selected,refresh]);
  async function apply(){
    if(!inspection?.eligible||!inspection.operation||inspection.case!==selected||busy)return;
    setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({case:selected,revision:inspection.revision,operation:inspection.operation})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'The saved reading could not be applied.');setInspection(data);
    }catch(failure){setInspection(null);setError(failure instanceof Error?failure.message:'Recovery failed. Inspect this case again before retrying.');}
    finally{setBusy(false);}
  }
  return <main style={{maxWidth:760,margin:'0 auto',padding:24,overflowWrap:'anywhere'}}>
    <h1>QA saved-reading recovery</h1>
    <p>Inspect an existing synthetic case and apply its verified saved reading. Estimate pricing and PDF acceptance remain separate checks.</p>
    <label htmlFor="qa-recovery-case">Synthetic case</label>{' '}
    <select id="qa-recovery-case" value={selected} disabled={busy} onChange={event=>{setInspection(null);setError('');setSubmitted(false);setSelected(event.target.value);}} style={{minHeight:44,fontSize:16}}>
      {cases.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
    {' '}<button type="button" disabled={busy} onClick={()=>{setInspection(null);setError('');setRefresh(value=>value+1);}} style={{minHeight:44}}>Inspect again</button>
    {!submitted&&error&&<p role="alert">{error}</p>}
    {!submitted&&!inspection&&!error&&<p role="status">Inspecting the saved reading…</p>}
    {!submitted&&inspection&&<section aria-label="Saved-reading inspection">
      <h2>{inspection.label}</h2>
      <p>Case {inspection.id} · Revision {inspection.revision}</p>
      <p>Checked {inspection.checkedAt}</p>
      {inspection.applied?<p role="status">Saved reading applied. Pricing has not been started.</p>:inspection.eligible?<>
        <p>{inspection.retainedFacts} verified facts retained. Changed answer fields: {inspection.changedFields?.join(', ')||'none'}.</p>
        <button type="button" disabled={busy} onClick={()=>void apply()} style={{minHeight:44,padding:'10px 16px',fontSize:16}}>{busy?'Applying saved reading…':'Apply verified saved reading'}</button>
      </>:<p role="status">{inspection.reason||'No verified saved reading is available.'}</p>}
    </section>}
    <P5QaContinuation key={`${selected}:${inspection?.applied?inspection.revision:0}`} caseName={selected} onSaved={setSubmitted}/>
  </main>;
}
