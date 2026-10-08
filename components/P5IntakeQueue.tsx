'use client';
import {useEffect,useState} from 'react';
import type {IntakeSnapshot} from '../lib/p5/intakeContract';
import {intakeReference} from '../lib/p5/intakeContract';
import {INTAKE_SITES,INTAKE_RECIPIENTS,type IntakeSite,type IntakeRouting} from '../lib/p5/intakePolicy';
import {deliveryReason} from '../lib/p5/intakeDeliveryPolicy';
import {SCOPE_FIELDS} from '../lib/p5/scope';
type Summary=Pick<IntakeSnapshot,'draftId'|'projectId'|'originSite'|'currentSite'|'revision'|'contact'|'savedAt'>&{routing:IntakeRouting;fileCount:number};
type Detail={snapshot:IntakeSnapshot;delivery:Record<string,{status?:string;recipient?:string;providerId?:string;reason?:string;attempts?:number;nextAttemptAt?:string}>};
async function read(url:string){const response=await fetch(url,{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error||'The saved project requests could not be loaded.');return body;}
export default function P5IntakeQueue(){
 const [requests,setRequests]=useState<Summary[]>([]),[selected,setSelected]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[nextCursor,setNextCursor]=useState<string|null>(null);
 async function load(cursor:string|null=null){setBusy(true);setError('');try{const body=await read('/api/admin/p5-intake'+(cursor?'?cursor='+encodeURIComponent(cursor):''));setRequests(previous=>cursor?[...previous,...body.requests.filter((r:Summary)=>!previous.some(saved=>saved.draftId===r.draftId))]:body.requests);setNextCursor(body.nextCursor);}catch(e){setError(e instanceof Error?e.message:'Requests could not be loaded.');}finally{setBusy(false);}}
 async function inspect(draftId:string,revision:number){setBusy(true);setError('');try{setSelected(await read(`/api/admin/p5-intake?draftId=${encodeURIComponent(draftId)}&revision=${revision}`));}catch(e){setError(e instanceof Error?e.message:'The saved project could not be loaded.');}finally{setBusy(false);}}
 useEffect(()=>{let active=true;void read('/api/admin/p5-intake').then(body=>{if(active){setRequests(body.requests);setNextCursor(body.nextCursor);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Requests could not be loaded.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
 const saved=selected?.snapshot;
 const name=(site:IntakeSite)=>INTAKE_SITES[site].name;
 return <section aria-labelledby="p5-intake-queue-heading" style={{padding:'24px 0',overflowWrap:'anywhere'}}>
  <h2 id="p5-intake-queue-heading">Project intake requests</h2>
  <p>These requests are ready for scope review. Delivery and CRM status are separate from the saved project.</p>
  <button style={{minHeight:44}} disabled={busy} onClick={()=>void load()}>Refresh project requests</button>
  {error&&<p role="alert">{error}</p>}
  {!requests.length&&!busy&&!error&&<p>No submitted intake requests yet.</p>}
  <ul>{requests.map(r=><li key={r.projectId} style={{padding:'12px 0'}}><button style={{minHeight:44,textAlign:'left'}} disabled={busy} onClick={()=>void inspect(r.draftId,r.revision)}>{intakeReference(r.projectId)} · {r.contact.name} · {r.routing.teamName}</button><p>{r.fileCount} saved files · Revision {r.revision} · {new Date(r.savedAt).toLocaleString()}</p></li>)}</ul>
  {nextCursor&&<button style={{minHeight:44}} disabled={busy} onClick={()=>void load(nextCursor)}>Load older project requests</button>}
  {requests.length>0&&<p>{requests.length} requests shown{nextCursor?'. More requests are available.':'. End of the saved request list.'} Refresh to check for new submissions.</p>}
  {saved&&<article aria-label="Submitted project details">
   <h3>{intakeReference(saved.projectId)} · Submitted revision {saved.revision}</h3>
   <p>Origin: {name(saved.originSite)}. Receiving site: {name(saved.currentSite)}. Primary project team: {saved.routing.teamName}.</p>
   <p>Team recipient: {INTAKE_RECIPIENTS[saved.currentSite]}</p>
   <p>Supporting work: {saved.routing.supportingServices.join(', ')||'None selected'}</p>
   <h4>Customer and follow-up</h4><p>{saved.contact.name}<br/>Email: {saved.contact.email||'Not provided'}<br/>Phone: {saved.contact.phone||'Not provided'}<br/>Preferred contact: {saved.contact.preferredContact}</p>
   <h4>Submitted scope</h4><p style={{whiteSpace:'pre-wrap'}}>{saved.scope.text}</p>
   <dl>{([['Desired outcome',saved.details.desiredOutcome],['Project context',saved.details.workContext],['Budget',saved.details.budget],...Object.entries(saved.scope.answers).map(([field,value])=>[SCOPE_FIELDS[field as keyof typeof SCOPE_FIELDS]?.label||field,value])] as Array<[string,string|undefined]>).filter(([,value])=>value).map(([label,value])=><div key={label}><dt><strong>{label}</strong></dt><dd style={{whiteSpace:'pre-wrap'}}>{value}</dd></div>)}</dl>
   <h4>Details to resolve</h4>{saved.unresolved.length?<ul>{saved.unresolved.map((note,i)=><li key={i}>{note}</li>)}</ul>:<p>No unresolved details were recorded at submission. Review the full scope before preparing an estimate.</p>}
   <h4>Original submitted files</h4><p>Downloads require administrator sign-in and verify the saved file bytes for this revision.</p>
   <ul>{saved.scope.uploads.map(f=><li key={f.id}><a href={`/api/admin/p5-intake/file?draftId=${encodeURIComponent(saved.draftId)}&revision=${saved.revision}&fileId=${encodeURIComponent(f.id)}`}>{f.name}</a> ({f.size.toLocaleString()} bytes)</li>)}</ul>
   <details><summary>Complete submitted conversation</summary><ol>{saved.details.transcript.map((m,i)=><li key={`${m.id}:${i}`}><strong>{m.role==='user'?'Customer':'Project assistant'}</strong>{m.caption&&<p>{m.caption}</p>}{m.label&&<p><strong>{m.label}</strong></p>}<p style={{whiteSpace:'pre-wrap'}}>{m.text}</p>{m.files?.length?<ul>{m.files.map((file,j)=><li key={j}>{file}</li>)}</ul>:null}</li>)}</ol></details>
   <details><summary>Saved extraction and file-reading evidence</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(saved.scope.extraction,null,2)}</pre></details>
   <h4>Delivery status</h4><ul>{(['customer','team','crm'] as const).map(channel=><li key={channel}>{channel}: {selected?.delivery[channel]?.status||'unconfirmed'}{selected?.delivery[channel]?.reason&&<p>{deliveryReason(selected.delivery[channel].reason)}</p>}<small>Attempts: {selected?.delivery[channel]?.attempts||0}{selected?.delivery[channel]?.nextAttemptAt?` · Eligible after: ${new Date(selected.delivery[channel].nextAttemptAt!).toLocaleString()}`:''}</small></li>)}</ul>
  </article>}
 </section>;
}
