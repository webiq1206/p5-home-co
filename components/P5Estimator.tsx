"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {ESTIMATOR_BRAND as brand} from '@/lib/p5/brand';
import {SCOPE_FIELDS,SCOPE_TEXT_LIMIT,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,type ScopeField,type ScopeAnswers,type ScopeUpload} from '@/lib/p5/scope';
import {deriveScopeAnswers,reconcileScope,scopeQuestions,scopeAssumptions,validateScopeAnswer,type ScopeQuestion} from '@/lib/p5/adaptive';
import {loadBrowserDraft,newBrowserDraft,persistBrowserDraft,draftHeaders,cacheFiles,loadCachedFiles,clearCachedFiles,requireDraftReceipt,type BrowserDraft} from '@/lib/p5/browserDraft';
import {mergeProjectSource,type ProjectSource} from '@/lib/p5/projectSource';
import {resumeWizardDraft} from '@/lib/p5/wizardResume';
import {snapshotProjectFile} from '@/lib/p5/fileSnapshot';
import {transferProjectFiles} from '@/lib/p5/uploadTransfer';
import styles from './P5Estimator.module.css';
import {reportProgress,trackScopeEvent} from '@/lib/p5/progress';
const textAnswers=(a:ScopeAnswers)=>JSON.stringify(Object.entries(a).filter(([k,v])=>SCOPE_FIELDS[k as ScopeField].kind==='text'&&v?.trim()).sort(([a],[b])=>a.localeCompare(b)));
const labels:Record<string,string>={handyman:'Home repairs',re10:'Inspection and RE-10 repairs','cabinet-product':'Cabinets, supply only','cabinet-install':'Cabinets with installation',kitchen:'Kitchen remodel',bathroom:'Bathroom remodel','whole-home':'Whole-home remodel',addition:'Home addition',adu:'ADU','new-construction':'New home','change-order':'Change order',rush:'Rush work',refresh:'Simple refresh','mid-range':'Standard finishes','high-end':'Premium finishes',luxury:'Custom luxury finishes'};
const scopeExample=(brand.id as string)==='cabinet'?'For example: Painted Shaker kitchen cabinets, 20 ft of base and 15 ft of uppers. Include installation.':(brand.id as string)==='construction'?'For example: Build a 2,500 sq ft home with an 800 sq ft garage. Our plans are attached.':(brand.id as string)==='handyman'?'For example: Fix three sticking doors, replace two faucets and repair damaged drywall.':'For example: Remodel our 8 × 10 ft bathroom. Keep the layout, replace the shower, tile and vanity.';
const accept='.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.txt,.csv,.json,.xlsx,.xls,.ods,.docx,.doc';
type Recognition={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:any)=>void)|null;onerror:((event:any)=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
export function P5Estimator({defaultService='',headingAs='h1',projectSource}:{defaultService?:string;headingAs?:'h1'|'h2';projectSource?:ProjectSource}){
  const [draft,setDraft]=useState<BrowserDraft|null>(null);const current=useRef<BrowserDraft|null>(null);
  const [files,setFiles]=useState<File[]>([]);const filesRef=useRef<File[]>([]);
  const [busy,setBusy]=useState('');const busyRef=useRef(false);const [error,setError]=useState('');const [warning,setWarning]=useState('');const [status,setStatus]=useState('');
  const [uploadPercent,setUploadPercent]=useState<number|null>(null);const [preparingFiles,setPreparingFiles]=useState(false);
  const started=useRef(false);
  const [listening,setListening]=useState(false);const [speechAvailable,setSpeechAvailable]=useState(false);const recognition=useRef<Recognition|null>(null);
  const [result,setResult]=useState<any>(null);const [delivery,setDelivery]=useState<any[]>([]);const [confirmed,setConfirmed]=useState(false);
  const [active,setActive]=useState<ScopeQuestion|null>(null);const [inputOpen,setInputOpen]=useState(false);const [editField,setEditField]=useState<ScopeField|''>('');
  const queue=useRef<Promise<unknown>>(Promise.resolve());const heading=useRef<HTMLHeadingElement>(null);const mounted=useRef(false);const id=useId();const Heading=headingAs;
  const apply=(next:BrowserDraft)=>{current.current=next;setDraft(next);if(!persistBrowserDraft(next))setStatus('Keep this page open. This browser cannot save your work on this device.');};
  const change=(update:Partial<BrowserDraft>)=>{if(!current.current)return;apply({...current.current,...update,dirty:true,updatedAt:Date.now()});setConfirmed(false);};
  const questions=(d:BrowserDraft)=>scopeQuestions(d.answers,d.extraction,d.conflicts||[],d.wizard?.skipped||[],d.pricedFields||[]);
  const resume=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);apply(resumeWizardDraft(d,Boolean(next)));};
  const focus=()=>requestAnimationFrame(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start',behavior:'auto'});});
  const showQuestions=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);if(!next){trackScopeEvent('repairsConfirmed',d.answers.service);trackScopeEvent('contactViewed',d.answers.service);}apply({...d,step:next?1:2});setInputOpen(false);setConfirmed(false);focus();};
  const answer=(key:ScopeField,value:string)=>{
    const d=current.current;if(!d)return;
    let answers={...d.answers,[key]:value};
    if((key==='length'||key==='width')&&d.answers.length&&d.answers.width&&d.answers.sqft===deriveScopeAnswers({...d.answers,sqft:''}).sqft)answers.sqft='';
    answers=deriveScopeAnswers(answers);
    change({answers,conflicts:(d.conflicts||[]).filter(c=>c.field!==key),wizard:{...d.wizard,skipped:(d.wizard?.skipped||[]).filter(k=>k!==key),resolutions:{...d.wizard?.resolutions,[key]:value}}});
  };
  useEffect(()=>{
    mounted.current=true;const loaded=loadBrowserDraft(defaultService,projectSource?.id);const d=projectSource?mergeProjectSource(loaded,projectSource):loaded;resume(d);setWarning(d.analysisWarning||d.extraction?.reviewNotes.find(n=>n.startsWith("Your files are saved, but"))||"");
    setSpeechAvailable(Boolean((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition));
    loadCachedFiles(d.id).then(f=>{if(mounted.current&&current.current?.id===d.id){filesRef.current=f;setFiles(f);}}).catch(()=>setStatus('File recovery is unavailable. Keep this page open while uploading.'));
    if(d.revision>0)fetch('/api/p5-estimator/draft',{headers:draftHeaders(d),cache:'no-store'}).then(r=>r.ok?r.json():null).then(async data=>{
      if(!mounted.current||!data?.draft||current.current?.id!==d.id)return;
      const saved=requireDraftReceipt(data);
      if(saved.status==='submitted'){
        const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision})});const value=await response.json();
        if(value.result&&mounted.current){setResult(value.result);setDelivery(value.delivery||[]);}return;
      }
      // Never overwrite edits made while recovery was in flight or unsaved offline work.
      if(!d.dirty&&current.current.updatedAt===d.updatedAt&&saved.revision>=d.revision){const restored={...d,...saved,key:d.key,step:d.step,updatedAt:d.updatedAt} as BrowserDraft;resume(restored);}
      else apply({...current.current,uploads:saved.uploads});
    }).catch(()=>setStatus('Your saved answers are available on this device. Reconnect to save online.'));
    const preventFileNavigation=(event:DragEvent)=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();};
    window.addEventListener("drop",preventFileNavigation);window.addEventListener("dragover",preventFileNavigation);
    return()=>{mounted.current=false;recognition.current?.stop();window.removeEventListener("drop",preventFileNavigation);window.removeEventListener("dragover",preventFileNavigation);};
  },[defaultService,projectSource?.id]);
  useEffect(()=>{if(projectSource&&current.current){const next=mergeProjectSource(current.current,projectSource);if(next!==current.current){resume(next);setConfirmed(false);}}},[JSON.stringify(projectSource)]);
  useEffect(()=>{
    if(!draft)return;
    const engaged=Boolean(draft.text||files.length||Object.keys(draft.answers).length);
    if(engaged&&!started.current){started.current=true;trackScopeEvent('started',draft.answers.service);}
    if(engaged)reportProgress(draft,result?'completed':'active');
  },[draft?.step,JSON.stringify(draft?.answers),Boolean(draft?.text),files.length,Boolean(result)]);
  const serialized=<T,>(operation:()=>Promise<T>):Promise<T>=>{const task=queue.current.catch(()=>undefined).then(operation);queue.current=task;return task;};
  async function save(reviewed=false){
    const d=current.current;if(!d)throw new Error('Your project is still loading.');
    const response=await fetch('/api/p5-estimator/draft',{method:'PUT',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({text:d.text,answers:d.answers,contact:d.contact,revision:d.revision,wizard:d.wizard,reviewed})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Your project could not be saved. Please retry.');const saved=requireDraftReceipt(data);
    if(current.current?.id!==d.id)return saved;
    const unchanged=current.current.updatedAt===d.updatedAt;
    apply({...current.current,revision:saved.revision,extraction:saved.extraction,uploads:saved.uploads,pricedFields:data.pricedFields||[],...(unchanged?{answers:saved.answers,wizard:saved.wizard,conflicts:[...(data.conflicts||[]),...(current.current.conflicts||[]).filter(c=>!data.conflicts?.some((v:any)=>v.field===c.field))],dirty:false}:{})});
    return saved;
  }
  useEffect(()=>{
    if(!draft?.contact.email||busy||result)return;
    const timer=setTimeout(()=>{if(!busyRef.current)void serialized(()=>save()).then(()=>setStatus('Project saved.')).catch(()=>setStatus('Saved on this device. We will retry saving when connected.'));},1800);
    return()=>clearTimeout(timer);
  },[draft?.text,JSON.stringify(draft?.answers),JSON.stringify(draft?.contact),busy,Boolean(result)]);
  async function run(label:string,operation:()=>Promise<void>){
    if(busyRef.current)return;busyRef.current=true;setBusy(label);setError('');recognition.current?.stop();
    try{await serialized(operation);}catch(e){setError(e instanceof TypeError?'The connection was interrupted. Your saved details are intact. Keep this tab open and retry.':e instanceof Error?e.message:'This step could not finish. Your work is still here.');}finally{busyRef.current=false;setBusy('');setUploadPercent(null);}
  }
  async function ensureSourcePhoto(){
    const url=projectSource?.imageUrl;if(!url||current.current?.sourceImageUrl===url)return;
    const parsed=new URL(url,window.location.origin);
    if(parsed.origin!==window.location.origin&&!url.startsWith('data:image/')&&!url.startsWith('blob:'))throw new Error('The design photo cannot be imported from this address. Please add it using Add files.');
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Your design photo could not be read. Please retry or add the photo using Add files.');
    const blob=await response.blob();const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif'};
    if(!ext[blob.type]||blob.size>SCOPE_FILE_LIMIT)throw new Error('Use Add files to provide a supported design photo up to 10 MB.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
    const name=`design-photo-${digest}.${ext[blob.type]}`;
    if(!filesRef.current.some(f=>f.name===name)&&!current.current?.uploads?.some(f=>f.name===name)){
      await addFiles([new File([blob],name,{type:blob.type,lastModified:0})]);
      if(!filesRef.current.some(f=>f.name===name))throw new Error('The design photo was not added. Check the file limits and retry.');
    }
  }
  async function analyze(){
    await ensureSourcePhoto();
    setBusy('Saving your project...');await save();const d=current.current!;const pending=[...filesRef.current];
    if(pending.length){
      setBusy('Uploading your files...');setUploadPercent(0);const upload=new FormData();upload.set('analyze','false');for(const f of pending)upload.append('files',new Blob([await f.arrayBuffer()],{type:f.type}),f.name);
      const receipt=requireDraftReceipt(await transferProjectFiles(upload,draftHeaders(d),setUploadPercent));
      for(const f of pending){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');if(!receipt.uploads.some(stored=>stored.sha256===digest))throw new Error(`${f.name}: upload was not confirmed. Please retry.`);}
      apply({...current.current!,uploads:receipt.uploads,revision:receipt.revision});filesRef.current=[];setFiles([]);await clearCachedFiles(d.id).catch(()=>undefined);setUploadPercent(null);setStatus('Files uploaded and saved.');
    }
    setBusy('Reading your documents and project details...');const form=new FormData();form.set('text',d.text);
    const response=await fetch('/api/p5-estimator/scope',{method:'POST',headers:draftHeaders(d),body:form,signal:AbortSignal.timeout(200000)});const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Your files could not be processed. They are still here. Please retry.');const saved=requireDraftReceipt(data);
    const next={...current.current!,...saved,key:d.key,step:1,updatedAt:Date.now(),dirty:false,conflicts:data.conflicts||[],pricedFields:data.pricedFields||[],analysisWarning:data.warning||"",sourceImageUrl:projectSource?.imageUrl,analyzedText:d.text,analyzedAnswers:textAnswers(saved.answers)} as BrowserDraft;
    apply(next);setWarning(data.warning||'');if(pending.length)trackScopeEvent(d.uploads?.length?'additionalDocuments':'documentUploaded',saved.answers.service);trackScopeEvent(data.warning?'analysisFailed':'analysisCompleted',saved.answers.service);filesRef.current=[];setFiles([]);
    try{await clearCachedFiles(d.id);}catch{setStatus('Files are uploaded. Local file cleanup will retry later.');}
    setStatus(data.warning?'Files uploaded. Some details still need review.':'Project details saved. We will only ask about what is missing.');showQuestions(next);
  }
  const needsAnalysis=()=>{const d=current.current;return Boolean(d&&(projectSource?.imageUrl&&d.sourceImageUrl!==projectSource.imageUrl||filesRef.current.length||d.text.trim()&&d.text!==d.analyzedText||textAnswers(d.answers)!=='[]'&&textAnswers(d.answers)!==d.analyzedAnswers));};
  const begin=()=>run('Reading your project...',async()=>{
    if(needsAnalysis()||(current.current?.uploads?.length&&!current.current.extraction))await analyze();
    else{await save();showQuestions(current.current!);}
  });
  async function addFiles(selected:FileList|File[]|null){
    if(!selected||!current.current)return;
    const incoming=Array.from(selected);const next=[...filesRef.current];
    for(const f of incoming){if(!accept.split(',').includes('.'+f.name.split('.').pop()?.toLowerCase())){setError(`${f.name}: use a supported document or photo format.`);return;}if(!next.some(v=>v.name===f.name&&v.size===f.size&&v.lastModified===f.lastModified))next.push(f);}
    const uploaded=current.current.uploads||[];
    if(next.length+uploaded.length>12||next.some(f=>!f.size||f.size>SCOPE_FILE_LIMIT)||next.reduce((n,f)=>n+f.size,0)+uploaded.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT){setError('Use up to 12 files, 10 MB each and 22 MB total.');return;}
    let copied:File[];setPreparingFiles(true);
    try{copied=await Promise.all(next.map(f=>filesRef.current.includes(f)?f:snapshotProjectFile(f)));}catch(error){setPreparingFiles(false);setError(error instanceof Error?error.message:'The selected file could not be read. Please select it again.');return;}
    filesRef.current=copied;setFiles(copied);setError('');setConfirmed(false);
    try{await cacheFiles(current.current.id,copied);setStatus('Files ready. Continue to read them with your project details.');}catch{setStatus('Files are ready in this tab. Device storage is unavailable; keep this tab open until upload completes.');}finally{setPreparingFiles(false);}
  }
  function speak(){
    if(listening){recognition.current?.stop();return;}const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Constructor)return;
    const r:Recognition=new Constructor();recognition.current=r;r.continuous=true;r.interimResults=false;r.lang='en-US';
    r.onresult=(event:any)=>{let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+' ';if(text)change({text:`${current.current?.text||''} ${text}`.trim().slice(0,SCOPE_TEXT_LIMIT)});};
    r.onerror=()=>{setListening(false);setError("Microphone input is unavailable. You can type, upload, or use your keyboard's dictation button.");};r.onend=()=>setListening(false);
    try{setListening(true);r.start();}catch{setListening(false);setError('The microphone could not start. You can still type or add files.');}
  }
  async function advance(skip=false){
    if(!current.current)return;
    if(active?.conflict&&!current.current.wizard?.resolutions[active.field]){setError('Choose the detail to use, or enter a correction.');return;}
    if(active){const value=current.current.answers[active.field]||'';const issue=validateScopeAnswer(active.field,value);if(!skip&&(issue||!value.trim())){setError(issue||'Add this detail, or choose Not sure yet.');return;}
      if(skip){if(active.field==='service'||active.conflict)return;const d=current.current;change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:[...new Set([...(d.wizard?.skipped||[]),active.field])]}});}}
    await run('Updating your project...',async()=>{if(needsAnalysis())await analyze();else{await save();showQuestions(current.current!);}});
  }
  async function downloadPdf(){await run('Preparing your PDF...',async()=>{const response=await fetch('/api/p5-estimator/pdf',{headers:draftHeaders(current.current!)});if(!response.ok)throw new Error('The PDF could not be downloaded. Your submission is saved; please retry.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`${brand.id}-project-summary.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
  async function submit(event:React.FormEvent){
    event.preventDefault();if(draft?.step!==2){await begin();return;}
    if(needsAnalysis()){await begin();return;}
    if(!confirmed){setError('Please confirm your project details before continuing.');return;}
    const d=current.current!;
    if(questions(d).length){showQuestions(d);return;}
    for(const [key,value]of Object.entries(d.answers)){const issue=validateScopeAnswer(key as ScopeField,value!);if(issue){setEditField(key as ScopeField);setError(`${SCOPE_FIELDS[key as ScopeField].label}: ${issue}`);return;}}
    if(d.contact.name.trim().length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact.email)){setError('Enter your name and a valid email address.');return;}
    await run('Preparing your estimate...',async()=>{trackScopeEvent('contactSubmitted',d.answers.service);const saved=await save(true);const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(current.current!),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Your estimate could not be completed. Please retry.');setResult(data.result);setDelivery(data.delivery||[]);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);if(data.delivery?.some((v:any)=>v.channel==='customer'&&v.status==='sent'))trackScopeEvent('estimateEmailed',d.answers.service);setStatus('');focus();});
  }
  const field=(key:ScopeField)=>{const definition=SCOPE_FIELDS[key];const value=draft?.answers[key]||'';const fieldId=`${id}-${key}`;
    return <div key={key} className={styles.field}><label htmlFor={fieldId}>{definition.label}</label>{definition.kind==='choice'?<select id={fieldId} value={value} onChange={e=>answer(key,e.target.value)}><option value="">Choose an answer</option>{definition.options.filter(v=>key!=='service'||(brand.services as readonly string[]).includes(v)).map(v=><option key={v} value={v}>{labels[v]||v.replaceAll('-',' ')}</option>)}</select>:definition.kind==='number'?<input id={fieldId} inputMode="decimal" value={value} onChange={e=>answer(key,e.target.value)} placeholder="Approximate is fine"/>:<textarea id={fieldId} rows={3} value={value} onChange={e=>answer(key,e.target.value)} maxLength={4000}/>}</div>;};
  if(!draft)return <div className={styles.root} role="status">Loading your project...</div>;
  const projectInput=<>
    <div className={styles.field}><label htmlFor={`${id}-scope`}>Tell us about your project</label><textarea id={`${id}-scope`} rows={4} maxLength={SCOPE_TEXT_LIMIT} value={draft.text} onChange={e=>change({text:e.target.value})} placeholder={projectSource?"Add any other work, installation needs or project notes.":scopeExample}/></div>
    <div className={styles.inputTools} onDragEnter={e=>e.preventDefault()} onDragOver={e=>e.preventDefault()} onDragLeave={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(e.dataTransfer.files);}}>{speechAvailable?<button type="button" onClick={speak} aria-pressed={listening}>{listening?'Stop dictation':'Use microphone'}</button>:<span className={styles.hint}>You can use your keyboard microphone to dictate.</span>}<label className={styles.attach} htmlFor={`${id}-files`}><span aria-hidden="true">↑</span><span><strong>Upload plans, photos or documents</strong><small>Choose files or drag them here</small></span><input id={`${id}-files`} type="file" accept={accept} multiple aria-label="Upload plans, photos or documents" onChange={e=>{const input=e.currentTarget;const selected=Array.from(input.files||[]);void addFiles(selected).then(()=>{input.value='';});}}/></label></div>
    <p className={styles.hint}>Plans, photos, PDFs, Word or spreadsheets. Up to 12 files, 10 MB each, 22 MB total.</p>
    {Boolean(files.length||draft.uploads?.length)&&<ul className={styles.files}>{draft.uploads?.map(f=><li key={f.id}><span>{f.name}</span><span className={styles.hint}>Uploaded</span></li>)}{files.map((f,i)=><li key={`${f.name}-${i}`}><span>{f.name}<small>Ready to upload</small></span><button type="button" aria-label={`Remove ${f.name}`} onClick={async()=>{const next=filesRef.current.filter((_,index)=>i!==index);filesRef.current=next;setFiles(next);try{await cacheFiles(draft.id,next);}catch{setStatus('File removed from this session. Local storage could not be updated.');}}}>Remove</button></li>)}</ul>}
  </>;
  const known=Object.keys(draft.answers).filter(k=>draft.answers[k as ScopeField]?.trim()) as ScopeField[];
  const review=<details className={styles.known}><summary>{known.length?`${known.length} project details saved`:'Project details'}</summary><dl>{known.map(k=><div key={k}><dt>{SCOPE_FIELDS[k].label}</dt><dd>{labels[draft.answers[k]!]||draft.answers[k]} <button type="button" aria-label={`Edit ${SCOPE_FIELDS[k].label}`} onClick={()=>setEditField(k)}>Edit</button></dd></div>)}</dl>{editField&&<div>{field(editField)}<button type="button" onClick={()=>{const issue=validateScopeAnswer(editField,draft.answers[editField]||'');if(issue){setError(issue);return;}setEditField('');}}>Done</button></div>}</details>;
  return <div role="region" aria-label="Project estimator" className={styles.root} data-p5-estimator aria-busy={Boolean(busy)} style={{'--p5-accent':brand.accent} as React.CSSProperties}>
    <div className={styles.intro}><p className={styles.eyebrow}>{brand.name} · Project estimator</p><Heading ref={heading} tabIndex={-1}>{result?'Your project summary':draft.step===0?(projectSource?'Your design is ready to estimate':'What would you like to do?'):draft.step===1?'A little more about your project':'Your project is ready to review'}</Heading><p>{result?'Review your estimate and the next step below.':draft.step===0?(projectSource?'Your design selections are included. Add anything else, then continue.':'Tell us or show us. We’ll ask only for the details we still need.'):draft.step===1?'We’ve saved what you provided. Let’s fill in the remaining details.':'Check your details and tell us where to send your estimate.'}</p></div>
    {!result&&<ol className={styles.progress} aria-label="Estimator progress">{['Your project','A few details','Your estimate'].map((label,index)=><li key={label} aria-current={draft.step===index?'step':undefined}><span>{index+1}. {label}</span></li>)}</ol>}
    {result?<div className={styles.result}>
      <h2>{result.range?`${result.range.low.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})} to ${result.range.high.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`:"Your scope is ready for pricing review"}</h2>
      <p>{result.message}</p>{result.categoryRanges?.length>0&&<section aria-label="Planning range by trade"><h3>Planning range by trade</h3><dl className={styles.tradeRanges}>{result.categoryRanges.map((r:any)=><div key={r.category}><dt>{r.category}</dt><dd>${r.low.toLocaleString("en-US")} to ${r.high.toLocaleString("en-US")}</dd></div>)}</dl><p className={styles.hint}>These categories make up the planning range above. Allowances shown below are already included.</p></section>}{result.lineItems?.length>0&&<details><summary>View items and unit pricing</summary><p className={styles.hint}>Item amounts make up the range above. Unit ranges are rounded for display. Allowances are already included.</p><dl className={styles.itemRanges}>{result.lineItems.map((item:any)=><div key={item.id}><dt><strong>{item.description}</strong><span>{item.category}</span></dt><dd><span>{item.quantity.toLocaleString("en-US")} {item.unit}</span><span>${item.unitLow.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} to ${item.unitHigh.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} per {item.unit}</span><strong>${item.low.toLocaleString("en-US")} to ${item.high.toLocaleString("en-US")}</strong></dd></div>)}</dl></details>}<h3>Project summary</h3><p className={styles.preserve}>{result.summary}</p>
      {[["Included categories",result.includedCategories],["Assumptions",result.assumptions],["Exclusions",result.exclusions],["Factors that may change the range",result.factors]].map(([title,items]:any)=>items?.length?<div key={title}><h3>{title}</h3><ul>{items.map((item:string)=><li key={item}>{item.replaceAll("-"," ")}</li>)}</ul></div>:null)}
      {result.allowances?.length>0&&<div><h3>Allowances</h3>{result.allowances.map((a:any,i:number)=><div key={i}><p><strong>{a.description}</strong>{a.amount!==null?`: $${a.amount.toLocaleString("en-US")}`:" (to be confirmed)"}</p><p>{a.includes.join(", ")}</p><p>{["tax","freight","delivery","installation","waste"].map(k=>`${k}: ${a[`${k}Included`]?"included":"excluded"}`).join("; ")}</p><p>Selection deadline: {a.selectionDeadline}. {a.adjustment}</p></div>)}</div>}
      <button type="button" onClick={downloadPdf} disabled={Boolean(busy)}>Download your project summary</button><h3>Recommended next step</h3><p>{result.nextStep}</p><p>{result.disclaimer}</p>
      <p role="status">{delivery.length>0&&delivery.every(d=>d.status==="sent")?"Your summary was sent and the team has your record.":"Your project is saved. Some deliveries are pending or need team review. Please do not submit the same project again."}</p>
      <a className={styles.primary} href={brand.consultationPath} onClick={()=>trackScopeEvent("onsiteRequested",draft.answers.service)}>Schedule a consultation</a><a className={styles.secondary} href="tel:+12084771169">Call {brand.phone}</a>
      <button type="button" onClick={()=>{const next={...newBrowserDraft(defaultService),namespace:draft.namespace};apply(next);started.current=false;setResult(null);filesRef.current=[];setFiles([]);setConfirmed(false);setActive(null);setWarning("");setStatus("");}}>Start another project</button>
    </div>:<form onSubmit={submit} noValidate><fieldset disabled={Boolean(busy)||preparingFiles} className={styles.formBody}>
      {draft.step===0?<>{projectSource&&review}{projectInput}<div className={styles.actions}><button className={styles.primary} type="button" onClick={begin}>Continue</button></div><p className={styles.hint}>Add what you know, or continue and we’ll help with the rest.</p></>:<>
        {draft.step===1&&active?<section className={styles.question} aria-label="Project question"><p className={styles.questionReason}>{active.reason}</p>{active.values?.length?<div className={styles.choices}>{active.values.map(value=><button type="button" key={value} onClick={()=>answer(active.field,value)} aria-pressed={draft.answers[active.field]===value}>{labels[value]||value}</button>)}</div>:null}{active.values?.length?<details><summary>Use a different answer</summary>{field(active.field)}</details>:field(active.field)}<div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>advance()}>Continue</button>{active.field!=='service'&&!active.conflict&&<button type="button" onClick={()=>advance(true)}>Not sure yet</button>}</div></section>:<>
          <div className={styles.fields}>{([['name','Your name','text'],['email','Email','email'],['phone','Phone (optional)','tel']] as const).map(([key,label,type])=><label className={styles.field} key={key} htmlFor={`${id}-contact-${key}`}><span>{label}</span><input id={`${id}-contact-${key}`} type={type} autoComplete={key} value={draft.contact[key]} onChange={e=>change({contact:{...draft.contact,[key]:e.target.value}})} maxLength={key==='name'?120:key==='email'?200:40}/></label>)}</div>
        </>}
        {review}
        <details open={inputOpen} onToggle={e=>setInputOpen(e.currentTarget.open)}><summary>Add or edit project information</summary>{projectInput}<button type="button" onClick={begin}>Update project</button></details>
        {warning&&<div className={styles.notice}><p>{warning}</p><button type="button" onClick={()=>run('Reading your saved documents...',analyze)}>Retry document reading</button></div>}
        {draft.step===2&&<>
          {scopeAssumptions(draft.answers,draft.wizard?.skipped).length>0&&<details><summary>Assumptions and details to confirm</summary><ul>{scopeAssumptions(draft.answers,draft.wizard?.skipped).map(note=><li key={note}>{note}</li>)}</ul></details>}
          <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>These details reflect my project. I understand this is a preliminary estimate, subject to confirmed scope, selections and site conditions.</span></label>
          <div className={styles.actions}><button className={styles.primary} type="submit">Get my estimate</button></div>
        </>}
        <button className={styles.back} type="button" onClick={()=>{change({step:0});setError('');focus();}}>Back to my project</button>
      </>}
    </fieldset></form>}
    {(busy||preparingFiles)&&<div className={styles.loadingOverlay}><div className={styles.loadingCard} role="status" aria-live="polite"><span className={styles.spinner} aria-hidden="true"/><h2>{preparingFiles?'Preparing your files...':busy}</h2>{uploadPercent!==null?<><progress max={100} value={uploadPercent} aria-label="File upload progress"/><p>{uploadPercent}% transferred. Waiting for confirmation before marking files saved.</p></>:<p>{preparingFiles?'Checking that every selected file can be read.':busy.includes('Reading')?'Finding project details, measurements and specifications. Large documents take longer.':'Please keep this tab open. Your project details stay with this estimate.'}</p>}</div></div>}{error&&<p className={styles.error} role="alert">{error}</p>}{status&&!busy&&!preparingFiles&&<p className={styles.hint} role="status">{status}</p>}
  </div>;
}
