"use client";
import {CLIENT_BUDGET_MS,ProcessingDeadlineError,remainingBudget,withinDeadline,fetchWithinDeadline} from '@/lib/p5/processingBudget';
import {completeSubmission} from '@/lib/p5/submitProgress';
import P5EstimateDetails from './P5EstimateDetails';
import P5ProcessingStatus from './P5ProcessingStatus';
import type {ProcessingStatus} from '@/lib/p5/processingStatus';
import {useEffect,useId,useRef,useState} from 'react';
import {ESTIMATOR_BRAND as brand} from '@/lib/p5/brand';
import {estimatorTheme,estimatorThemeStyle} from '@/lib/p5/theme';
import {SCOPE_FIELDS,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP,type ScopeField,type ScopeAnswers,type ScopeUpload} from '@/lib/p5/scope';
import {deriveScopeAnswers,questionForField,scopeQuestionsForBrand as scopeQuestions,scopeAssumptions,validateScopeAnswer,type ScopeQuestion} from '@/lib/p5/adaptive';
import {loadBrowserDraft,persistBrowserDraft,draftHeaders,cacheFiles,loadCachedFiles,clearCachedFiles,requireDraftReceipt,archiveBrowserDraft,listBrowserDraftRecoveries,replaceBrowserDraft,restoreBrowserDraft,type BrowserDraft,type BrowserDraftRecovery} from '@/lib/p5/browserDraft';
import {mergeProjectSource,type ProjectSource} from '@/lib/p5/projectSource';
import {resumeWizardDraft} from '@/lib/p5/wizardResume';
import {snapshotProjectFile} from '@/lib/p5/fileSnapshot';
import {transferLargeFiles} from '@/lib/p5/resumableTransfer';
import {transferProjectFiles} from '@/lib/p5/uploadTransfer';
import {fieldCategory} from '@/lib/p5/presentation';
import styles from './P5Estimator.module.css';
import {reportProgress,trackScopeEvent} from '@/lib/p5/progress';
import {displayScopeText,refreshAnalyzedScope,scopeFingerprint,scopeTextChanged,sourceSnapshot,sourceSnapshotsEqual} from '@/lib/p5/scopeReplacement';

