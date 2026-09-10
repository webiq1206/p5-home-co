"use client";
import {useEffect,useRef,useState} from "react";
import {ESTIMATOR_BRAND as brand} from "@/lib/p5/brand";
import {SCOPE_FIELDS,SCOPE_TEXT_LIMIT,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,mergeScopeFacts,requiredScopeQuestions,validateAnswer,type ScopeField,type ScopeAnswers,type ScopeConflict} from "@/lib/p5/scope";
import {loadBrowserDraft,newBrowserDraft,persistBrowserDraft,draftHeaders,cacheFiles,loadCachedFiles,clearCachedFiles,type BrowserDraft} from "@/lib/p5/browserDraft";
import styles from "./P5Estimator.module.css";
const labels:Record<string,string>={handyman:"Home repairs",re10:"RE-10 repairs","cabinet-product":"Cabinets, product only","cabinet-install":"Cabinets with installation",kitchen:"Kitchen remodel",bathroom:"Bathroom remodel","whole-home":"Whole-home remodel",addition:"Home addition",adu:"ADU","new-construction":"New home","change-order":"Change order",rush:"Rush work"};
const accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.txt,.csv,.json,.xlsx,.xls,.ods,.docx,.doc";
type Recognition={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:any)=>void)|null;onerror:((event:any)=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
export function P5Estimator({defaultService=brand.defaultService}:{defaultService?:string}){
  const [draft,setDraft]=useState<BrowserDraft|null>(null);const current=useRef<BrowserDraft|null>(null);
  const [files,setFiles]=useState<File[]>([]);const [storedFiles,setStoredFiles]=useState<string[]>([]);
  const [conflicts,setConflicts]=useState<ScopeConflict[]>([]);const [busy,setBusy]=useState("");const [error,setError]=useState("");
  const [status,setStatus]=useState("");const [listening,setListening]=useState(false);const [speechAvailable,setSpeechAvailable]=useState(false);
  const [result,setResult]=useState<any>(null);const [delivery,setDelivery]=useState<any[]>([]);const [extra,setExtra]=useState<ScopeField|"">("");
  const [confirmed,setConfirmed]=useState(false);const heading=useRef<HTMLHeadingElement>(null);const recognition=useRef<Recognition|null>(null);
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());const mounted=useRef(false);
  const change=(update:Partial<BrowserDraft>)=>{const d=current.current;if(!d)return;const next={...d,...update};current.current=next;setDraft(next);if(!persistBrowserDraft(next))setStatus("This browser cannot save your work on this device. Keep this page open until server save completes.");setConfirmed(false);};
  const answer=(key:ScopeField,value:string)=>{const d=current.current;if(!d)return;const nextConflicts=conflicts.filter(x=>x.field!==key);change({answers:{...d.answers,[key]:value},conflicts:nextConflicts});setConflicts(nextConflicts);};
  useEffect(()=>{
    mounted.current=true;const d=loadBrowserDraft(defaultService);current.current=d;setDraft(d);setConflicts(d.conflicts||[]);
    setSpeechAvailable(Boolean((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition));
    loadCachedFiles(d.id).then(f=>{if(mounted.current)setFiles(f);}).catch(()=>setStatus("File recovery is unavailable in this browser. Text answers are still saved."));
    if(d.revision>0)fetch("/api/p5-estimator/draft",{headers:draftHeaders(d)}).then(r=>r.ok?r.json():null).then(data=>{
      if(!mounted.current||!data?.draft)return;const saved=data.draft;setStoredFiles(saved.uploads.map((f:any)=>f.name));
      if(saved.status==="submitted"){fetch("/api/p5-estimator/submit",{method:"POST",headers:{...draftHeaders(d),"Content-Type":"application/json"},body:JSON.stringify({revision:saved.revision})}).then(r=>r.json()).then(value=>{if(value.result&&mounted.current){setResult(value.result);setDelivery(value.delivery||[]);}}).catch(()=>setStatus("Your submission is saved. Reconnect to load the result."));return;}
      if(saved.revision>d.revision){const restored={...d,...saved,step:d.step,key:d.key};current.current=restored;setDraft(restored);persistBrowserDraft(restored);setStatus("Restored the latest saved project.");}
    }).catch(()=>setStatus("Working offline. Your saved answers are available on this device."));
    const viewport=window.visualViewport;const reveal=()=>{const active=document.activeElement;if(active instanceof HTMLElement&&active.closest("[data-p5-estimator]"))active.scrollIntoView({block:"nearest"});};
    viewport?.addEventListener("resize",reveal);
    return()=>{mounted.current=false;recognition.current?.stop();viewport?.removeEventListener("resize",reveal);};
  },[defaultService]);
  const persistServer=(reviewed=false):Promise<any>=>{
    const operation=saveQueue.current.catch(()=>undefined).then(async()=>{
      const d=current.current;if(!d)throw new Error("Project is still loading.");
      const response=await fetch("/api/p5-estimator/draft",{method:"PUT",headers:{...draftHeaders(d),"Content-Type":"application/json"},body:JSON.stringify({...d,reviewed})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Your work could not be saved. Please retry.");
      const next={...current.current!,revision:data.draft.revision,extraction:data.draft.extraction};current.current=next;setDraft(next);persistBrowserDraft(next);return data.draft;
    });saveQueue.current=operation;return operation;
  };
  useEffect(()=>{
    if(!draft||!draft.contact.email||busy||result)return;
    const timer=setTimeout(()=>{persistServer().then(()=>setStatus("Project saved.")).catch(()=>setStatus("Saved on this device. Server save will retry when connected."));},1800);
    return()=>clearTimeout(timer);
  },[draft?.text,JSON.stringify(draft?.answers),JSON.stringify(draft?.contact)]);
  const go=(step:number)=>{recognition.current?.stop();change({step});setError("");requestAnimationFrame(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:"start"});});};
  async function analyze(runAnalysis=true){
    setBusy("Reading your scope and documents...");setError("");
    try{
      await persistServer();const d=current.current!;const form=new FormData();form.set("text",d.text);form.set("analyze",String(runAnalysis));for(const file of files)form.append("files",file);
      const response=await fetch("/api/p5-estimator/scope",{method:"POST",headers:draftHeaders(d),body:form});const data=await response.json();
      if(!response.ok)throw new Error(data.error||"We could not analyze this scope. Your work is saved.");
      const merged=data.analysis?mergeScopeFacts(d.answers,data.analysis.extraction):{answers:d.answers,conflicts:[]};
      const next={...current.current!,revision:data.draft.revision,extraction:data.analysis?.extraction||d.extraction,answers:merged.answers,conflicts:merged.conflicts,step:1};
      current.current=next;setDraft(next);persistBrowserDraft(next);setConflicts(merged.conflicts);setStoredFiles(data.draft.uploads.map((f:any)=>f.name));
      setFiles([]);await clearCachedFiles(d.id);setStatus("Review the extracted details and correct anything that needs changing.");
    }catch(e){setError(e instanceof Error?e.message:"Scope review failed. Your work is intact.");}finally{setBusy("");}
  }
  async function addFiles(selected:FileList|null){
    if(!selected||!draft)return;const next=[...files,...Array.from(selected)];
    if(next.length+storedFiles.length>12||next.some(f=>!f.size||f.size>SCOPE_FILE_LIMIT)||next.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT){setError("Use up to 12 files, 10 MB each and 22 MB total.");return;}
    setFiles(next);setError("");try{await cacheFiles(draft.id,next);setStatus("Files saved on this device until upload.");}catch{setStatus("Keep this page open until upload completes; this browser could not save the files locally.");}
  }
  async function downloadPdf(){
    if(!current.current)return;setBusy("Preparing your PDF...");setError("");
    try{const response=await fetch("/api/p5-estimator/pdf",{headers:draftHeaders(current.current)});if(!response.ok)throw new Error("The PDF could not be downloaded. Your submission is saved; please retry.");const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=url;link.download=`${brand.id}-estimate-${current.current.id}-customer.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:"PDF download failed.");}finally{setBusy("");}
  }
  function speak(){
    if(listening){recognition.current?.stop();return;}
    const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Constructor)return;
    const r:Recognition=new Constructor();recognition.current=r;r.continuous=true;r.interimResults=false;r.lang="en-US";
    r.onresult=(event:any)=>{let text="";for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+" ";if(text)change({text:`${current.current?.text||""} ${text}`.trim().slice(0,SCOPE_TEXT_LIMIT)});};
    r.onerror=()=>{setListening(false);setError("Microphone input is unavailable. Type your scope or use your keyboard's dictation button.");};r.onend=()=>setListening(false);
    try{r.start();setListening(true);}catch{setError("The microphone could not start. You can still type or upload your scope.");}
  }
  async function submit(event:React.FormEvent){
    event.preventDefault();if(!confirmed){setError("Confirm that you have reviewed the project details.");return;}
    const d=current.current!;
    for(const [key,value]of Object.entries(d.answers)){const issue=validateAnswer(key as ScopeField,value!);if(issue){setError(`${SCOPE_FIELDS[key as ScopeField].label}: ${issue}`);return;}}
    if(conflicts.length){setError("Resolve the conflicting project details before continuing.");return;}
    if(d.contact.name.trim().length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact.email)){setError("Enter your name and a valid email address.");return;}
    setBusy("Saving your project and preparing the result...");setError("");
    try{
      const check=await fetch("/api/p5-estimator/draft",{headers:draftHeaders(d)});const restored=check.ok?(await check.json()).draft:null;
      const saved=restored?.status==="submitted"?restored:await persistServer(true);const latest=current.current!;
      const response=await fetch("/api/p5-estimator/submit",{method:"POST",headers:{...draftHeaders(latest),"Content-Type":"application/json"},body:JSON.stringify({revision:saved.revision})});const data=await response.json();
      if(!response.ok)throw new Error(data.error||"We could not finish the submission. Your work is saved.");
      setResult(data.result);setDelivery(data.delivery||[]);setStatus("Your project was saved. Delivery status is shown below.");
    }catch(e){setError(e instanceof Error?e.message:"Submission could not be completed. Your work is intact.");}finally{setBusy("");}
  }
  const field=(key:ScopeField)=>{
    const definition=SCOPE_FIELDS[key];const value=draft?.answers[key]||"";const id=`p5-${key}`;
    return <div key={key} className={styles.field}><label htmlFor={id}>{definition.label}</label>{definition.kind==="choice"?
      <select id={id} aria-label={definition.label} value={value} onChange={e=>answer(key,e.target.value)}><option value="">Not sure yet</option>{definition.options.filter(v=>key!=="service"||(brand.services as readonly string[]).includes(v)).map(v=><option key={v} value={v}>{labels[v]||v.replaceAll("-"," ")}</option>)}</select>:
      definition.kind==="number"?<input id={id} inputMode="decimal" value={value} onChange={e=>answer(key,e.target.value)} placeholder="Leave blank if unknown"/>:
      <textarea id={id} rows={key==="address"||key==="location"?2:3} value={value} onChange={e=>answer(key,e.target.value)} maxLength={4000}/>}</div>;
  };
  if(!draft)return <div className={styles.root} role="status">Loading your saved project...</div>;
  const fields=[...new Set<ScopeField>(["service",...Object.keys(draft.answers) as ScopeField[],...(draft.extraction?.facts.map(f=>f.field)||[]),...requiredScopeQuestions(draft.answers),"location","urgency",...(extra?[extra]:[])])];
  return <section className={styles.root} data-p5-estimator style={{"--p5-accent":brand.accent} as React.CSSProperties}>
    <div className={styles.intro}><p className={styles.eyebrow}>{brand.name}</p><h1 ref={heading} tabIndex={-1}>{result?"Your project summary":"Tell us what you have in mind"}</h1><p>Start with a description, add your documents, or answer a few questions. Bring what you know; you can leave unknown details blank.</p></div>
    {!result&&<ol className={styles.progress} aria-label="Estimator progress">{["Your scope","Review details","Get your result"].map((label,index)=><li key={label} aria-current={draft.step===index?"step":undefined}><button type="button" disabled={index>draft.step||Boolean(busy)} onClick={()=>go(index)}>{index+1}. {label}</button></li>)}</ol>}
    {result?<div className={styles.result}>
      <h2>{result.range?`${result.range.low.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})} to ${result.range.high.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`:"Your scope is ready for pricing review"}</h2>
      <p>{result.message}</p><h3>Project summary</h3><p className={styles.preserve}>{result.summary}</p>
      {[["Included categories",result.includedCategories],["Assumptions",result.assumptions],["Exclusions",result.exclusions],["Factors that may change the range",result.factors]].map(([title,items]:any)=>items?.length?<div key={title}><h3>{title}</h3><ul>{items.map((item:string)=><li key={item}>{item.replaceAll("-"," ")}</li>)}</ul></div>:null)}
      {result.allowances?.length>0&&<div><h3>Allowances</h3>{result.allowances.map((a:any,i:number)=><div key={i}><p><strong>{a.description}</strong>{a.amount!==null?`: $${a.amount.toLocaleString("en-US")}`:" (to be confirmed)"}</p><p>{a.includes.join(", ")}</p><p>{["tax","freight","delivery","installation","waste"].map(k=>`${k}: ${a[`${k}Included`]?"included":"excluded"}`).join("; ")}</p><p>Selection deadline: {a.selectionDeadline}. {a.adjustment}</p></div>)}</div>}
      <button type="button" onClick={downloadPdf} disabled={Boolean(busy)}>Download your project summary</button><h3>Recommended next step</h3><p>{result.nextStep}</p><p>{result.disclaimer}</p>
      <p role="status">{delivery.length>0&&delivery.every(d=>d.status==="sent")?"Your summary was sent and the team has your record.":"Your project is saved. Some deliveries are pending or need team review. Please do not submit the same project again."}</p>
      <a className={styles.primary} href={brand.consultationPath}>Schedule a consultation</a><a className={styles.secondary} href="tel:+12084771169">Call {brand.phone}</a>
      <button type="button" onClick={()=>{const next=newBrowserDraft(defaultService);current.current=next;setDraft(next);persistBrowserDraft(next);setResult(null);setStoredFiles([]);setFiles([]);setConflicts([]);setConfirmed(false);}}>Start another project</button>
    </div>:<form onSubmit={submit} noValidate>
      {draft.step===0?<>
        <label className={styles.field} htmlFor="p5-scope"><span>Describe your project</span><textarea id="p5-scope" rows={6} maxLength={SCOPE_TEXT_LIMIT} value={draft.text} onChange={e=>change({text:e.target.value})} placeholder="Paste a scope, list repairs, or describe the rooms, size, finishes and timing you have in mind."/></label>
        <div className={styles.actions}>{speechAvailable?<button type="button" onClick={speak} aria-pressed={listening}>{listening?"Stop dictation":"Describe it by voice"}</button>:<p className={styles.hint}>You can also use the microphone on your phone's keyboard to dictate your scope.</p>}</div>
        <label className={styles.upload} htmlFor="p5-files"><span>Add plans, photos or documents</span><span className={styles.hint}>PDFs, photos, Word files and spreadsheets. Up to 12 files, 10 MB each, 22 MB total.</span><input id="p5-files" type="file" accept={accept} multiple onChange={e=>{void addFiles(e.target.files);e.target.value="";}}/></label>
        {(files.length>0||storedFiles.length>0)&&<ul className={styles.files}>{storedFiles.map(name=><li key={name}>{name} <span>Uploaded</span></li>)}{files.map((file,i)=><li key={`${file.name}-${i}`}><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={async()=>{const next=files.filter((_,index)=>index!==i);setFiles(next);await clearCachedFiles(draft.id);await cacheFiles(draft.id,next);}}>Remove</button></li>)}</ul>}
        <div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>analyze(true)} disabled={Boolean(busy)||(!draft.text.trim()&&!files.length&&!storedFiles.length)}>Review my scope</button><button type="button" onClick={()=>files.length?void analyze(false):go(1)} disabled={Boolean(busy)}>Continue manually</button></div>
      </>:draft.step===1?<>
        <h2>Review your project details</h2><p>Details read from your scope are filled in below. Edit anything that needs correcting; leave unknown information blank for review.</p>
        {conflicts.length>0&&<div className={styles.notice} role="alert"><h3>Please resolve these differences</h3>{conflicts.map(c=><div key={c.field}><p>{SCOPE_FIELDS[c.field].label}: {c.explanation}</p><div className={styles.actions}>{c.values.map(v=><button key={v} type="button" onClick={()=>answer(c.field,v)}>{v}</button>)}</div></div>)}</div>}
        <div className={styles.fields}>{fields.map(field)}</div>
        <p className={styles.hint}>Location is optional. Jurisdiction, utilities, access, soil, slope, permitting and site conditions may change the final price. We will request the exact address when a property review, site visit or firm proposal needs it.</p>
        {draft.extraction&&<details><summary>Sources and items for review</summary>{draft.extraction.facts.map((f,i)=><p key={i}><strong>{SCOPE_FIELDS[f.field].label}:</strong> {f.value}<br/>{f.source}: {f.evidence}</p>)}{draft.extraction.reviewNotes.map((note,i)=><p key={i}>{note}</p>)}{draft.extraction.missingInformation.map((note,i)=><p key={`missing-${i}`}>{note}</p>)}</details>}
        <label className={styles.field}><span>Add another project detail</span><select value={extra} onChange={e=>setExtra(e.target.value as ScopeField)}><option value="">Choose an optional detail</option>{(Object.keys(SCOPE_FIELDS) as ScopeField[]).filter(k=>!fields.includes(k)).map(k=><option key={k} value={k}>{SCOPE_FIELDS[k].label}</option>)}</select></label>
        <div className={styles.actions}><button type="button" onClick={()=>go(0)}>Back</button><button className={styles.primary} type="button" onClick={()=>{if(!draft.answers.service){setError("Choose the project type first.");return;}if(conflicts.length){setError("Resolve the differences above first.");return;}go(2);}}>Continue</button></div>
      </>:<>
        <h2>Where should we send your summary?</h2><p>We will send your planning result or let you know what needs a specialist's review.</p>
        <div className={styles.fields}>{([['name','Your name','text'],['email','Email','email'],['phone','Phone (optional)','tel']] as const).map(([key,label,type])=><label className={styles.field} key={key} htmlFor={`p5-contact-${key}`}><span>{label}</span><input id={`p5-contact-${key}`} type={type} autoComplete={key} value={draft.contact[key]} onChange={e=>change({contact:{...draft.contact,[key]:e.target.value}})} maxLength={key==='name'?120:key==='email'?200:40}/></label>)}</div>
        <details><summary>Review the details you are sending</summary><p className={styles.preserve}>{draft.text}</p>{Object.entries(draft.answers).filter(([,v])=>v).map(([k,v])=><p key={k}><strong>{SCOPE_FIELDS[k as ScopeField].label}:</strong> {v}</p>)}</details>
        <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I reviewed these project details. I understand this is preliminary planning information, not a bid, quote, offer or guaranteed price.</span></label>
        <div className={styles.actions}><button type="button" onClick={()=>go(1)} disabled={Boolean(busy)}>Back and edit</button><button className={styles.primary} type="submit" disabled={Boolean(busy)}>Get my project summary</button></div>
      </>}
    </form>}
    {busy&&<p className={styles.notice} role="status" aria-live="polite">{busy}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}{status&&<p className={styles.hint} role="status">{status}</p>}
  </section>;
}