const textAnswers=(a:ScopeAnswers)=>JSON.stringify(Object.entries(a).filter(([k,v])=>SCOPE_FIELDS[k as ScopeField].kind==='text'&&v?.trim()).sort(([a],[b])=>a.localeCompare(b)));
const labels:Record<string,string>={handyman:'Home repairs',re10:'Inspection and RE-10 repairs','cabinet-product':'Cabinets, supply only','cabinet-install':'Cabinets with installation',kitchen:'Kitchen remodel',bathroom:'Bathroom remodel','whole-home':'Whole-home remodel',addition:'Home addition',adu:'ADU','new-construction':'New home','change-order':'Change order',rush:'Rush work',refresh:'Simple refresh','mid-range':'Standard finishes','high-end':'Premium finishes',luxury:'Custom luxury finishes',standard:'Standard',priority:'Priority',emergency:'Emergency',complex:'Complex',yes:'Yes',no:'No'};
const readable=(field:ScopeField,value:string)=>field==='cabinetRoom'?value.replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase()):labels[value]||value.replaceAll('-',' ');
const scopeExample=(brand.id as string)==='cabinet'?'For example: Painted Shaker kitchen cabinets, 20 ft of base and 15 ft of uppers. Include installation.':(brand.id as string)==='construction'?'For example: Build a 2,500 sq ft home with an 800 sq ft garage. Our plans are attached.':(brand.id as string)==='handyman'?'For example: Fix three sticking doors, replace two faucets and repair damaged drywall.':'For example: Remodel our 8 x 10 ft bathroom. Keep the layout, replace the shower, tile and vanity.';
const accept='.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.tif,.tiff,.avif,.txt,.csv,.json,.xlsx,.xls,.ods,.docx,.doc';
const STEP_LABELS=['Project','Details','Estimate'];
type Recognition={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:any)=>void)|null;onerror:((event:any)=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
type Paused={kind:'analysis'|'pricing';processing:ProcessingStatus|null};
type MissingField={field:ScopeField;label:string};
const theme=estimatorTheme();

export function P5Estimator({defaultService='',headingAs='h1',projectSource}:{defaultService?:string;headingAs?:'h1'|'h2';projectSource?:ProjectSource}){
  const [draft,setDraft]=useState<BrowserDraft|null>(null);const current=useRef<BrowserDraft|null>(null);
  const [files,setFiles]=useState<File[]>([]);const filesRef=useRef<File[]>([]);
  const [busy,setBusy]=useState('');const busyRef=useRef(false);const [error,setError]=useState('');const [warning,setWarning]=useState('');const [status,setStatus]=useState('');
  const [uploadPercent,setUploadPercent]=useState<number|null>(null);const [preparingFiles,setPreparingFiles]=useState(false);const [dragging,setDragging]=useState(false);
  const [processing,setProcessing]=useState<ProcessingStatus|null>(null);const lastProcessing=useRef<ProcessingStatus|null>(null);
  const [paused,setPaused]=useState<Paused|null>(null);const resuming=useRef(false);
  const [missingFields,setMissingFields]=useState<MissingField[]>([]);
  const started=useRef(false);
  const [clarificationReply,setClarificationReply]=useState('');
  const [recoveries,setRecoveries]=useState<BrowserDraftRecovery[]>([]);
  const [result,setResult]=useState<any>(null);const [delivery,setDelivery]=useState<any[]>([]);const [confirmed,setConfirmed]=useState(false);
  const [active,setActive]=useState<ScopeQuestion|null>(null);const [inputOpen,setInputOpen]=useState(false);const [editField,setEditField]=useState<ScopeField|''>('');
  const [listening,setListening]=useState(false);const [speechAvailable,setSpeechAvailable]=useState(false);const recognition=useRef<Recognition|null>(null);
  const queue=useRef<Promise<unknown>>(Promise.resolve());const heading=useRef<HTMLHeadingElement>(null);const mounted=useRef(false);const estimatorRef=useRef<HTMLDivElement>(null);const confirmationRef=useRef<HTMLInputElement>(null);const contactNameRef=useRef<HTMLInputElement>(null);const contactEmailRef=useRef<HTMLInputElement>(null);const id=useId();const Heading=headingAs;
  const [validationTarget,setValidationTarget]=useState<'confirmation'|'contact'|''>('');
  const apply=(next:BrowserDraft)=>{current.current=next;setDraft(next);if(!persistBrowserDraft(next))setStatus('Keep this page open. This browser cannot save your work on this device.');};
  const change=(update:Partial<BrowserDraft>)=>{if(!current.current)return;apply({...current.current,...update,dirty:true,updatedAt:Date.now()});setConfirmed(false);};
  const changeContact=(key:keyof BrowserDraft['contact'],value:string)=>{const latest=current.current;if(latest)change({contact:{...latest.contact,[key]:value}});};
  const questions=(d:BrowserDraft)=>scopeQuestions(d.answers,d.extraction,d.conflicts||[],d.wizard?.skipped||[],d.pricedFields||[]);
  const resume=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);setClarificationReply(d.pendingReply?.id===next?.instructionId?d.pendingReply?.answer||'':'');apply(resumeWizardDraft(d,Boolean(next)));};
  /** Every step change starts at the top of the estimator with focus on its heading. */
  const focus=()=>requestAnimationFrame(()=>{const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;estimatorRef.current?.scrollIntoView({block:'start',behavior:reduced?'auto':'smooth'});heading.current?.focus({preventScroll:true});});
  const showQuestions=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);if(!next){trackScopeEvent('repairsConfirmed',d.answers.service);trackScopeEvent('contactViewed',d.answers.service);}apply({...d,step:next?1:2});setInputOpen(false);setConfirmed(false);setMissingFields([]);focus();};
  const answer=(key:ScopeField,value:string)=>{
    const d=current.current;if(!d)return;
    let answers={...d.answers,[key]:value};
    if((key==='length'||key==='width')&&d.answers.length&&d.answers.width&&d.answers.sqft===deriveScopeAnswers({...d.answers,sqft:''}).sqft)answers.sqft='';
    answers=deriveScopeAnswers(answers);
    change({answers,conflicts:(d.conflicts||[]).filter(c=>c.field!==key),wizard:{...d.wizard,skipped:(d.wizard?.skipped||[]).filter(k=>k!==key),resolutions:{...d.wizard?.resolutions,[key]:value}}});
  };
  useEffect(()=>{
    mounted.current=true;const loaded=loadBrowserDraft(defaultService,projectSource?.id);const d=projectSource&&!loaded.sourceDetached?mergeProjectSource(loaded,projectSource):loaded;resume(d);setRecoveries(listBrowserDraftRecoveries(d.namespace));setWarning(d.analysisWarning||d.extraction?.reviewNotes.find(n=>n.startsWith("Your files are saved, but"))||"");
    setSpeechAvailable(Boolean((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition));
    loadCachedFiles(d.id).then(f=>{if(mounted.current&&current.current?.id===d.id){filesRef.current=f;setFiles(f);}}).catch(()=>setStatus('File recovery is unavailable. Keep this page open while uploading.'));
    if(d.revision>0)fetch('/api/p5-estimator/draft',{headers:draftHeaders(d),cache:'no-store'}).then(r=>r.ok?r.json():null).then(async data=>{
      if(!mounted.current||!data?.draft||current.current?.id!==d.id)return;
      checkOperation();const saved=requireDraftReceipt(data);
      if(saved.status==='submitted'){
        if(!sourceSnapshotsEqual(sourceSnapshot(d),sourceSnapshot(current.current as BrowserDraft)))return;
        const response=await operationFetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision})});const value=await response.json();
        if(value.result&&mounted.current){setResult(value.result);setDelivery(value.delivery||[]);}return;
      }
      // Never overwrite edits made while recovery was in flight or unsaved offline work.
      if(!sourceSnapshotsEqual(sourceSnapshot(d),sourceSnapshot(current.current as BrowserDraft)))return;
      if(!d.dirty&&current.current.updatedAt===d.updatedAt&&saved.revision>=d.revision){const restored={...d,...saved,key:d.key,step:d.step,updatedAt:d.updatedAt} as BrowserDraft;resume(restored);}
      else apply({...current.current,uploads:saved.uploads});
    }).catch(()=>setStatus('Your saved answers are available on this device. Reconnect to save online.'));
    const preventFileNavigation=(event:DragEvent)=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();};
    window.addEventListener("drop",preventFileNavigation);window.addEventListener("dragover",preventFileNavigation);
    return()=>{mounted.current=false;recognition.current?.stop();window.removeEventListener("drop",preventFileNavigation);window.removeEventListener("dragover",preventFileNavigation);};
  },[defaultService,projectSource?.id]);
  useEffect(()=>{if(projectSource&&current.current&&!current.current.sourceDetached){const next=mergeProjectSource(current.current,projectSource);if(next!==current.current){resume(next);setConfirmed(false);}}},[JSON.stringify(projectSource)]);
  useEffect(()=>{
    if(!draft)return;
    const engaged=Boolean(draft.text||files.length||Object.keys(draft.answers).length);
    if(engaged&&!started.current){started.current=true;trackScopeEvent('started',draft.answers.service);}
    if(engaged)reportProgress(draft,result?'completed':'active');
  },[draft?.step,JSON.stringify(draft?.answers),Boolean(draft?.text),files.length,Boolean(result)]);
  const operationBudget=useRef<{deadline:number;controller:AbortController}|null>(null);
  const operationFetch:typeof fetch=(input,init)=>{const budget=operationBudget.current;return fetchWithinDeadline(fetch,input,{...init,...(budget?{signal:budget.controller.signal}:{})},budget?.deadline||Date.now()+CLIENT_BUDGET_MS);};
  const checkOperation=()=>{const budget=operationBudget.current;if(budget){if(budget.controller.signal.aborted)throw new ProcessingDeadlineError();remainingBudget(budget.deadline);}};
  const serialized=<T,>(operation:()=>Promise<T>):Promise<T>=>{const task=queue.current.catch(()=>undefined).then(operation);queue.current=task;return task;};
  async function save(reviewed=false,clarification?:{id:string;answer:string}){
    const initiated=operationBudget.current;
    const d=current.current;if(!d)throw new Error('Your project is still loading.');
    const requestSource=sourceSnapshot(d);
    const response=await operationFetch('/api/p5-estimator/draft',{method:'PUT',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({text:d.text,answers:d.answers,contact:d.contact,revision:d.revision,wizard:d.wizard,reviewed,clarification,scopeFingerprint:scopeFingerprint(d.text)})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Your project could not be saved. Please retry.');checkOperation();const saved=requireDraftReceipt(data);
    if(initiated&&initiated!==operationBudget.current)throw new ProcessingDeadlineError();
    if(current.current?.id!==d.id)return saved;
    // A response for an older source may still be valid on the server, but
    // it must not put its extraction back into the newer local project.
    if(!sourceSnapshotsEqual(requestSource,sourceSnapshot(current.current))){apply({...current.current,revision:saved.revision});return saved;}
    const unchanged=current.current.updatedAt===d.updatedAt;
    apply({...current.current,revision:saved.revision,extraction:saved.extraction,uploads:saved.uploads,pricedFields:data.pricedFields||[],...(unchanged?{answers:saved.answers,wizard:saved.wizard,conflicts:[...(data.conflicts||[]),...(current.current.conflicts||[]).filter(c=>!data.conflicts?.some((v:any)=>v.field===c.field))],dirty:false}:{})});
    return saved;
  }
  useEffect(()=>{
    if(!draft?.contact.email||busy||result)return;
    const timer=setTimeout(()=>{if(!busyRef.current)void serialized(()=>save()).then(()=>setStatus('Project saved.')).catch(()=>setStatus('Saved on this device. We will retry saving when connected.'));},1800);
    return()=>clearTimeout(timer);
  },[draft?.text,JSON.stringify(draft?.answers),JSON.stringify(draft?.contact),busy,Boolean(result)]);
  /** One bounded operation at a time. A deadline is a pause with the work
   * preserved server-side, never a failure that discards progress. */
  async function run(label:string,operation:()=>Promise<void>,kind:Paused['kind']|null=null){
    if(busyRef.current)return;busyRef.current=true;setBusy(label);setProcessing(null);lastProcessing.current=null;setError('');setPaused(null);recognition.current?.stop();
    const budget={deadline:Date.now()+CLIENT_BUDGET_MS,controller:new AbortController()};operationBudget.current=budget;
    try{await withinDeadline(()=>serialized(async()=>{checkOperation();await withinDeadline(operation,budget.deadline);checkOperation();}),budget.deadline);}
    catch(e){
      const userPaused=budget.controller.signal.aborted&&Date.now()<budget.deadline;
      if(userPaused)setStatus('Your progress is saved. Continue whenever you are ready.');
      else if(e instanceof ProcessingDeadlineError&&kind)setPaused({kind,processing:lastProcessing.current});
      else setError(e instanceof ProcessingDeadlineError?'This is taking longer than expected. Your completed work is saved; continue to pick up where it stopped.':e instanceof TypeError?'The connection was interrupted. Your saved details are intact. Keep this tab open and retry.':e instanceof Error?e.message:'This step could not finish. Your work is still here.');
    }
    finally{budget.controller.abort();if(operationBudget.current===budget)operationBudget.current=null;busyRef.current=false;setBusy('');setUploadPercent(null);setProcessing(null);}
  }
  useEffect(()=>{
    if(!paused||busy)return;
    let cancelled=false;
    const kind=paused.kind;
    const tick=async()=>{
      const d=current.current;if(!d||cancelled)return;
      try{
        if(kind==='pricing'){
          const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,background:true,retry:false})});
          const data=await response.json();if(cancelled)return;
          if(response.status===202&&data.pending){if(data.processing)setPaused(p=>p&&p.kind===kind?{...p,processing:data.processing}:p);return;}
          setPaused(null);
          if(!response.ok){if(data.pricingReviewRequired)setMissingFields(Array.isArray(data.missingFields)?data.missingFields.filter((f:any)=>f&&typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field)).map((f:any)=>({field:f.field as ScopeField,label:String(f.label||SCOPE_FIELDS[f.field as ScopeField].label)})):[]);setError(data.error||'Your estimate could not be completed. Your saved work is intact; please retry.');return;}
          if(data.result){setResult(data.result);setDelivery(data.delivery||[]);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);setStatus('');focus();}
        }else{
          const form=new FormData();form.set('text',d.text);form.set('scopeFingerprint',scopeFingerprint(d.text));form.set('revision',String(d.revision));form.set('resumable','true');form.set('background','true');form.set('retry','false');
          const response=await fetch('/api/p5-estimator/scope',{method:'POST',headers:draftHeaders(d),body:form});
          const data=await response.json();if(cancelled)return;
          if(data.pending){if(Number.isInteger(data.draftRevision)&&data.draftRevision!==d.revision)apply({...d,revision:data.draftRevision});if(data.processing)setPaused(p=>p&&p.kind===kind?{...p,processing:data.processing}:p);return;}
          setPaused(null);
          if(!response.ok){setError(data.error||'Your files could not be processed. They are still here. Please retry.');return;}
          // The reading finished. Re-enter the normal flow; the saved job answers immediately.
          resuming.current=true;void begin();
        }
      }catch{/* transient; the next tick retries */}
    };
    const timer=setInterval(()=>{void tick();},4000);void tick();
    return()=>{cancelled=true;clearInterval(timer);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[paused?.kind,busy]);
  const track=(detail:ProcessingStatus|null|undefined)=>{if(detail){lastProcessing.current=detail;setProcessing(detail);}};
  async function ensureSourcePhoto(){
    const url=projectSource&&!current.current?.sourceDetached?projectSource.imageUrl:undefined;if(!url||current.current?.sourceImageUrl===url)return;
    const parsed=new URL(url,window.location.origin);
    if(parsed.origin!==window.location.origin&&!url.startsWith('data:image/')&&!url.startsWith('blob:'))throw new Error('The design photo cannot be imported from this address. Please add it using Add files.');
    const response=await operationFetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Your design photo could not be read. Please retry or add the photo using Add files.');
    const blob=await response.blob();const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif'};
    if(!ext[blob.type]||blob.size>SCOPE_FILE_LIMIT)throw new Error('Use Add files to provide a supported design photo up to 250 MB.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
    const name=`design-photo-${digest}.${ext[blob.type]}`;
    if(!filesRef.current.some(f=>f.name===name)&&!current.current?.uploads?.some(f=>f.name===name)){
      await addFiles([new File([blob],name,{type:blob.type,lastModified:0})]);
      if(!filesRef.current.some(f=>f.name===name))throw new Error('The design photo was not added. Check the file limits and retry.');
    }
  }
  async function analyze(){
    const initiated=operationBudget.current;
    const checkAnalysis=()=>{if(initiated&&initiated!==operationBudget.current)throw new ProcessingDeadlineError();checkOperation();};
    await ensureSourcePhoto();
    setBusy('Saving your project...');await save();const d=current.current!;const pending=[...filesRef.current];
    const expectedSource=sourceSnapshot(d);
    const requireCurrentSource=()=>{
      if(!mounted.current||current.current?.id!==d.id||!sourceSnapshotsEqual(expectedSource,sourceSnapshot(current.current)))throw new Error('Your project changed while it was being read. Your files are retained. Refresh before continuing so newer details are not overwritten.');
    };
    if(pending.length){
      setBusy('Uploading your files...');setUploadPercent(0);
      const large=pending.some(f=>f.size>10*1024*1024)||pending.reduce((n,f)=>n+f.size,0)>22*1024*1024;
      let uploaded:unknown;
      if(large)uploaded=await transferLargeFiles(pending,draftHeaders(d),setUploadPercent,operationFetch);
      else{const upload=new FormData();upload.set('analyze','false');for(const f of pending)upload.append('files',new Blob([await f.arrayBuffer()],{type:f.type}),f.name);uploaded=await transferProjectFiles(upload,draftHeaders(d),setUploadPercent,operationBudget.current?.controller.signal,operationBudget.current?.deadline);}
      checkOperation();const receipt=requireDraftReceipt(uploaded);
      if(!sourceSnapshotsEqual(sourceSnapshot(d),sourceSnapshot(receipt as BrowserDraft)))throw new Error('Your project changed while files were uploading. Your files are retained. Refresh before continuing so newer details are not overwritten.');
      requireCurrentSource();
      for(const f of pending){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');if(!receipt.uploads.some(stored=>stored.sha256===digest))throw new Error(`${f.name}: upload was not confirmed. Please retry.`);}
      apply({...current.current!,uploads:receipt.uploads,revision:receipt.revision});filesRef.current=[];setFiles([]);await clearCachedFiles(d.id).catch(()=>undefined);setUploadPercent(null);setStatus('Files uploaded and saved.');
    }
    setBusy('Reading your documents and project details...');const form=new FormData();form.set('text',d.text);form.set('scopeFingerprint',scopeFingerprint(d.text));form.set('revision',String(current.current!.revision));form.set('resumable','true');form.set('background','true');form.set('retry',resuming.current?'false':'true');resuming.current=false;
    let data:any;
    do{
      requireCurrentSource();
      const response=await operationFetch('/api/p5-estimator/scope',{method:'POST',headers:draftHeaders(d),body:form,signal:AbortSignal.timeout(200000)});data=await response.json();form.set('retry','false');
      if(!response.ok)throw new Error(data.error||'Your files could not be processed. They are still here. Please retry.');
      requireCurrentSource();
      if(data.pending){if(Number.isInteger(data.draftRevision)){apply({...current.current!,revision:data.draftRevision});form.set('revision',String(data.draftRevision));}setBusy(data.progress||'Reading your project...');track(data.processing);await new Promise(r=>setTimeout(r,1000));}
    }while(data.pending);
    checkOperation();const saved=requireDraftReceipt(data);
    requireCurrentSource();
    checkAnalysis();
    const next={...current.current!,...saved,key:d.key,step:1,updatedAt:Date.now(),dirty:false,conflicts:data.conflicts||[],pricedFields:data.pricedFields||[],analysisWarning:data.warning||"",sourceImageUrl:current.current?.sourceDetached?undefined:projectSource?.imageUrl,analyzedText:d.text,analyzedAnswers:textAnswers(saved.answers)} as BrowserDraft;
    apply(next);setWarning(data.warning||'');if(pending.length)trackScopeEvent(d.uploads?.length?'additionalDocuments':'documentUploaded',saved.answers.service);trackScopeEvent(data.warning?'analysisFailed':'analysisCompleted',saved.answers.service);filesRef.current=[];setFiles([]);
    try{await clearCachedFiles(d.id);}catch{setStatus('Files are uploaded. Local file cleanup will retry later.');}
    setStatus(data.warning?'Files uploaded. Some details still need review.':'Project details saved. We will only ask about what is missing.');showQuestions(next);
  }
  const needsAnalysis=()=>{const d=current.current;return Boolean(d&&(d.analysisWarning||!d.sourceDetached&&projectSource?.imageUrl&&d.sourceImageUrl!==projectSource.imageUrl||filesRef.current.length||d.text.trim()&&d.text!==d.analyzedText||textAnswers(d.answers)!=='[]'&&textAnswers(d.answers)!==d.analyzedAnswers));};
  const begin=()=>run('Reading your project...',async()=>{
    if(!current.current?.text.trim()&&!filesRef.current.length&&!current.current?.uploads?.length&&!Object.values(current.current?.answers||{}).some(v=>v?.trim())){setError('Describe your project or add a file to continue.');return;}
    if(needsAnalysis()||(current.current?.uploads?.length&&!current.current.extraction))await analyze();
    else{await save();showQuestions(current.current!);}
  },'analysis');
  async function addFiles(selected:FileList|File[]|null){
    if(!selected||!current.current)return;
    const incoming=Array.from(selected);const next=[...filesRef.current];
    for(const f of incoming){if(!accept.split(',').includes('.'+f.name.split('.').pop()?.toLowerCase())){setError(`${f.name}: use a supported document or photo format.`);return;}if(!next.some(v=>v.name===f.name&&v.size===f.size&&v.lastModified===f.lastModified))next.push(f);}
    const uploaded=current.current.uploads||[];
    if(next.length+uploaded.length>SCOPE_FILE_COUNT||next.some(f=>!f.size||f.size>SCOPE_FILE_LIMIT)||next.reduce((n,f)=>n+f.size,0)+uploaded.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT){setError(SCOPE_UPLOAD_HELP);return;}
    let copied:File[];setPreparingFiles(true);
    try{copied=[];for(const file of next)copied.push(filesRef.current.includes(file)||file.size>10*1024*1024?file:await snapshotProjectFile(file));}catch(error){setPreparingFiles(false);setError(error instanceof Error?error.message:'The selected file could not be read. Please select it again.');return;}
    filesRef.current=copied;setFiles(copied);setError('');setConfirmed(false);
    try{if(copied.reduce((n,f)=>n+f.size,0)>22*1024*1024)throw new Error('Large files stay in this tab until upload.');await cacheFiles(current.current.id,copied);setStatus('Files ready. Continue to read them with your project details.');}catch{setStatus('Files are ready in this tab. Device storage is unavailable; keep this tab open until upload completes.');}finally{setPreparingFiles(false);}
  }
  /** Talk to text where the browser supports it. Final phrases are appended to the project text. */
  function speak(){
    if(listening){recognition.current?.stop();return;}
    const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Constructor)return;
    const r:Recognition=new Constructor();recognition.current=r;r.continuous=true;r.interimResults=false;r.lang='en-US';
    r.onresult=(event:any)=>{let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+' ';if(text.trim()){const d=current.current;if(d)changeProjectText(`${displayScopeText(d.text,d.answers.estimatingInstructions)} ${text}`.trim());}};
    r.onerror=()=>{setListening(false);setError("Microphone input is unavailable. You can type, upload, or use your keyboard's dictation button.");};r.onend=()=>setListening(false);
    try{setListening(true);setError('');r.start();}catch{setListening(false);setError('The microphone could not start. You can still type or add files.');}
  }
  async function advance(skip=false){
    if(!current.current)return;
    if(active?.instructionId){
      if(!clarificationReply.trim()){setError('Add an answer or select an option.');return;}
      const reply={id:active.instructionId,answer:clarificationReply};
      await run('Saving your answer...',async()=>{await save(false,reply);const saved=current.current!;apply({...saved,analyzedAnswers:textAnswers(saved.answers)});setClarificationReply('');apply({...current.current!,pendingReply:undefined});showQuestions(current.current!);});
      return;
    }
    if(active?.conflict&&!current.current.wizard?.resolutions[active.field]){setError('Choose the detail to use, or enter a correction.');return;}
    if(active){const value=current.current.answers[active.field]||'';const issue=validateScopeAnswer(active.field,value);if(!skip&&(issue||!value.trim())){setError(issue||'Add this detail, or choose Not sure yet.');return;}
      if(skip){if(active.field==='service'||active.conflict)return;const d=current.current;change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:[...new Set([...(d.wizard?.skipped||[]),active.field])]}});}}
    await run('Saving your answer...',async()=>{await save();const saved=current.current!;apply({...saved,analyzedAnswers:textAnswers(saved.answers)});showQuestions(current.current!);});
  }
  /** Open one missing detail as a question, keeping every other answer. */
  const jumpToField=(field:ScopeField)=>{
    const d=current.current;if(!d)return;
    change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:(d.wizard?.skipped||[]).filter(k=>k!==field)}});
    setActive(questionForField(field,d.answers));setMissingFields([]);setError('');setInputOpen(false);
    apply({...current.current!,step:1});focus();
  };
  async function downloadPdf(){await run('Preparing your PDF...',async()=>{const response=await operationFetch('/api/p5-estimator/pdf',{headers:draftHeaders(current.current!)});if(!response.ok)throw new Error('The PDF could not be downloaded. Your submission is saved; please retry.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`${brand.id}-project-summary.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
  const focusCorrection=(element:HTMLElement|null)=>requestAnimationFrame(()=>{if(!element)return;element.focus({preventScroll:true});element.scrollIntoView({block:'center',behavior:'smooth'});});
  async function submit(event:React.FormEvent){
    event.preventDefault();if(draft?.step!==2){await begin();return;}
    if(needsAnalysis()){await begin();return;}
    const d=current.current!;
    if(questions(d).length){showQuestions(d);return;}
    for(const [key,value]of Object.entries(d.answers)){const issue=validateScopeAnswer(key as ScopeField,value!);if(issue){setEditField(key as ScopeField);setError(`${SCOPE_FIELDS[key as ScopeField].label}: ${issue}`);requestAnimationFrame(()=>document.getElementById(`${id}-${key}`)?.focus());return;}}
    const invalidName=d.contact.name.trim().length<2;const invalidEmail=!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact.email);
    if(invalidName||invalidEmail){setValidationTarget('contact');setError('Enter your name and a valid email address to see your estimate.');focusCorrection(invalidName?contactNameRef.current:contactEmailRef.current);return;}
    if(!confirmed){setValidationTarget('confirmation');setError('Please confirm your project details before continuing.');focusCorrection(confirmationRef.current);return;}
    await run('Preparing your estimate...',async()=>{
      trackScopeEvent('contactSubmitted',d.answers.service);const budget=operationBudget.current!;const saved=await save(true);
      const checkSubmission=()=>{if(operationBudget.current!==budget)throw new ProcessingDeadlineError();checkOperation();};
      let retry=!resuming.current;resuming.current=false;
      let data:any;
      try{
        data=await completeSubmission(()=>{checkSubmission();const shouldRetry=retry;retry=false;return operationFetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(current.current!),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision,background:true,retry:shouldRetry})});},(message,detail)=>{checkSubmission();setBusy(message);track(detail);},undefined,budget.deadline);
      }catch(failure){
        const details=(failure as any)?.details;
        if(details?.pricingReviewRequired){setMissingFields(Array.isArray(details.missingFields)?details.missingFields.filter((f:any)=>f&&typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field)).map((f:any)=>({field:f.field as ScopeField,label:String(f.label||SCOPE_FIELDS[f.field as ScopeField].label)})):[]);throw new Error(details.error||'A few more details are needed before pricing.');}
        throw failure;
      }
      checkSubmission();setResult(data.result);setDelivery(data.delivery||[]);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);if(data.delivery?.some((v:any)=>v.channel==='customer'&&v.status==='sent'))trackScopeEvent('estimateEmailed',d.answers.service);setStatus('');focus();
    },'pricing');
  }
  const continuePaused=()=>{const kind=paused?.kind;setPaused(null);resuming.current=true;if(kind==='pricing'){const form=document.getElementById(`${id}-form`) as HTMLFormElement|null;if(form)form.requestSubmit();else void begin();}else void begin();};
  const reply=(value:string)=>{setClarificationReply(value);if(active?.instructionId)change({pendingReply:{id:active.instructionId,answer:value}});};
  const changeProjectText=(text:string)=>{
    const d=current.current;if(!d)return;
    if(!scopeTextChanged(displayScopeText(d.text,d.answers.estimatingInstructions),text)){
      change({text,answers:{...d.answers,estimatingInstructions:''}});return;
    }
    // Editing the visible scope is an ordinary additive change. Preserve
    // independent authored answers; only a deliberate replacement starts a
    // blank draft and archives the old project.
    change({...refreshAnalyzedScope(d,text),text});setClarificationReply('');setActive(null);setWarning('');setRecoveries(listBrowserDraftRecoveries(d.namespace));
  };
  const switchProject=async(recovery?:BrowserDraftRecovery)=>{
    if(busyRef.current||preparingFiles||!current.current)return;
    const d=current.current;
    if(!window.confirm(recovery?'Restore this saved project? Your current project will be kept in recovery.':'Start a replacement project with no previous answers or files? Your current project and files will be kept in recovery.'))return;
    await run('Preserving your project...',async()=>{
      // Do not replace a project if pending local files cannot be retained.
      if(filesRef.current.length)await cacheFiles(d.id,filesRef.current);
      const archived=replaceBrowserDraft(d,'');
      let next=recovery?restoreBrowserDraft(recovery):archived.draft;
      if(!next)throw new Error('This saved project could not be restored. Your current project is unchanged.');
      const pending=recovery?await loadCachedFiles(next.id):[];
      if(recovery&&next.revision>0){
        const response=await operationFetch('/api/p5-estimator/draft',{headers:draftHeaders(next),cache:'no-store'});
        if(!response.ok)throw new Error('The saved project could not be checked. Keep this page open and retry.');
        const saved=requireDraftReceipt(await response.json());
        if(saved.status==='submitted')throw new Error('This project was already submitted and cannot be edited. Its recovery is retained; start a replacement project instead.');
        if(scopeTextChanged(saved.text,next.text)){
          // The archived source is a new correction, not permission to reuse stale analysis.
          next={...refreshAnalyzedScope(next,next.text),revision:saved.revision,uploads:saved.uploads,dirty:true};
        }else{
          if(next.dirty){
            const serverSnapshot={...next,...saved,key:next.key,namespace:next.namespace,dirty:false} as BrowserDraft;
            if(!archiveBrowserDraft(serverSnapshot))throw new Error('The newer server version could not be backed up. Neither version has been changed.');
            if(JSON.stringify((next.uploads||[]).map(f=>f.sha256).sort())!==JSON.stringify(saved.uploads.map((f:ScopeUpload)=>f.sha256).sort()))throw new Error('The saved project has a different file set. Both versions are retained in recovery; review them before replacing the project.');
            // The user explicitly chose this snapshot. Preserve its unsaved authored
            // fields, but trust the server for immutable extraction and file evidence.
            next={...next,revision:saved.revision,uploads:saved.uploads,extraction:saved.extraction,step:0,dirty:true};
          }else next={...next,...saved,key:next.key,namespace:next.namespace,step:0,dirty:false} as BrowserDraft;
        }
      }
      filesRef.current=pending;setFiles(pending);setResult(null);setDelivery([]);setError('');setWarning('');setConfirmed(false);setClarificationReply('');setInputOpen(false);setMissingFields([]);started.current=false;
      resume(next);setRecoveries(listBrowserDraftRecoveries(next.namespace));setStatus(recovery?'Saved project restored. Review it before continuing.':'Replacement project started. Previous answers and uploaded files are not included.');focus();
    });
  };
  const field=(key:ScopeField)=>{const definition=SCOPE_FIELDS[key];const value=draft?.answers[key]||'';const fieldId=`${id}-${key}`;
    return <div key={key} className={styles.field}><label htmlFor={fieldId}>{definition.label}</label>{definition.kind==='choice'?<select id={fieldId} value={value} onChange={e=>answer(key,e.target.value)}><option value="">Choose an answer</option>{definition.options.filter(v=>key!=='service'||(brand.services as readonly string[]).includes(v)).map(v=><option key={v} value={v}>{readable(key,v)}</option>)}</select>:definition.kind==='number'?<input id={fieldId} inputMode="decimal" value={value} onChange={e=>answer(key,e.target.value)} placeholder="Approximate is fine"/>:<textarea id={fieldId} rows={3} value={value} onChange={e=>answer(key,e.target.value)} />}</div>;};
  if(!draft)return <div ref={estimatorRef} className={styles.root} data-theme={theme.mode} style={estimatorThemeStyle(theme) as React.CSSProperties} role="status">Loading your project...</div>;
  const attachedProjectSource=projectSource&&!draft.sourceDetached?projectSource:undefined;
  const known=Object.keys(draft.answers).filter(k=>k!=='estimatingInstructions'&&draft.answers[k as ScopeField]?.trim()) as ScopeField[];
  const knownGroups=[...new Set(known.map(fieldCategory))].map(title=>({title,fields:known.filter(k=>fieldCategory(k)===title)}));
  const uploadedCount=draft.uploads?.length||0;
  const contactReady=draft.contact.name.trim().length>=2&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact.email);
  const stepIndex=result?3:draft.step;
  const submitErrorId=`${id}-submit-error`;
  const projectInput=<>
    <div className={styles.field}>
      <div className={styles.fieldHead}><label htmlFor={`${id}-scope`}>Tell us about your project</label>{speechAvailable&&<button type="button" className={styles.mic} data-listening={listening} aria-pressed={listening} onClick={speak}><i aria-hidden="true"/>{listening?'Stop listening':'Talk instead'}</button>}</div>
      <textarea id={`${id}-scope`} rows={5} value={displayScopeText(draft.text,draft.answers.estimatingInstructions)} onChange={e=>changeProjectText(e.target.value)} placeholder={`${scopeExample}\nInclude any notes, instructions, inclusions or exclusions.`}/>
      <p className={styles.hint}>Include sizes, what to include or exclude, and who supplies materials. Instructions such as “price only the trim” or “exclude plumbing” are followed throughout.</p>
    </div>
    <label className={styles.dropzone} htmlFor={`${id}-files`} data-dragging={dragging} onDragEnter={e=>{e.preventDefault();setDragging(true);}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);void addFiles(e.dataTransfer.files);}}>
      <span className={styles.dropzoneIcon} aria-hidden="true">↑</span>
      <span><strong>Upload project files</strong><small>Plans, blueprints, photos, notes, estimates or proposals. PDF, images, Word, spreadsheets and text.</small></span>
      <input id={`${id}-files`} type="file" accept={accept} multiple aria-label="Upload project files" onChange={e=>{const input=e.currentTarget;const selected=Array.from(input.files||[]);void addFiles(selected).then(()=>{input.value='';});}}/>
    </label>
    <p className={styles.hint}><details><summary>File types and limits</summary>{SCOPE_UPLOAD_HELP}</details></p>
    {Boolean(files.length||uploadedCount)&&<ul className={styles.files} aria-label="Project files">{draft.uploads?.map(f=><li key={f.id}><span>{f.name}<small>Uploaded and saved</small></span></li>)}{files.map((f,i)=><li key={`${f.name}-${i}`}><span>{f.name}<small>Ready to upload</small></span><button type="button" className={styles.iconButton} aria-label={`Remove ${f.name}`} onClick={async()=>{const next=filesRef.current.filter((_,index)=>i!==index);filesRef.current=next;setFiles(next);try{await cacheFiles(draft.id,next);}catch{setStatus('File removed from this session. Local storage could not be updated.');}}}>Remove</button></li>)}</ul>}
    {!attachedProjectSource&&<div className={styles.tools}><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start a different project</button>
      {recoveries.length>0&&<details className={styles.accordion} style={{flex:'1 1 100%',margin:0}}><summary><span className={styles.accordionTitle}>Saved project recovery</span><span className={styles.accordionMeta}>{recoveries.length}</span></summary><div className={styles.accordionBody}><ul className={styles.bullets} style={{listStyle:'none',paddingLeft:0}}>{recoveries.map(recovery=><li key={recovery.key}><button type="button" className={styles.secondary} onClick={()=>void switchProject(recovery)}>Restore {recovery.draft.text.slice(0,65)||'untitled project'}</button><details><summary className={styles.hint}>View saved details</summary><p style={{whiteSpace:'pre-wrap'}}>{displayScopeText(recovery.draft.text,recovery.draft.answers.estimatingInstructions)}</p><dl className={styles.rows}>{Object.entries(recovery.draft.answers).filter(([key])=>key!=='estimatingInstructions').map(([key,value])=><div key={key}><dt>{SCOPE_FIELDS[key as ScopeField]?.label||key}</dt><dd>{value}</dd></div>)}</dl>{recovery.draft.uploads?.map(file=><p key={file.id} className={styles.hint}>{file.name}</p>)}</details></li>)}</ul></div></details>}
    </div>}
  </>;
  const knownDetails=known.length>0&&<>
    <p className={styles.sectionLabel}>Your project details</p>
    {knownGroups.map(group=><details key={group.title} className={styles.accordion} open={group.title==='Project at a glance'||group.fields.includes(editField as ScopeField)}>
      <summary><span className={styles.accordionTitle}>{group.title}</span><span className={styles.accordionMeta}>{group.fields.length} {group.fields.length===1?'detail':'details'}</span></summary>
      <div className={styles.accordionBody}><dl className={styles.rows}>{group.fields.map(k=><div key={k}><dt>{SCOPE_FIELDS[k].label}</dt><dd>{editField===k?<div>{field(k)}<button type="button" className={styles.secondary} onClick={()=>{const issue=validateScopeAnswer(k,draft.answers[k]||'');if(issue){setError(issue);return;}setEditField('');setError('');}}>Done</button></div>:readable(k,draft.answers[k]!)}</dd>{editField!==k&&<button type="button" className={styles.iconButton} aria-label={`Edit ${SCOPE_FIELDS[k].label}`} onClick={()=>setEditField(k)}>Edit</button>}</div>)}</dl></div>
    </details>)}
  </>;
  const pausedCard=paused&&<section className={styles.notice} role="status" aria-live="polite">
    <h3>{paused.kind==='analysis'?'Still reading your project':'Still preparing your estimate'}</h3>
    <p>{paused.processing?.totalPages?`${Math.min(paused.processing.totalPages,paused.processing.readPages||0)} of ${paused.processing.totalPages} pages are checked so far. `:''}This is taking longer than the usual minute. Your completed work is saved and processing continues in the background; this page checks every few seconds and will show the result as soon as it is ready.</p>
    <div className={styles.actions}><button type="button" className={styles.primary} onClick={continuePaused}>Keep going</button><button type="button" className={styles.ghost} onClick={()=>setPaused(null)}>Come back later</button></div>
  </section>;
  const alertCard=error&&<div id={submitErrorId} className={styles.alert} role="alert" aria-live="assertive">
    {missingFields.length>0?<><h3>A few more details are needed</h3><p>{error}</p><ul className={styles.missingList}>{missingFields.map(m=><li key={m.field}><button type="button" className={styles.secondary} onClick={()=>jumpToField(m.field)}><span>{m.label}</span><span aria-hidden="true">→</span></button></li>)}</ul></>:<p>{error}</p>}
  </div>;
  return <div ref={estimatorRef} role="region" aria-label="Project estimator" className={styles.root} data-p5-estimator data-theme={theme.mode} data-step={stepIndex} aria-busy={Boolean(busy)} style={estimatorThemeStyle(theme) as React.CSSProperties}>
    <div className={styles.top}><p className={styles.eyebrow}>{brand.name} · Project estimator</p>{!result&&<span className={styles.stepCount}>Step {draft.step+1} of 3</span>}</div>
    {!result&&<ol className={styles.steps} aria-label="Estimator progress">{STEP_LABELS.map((label,index)=><li key={label} data-state={index===draft.step?'current':index<draft.step?'done':'upcoming'} aria-current={draft.step===index?'step':undefined}><span aria-hidden="true">{index<draft.step?'✓':index+1}</span>{label}</li>)}</ol>}
    {!busy&&!preparingFiles&&<>
      <Heading ref={heading} tabIndex={-1} className={styles.title}>{result?'Your project summary':draft.step===0?(attachedProjectSource?'Your design is ready to estimate':'Start your estimate'):draft.step===1?'One quick detail':'Review your project'}</Heading>
      <p className={styles.lead}>{result?'Review your estimate and the next step below.':draft.step===0?(attachedProjectSource?'Your design selections are included. Add anything else, then continue.':'Describe your project or add files. We only ask about what is missing.'):draft.step===1?'We saved what you provided. This detail affects the price.':'Check the summary, add where to send your estimate, and get your price.'}</p>
    </>}
    {result?<div className={styles.result}>
      <div className={styles.rangeCard}><p className={styles.eyebrow}>{result.range?'Preliminary planning range':'Status'}</p><h2>{result.range?`${result.range.low.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})} to ${result.range.high.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`:"Your scope is ready for pricing review"}</h2><p>{result.message}</p></div>
      <div className={styles.resultActions}><a className={styles.primary} href={brand.consultationPath} onClick={()=>trackScopeEvent("onsiteRequested",draft.answers.service)}>Schedule a consultation</a><button type="button" className={styles.secondary} onClick={downloadPdf} disabled={Boolean(busy)}>Download your project summary</button><a className={styles.secondary} href="tel:+12084771169">Call {brand.phone}</a></div>
      <p className={styles.delivery} role="status">{delivery.length>0&&delivery.every(d=>d.status==="sent")?"Your summary was sent and the team has your record.":delivery.some(d=>d.status==="needs-review")?"Your estimate is saved. The team will check its delivery; you do not need to submit it again.":"Your estimate is saved. We are sending a copy to your email."}</p>
      <P5EstimateDetails result={result}/>
      <div className={styles.panel} style={{marginTop:16}}><h3>Recommended next step</h3><p style={{marginTop:6}}>{result.nextStep}</p></div>
      <p className={styles.disclaimer}>{result.disclaimer}</p>
      <div className={styles.actions}><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start another project</button></div>
    </div>:<form id={`${id}-form`} onSubmit={submit} noValidate><fieldset disabled={Boolean(busy)||preparingFiles} className={styles.formBody}>
      {draft.step===0&&<>
        {attachedProjectSource&&knownDetails}
        {projectInput}
        {pausedCard}{alertCard}
        <div className={styles.actions}><button className={styles.primary} type="button" onClick={begin}>Continue <span aria-hidden="true">→</span></button><span className={styles.hint}>Add what you know. We help with the rest.</span></div>
      </>}
      {draft.step===1&&<>
        {active?<section key={active.instructionId||active.field} className={styles.question} aria-label="Project question">
          <p className={styles.eyebrow}>{active.label}</p><h2>{active.reason}</h2>
          {active.detail&&<details className={styles.context}><summary className={styles.hint}>Why we ask</summary><p className={styles.hint}>{active.detail}</p></details>}
          {active.values?.length?<div className={styles.choices} role="group" aria-label="Suggested answers">{active.values.map(value=><button type="button" className={styles.choice} key={value} onClick={()=>active.instructionId?reply(value):answer(active.field,value)} aria-pressed={(active.instructionId?clarificationReply:draft.answers[active.field])===value}>{active.instructionId?value:readable(active.field,value)}</button>)}</div>:null}
          {active.instructionId?<div className={styles.field}><label htmlFor={`${id}-reply`}>Your answer</label><textarea id={`${id}-reply`} rows={3} value={clarificationReply} onChange={e=>reply(e.target.value)} placeholder="Choose an option above or type your answer."/></div>:active.values?.length?<details className={styles.context}><summary className={styles.hint}>Use a different answer</summary>{field(active.field)}</details>:field(active.field)}
          {alertCard}
          <div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>advance()}>Continue <span aria-hidden="true">→</span></button>{active.field!=='service'&&!active.conflict&&!active.instructionId&&<button type="button" className={styles.secondary} onClick={()=>advance(true)}>Not sure yet</button>}</div>
        </section>:<div className={styles.panel}><p>Your details are complete.</p><div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>showQuestions(current.current!)}>Review your project <span aria-hidden="true">→</span></button></div></div>}
        <div className={styles.actions}><button className={styles.ghost} type="button" onClick={()=>{change({step:0});setError('');focus();}}>Back to my project</button></div>
      </>}
      {draft.step===2&&<>
        <div className={styles.reviewHeader}>
          <div className={styles.summaryCard}><h3>Project summary</h3><dl className={styles.summaryRows}>
            <div><dt>Project</dt><dd>{draft.answers.service?readable('service',draft.answers.service):'Not set'}</dd></div>
            {draft.answers.location&&<div><dt>Location</dt><dd>{draft.answers.location}</dd></div>}
            {draft.answers.sqft&&<div><dt>Area</dt><dd>{Number(draft.answers.sqft.replaceAll(',','')).toLocaleString('en-US')} sq ft</dd></div>}
            {draft.answers.finish&&<div><dt>Finish</dt><dd>{readable('finish',draft.answers.finish)}</dd></div>}
            <div><dt>Details saved</dt><dd>{known.length}</dd></div>
            <div><dt>Files</dt><dd>{uploadedCount?`${uploadedCount} uploaded`:'None'}</dd></div>
          </dl>{draft.extraction?.summary&&<p className={styles.hint}>{draft.extraction.summary.slice(0,280)}{draft.extraction.summary.length>280?'…':''}</p>}</div>
          <div className={styles.reviewAction}><button className={styles.primary} type="submit" aria-describedby={error?submitErrorId:undefined}>Get my estimate</button><p>{contactReady&&confirmed?'Your estimate opens right here.':'Add your name and email, then confirm your details.'}</p></div>
        </div>
        <div className={styles.panel}>
          <p className={styles.hint} style={{marginBottom:12}}>Your name and email are required to view your estimate. Phone is optional.</p>
          <div className={styles.contactGrid}>{([['name','Your name','text'],['email','Email','email'],['phone','Phone (optional)','tel']] as const).map(([key,label,type])=><label className={styles.field} key={key} htmlFor={`${id}-contact-${key}`}><span>{label}</span><input id={`${id}-contact-${key}`} ref={key==='name'?contactNameRef:key==='email'?contactEmailRef:undefined} type={type} autoComplete={key} required={key!=='phone'} aria-invalid={validationTarget==='contact'&&key!=='phone'&&(key==='name'?draft.contact.name.trim().length<2:!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact.email))?true:undefined} aria-describedby={validationTarget==='contact'&&key!=='phone'?submitErrorId:undefined} value={draft.contact[key]} onChange={e=>changeContact(key,e.target.value)} maxLength={key==='name'?120:key==='email'?200:40}/></label>)}</div>
          <label className={styles.check} data-invalid={validationTarget==='confirmation'&&!confirmed?true:undefined}><input ref={confirmationRef} type="checkbox" required checked={confirmed} aria-invalid={validationTarget==='confirmation'&&!confirmed?true:undefined} aria-describedby={validationTarget==='confirmation'?submitErrorId:undefined} onChange={e=>{setConfirmed(e.target.checked);if(e.target.checked){setValidationTarget('');setError('');}}}/><span>These details reflect my project. I understand this is a preliminary estimate, subject to confirmed scope, selections and site conditions.</span></label>
        </div>
        {pausedCard}{alertCard}
        {warning&&<div className={styles.notice}><p>{warning}</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={()=>run('Reading your saved documents...',analyze,'analysis')}>Retry document reading</button></div></div>}
        {knownDetails}
        {(draft.extraction?.instructions||draft.extraction?.documentCoverage)&&<><p className={styles.sectionLabel}>Requested scope and documents</p><P5EstimateDetails result={{instructions:draft.extraction.instructions,documentCoverage:draft.extraction.documentCoverage}} openFirst={false}/></>}
        {scopeAssumptions(draft.answers,draft.wizard?.skipped).length>0&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Assumptions and details to confirm</span><span className={styles.badge} data-kind="assumption">To confirm</span></summary><div className={styles.accordionBody}><ul className={styles.bullets}>{scopeAssumptions(draft.answers,draft.wizard?.skipped).map(note=><li key={note}>{note}</li>)}</ul></div></details>}
        <details className={styles.accordion} open={inputOpen} onToggle={e=>setInputOpen(e.currentTarget.open)}><summary><span className={styles.accordionTitle}>Add or edit project information</span></summary>{inputOpen&&<div className={styles.accordionBody}>{projectInput}<div className={styles.actions}><button className={styles.secondary} type="button" onClick={begin}>Update project</button></div></div>}</details>
        <div className={styles.actions}><button className={styles.ghost} type="button" onClick={()=>{change({step:0});setError('');focus();}}>Back to my project</button></div>
      </>}
    </fieldset></form>}
    {(busy||preparingFiles)&&<P5ProcessingStatus message={preparingFiles?'Preparing your files...':busy} processing={preparingFiles?null:processing} uploadPercent={uploadPercent} onPause={busy?()=>operationBudget.current?.controller.abort(new ProcessingDeadlineError()):undefined}/>}
    {status&&!busy&&!preparingFiles&&!error&&<p className={styles.status} role="status">{status}</p>}
  </div>;
}
