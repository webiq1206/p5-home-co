"use client";
import {CLIENT_BUDGET_MS,CLIENT_BACKGROUND_BUDGET_MS,ProcessingDeadlineError,remainingBudget,withinDeadline,fetchWithinDeadline,isProcessingDeadline} from '@/lib/p5/processingBudget';
import {completeSubmission} from '@/lib/p5/submitProgress';
import P5EstimateDetails from './P5EstimateDetails';
import P5ProcessingStatus,{type WaitChoice} from './P5ProcessingStatus';
import {analysisMessage,projectMaterials,type ProcessingStatus} from '@/lib/p5/processingStatus';
import {customerChoiceLabel,selectCustomerAnswer,contextualCustomerAnswer,exactCustomerChoice,customerQuestionKey} from '@/lib/p5/customerAnswers';
import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ESTIMATOR_BRAND as brand} from '@/lib/p5/brand';
import {estimatorTheme,estimatorThemeStyle} from '@/lib/p5/theme';
import {SCOPE_FIELDS,SCOPE_FILE_LIMIT,SCOPE_MAX_PAGES,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP,type ScopeField,type ScopeAnswers,type ScopeUpload} from '@/lib/p5/scope';
import {questionContext,scopeFieldApplies} from '@/lib/p5/dynamicQuestions';
import {deriveScopeAnswers,finishOptionsForService,questionForField,scopeQuestionsForBrand as scopeQuestions,scopeAssumptions,validateScopeAnswer,type ScopeQuestion} from '@/lib/p5/adaptive';
import {loadBrowserDraft,newBrowserDraft,persistBrowserDraft,draftHeaders,cacheFiles,loadCachedFiles,clearCachedFiles,requireDraftReceipt,archiveBrowserDraft,listBrowserDraftRecoveries,replaceBrowserDraft,restoreBrowserDraft,missingPendingFiles,DEVICE_CACHE_LIMIT,type BrowserDraft,type BrowserDraftRecovery,type TranscriptEntry,readJson,withTimeout} from '@/lib/p5/browserDraft';
import {mergeProjectSource,type ProjectSource} from '@/lib/p5/projectSource';
import {resumeWizardDraft} from '@/lib/p5/wizardResume';
import {snapshotProjectFile} from '@/lib/p5/fileSnapshot';
import {transferLargeFiles} from '@/lib/p5/resumableTransfer';
import {fileDigest} from '@/lib/p5/fileDigest';
import {transferProjectFiles} from '@/lib/p5/uploadTransfer';
import {unaskedQuestions} from '@/lib/p5/questionBudget';
import {customerPresentation,fieldCategory,HIDE_CUSTOMER_UNIT_RATES,priceText,priceLabel} from '@/lib/p5/presentation';
import styles from './P5Estimator.module.css';
import type {EstimateDocument} from '@/lib/p5/estimateDocument';
import {reportProgress,trackScopeEvent} from '@/lib/p5/progress';
import {trackGoogleAdsLeadConversion} from '@/lib/googleAdsConversion';
import {displayScopeText,refreshAnalyzedScope,scopeFingerprint,scopeTextChanged,sourceSnapshot,sourceSnapshotsEqual} from '@/lib/p5/scopeReplacement';
import {ESTIMATOR_VERSION,estimatorRelease} from '@/lib/p5/version';
import {parseNumericAnswer} from '@/lib/p5/answerParsing';

const textAnswers=(a:ScopeAnswers)=>JSON.stringify(Object.entries(a).filter(([k,v])=>SCOPE_FIELDS[k as ScopeField].kind==='text'&&v?.trim()).sort(([a],[b])=>a.localeCompare(b)));
const labels:Record<string,string>={handyman:'Home repairs',re10:'Inspection and RE-10 repairs','cabinet-product':'Cabinets, supply only','cabinet-install':'Cabinet installation',kitchen:'Kitchen remodel',bathroom:'Bathroom remodel','whole-home':'Whole-home remodel',addition:'Home addition',adu:'ADU','new-construction':'New home','change-order':'Change order',rush:'Rush work',refresh:'Builder grade','mid-range':'Mid-range','high-end':'High-end',luxury:'Luxury',standard:'Standard',priority:'Priority',emergency:'Emergency',complex:'Complex',yes:'Yes',no:'No'};
const readable=(field:ScopeField,value:string)=>field==='cabinetRoom'?value.replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase()):labels[value]||value.replaceAll('-',' ');
const brandId=brand.id as string;
const PDF_STATE_LABEL={available:'Available',preparing:'Preparing',downloaded:'Downloaded',failed:'Retry'} as const;
const SUGGESTIONS:Record<string,string[]>={
  construction:['I need pricing for a new build','I have plans I want you to review','Help me estimate an addition or ADU','I want to describe my project'],
  remodeling:['Help me price a remodel','I have plans I want you to review','Estimate this scope of work','I want to describe my project'],
  handyman:['Estimate my repair list','Review my inspection report and estimate the repairs','Upload a file and build an estimate','I want to describe my project'],
  cabinet:['Help me price new cabinets','I have drawings I want you to review','Estimate this scope of work','I want to describe my project'],
  p5:['Estimate my construction project','I have plans I want you to review','Help me price a remodel','I want to describe my project'],
  re10:['Estimate the repairs from my RE-10 report','Review my inspection report and estimate the repairs','Upload a file and build an estimate','I want to describe the repairs'],
};
// The four tiers of the owner's master price book, in its own definitions. The value 'refresh'
// is what the selector has always stored for the lowest tier; the book calls it Builder Grade.
const FINISH_LEVELS:[string,string][]=[['refresh','Production-builder spec: stock cabinets, LVP or carpet, laminate or entry-level quartz, standard fixtures, vinyl windows, hollow-core doors.'],['mid-range','Semi-custom cabinets, quartz or granite, engineered hardwood, tiled showers, name-brand fixtures, solid-core doors. The most common choice.'],['high-end','Custom cabinets, quartzite or premium quartz, wide-plank white oak, frameless glass, designer fixtures, custom trim.'],['luxury','Inset or European cabinetry, full-height slabs, custom millwork, pro or integrated appliances, luxury plumbing brands.']];
const composerPlaceholder='Describe your project in your own words, or attach plans, photos and documents.';
const AttachGlyph=()=><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
const MicGlyph=()=><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>;
const FileGlyph=()=><svg aria-hidden="true" className={styles.chipIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>;
const BackGlyph=()=><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
const CloseGlyph=()=><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>;
const accept='.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.tif,.tiff,.avif,.txt,.csv,.json,.xlsx,.xls,.ods,.docx,.doc';
const STEP_LABELS=['Project','Details','Estimate'];
type Recognition={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:any)=>void)|null;onerror:((event:any)=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
type Paused={kind:'analysis'|'pricing';processing:ProcessingStatus|null};
type MissingField={field:ScopeField;label:string};
const theme=estimatorTheme();
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const newEntry=(role:TranscriptEntry['role'],text:string,extra:Partial<TranscriptEntry>={}):TranscriptEntry=>({id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,role,text,at:Date.now(),...extra});
function Message({role,children,last}:{role:'user'|'assistant';children:React.ReactNode;last?:boolean}){return <div className={styles.msg} data-role={role} data-last-user={last?'':undefined}><div className={styles.bubble}>{children}</div></div>;}

export interface P5EstimatorProps {defaultService?:string;headingAs?:'h1'|'h2';projectSource?:ProjectSource;layout?:'page'|'embedded';onExit?:()=>void;}

export function P5Estimator({defaultService='',headingAs='h1',projectSource,layout='embedded',onExit}:P5EstimatorProps){
  const [draft,setDraft]=useState<BrowserDraft|null>(null);const current=useRef<BrowserDraft|null>(null);
  const [files,setFiles]=useState<File[]>([]);const filesRef=useRef<File[]>([]);const fileInput=useRef<HTMLInputElement|null>(null);const composerRef=useRef<HTMLTextAreaElement|null>(null);
  // What the PDF card claims is what actually happened: nothing is called "Ready" before it exists.
  const [pdfState,setPdfState]=useState<'available'|'preparing'|'downloaded'|'failed'>('available');
  // Saved versions of this estimate and the plain-language change request for the next one.
  const [versions,setVersions]=useState<{revision:number;submittedAt:string|null;total:string;reference:string}[]>([]);
  const [reviseText,setReviseText]=useState('');
  const [busy,setBusy]=useState('');const busyRef=useRef(false);
  // Which operation is running, declared by its caller rather than guessed from the progress message.
  const [runKind,setRunKind]=useState<Paused['kind']|null>(null);const [error,setError]=useState('');const [warning,setWarning]=useState('');const [status,setStatus]=useState('');
  const [uploadPercent,setUploadPercent]=useState<number|null>(null);const [preparingFiles,setPreparingFiles]=useState(true);const [dragging,setDragging]=useState(false);
  const [processing,setProcessing]=useState<ProcessingStatus|null>(null);const lastProcessing=useRef<ProcessingStatus|null>(null);
  const [paused,setPaused]=useState<Paused|null>(null);const resuming=useRef(false);
  const [missingFields,setMissingFields]=useState<MissingField[]>([]);const [verificationItems,setVerificationItems]=useState<string[]>([]);
  const started=useRef(false);
  const [reply,setReply]=useState('');
  const [editText,setEditText]=useState('');const [addingDetails,setAddingDetails]=useState(false);
  const [recoveries,setRecoveries]=useState<BrowserDraftRecovery[]>([]);
  // Defense in depth: whatever a current or historical response carries, the page
  // only ever renders the allowlisted customer projection of it.
  const [rawResult,setResult]=useState<any>(null);const [estimateDoc,setEstimateDoc]=useState<EstimateDocument|null>(null);const result=useMemo(()=>rawResult?customerPresentation(rawResult,{hideUnitRates:HIDE_CUSTOMER_UNIT_RATES}):null,[rawResult]);const [delivery,setDelivery]=useState<any[]>([]);const deliveryChecks=useRef(0);const [confirmed,setConfirmed]=useState(false);
  const [active,setActive]=useState<ScopeQuestion|null>(null);const [editField,setEditField]=useState<ScopeField|''>('');
  const [listening,setListening]=useState(false);const [speechAvailable,setSpeechAvailable]=useState(false);const recognition=useRef<Recognition|null>(null);
  const [expanded,setExpanded]=useState(false);const [topInset,setTopInset]=useState(0);const [bottomInset,setBottomInset]=useState(0);
  const queue=useRef<Promise<unknown>>(Promise.resolve());const mounted=useRef(false);const rootRef=useRef<HTMLDivElement>(null);const threadRef=useRef<HTMLDivElement>(null);const stageRef=useRef<HTMLElement|null>(null);const confirmationRef=useRef<HTMLInputElement>(null);const contactNameRef=useRef<HTMLInputElement>(null);const contactEmailRef=useRef<HTMLInputElement>(null);const id=useId();const Heading=headingAs;
  const pendingUserMessage=useRef<{text:string;files:string[];caption?:string}|null>(null);
  const [validationTarget,setValidationTarget]=useState<'confirmation'|'contact'|''>('');
  const frameActive=layout==='page'||expanded;
  const apply=(next:BrowserDraft)=>{current.current=next;setDraft(next);if(!persistBrowserDraft(next))setStatus('Keep this page open. This browser cannot save your work on this device.');};
  const change=(update:Partial<BrowserDraft>)=>{if(!current.current)return;apply({...current.current,...update,dirty:true,updatedAt:Date.now()});setConfirmed(false);};
  const changeContact=(key:keyof BrowserDraft['contact'],value:string)=>{const latest=current.current;if(latest)change({contact:{...latest.contact,[key]:value}});};
  const log=(...entries:TranscriptEntry[])=>{const d=current.current;if(!d||!entries.length)return;apply({...d,transcript:[...(d.transcript||[]),...entries]});};
  // Never the same question twice, and only a few beyond what the price needs (lib/p5/questionBudget.ts).
  const questions=(d:BrowserDraft)=>unaskedQuestions(scopeQuestions(d.answers,d.extraction,d.conflicts||[],d.wizard?.skipped||[],d.pricedFields||[],d.text),d.transcript,d.pricedFields||[]);
  const resume=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);setReply(d.pendingReply?.id===customerQuestionKey(next)?d.pendingReply?.answer||'':'');apply(resumeWizardDraft(d,Boolean(next)));};
  const engage=()=>{if(layout==='embedded'&&!expanded)setExpanded(true);};
  const scrollThread=(el:HTMLElement|null,block:'start'|'center'='start')=>{
    const thread=threadRef.current;if(!el||!frameActive)return;
    const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior:ScrollBehavior=reduced?'auto':'smooth';
    if(!thread||getComputedStyle(thread).overflowY==='visible'){if(frameActive)el.scrollIntoView({block:block==='start'?'start':'center',behavior});return;}
    const offset=el.getBoundingClientRect().top-thread.getBoundingClientRect().top+thread.scrollTop;
    const top=block==='start'?offset-8:offset-thread.clientHeight/2+el.offsetHeight/2;
    thread.scrollTo({top:Math.max(0,top),behavior});
  };
  const positionThread=(el:HTMLElement|null)=>{
    const thread=threadRef.current;if(!el||!frameActive)return;
    if(!thread||getComputedStyle(thread).overflowY==='visible'){if(frameActive)el.scrollIntoView({block:'start'});return;}
    thread.scrollTo({top:Math.max(0,el.getBoundingClientRect().top-thread.getBoundingClientRect().top+thread.scrollTop-8),behavior:'auto'});
  };
  const showQuestions=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);if(!next){trackScopeEvent('repairsConfirmed',d.answers.service);trackScopeEvent('contactViewed',d.answers.service);}apply({...d,step:next?1:2});setAddingDetails(false);setConfirmed(false);setMissingFields([]);setVerificationItems([]);};
  const answer=(key:ScopeField,value:string)=>{
    const d=current.current;if(!d)return;
    let answers={...d.answers,[key]:value};
    if((key==='length'||key==='width')&&d.answers.length&&d.answers.width&&d.answers.sqft===deriveScopeAnswers({...d.answers,sqft:''}).sqft)answers.sqft='';
    answers=deriveScopeAnswers(answers);
    change({answers,conflicts:(d.conflicts||[]).filter(c=>c.field!==key),wizard:{...d.wizard,skipped:(d.wizard?.skipped||[]).filter(k=>k!==key),resolutions:{...d.wizard?.resolutions,[key]:value}}});
  };
  useEffect(()=>{
    // An emailed estimate link (?estimate=<id>&t=<signed token>) is exchanged once for a key for this
    // device, saved like any draft, and the page reloads on a clean address; the saved estimate or its
    // live progress then loads through the normal restore below. A bad or expired link says so.
    {const params=new URLSearchParams(window.location.search);const linkId=params.get('estimate'),linkToken=params.get('t');
      if(linkId&&linkToken){
        const clean=new URL(window.location.href);clean.searchParams.delete('estimate');clean.searchParams.delete('t');
        void fetch('/api/p5-estimator/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:linkId,t:linkToken})}).then(r=>readJson(r).then(v=>({ok:r.ok,v}))).then(({ok,v})=>{
          if(!ok||!v?.key){window.history.replaceState(null,'',clean.toString());setError(v?.error||'This estimate link could not be opened. Contact us and we will send a new one.');return;}
          const base=loadBrowserDraft(defaultService,projectSource?.id);
          if(base.id!==v.id&&(base.revision>0||base.text.trim()))archiveBrowserDraft(base);
          persistBrowserDraft({...newBrowserDraft(String(v.service||defaultService)),namespace:base.namespace,id:v.id,key:v.key,revision:Number(v.revision)||1,text:String(v.text||''),answers:v.answers||{},contact:v.contact||{name:'',email:'',phone:''},step:2});
          window.location.replace(clean.toString());
        }).catch(()=>{window.history.replaceState(null,'',clean.toString());setError('This estimate link could not be opened right now. Check your connection and open it again.');});
        return;
      }}
    mounted.current=true;const loaded=loadBrowserDraft(defaultService,projectSource?.id);const d=projectSource&&!loaded.sourceDetached?mergeProjectSource(loaded,projectSource):loaded;resume(d);
    // A project carried over from a sister company arrives as a single-use code; claim it once and
    // start from it. The code is removed from the address bar so a refresh or a shared link never reuses it.
    const carriedCode=new URLSearchParams(window.location.search).get('continue');
    if(carriedCode){
      const url=new URL(window.location.href);url.searchParams.delete('continue');window.history.replaceState(null,'',url.toString());
      void fetch('/api/p5-estimator/handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'claim',code:carriedCode})}).then(r=>r.json()).then((carried:{text?:string;answers?:Record<string,string>;fromName?:string;requiredFiles?:Array<{name:string;size:number}>;error?:string})=>{
        if(!mounted.current)return;
        if(carried.error||!current.current){setWarning(carried.error||'');return;}
        const answers=Object.fromEntries(Object.entries(carried.answers||{}).filter(([key])=>Object.hasOwn(SCOPE_FIELDS,key)));
        if((current.current.text.trim()||current.current.revision>0||current.current.pendingFiles?.length||current.current.uploads?.length)&&!archiveBrowserDraft(current.current))throw new Error('Your existing project could not be backed up. Keep both project tabs open and retry.');
        const next={...newBrowserDraft(defaultService),namespace:current.current.namespace,text:carried.text||'',answers,pendingFiles:carried.requiredFiles||[]};
        if(!persistBrowserDraft(next))throw new Error('This browser could not save the transferred project. Return to the original site and retry.');
        filesRef.current=[];setFiles([]);apply(next);setPreparingFiles(false);setConfirmed(false);
        setStatus(`Your project details were carried over from ${carried.fromName||'our sister company'}.${next.pendingFiles.length?' Reattach the listed original files before continuing.':''}`);
      }).catch(()=>{setError('Your project transfer could not be opened. Return to the original site and retry; your original project remains saved.');});
    }setRecoveries(listBrowserDraftRecoveries(d.namespace));setWarning(d.analysisWarning||d.extraction?.reviewNotes.find(n=>n.startsWith("Your files are saved, but"))||"");
    setSpeechAvailable(Boolean((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition));
    // The composer stays locked until device recovery settles, so a reload can
    // never send a project while files chosen earlier are silently missing.
    setPreparingFiles(true);
    withTimeout(loadCachedFiles(d.id),15000,'File recovery did not respond. Reload or select your original files again before continuing.').then(f=>{if(mounted.current&&current.current?.id===d.id){filesRef.current=f;setFiles(f);requireRecoveredFiles();}}).catch(error=>{if(mounted.current&&current.current?.id===d.id)setError(error instanceof Error?error.message:'File recovery is unavailable. Select your original files again before continuing; your saved answers are retained.');}).finally(()=>{if(mounted.current&&current.current?.id===d.id)setPreparingFiles(false);});
    if(d.revision>0)fetch('/api/p5-estimator/draft',{headers:draftHeaders(d),cache:'no-store'}).then(r=>r.ok?r.text().then(b=>{try{return JSON.parse(b);}catch{return null;}}):null).then(async data=>{
      if(!mounted.current||!data?.draft||current.current?.id!==d.id)return;
      checkOperation();const saved=requireDraftReceipt(data);setVersions(Array.isArray(data.versions)?data.versions:[]);
      if(saved.status==='submitted'){
        if(!sourceSnapshotsEqual(sourceSnapshot(d),sourceSnapshot(current.current as BrowserDraft)))return;
        const response=await operationFetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision})});const value=await readJson(response);
        if(value.result&&mounted.current){setResult(value.result);setEstimateDoc(value.document||null);setDelivery(value.delivery||[]);}return;
      }
      if(!sourceSnapshotsEqual(sourceSnapshot(d),sourceSnapshot(current.current as BrowserDraft)))return;
      // An estimate still being prepared on the server (the page was closed, or opened from the emailed
      // link): show its live progress; the existing pricing poll picks the job up where it is.
      if(data.submission?.state==='processing'&&saved.revision===d.revision){resume({...d,...saved,key:d.key,step:2,updatedAt:d.updatedAt,transcript:d.transcript} as BrowserDraft);setPaused({kind:'pricing',processing:null});setStatus('Your estimate is still being prepared. It will appear here when it is ready.');return;}
      if(!d.dirty&&current.current.updatedAt===d.updatedAt&&saved.revision>=d.revision){const restored={...d,...saved,key:d.key,step:d.step,updatedAt:d.updatedAt,transcript:d.transcript} as BrowserDraft;resume(restored);}
      else apply({...current.current,revision:saved.revision,uploads:saved.uploads,extraction:current.current.extraction||saved.extraction||null});
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
  useEffect(()=>{
    if(!frameActive)return;
    const html=document.documentElement;const body=document.body;
    const previous={html:html.style.overflow,body:body.style.overflow,scrollY:window.scrollY};
    html.style.overflow='hidden';body.style.overflow='hidden';body.dataset.p5EstimatorActive='true';
    const measure=()=>{
      let top=0;
      for(const el of Array.from(document.querySelectorAll<HTMLElement>('header, nav, [data-site-header], .site-header'))){
        if(rootRef.current&&(el===rootRef.current||rootRef.current.contains(el)))continue;
        const style=getComputedStyle(el);if(style.position!=='fixed'&&style.position!=='sticky')continue;
        if(style.display==='none'||style.visibility==='hidden')continue;
        const rect=el.getBoundingClientRect();
        if(rect.top>1||rect.height<=0||rect.height>220||rect.width<window.innerWidth*.6)continue;
        top=Math.max(top,rect.bottom);
      }
      setTopInset(Math.round(top));
      const vv=window.visualViewport;
      if(vv){const gap=window.innerHeight-(vv.height+vv.offsetTop);setBottomInset(gap>40?Math.round(gap):0);}
    };
    window.scrollTo(0,0);measure();
    const later=window.setTimeout(measure,250);
    window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);window.visualViewport?.addEventListener('scroll',measure);
    return()=>{window.clearTimeout(later);window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('scroll',measure);html.style.overflow=previous.html;body.style.overflow=previous.body;delete body.dataset.p5EstimatorActive;if(layout==='embedded')rootRef.current?.scrollIntoView({block:'start'});};
  },[frameActive]);
  // When the on-screen keyboard changes the inset, keep the focused field in view.
  useEffect(()=>{
    if(!frameActive||bottomInset<=0)return;
    const focused=document.activeElement as HTMLElement|null;
    if(!focused||!rootRef.current?.contains(focused))return;
    const frame=requestAnimationFrame(()=>scrollThread(focused,'center'));
    return()=>cancelAnimationFrame(frame);
  },[bottomInset,frameActive]);
  const operationBudget=useRef<{deadline:number;controller:AbortController}|null>(null);
  const operationFetch:typeof fetch=(input,init)=>{const budget=operationBudget.current;return fetchWithinDeadline(fetch,input,{...init,...(budget?{signal:budget.controller.signal}:{})},budget?.deadline||Date.now()+CLIENT_BUDGET_MS);};
  const checkOperation=()=>{const budget=operationBudget.current;if(budget){if(budget.controller.signal.aborted)throw new ProcessingDeadlineError();remainingBudget(budget.deadline);}};
  const serialized=<T,>(operation:()=>Promise<T>):Promise<T>=>{const task=queue.current.catch(()=>undefined).then(operation);queue.current=task;return task;};
  async function adoptServerDraft(){
    const d=current.current;if(!d)return false;
    try{
      const response=await operationFetch('/api/p5-estimator/draft',{headers:draftHeaders(d),cache:'no-store'});
      if(!response.ok)return false;
      const data=await readJson(response);const server=data?.draft;
      const local=current.current;
      if(!server||!Number.isInteger(server.revision)||!local||local.id!==d.id||server.revision===local.revision)return false;
      apply({...local,revision:server.revision,uploads:server.uploads||local.uploads,extraction:local.extraction||server.extraction||null,answers:{...(server.answers||{}),...local.answers},wizard:local.wizard||server.wizard,pricedFields:local.pricedFields||data.pricedFields||[]});
      return true;
    }catch{return false;}
  }
  async function save(reviewed=false,clarification?:{id:string;answer:string}){
    const initiated=operationBudget.current;
    const d=current.current;if(!d)throw new Error('Your project is still loading.');
    const requestSource=sourceSnapshot(d);
    const put=(revision:number)=>operationFetch('/api/p5-estimator/draft',{method:'PUT',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({text:d.text,answers:d.answers,contact:d.contact,revision,wizard:d.wizard,reviewed,clarification,scopeFingerprint:scopeFingerprint(d.text)})});
    let response=await put(d.revision);
    let data=await readJson(response);
    if(response.status===409&&!clarification&&await adoptServerDraft()){const refreshed=current.current;if(refreshed&&refreshed.id===d.id){response=await put(refreshed.revision);data=await readJson(response);}}
    if(!response.ok)throw new Error(data.error||'Your project could not be saved. Please retry.');checkOperation();const saved=requireDraftReceipt(data);
    if(initiated&&initiated!==operationBudget.current)throw new ProcessingDeadlineError();
    if(current.current?.id!==d.id)return saved;
    if(!sourceSnapshotsEqual(requestSource,sourceSnapshot(current.current))){apply({...current.current,revision:saved.revision});return saved;}
    const unchanged=current.current.updatedAt===d.updatedAt;
    apply({...current.current,revision:saved.revision,extraction:saved.extraction,uploads:saved.uploads,pricedFields:data.pricedFields||[],...(unchanged?{answers:saved.answers,wizard:saved.wizard,conflicts:[...(data.conflicts||[]),...(current.current.conflicts||[]).filter(c=>!data.conflicts?.some((v:any)=>v.field===c.field))],dirty:false,reviewedRevision:reviewed?saved.revision:undefined}:{})});
    return saved;
  }
  useEffect(()=>{
    if(!draft?.contact.email||busy||result||!draft.dirty||paused)return;
    const timer=setTimeout(()=>{if(!busyRef.current)void serialized(()=>save()).then(()=>setStatus('Project saved.')).catch(()=>setStatus('Saved on this device. We will retry saving when connected.'));},1800);
    return()=>clearTimeout(timer);
  },[draft?.text,JSON.stringify(draft?.answers),JSON.stringify(draft?.contact),busy,Boolean(result),Boolean(draft?.dirty),Boolean(paused)]);
  const preflightField=useRef<ScopeField|null>(null);
  async function run(label:string,operation:()=>Promise<void>,kind:Paused['kind']|null=null){
    if(busyRef.current)return;busyRef.current=true;setBusy(label);setRunKind(kind);setProcessing(null);lastProcessing.current=null;setError('');setPaused(null);recognition.current?.stop();
    const budget={deadline:Date.now()+(kind?CLIENT_BACKGROUND_BUDGET_MS:CLIENT_BUDGET_MS),controller:new AbortController()};operationBudget.current=budget;
    try{await withinDeadline(()=>serialized(async()=>{checkOperation();await withinDeadline(operation,budget.deadline);checkOperation();}),budget.deadline);}
    catch(e){
      const userPaused=budget.controller.signal.aborted&&Date.now()<budget.deadline;
      if(userPaused)setStatus('Your progress is saved. Continue whenever you are ready.');
      else if(isProcessingDeadline(e)&&kind)setPaused({kind,processing:lastProcessing.current});
      else{
        const message=e instanceof Error?e.message:'';
        if(message==='p5-preflight'&&preflightField.current){const needed=preflightField.current;preflightField.current=null;jumpToField(needed);setStatus('One more detail is needed before I can prepare your estimate.');}
        else
        if(/review and confirm the extracted scope/i.test(message)){const d=current.current;if(d){apply({...d,step:2});setActive(null);}setError('Your project changed since it was confirmed. Check the summary below, confirm your details, then tap Get my estimate again.');}
        else setError(isProcessingDeadline(e)?'This is taking longer than expected. Your completed work is saved; continue to pick up where it stopped.':e instanceof TypeError?'The connection was interrupted. Your saved details are intact. Keep this tab open and retry.':message||'This step could not finish. Your work is still here.');
      }
    }
    finally{budget.controller.abort();if(operationBudget.current===budget)operationBudget.current=null;busyRef.current=false;setBusy('');setRunKind(null);setUploadPercent(null);setProcessing(null);}
  }
  useEffect(()=>{
    if(!paused||busy)return;
    let cancelled=false;const kind=paused.kind;let inFlight=false;
    const tick=async()=>{const d=current.current;if(!d||cancelled||inFlight||busyRef.current)return;inFlight=true;try{await check(d);}finally{inFlight=false;}};
    const check=async(d:NonNullable<typeof current.current>)=>{
      try{
        if(kind==='pricing'){
          if(d.dirty){setPaused(null);apply({...d,step:2});setActive(null);setError('Your project changed while it was being priced. Check the summary, confirm your details, then tap Get my estimate again.');return;}
          const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,background:true,retry:false})});
          const data=await readJson(response);if(cancelled||busyRef.current)return;
          if(response.status===202&&data.pending){if(data.processing)setPaused(p=>p&&p.kind===kind?{...p,processing:data.processing}:p);return;}
          setPaused(null);
          if(!response.ok){if(data.pricingReviewRequired){setMissingFields(parseMissing(data.missingFields));setVerificationItems(parseItems(data.verificationItems));}setError(data.error||'Your estimate could not be completed. Your saved work is intact; please retry.');return;}
          if(data.result){setResult(data.result);setEstimateDoc(data.document||null);setDelivery(data.delivery||[]);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);setStatus('');}
        }else{
          const form=new FormData();form.set('text',d.text);form.set('scopeFingerprint',scopeFingerprint(d.text));form.set('revision',String(d.revision));form.set('resumable','true');form.set('background','true');form.set('retry','false');
          const response=await fetch('/api/p5-estimator/scope',{method:'POST',headers:draftHeaders(d),body:form});
          const data=await readJson(response);if(cancelled||busyRef.current)return;
          if(data.pending){if(Number.isInteger(data.draftRevision)&&data.draftRevision!==d.revision)apply({...d,revision:data.draftRevision});if(data.processing)setPaused(p=>p&&p.kind===kind?{...p,processing:data.processing}:p);return;}
          if(response.status===409){await adoptServerDraft();return;}
          setPaused(null);
          if(!response.ok){setError(data.error||'Your files could not be processed. They are still here. Please retry.');return;}
          resuming.current=true;void begin();
        }
      }catch{}
    };
    const timer=setInterval(()=>{void tick();},4000);void tick();
    return()=>{cancelled=true;clearInterval(timer);};
  },[paused?.kind,busy]);
  const parseMissing=(value:unknown):MissingField[]=>Array.isArray(value)?value.filter((f:any)=>f&&typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field)).map((f:any)=>({field:f.field as ScopeField,label:String(f.label||SCOPE_FIELDS[f.field as ScopeField].label)})):[];
  const parseItems=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).slice(0,8):[];
  const track=(detail:ProcessingStatus|null|undefined)=>{if(detail){lastProcessing.current=detail;setProcessing(detail);}};
  async function ensureSourcePhoto(){
    const url=projectSource&&!current.current?.sourceDetached?projectSource.imageUrl:undefined;if(!url||current.current?.sourceImageUrl===url)return;
    const parsed=new URL(url,window.location.origin);
    if(parsed.origin!==window.location.origin&&!url.startsWith('data:image/')&&!url.startsWith('blob:'))throw new Error('The design photo cannot be imported from this address. Please add it using Add files.');
    const response=await operationFetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Your design photo could not be read. Please retry or add the photo using Add files.');
    const blob=await response.blob();const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif'};
    if(!ext[blob.type]||blob.size>SCOPE_FILE_LIMIT)throw new Error('Use Add files to provide a supported design photo up to 250 MiB.');
    const digest=(await fileDigest(blob,operationBudget.current?.controller.signal)).slice(0,16);
    const name=`design-photo-${digest}.${ext[blob.type]}`;
    if(!filesRef.current.some(f=>f.name===name)&&!current.current?.uploads?.some(f=>f.name===name)){
      await addFiles([new File([blob],name,{type:blob.type,lastModified:0})]);
      if(!filesRef.current.some(f=>f.name===name))throw new Error('The design photo was not added. Check the file limits and retry.');
    }
  }
  async function analyze(){
    const initiated=operationBudget.current;
    const checkAnalysis=()=>{if(initiated&&initiated!==operationBudget.current)throw new ProcessingDeadlineError();checkOperation();};
    requireRecoveredFiles();await ensureSourcePhoto();
    const message=pendingUserMessage.current;pendingUserMessage.current=null;
    if(message&&(message.text.trim()||message.files.length))log(newEntry('user',message.text,{files:message.files,kind:'scope',caption:message.caption}));
    setBusy('Saving your project...');await save();const d=current.current!;const pending=[...filesRef.current];
    const expectedSource=sourceSnapshot(d);
    const requireCurrentSource=()=>{if(!mounted.current||current.current?.id!==d.id||!sourceSnapshotsEqual(expectedSource,sourceSnapshot(current.current)))throw new Error('Your project changed while it was being read. Your files are retained. Refresh before continuing so newer details are not overwritten.');};
    if(pending.length){
      setBusy('Uploading your files...');setUploadPercent(0);
      const large=pending.some(f=>f.size>10*1024*1024)||pending.reduce((n,f)=>n+f.size,0)>22*1024*1024;
      let uploaded:unknown;
      if(large)uploaded=await transferLargeFiles(pending,draftHeaders(d),setUploadPercent,operationFetch,operationBudget.current?.controller.signal);
      else{const upload=new FormData();upload.set('analyze','false');for(const f of pending)upload.append('files',new Blob([await f.arrayBuffer()],{type:f.type}),f.name);uploaded=await transferProjectFiles(upload,draftHeaders(d),setUploadPercent,operationBudget.current?.controller.signal,operationBudget.current?.deadline);}
      checkOperation();const receipt=requireDraftReceipt(uploaded);
      if(!sourceSnapshotsEqual(sourceSnapshot(d),sourceSnapshot(receipt as BrowserDraft)))throw new Error('Your project changed while files were uploading. Your files are retained. Refresh before continuing so newer details are not overwritten.');
      requireCurrentSource();
      for(const f of pending){const digest=await fileDigest(f,operationBudget.current?.controller.signal);if(!receipt.uploads.some(stored=>stored.sha256===digest&&stored.size===f.size))throw new Error(`${f.name}: upload was not confirmed. Please retry.`);}
      apply({...current.current!,uploads:receipt.uploads,revision:receipt.revision,pendingFiles:[]});filesRef.current=[];setFiles([]);await clearCachedFiles(d.id).catch(()=>undefined);setUploadPercent(null);setStatus('Files uploaded and saved.');
    }
    setBusy(analysisMessage(Boolean(current.current!.uploads?.length)));const form=new FormData();form.set('text',d.text);form.set('scopeFingerprint',scopeFingerprint(d.text));form.set('revision',String(current.current!.revision));form.set('resumable','true');form.set('background','true');form.set('retry',resuming.current?'false':'true');resuming.current=false;
    let data:any;let conflicts=0;
    do{
      requireCurrentSource();
      const response=await operationFetch('/api/p5-estimator/scope',{method:'POST',headers:draftHeaders(d),body:form,signal:AbortSignal.timeout(200000)});data=await readJson(response);form.set('retry','false');
      if(response.status===409&&conflicts<3&&await adoptServerDraft()){conflicts++;form.set('revision',String(current.current!.revision));data={pending:true};continue;}
      if(!response.ok)throw new Error(data.error||analysisMessage(Boolean(current.current!.uploads?.length),'error'));
      requireCurrentSource();
      if(data.pending){if(Number.isInteger(data.draftRevision)){apply({...current.current!,revision:data.draftRevision});form.set('revision',String(data.draftRevision));}setBusy(data.progress||'Reading your project...');track(data.processing);await new Promise(r=>setTimeout(r,1000));}
    }while(data.pending);
    checkOperation();const saved=requireDraftReceipt(data);requireCurrentSource();checkAnalysis();
    const next={...current.current!,...saved,key:d.key,step:1,updatedAt:Date.now(),dirty:false,conflicts:data.conflicts||[],pricedFields:data.pricedFields||[],analysisWarning:data.warning||"",sourceImageUrl:current.current?.sourceDetached?undefined:projectSource?.imageUrl,analyzedText:d.text,analyzedAnswers:textAnswers(saved.answers),transcript:current.current!.transcript} as BrowserDraft;
    apply(next);setWarning(data.warning||'');if(pending.length)trackScopeEvent(d.uploads?.length?'additionalDocuments':'documentUploaded',saved.answers.service);trackScopeEvent(data.warning?'analysisFailed':'analysisCompleted',saved.answers.service);filesRef.current=[];setFiles([]);
    if(next.uploads?.length)try{await clearCachedFiles(d.id);}catch{setStatus('Files are uploaded. Local file cleanup will retry later.');}
    const remaining=questions(next);const captured=Object.keys(next.answers).filter(k=>k!=='estimatingInstructions'&&next.answers[k as ScopeField]?.trim()).length;const read=next.uploads?.length||0;
    const ack=[`Thanks. I read ${read?`${read} ${read===1?'file':'files'} and `:''}your description and saved ${captured} project ${captured===1?'detail':'details'}.`,data.warning?(read?'Some files still need review; see the note below.':'I could not finish reading your description; your text is saved. See the note below.'):remaining.length?`I have ${remaining.length===1?'one quick question':`${remaining.length} quick questions`} before your estimate.`:'That is everything I need. Review your project below, then add where to send your estimate.'].join(' ');
    log(newEntry('assistant',ack,{kind:'ack'}));setStatus('');showQuestions(current.current!);
  }
  const needsAnalysis=()=>{const d=current.current;return Boolean(d&&(d.analysisWarning||!d.sourceDetached&&projectSource?.imageUrl&&d.sourceImageUrl!==projectSource.imageUrl||filesRef.current.length||d.text.trim()&&d.text!==d.analyzedText||textAnswers(d.answers)!=='[]'&&textAnswers(d.answers)!==d.analyzedAnswers));};
  useEffect(()=>{
    if(!result||!delivery.length||!delivery.some(d=>d.status==='pending'||d.status==='retry'||d.status==='sending')||deliveryChecks.current>=10)return;
    const d=current.current;if(!d)return;let cancelled=false;
    const timer=setTimeout(async()=>{deliveryChecks.current+=1;try{const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision})});const value=await readJson(response);if(!cancelled&&mounted.current&&Array.isArray(value.delivery)&&value.delivery.length)setDelivery(value.delivery);}catch{}},6000);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[result,delivery]);
  useEffect(()=>{const el=composerRef.current;if(!el)return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,220)+'px';},[draft?.text,draft?.answers.estimatingInstructions,draft?.step,reply,editText,addingDetails]);
  /** Files chosen before a reload that this device could not give back. */
  function requireRecoveredFiles(){
    const missing=missingPendingFiles(current.current||{},filesRef.current);
    if(missing.length)throw new Error(`Select the original files again before continuing: ${missing.map(f=>f.name).join(', ')}. Your answers and server upload progress are retained; matching uploaded segments will resume.`);
  }
  const begin=()=>run('Reading your project...',async()=>{
    requireRecoveredFiles();
    if(!current.current?.text.trim()&&!filesRef.current.length&&!current.current?.uploads?.length&&!Object.values(current.current?.answers||{}).some(v=>v?.trim())){pendingUserMessage.current=null;setError('Describe your project or add a file to continue.');return;}
    if(needsAnalysis()||(current.current?.uploads?.length&&!current.current.extraction))await analyze();else{pendingUserMessage.current=null;await save();showQuestions(current.current!);}
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
    apply({...current.current,pendingFiles:[...(current.current.pendingFiles||[]).filter(expected=>!copied.some(file=>file.name===expected.name&&file.size===expected.size)),...copied.map(({name,size})=>({name,size}))]});
    // cacheFiles owns the device budget: selections above it stay in this tab and
    // pendingFiles names them, so a reload asks for the originals instead of losing them.
    try{await withTimeout(cacheFiles(current.current.id,copied),60000,'Device storage did not respond.');requireRecoveredFiles();setStatus('Files saved on this device. Send your message to upload and read them with your project details.');}catch(error){const message=error instanceof Error?error.message:'';if(missingPendingFiles(current.current,copied).length)setError(message);setStatus(copied.reduce((n,f)=>n+f.size,0)>DEVICE_CACHE_LIMIT?'Files are ready in this tab. Large files stay in this tab until upload; keep it open, or after a reload reselect the original files to resume saved server segments.':`Files remain in this tab. Device storage may be full or unavailable. Keep this tab open until upload completes; after a reload, reselect the original files to resume saved server segments. ${message}`);}finally{setPreparingFiles(false);}
  }
  function speak(){
    if(listening){recognition.current?.stop();return;}
    const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Constructor)return;
    const r:Recognition=new Constructor();recognition.current=r;r.continuous=true;r.interimResults=false;r.lang='en-US';
    r.onresult=(event:any)=>{let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+' ';if(text.trim()){const d=current.current;if(!d)return;if(composerMode==='project')changeProjectText(`${displayScopeText(d.text,d.answers.estimatingInstructions)} ${text}`.trim());else if(composerMode==='edit')setEditText(v=>`${v} ${text}`.trim());else setComposerValue(`${current.current?.pendingReply?.answer??reply} ${text}`.trim());}};
    r.onerror=()=>{setListening(false);setError("Microphone input is unavailable. You can type, upload, or use your keyboard's dictation button.");};r.onend=()=>setListening(false);
    try{setListening(true);setError('');r.start();}catch{setListening(false);setError('The microphone could not start. You can still type or add files.');}
  }
  const logExchange=(question:ScopeQuestion,answerText:string)=>log(newEntry('assistant',question.reason,{kind:'question',label:question.label}),newEntry('user',answerText,{kind:'answer'}));
  async function advance({skip=false,clarification}:{skip?:boolean;clarification?:string}={}){
    if(!current.current)return;
    if(active?.instructionId){const text=(clarification??reply).trim();if(!text){setError('Add an answer or select an option.');return;}const payload={id:active.instructionId,answer:text};await run('Saving your answer...',async()=>{await save(false,payload);const saved=current.current!;apply({...saved,analyzedAnswers:textAnswers(saved.answers),pendingReply:undefined});setReply('');showQuestions(current.current!);});return;}
    if(active?.conflict&&!current.current.wizard?.resolutions[active.field]){setError('Choose the detail to use, or enter a correction.');return;}
    if(active){const value=current.current.answers[active.field]||'';const issue=validateScopeAnswer(active.field,value);if(!skip&&(issue||!value.trim())){setError(issue||'Add this detail, or choose Not sure yet.');return;}if(skip){if(active.field==='service'||active.conflict)return;const d=current.current;change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:[...new Set([...(d.wizard?.skipped||[]),active.field])]}});}}
    await run('Saving your answer...',async()=>{await save();const saved=current.current!;apply({...saved,analyzedAnswers:textAnswers(saved.answers),pendingReply:undefined});setReply('');showQuestions(current.current!);});
  }
  const optionLabel=(value:string)=>active?.instructionId?customerChoiceLabel(value):readable(active!.field,value);
  const choose=(value:string)=>{if(!active||busyRef.current)return;engage();setError('');const text=selectCustomerAnswer(optionLabel(value),reply,(active.values||[]).map(optionLabel));setReply(text);change({pendingReply:{id:customerQuestionKey(active)!,answer:text}});composerRef.current?.focus();};
  const skipQuestion=()=>{if(!active||busyRef.current)return;engage();logExchange(active,'Not sure yet');void advance({skip:true});};
  const jumpToField=(field:ScopeField)=>{const d=current.current;if(!d)return;engage();change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:(d.wizard?.skipped||[]).filter(k=>k!==field)}});setActive(questionForField(field,d.answers));setMissingFields([]);setVerificationItems([]);setError('');setAddingDetails(false);apply({...current.current!,step:1});};
  /** A failed transfer leaves the complete source project available to retry. */
  async function carryProject(fallback:string){
    const d=current.current;if(!d)return;
    const requiredFiles=[...(d.uploads||[]),...(d.pendingFiles||[]),...filesRef.current].map(({name,size})=>({name,size}));
    try{
      const response=await fetch('/api/p5-estimator/handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'send',service:d.answers.service,text:d.text||'',answers:d.answers||{},requiredFiles:requiredFiles.filter((f,i,all)=>all.findIndex(v=>v.name===f.name&&v.size===f.size)===i)})});
      const sent=response.ok?await response.json() as {url?:string;carried?:boolean}:null;
      if(!sent?.carried||!sent.url||new URL(sent.url).origin!==new URL(fallback).origin)throw new Error('transfer-incomplete');
      window.location.assign(sent.url);
    }catch{setError('Your project could not be transferred completely. Your text and files remain here. Please retry.');}
  }
  /** Reopen this saved estimate as its next version with the customer's change request (estimateRevisions.ts). */
  async function reviseEstimate(){
    const d=current.current;if(!d)return;const change=reviseText.trim();
    if(!change){setError('Tell us what to change, for example "Remove painting" or "Use upgraded cabinets".');return;}
    await run('Opening your estimate for changes...',async()=>{
      const response=await operationFetch('/api/p5-estimator/revise',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({change})});
      const value=await readJson(response);if(!response.ok)throw new Error(value.error||'Your estimate could not be reopened. It is still saved; please retry.');
      setVersions(v=>[{revision:Number(value.previous),submittedAt:null,total:estimateDoc?.total?.amount||'',reference:estimateDoc?.reference||''},...v.filter(x=>x.revision!==Number(value.previous))]);
      setResult(null);setEstimateDoc(null);setDelivery([]);setReviseText('');setConfirmed(false);setMissingFields([]);setVerificationItems([]);
      apply({...d,revision:Number(value.revision),text:String(value.text||d.text),step:0,dirty:false,reviewedRevision:undefined});
      setStatus(`Version ${value.revision} is open with your change. Add anything else or attach revised files, then continue. Your earlier estimate is saved.`);
    });
  }
  async function downloadVersionPdf(revision:number){
    const d=current.current;if(!d)return;
    await run('Preparing your PDF...',async()=>{const response=await operationFetch(`/api/p5-estimator/pdf?version=${revision}`,{headers:draftHeaders(d)});if(!response.ok)throw new Error('That version could not be downloaded. Please retry.');
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`${brand.id}-estimate-version-${revision}.pdf`;link.hidden=true;document.body.appendChild(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}});
  }
  async function downloadPdf(){let saved=false;setPdfState('preparing');await run('Preparing your PDF...',async()=>{const response=await operationFetch('/api/p5-estimator/pdf',{headers:draftHeaders(current.current!)});if(!response.ok)throw new Error('The PDF could not be downloaded. Your submission is saved; please retry.');const blob=await response.blob();if(!blob.size||!blob.type.toLowerCase().includes('application/pdf'))throw new Error('The PDF is not ready. Your estimate is saved; please retry.');const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${brand.id}-estimate.pdf`;link.hidden=true;document.body.appendChild(link);try{link.click();saved=true;}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}});setPdfState(saved?'downloaded':'failed');}
  const focusCorrection=(element:HTMLElement|null)=>requestAnimationFrame(()=>{if(!element)return;element.focus({preventScroll:true});scrollThread(element,'center');});
  async function submit(event:React.FormEvent){
    event.preventDefault();if(busyRef.current)return;if(draft?.step!==2){await begin();return;}
    try{requireRecoveredFiles();}catch(error){setError(error instanceof Error?error.message:'Reselect your original files before continuing.');return;}
    if(current.current?.analysisWarning&&!filesRef.current.length&&(current.current.text||'')===(current.current.analyzedText||'')){setError('Some of your files could not be read, so they cannot be priced yet. Use Retry document reading, or remove the file to price the rest of your project.');return;}
    if(needsAnalysis()){await begin();return;}
    const d=current.current!;
    if(questions(d).length){showQuestions(d);return;}
    for(const [key,value]of Object.entries(d.answers)){const issue=validateScopeAnswer(key as ScopeField,value!);if(issue){setEditField(key as ScopeField);setError(`${SCOPE_FIELDS[key as ScopeField].label}: ${issue}`);requestAnimationFrame(()=>document.getElementById(`${id}-${key}`)?.focus());return;}}
    const invalidName=d.contact.name.trim().length<2;const invalidEmail=Boolean(d.contact.email.trim())&&!EMAIL.test(d.contact.email);
    if(invalidName||invalidEmail){setValidationTarget('contact');setError(invalidName&&invalidEmail?'Enter your name, and check the email address or leave it blank.':invalidName?'Enter your name to see your estimate.':'Check the email address, or leave it blank to see your estimate here.');focusCorrection(invalidName?contactNameRef.current:contactEmailRef.current);return;}
    if(!confirmed){setValidationTarget('confirmation');setError('Please confirm your project details before continuing.');focusCorrection(confirmationRef.current);return;}
    engage();
    await run('Preparing your estimate...',async()=>{
      trackScopeEvent('contactSubmitted',d.answers.service);const budget=operationBudget.current!;const saved=await save(true);
      const checkSubmission=()=>{if(operationBudget.current!==budget)throw new ProcessingDeadlineError();checkOperation();};
      let retry=!resuming.current;resuming.current=false;let data:any;
      try{data=await completeSubmission(()=>{checkSubmission();const shouldRetry=retry;retry=false;return operationFetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(current.current!),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision,background:true,retry:shouldRetry})});},(message,detail)=>{checkSubmission();setBusy(message);track(detail);},undefined,budget.deadline);}
      catch(failure){const details=(failure as any)?.details;
        // A quantity needed before pricing can start opens its own question straight away.
        if(details?.preflight){const needed=parseMissing(details.missingFields);if(needed.length){preflightField.current=needed[0].field;throw new Error('p5-preflight');}}
        if(details?.pricingReviewRequired){setMissingFields(parseMissing(details.missingFields));setVerificationItems(parseItems(details.verificationItems));throw new Error(details.error||'A few more details are needed before pricing.');}throw failure;}
      checkSubmission();setResult(data.result);setEstimateDoc(data.document||null);setDelivery(data.delivery||[]);trackGoogleAdsLeadConversion({service:d.answers.service},`estimator:${d.id}`);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);if(data.delivery?.some((v:any)=>v.channel==='customer'&&v.status==='sent'))trackScopeEvent('estimateEmailed',d.answers.service);setStatus('');
    },'pricing');
  }
  const continuePaused=()=>{const kind=paused?.kind;setPaused(null);resuming.current=true;if(kind==='pricing'){const form=document.getElementById(`${id}-form`) as HTMLFormElement|null;if(form)form.requestSubmit();else void begin();}else void begin();};
  const changeProjectText=(text:string)=>{const d=current.current;if(!d)return;if(!scopeTextChanged(displayScopeText(d.text,d.answers.estimatingInstructions),text)){change({text,answers:{...d.answers,estimatingInstructions:''}});return;}change({...refreshAnalyzedScope(d,text),text,pendingReply:undefined});setReply('');setActive(null);setWarning('');setRecoveries(listBrowserDraftRecoveries(d.namespace));};
  const switchProject=async(recovery?:BrowserDraftRecovery)=>{
    if(busyRef.current||preparingFiles||!current.current)return;const d=current.current;
    if(!window.confirm(recovery?'Restore this saved project? Your current project will be kept in recovery.':'Start a new project with no previous answers or files? Your current project and files will be kept in recovery.'))return;
    await run('Preserving your project...',async()=>{
      if(filesRef.current.length)await cacheFiles(d.id,filesRef.current);const archived=replaceBrowserDraft(d,'');let next=recovery?restoreBrowserDraft(recovery):archived.draft;if(!next)throw new Error('This saved project could not be restored. Your current project is unchanged.');
      // Legacy design recoveries predate namespaced storage. The recovery list
      // already identity-filters them; bind the restored copy to this route so
      // the next autosave cannot leak it back into the generic estimator key.
      next={...next,namespace:d.namespace};const pending=recovery?await loadCachedFiles(next.id):[];
      if(recovery&&next.revision>0){
        const response=await operationFetch('/api/p5-estimator/draft',{headers:draftHeaders(next),cache:'no-store'});if(!response.ok)throw new Error('The saved project could not be checked. Keep this page open and retry.');const saved=requireDraftReceipt(await readJson(response));if(saved.status==='submitted')throw new Error('This project was already submitted and cannot be edited. Its recovery is retained; start a new project instead.');
        if(scopeTextChanged(saved.text,next.text)){next={...refreshAnalyzedScope(next,next.text),revision:saved.revision,uploads:saved.uploads,dirty:true};}
        else{if(next.dirty){const serverSnapshot={...next,...saved,key:next.key,namespace:next.namespace,dirty:false} as BrowserDraft;if(!archiveBrowserDraft(serverSnapshot))throw new Error('The newer server version could not be backed up. Neither version has been changed.');if(JSON.stringify((next.uploads||[]).map(f=>f.sha256).sort())!==JSON.stringify(saved.uploads.map((f:ScopeUpload)=>f.sha256).sort()))throw new Error('The saved project has a different file set. Both versions are retained in recovery; review them before replacing the project.');next={...next,revision:saved.revision,uploads:saved.uploads,extraction:saved.extraction,step:0,dirty:true};}else next={...next,...saved,key:next.key,namespace:next.namespace,step:0,dirty:false,transcript:next.transcript} as BrowserDraft;}
      }
      filesRef.current=pending;setFiles(pending);setResult(null);setEstimateDoc(null);setDelivery([]);setError('');setWarning('');setConfirmed(false);setReply('');setAddingDetails(false);setMissingFields([]);setVerificationItems([]);started.current=false;resume(next);setRecoveries(listBrowserDraftRecoveries(next.namespace));setStatus(recovery?'Saved project restored. Review it before continuing.':'New project started. Previous answers and uploaded files are not included.');
    });
  };
  const stage=result?3:draft?.step??0;
  const composerMode:'project'|'answer'|'edit'=stage===0?'project':stage===1?'answer':'edit';
  const composerText=draft?displayScopeText(draft.text,draft.answers.estimatingInstructions):'';
  const composerValue=composerMode==='project'?composerText:composerMode==='answer'?reply:editText;
  const setComposerValue=(value:string)=>{if(composerMode==='project')changeProjectText(value);else if(composerMode==='answer'){setReply(value);if(active)change({pendingReply:{id:customerQuestionKey(active)!,answer:value}});}else setEditText(value);};
  const addToProject=(text:string)=>{const d=current.current!;const combined=`${displayScopeText(d.text,d.answers.estimatingInstructions)}\n\n${text}`.trim();changeProjectText(combined);setReply('');pendingUserMessage.current={text,files:filesRef.current.map(f=>f.name),caption:'Added to your project'};void begin();};
  const send=()=>{
    const d=current.current;if(!d||busyRef.current||preparingFiles)return;engage();setError('');
    if(composerMode==='answer'&&active){
      if(active.handoff)return;
      const text=reply.trim();if(!text){if(filesRef.current.length){addToProject('');return;}setError('Type an answer, choose an option, or tap Not sure yet.');return;}
      if(filesRef.current.length){addToProject(contextualCustomerAnswer(active.reason,text));return;}
      if(active.instructionId){const canonical=active.values?.find(value=>customerChoiceLabel(value)===text)||text;logExchange(active,text);void advance({clarification:canonical});return;}
      const definition=SCOPE_FIELDS[active.field];
      if(definition.kind==='choice'){const match=exactCustomerChoice(text,active.values||[],value=>readable(active.field,value));if(match){answer(active.field,match);logExchange(active,readable(active.field,match));void advance();return;}addToProject(contextualCustomerAnswer(active.reason,text));return;}
      if(definition.kind==='number'){const issue=validateScopeAnswer(active.field,text);if(!issue){answer(active.field,text);logExchange(active,text);void advance();return;}
        const parsed=parseNumericAnswer(active.field,text);
        if(parsed&&'value' in parsed&&!validateScopeAnswer(active.field,parsed.value)){answer(active.field,parsed.value);if(parsed.note){const kept=current.current?.answers.otherDetails||'';if(!kept.includes(parsed.note))answer('otherDetails',[kept,`${SCOPE_FIELDS[active.field].label}: ${parsed.note}`].filter(Boolean).join(String.fromCharCode(10)));}logExchange(active,text);setReply('');void advance();return;}
        if(parsed&&'choices' in parsed){setError(`I found ${parsed.choices.join(' and ')} in your answer. Which number should I use? You can also tap Not sure yet.`);return;}
        addToProject(contextualCustomerAnswer(active.reason,text));return;}
      if(active.conflict&&active.values?.length){answer(active.field,text);logExchange(active,text);void advance();return;}answer(active.field,text);logExchange(active,text);void advance();return;
    }
    if(composerMode==='edit'){const text=editText.trim();if(text&&scopeTextChanged(composerText,text)){changeProjectText(text);pendingUserMessage.current={text,files:filesRef.current.map(f=>f.name),caption:'Updated project'};}else pendingUserMessage.current=filesRef.current.length?{text:'',files:filesRef.current.map(f=>f.name),caption:'Added files'}:null;setAddingDetails(false);void begin();return;}
    const hasScope=(d.transcript||[]).some(e=>e.kind==='scope');pendingUserMessage.current={text:composerText,files:[...(d.uploads||[]).map(f=>f.name),...filesRef.current.map(f=>f.name)],caption:hasScope?'Updated project':undefined};void begin();
  };
  const composerKey=(event:React.KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing)return;if(typeof window.matchMedia==='function'&&!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;event.preventDefault();if(canSend)send();};
  const stageKey=draft?`${stage}:${active?.instructionId||active?.field||''}:${result?'result':''}:${expanded}`:'';
  const lastStage=useRef('');const working=Boolean(busy)||preparingFiles;
  useLayoutEffect(()=>{
    if(!frameActive||!draft||!stageKey||working||stageKey===lastStage.current)return;lastStage.current=stageKey;
    const position=(focus:boolean)=>{const target=stageRef.current;if(target){positionThread(target);if(focus)(target.querySelector('[data-stage-heading]') as HTMLElement|null)?.focus({preventScroll:true});}else threadRef.current?.scrollTo({top:0});};
    // Focus before paint only. A second focus on the next frame can steal a
    // newly focused input while WebKit is delivering its input event.
    position(true);const frame=requestAnimationFrame(()=>position(false));
    return()=>cancelAnimationFrame(frame);
  },[stageKey,working,Boolean(draft),frameActive]);
  const sentMessageRef=useRef(false);
  useEffect(()=>{if(!busy||!sentMessageRef.current)return;sentMessageRef.current=false;requestAnimationFrame(()=>{const last=threadRef.current?.querySelector<HTMLElement>('[data-last-user]');if(last)scrollThread(last,'start');});},[busy]);
  useEffect(()=>{if(error&&!missingFields.length){const el=threadRef.current?.querySelector<HTMLElement>('[role=alert]');if(el)requestAnimationFrame(()=>scrollThread(el,'center'));}},[error]);
  useEffect(()=>{if(addingDetails){setEditText(composerText);requestAnimationFrame(()=>composerRef.current?.focus());}},[addingDetails]);
  if(!draft)return <div ref={rootRef} className={styles.root} data-p5-estimator data-theme={theme.mode} data-layout={layout} style={estimatorThemeStyle(theme) as React.CSSProperties} role="status"><div className={styles.loading}>Loading your project...</div></div>;
  const attachedProjectSource=projectSource&&!draft.sourceDetached?projectSource:undefined;
  const known=Object.keys(draft.answers).filter(k=>k!=='estimatingInstructions'&&draft.answers[k as ScopeField]?.trim()) as ScopeField[];
  const knownGroups=[...new Set(known.map(fieldCategory))].map(title=>({title,fields:known.filter(k=>fieldCategory(k)===title)}));
  const uploadedCount=draft.uploads?.length||0;const missingFiles=preparingFiles?[]:missingPendingFiles(draft,files);
  const hasEmail=Boolean(draft.contact.email.trim());
  const contactReady=draft.contact.name.trim().length>=2&&(!hasEmail||EMAIL.test(draft.contact.email));
  const submitErrorId=`${id}-submit-error`;const formId=`${id}-form`;
  const transcript=draft.transcript||[];const hasProgress=transcript.length>0||draft.step>0||Boolean(result)||uploadedCount>0;
  const locked=Boolean(busy)||preparingFiles;
  const canSend=!locked&&(composerMode==='project'?Boolean(composerText.trim()||files.length||uploadedCount||attachedProjectSource):composerMode==='answer'?Boolean(reply.trim()||files.length):Boolean(editText.trim()||files.length));
  const customerDelivery=delivery.find(d=>d.channel==='customer');
  // The staff notice is tracked on its own, so "our team was told" is never implied by the customer email.
  const staffDelivery=delivery.filter(d=>d.channel==='admin'||d.channel.startsWith('admin'));
  const staffState=!staffDelivery.length?'pending':staffDelivery.every(d=>d.status==='sent')?'sent':staffDelivery.some(d=>d.status==='needs-review')?'review':'pending';
  const DELIVERY_LABEL={sent:'Sent',review:'Being checked by our team',pending:'Sending',notRequested:'Not requested'} as const;
  const deliveryState=customerDelivery?.status==='sent'?'sent':customerDelivery?.status==='needs-review'?'review':!hasEmail&&!customerDelivery?'notRequested':'pending';
  const assumptions=scopeAssumptions(draft.answers,draft.wizard?.skipped,draft.extraction,draft.text);const lastUserIndex=transcript.map(e=>e.role).lastIndexOf('user');
  const exit=()=>{if(layout==='embedded'){setExpanded(false);return;}if(onExit){onExit();return;}if(window.history.length>1)window.history.back();else window.location.assign('/');};
  const back=()=>{const d=current.current;if(!d||busyRef.current)return;setError('');setMissingFields([]);setVerificationItems([]);if(d.step===2){const remaining=questions(d);if(remaining.length){setActive(remaining[0]);apply({...d,step:1});}else apply({...d,step:0});}else if(d.step===1){setActive(null);apply({...d,step:0});}};
  const field=(key:ScopeField)=>{const definition=SCOPE_FIELDS[key];const value=draft?.answers[key]||'';const fieldId=`${id}-${key}`;const options=definition.kind==='choice'?(key==='finish'?finishOptionsForService(draft?.answers.service):definition.options.filter(v=>key!=='service'||(brand.services as readonly string[]).includes(v))):[];return <div key={key} className={styles.field}><label htmlFor={fieldId}>{definition.label}</label>{definition.kind==='choice'?<select id={fieldId} value={value} onChange={e=>answer(key,e.target.value)}><option value="">Choose an answer</option>{options.map(v=><option key={v} value={v}>{readable(key,v)}</option>)}</select>:definition.kind==='number'?<input id={fieldId} inputMode="decimal" value={value} onChange={e=>answer(key,e.target.value)} placeholder="Approximate is fine"/>:<textarea id={fieldId} rows={3} value={value} onChange={e=>answer(key,e.target.value)} />}</div>;};
  const composer=<div className={styles.composer} data-dragging={dragging} onDragEnter={e=>{e.preventDefault();setDragging(true);}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);void addFiles(e.dataTransfer.files);}}>
    <label htmlFor={`${id}-scope`} className={styles.srOnly}>{composerMode==='answer'?'Your answer':'Tell us about your project'}</label>
    {Boolean(files.length||missingFiles.length||(composerMode!=='answer'&&uploadedCount))&&<ul className={styles.chips} aria-label="Project files">{composerMode!=='answer'&&draft.uploads?.map(f=><li key={f.id} className={styles.chip}><FileGlyph/><span className={styles.chipText}><span>{f.name}</span><small>Saved</small></span></li>)}{files.map((f,i)=><li key={`${f.name}-${i}`} className={styles.chip}><FileGlyph/><span className={styles.chipText}><span>{f.name}</span><small>Ready</small></span><button type="button" disabled={locked} className={styles.chipRemove} aria-label={`Remove ${f.name}`} onClick={async()=>{const next=filesRef.current.filter((_,index)=>i!==index);filesRef.current=next;setFiles(next);if(current.current)apply({...current.current,pendingFiles:(current.current.pendingFiles||[]).filter(file=>file.name!==f.name||file.size!==f.size)});try{await cacheFiles(draft.id,next);}catch{setStatus('File removed from this session. Local storage could not be updated.');}}}><span aria-hidden="true">×</span></button></li>)}{missingFiles.map((f,i)=><li key={`missing-${f.name}-${i}`} className={styles.chip} data-missing><FileGlyph/><span className={styles.chipText}><span>{f.name}</span><small>Select again</small></span><button type="button" disabled={locked} className={styles.chipRemove} aria-label={`Remove ${f.name}`} onClick={()=>{if(!current.current)return;apply({...current.current,pendingFiles:(current.current.pendingFiles||[]).filter(file=>file.name!==f.name||file.size!==f.size)});setError('');}}><span aria-hidden="true">×</span></button></li>)}</ul>}
    <textarea ref={composerRef} id={`${id}-scope`} className={styles.composerText} rows={composerMode==='answer'?1:2} value={composerValue} onChange={e=>setComposerValue(e.target.value)} onKeyDown={composerKey} disabled={locked} placeholder={composerMode==='answer'?'Type your answer':composerMode==='edit'?'Edit your project description or add details':composerPlaceholder}/>
    <div className={styles.composerBar}><div className={styles.composerTools}><button type="button" className={styles.iconBtn} aria-label="Attach files" title="Attach plans, photos, estimates or documents" disabled={locked} onClick={()=>fileInput.current?.click()}><AttachGlyph/></button><input ref={fileInput} id={`${id}-files`} className={styles.srOnly} type="file" accept={accept} multiple tabIndex={-1} aria-label="Upload project files" onChange={e=>{const input=e.currentTarget;const selected=Array.from(input.files||[]);void addFiles(selected).then(()=>{input.value='';});}}/>{speechAvailable&&<button type="button" className={styles.iconBtn} data-listening={listening} aria-pressed={listening} aria-label={listening?'Stop listening':'Talk instead'} title={listening?'Stop listening':'Talk instead'} disabled={locked} onClick={speak}><MicGlyph/></button>}<span className={styles.composerHint}>{dragging?'Drop files to add them':locked?'Working on your project':'Type, talk, or attach files'}</span></div><button type="button" className={styles.send} aria-label={composerMode==='answer'?'Send answer':'Continue'} title={composerMode==='answer'?'Send answer':'Continue'} onClick={()=>{sentMessageRef.current=true;send();}} disabled={!canSend}><span aria-hidden="true">↑</span></button></div>
  </div>;
  const knownDetails=known.length>0&&<div><p className={styles.sectionLabel} style={{marginTop:0}}>Your project details</p>{knownGroups.map(group=><details key={group.title} className={styles.accordion} open={group.fields.includes(editField as ScopeField)}><summary><span className={styles.accordionTitle}>{group.title}</span><span className={styles.accordionMeta}>{group.fields.length} {group.fields.length===1?'detail':'details'}</span></summary><div className={styles.accordionBody}><dl className={styles.rows}>{group.fields.map(k=><div key={k}><dt>{SCOPE_FIELDS[k].label}</dt><dd>{editField===k?<div>{field(k)}<button type="button" className={styles.secondary} onClick={()=>{const issue=validateScopeAnswer(k,draft.answers[k]||'');if(issue){setError(issue);return;}setEditField('');setError('');log(newEntry('user',`Changed ${SCOPE_FIELDS[k].label.toLowerCase()} to ${readable(k,draft.answers[k]||'')}`,{kind:'note'}));}}>Done</button></div>:readable(k,draft.answers[k]!)}</dd>{editField!==k&&<button type="button" className={styles.iconButton} aria-label={`Edit ${SCOPE_FIELDS[k].label}`} onClick={()=>setEditField(k)}>Edit</button>}</div>)}</dl></div></details>)}</div>;
  // What the customer actually provided decides the stage wording (photos, plans, specifications, or
  // only a description); the running operation decides whether this is reading or pricing.
  const materials=projectMaterials([...(draft.uploads||[]).map(u=>({name:u.name,type:u.type})),...files.map(f=>({name:f.name,type:f.type})),...(attachedProjectSource?.imageUrl?[{name:'photo.jpg',type:'image/jpeg'}]:[])],draft.text);
  // The running operation declares its own kind. It used to be recognised by comparing `busy` against
  // two exact strings, but `busy` is replaced by whatever the server last reported ("Recovering an
  // interrupted step", "Your scope is queued for pricing"), so the match almost always failed and the
  // customer lost both the ETA and the stay-or-email choice for the whole wait (live 2026-09-23).
  const operationKind=runKind||undefined;
  const waitChoice:WaitChoice|null={email:draft.contact.email||'',onEmail:async(email:string)=>{
    const d=current.current;if(!d)return 'Your project is not saved yet.';
    try{const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,background:true,notify:true,notifyEmail:email,notifyOnly:true})});
      const data=await readJson(response);if(!response.ok)return data.error||'That did not save. Please try again.';
      if(!d.contact.email)apply({...d,contact:{...d.contact,email}});return null;}
    catch{return 'You appear to be offline. Your estimate keeps going; try again when you reconnect.';}
  }};
  // The waiting surface while a background job runs: the same honest progress card (stage named for the
  // materials, live ETA) and the same stay-or-email choice the customer sees during the first wait.
  const pausedCard=paused&&<section className={styles.notice} role="status" aria-live="polite"><P5ProcessingStatus message={paused.processing?.message||(paused.kind==='analysis'?'Reviewing your project...':'Preparing your estimate...')} processing={paused.processing} uploadPercent={null} hasAttachments={Boolean(draft.uploads?.length||files.length)} materials={materials} kind={paused.kind} waitChoice={paused.kind==='pricing'?waitChoice:null}/><div className={styles.actions}><button type="button" className={styles.primary} onClick={continuePaused}>Keep going</button><button type="button" className={styles.ghost} onClick={()=>setPaused(null)}>Come back later</button></div></section>;
  const questionAlert=error&&<div id={submitErrorId} className={styles.alert} role="alert" aria-live="assertive"><p>{error}</p></div>;
  const alertCard=error&&<div id={submitErrorId} className={styles.alert} role="alert" aria-live="assertive">{missingFields.length>0||verificationItems.length>0?<><h3>{missingFields.length>0?'A few more details are needed':'A few items to confirm'}</h3><p>{error}</p>{verificationItems.length>0&&<ul>{verificationItems.map(item=><li key={item}>{item}</li>)}</ul>}{missingFields.length>0&&<ul className={styles.missingList}>{missingFields.map(m=><li key={m.field}><button type="button" className={styles.secondary} onClick={()=>jumpToField(m.field)}><span>{m.label}</span><span aria-hidden="true">→</span></button></li>)}</ul>}</>:<p>{error}</p>}</div>;
  const warningCard=warning&&!busy&&<div className={styles.notice}><p>{warning}</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={()=>{engage();void run(analysisMessage(Boolean(draft.uploads?.length),'retry'),analyze,'analysis');}}>{draft.uploads?.length?'Retry document reading':'Retry scope review'}</button></div></div>;
  const intro=<Message role="assistant"><div className={styles.stageHeading} ref={stage===0?(el=>{stageRef.current=el;}):undefined}><Heading tabIndex={-1} data-stage-heading className={styles.title}>{attachedProjectSource?'Your design is ready to estimate':hasProgress?'Your project estimate':'Let’s estimate your project'}</Heading><p className={styles.lead}>{attachedProjectSource?'Your design selections are included. Add anything else, then send it.':'Describe the work in your own words, or attach plans, photos and documents. I will ask only about what is missing, then show your estimate.'}</p></div>{attachedProjectSource&&knownDetails}{!hasProgress&&!composerText.trim()&&!files.length&&<div className={styles.suggestions} aria-label="Example projects">{(defaultService==='re10'?SUGGESTIONS.re10:SUGGESTIONS[brandId]||SUGGESTIONS.p5).map(text=><button key={text} type="button" className={styles.suggestion} onClick={()=>{changeProjectText(text);composerRef.current?.focus();}}>{text}</button>)}</div>}{recoveries.length>0&&!hasProgress&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Saved project recovery</span><span className={styles.accordionMeta}>{recoveries.length}</span></summary><div className={styles.accordionBody}><ul className={styles.bullets} style={{listStyle:'none',paddingLeft:0}}>{recoveries.map(recovery=><li key={recovery.key}><button type="button" className={styles.secondary} onClick={()=>void switchProject(recovery)}>Restore {recovery.draft.text.slice(0,65)||'untitled project'}</button><details><summary className={styles.hint}>View saved details</summary><p style={{whiteSpace:'pre-wrap'}}>{displayScopeText(recovery.draft.text,recovery.draft.answers.estimatingInstructions)}</p><dl className={styles.rows}>{Object.entries(recovery.draft.answers).filter(([key])=>key!=='estimatingInstructions').map(([key,value])=><div key={key}><dt>{SCOPE_FIELDS[key as ScopeField]?.label||key}</dt><dd>{value}</dd></div>)}</dl>{recovery.draft.uploads?.map(file=><p key={file.id} className={styles.hint}>{file.name}</p>)}</details></li>)}</ul></div></details>}</Message>;
  const history=transcript.map((entry,index)=><Message key={entry.id} role={entry.role} last={index===lastUserIndex}>{entry.role==='assistant'&&entry.kind==='question'&&entry.label&&<p className={styles.eyebrow}>{entry.label}</p>}{entry.caption&&<p className={styles.eyebrow} style={{color:'inherit',opacity:.7}}>{entry.caption}</p>}{entry.text&&(entry.text.length>500?<details className={styles.accordion}><summary><span className={styles.accordionTitle}>View full message</span></summary><div className={styles.accordionBody}><p className={styles.msgText}>{entry.text}</p></div></details>:<p className={styles.msgText}>{entry.text}</p>)}{entry.files&&entry.files.length>0&&<ul className={styles.files} aria-label="Attached files">{entry.files.map((name,i)=><li key={name+i}><FileGlyph/>{name}</li>)}</ul>}{entry.kind==='ack'&&draft.step===1&&index===transcript.length-1&&known.length>0&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>What I captured so far</span><span className={styles.accordionMeta}>{known.length} {known.length===1?'detail':'details'}</span></summary><div className={styles.accordionBody}><dl className={styles.rows}>{known.map(k=><div key={k}><dt>{SCOPE_FIELDS[k].label}</dt><dd>{readable(k,draft.answers[k]!)}</dd></div>)}</dl></div></details>}</Message>);
  const questionStage=draft.step===1&&!busy&&!preparingFiles&&<Message role="assistant">{!active&&warningCard}{active?<section key={active.instructionId||active.field} ref={el=>{stageRef.current=el;}} className={styles.question} aria-label="Project question"><p className={styles.eyebrow}>{active.label}</p><h2 tabIndex={-1} data-stage-heading>{active.reason}</h2>{active.detail&&(active.handoff?<p className={styles.hint}>{active.detail}</p>:<details className={styles.context}><summary className={styles.hint}>Why we ask</summary><p className={styles.hint}>{active.detail}</p></details>)}{active.handoff&&<div className={styles.actions}><a className={styles.primary} href={active.handoff.url} onClick={e=>{e.preventDefault();void carryProject(active.handoff!.url);}}>{active.handoff.label}</a></div>}{warningCard}{active.values?.length?<div className={styles.choices} role="group" aria-label="Suggested answers">{active.values.map(value=><button type="button" className={styles.choice} key={value} onClick={()=>choose(value)} aria-pressed={reply===optionLabel(value)||reply.startsWith(optionLabel(value)+'\n')}>{optionLabel(value)}</button>)}</div>:null}{questionAlert}{!active.handoff&&<div className={styles.questionActions}>{active.field!=='service'&&!active.conflict&&!active.instructionId&&<button type="button" className={styles.secondary} onClick={skipQuestion}>Not sure yet</button>}<span className={styles.hint}>{active.values?.length?'Choose an option or type your answer. Add details if needed, then send.':'Type your answer below and send it.'}</span></div>}</section>:<div ref={el=>{stageRef.current=el;}} className={styles.card}><h3 tabIndex={-1} data-stage-heading>Your details are complete.</h3><p className={styles.hint}>Review your project and add where to send your estimate.</p><div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>{engage();showQuestions(current.current!);}}>Review your project <span aria-hidden="true">→</span></button></div></div>}</Message>;
  const finishChoices=FINISH_LEVELS.filter(([value])=>finishOptionsForService(draft.answers.service).includes(value));
  const reviewStage=draft.step===2&&!result&&!busy&&!preparingFiles&&<Message role="assistant">
    <div className={styles.stageHeading} ref={el=>{stageRef.current=el;}}><h2 tabIndex={-1} data-stage-heading>Review your project</h2><p className={styles.lead}>Here is what I captured. Check anything that needs changing, then add where to send your estimate.</p></div>
    <details className={styles.accordion}><summary><span className={styles.accordionTitle}>Project summary</span><span className={styles.badge} data-kind="included">Captured</span><span className={styles.accordionMeta}>{known.length} details</span></summary><div className={styles.accordionBody}><dl className={styles.summaryRows}><div><dt>Project</dt><dd>{draft.answers.service?readable('service',draft.answers.service):'Not set'}</dd></div>{draft.answers.location&&<div><dt>Location</dt><dd>{draft.answers.location}</dd></div>}{draft.answers.sqft&&<div><dt>Area</dt><dd>{Number(draft.answers.sqft.replaceAll(',','')).toLocaleString('en-US')} sq ft</dd></div>}{draft.answers.finish&&<div><dt>Finish</dt><dd>{readable('finish',draft.answers.finish)}</dd></div>}<div><dt>Details saved</dt><dd>{known.length}</dd></div><div><dt>Files</dt><dd>{uploadedCount?`${uploadedCount} uploaded`:'None'}</dd></div></dl>{draft.extraction?.summary&&<p className={styles.hint} style={{marginTop:12}}>{draft.extraction.summary.slice(0,280)}{draft.extraction.summary.length>280?'…':''}</p>}</div></details>
    {scopeFieldApplies('finish',questionContext(draft.answers,draft.extraction,draft.text))&&<details className={styles.accordion} open={false}><summary><span className={styles.accordionTitle}>Finish level</span><span className={styles.badge} data-kind={draft.answers.finish?'included':'assumption'}>{draft.answers.finish?readable('finish',draft.answers.finish):'Choose one'}</span></summary><div className={styles.accordionBody}><p className={styles.hint} style={{marginBottom:12}}>Finish level changes material pricing across the estimate.</p><div className={styles.choices} role="group" aria-label="Finish level">{finishChoices.map(([value,detail])=><button type="button" key={value} className={styles.choice} aria-pressed={draft.answers.finish===value} onClick={()=>{if(draft.answers.finish===value)return;answer('finish',value);log(newEntry('user',`Finish level: ${readable('finish',value)}`,{kind:'note'}));}}><span><strong>{readable('finish',value)}</strong><br/><small className={styles.hint}>{detail}</small></span></button>)}</div></div></details>}
    {warningCard}
    {(draft.extraction?.instructions||draft.extraction?.documentCoverage)&&<div><P5EstimateDetails result={{instructions:draft.extraction.instructions,documentCoverage:draft.extraction.documentCoverage}} openFirst={false} showGlance={false}/></div>}
    {assumptions.length>0&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Assumptions and details to confirm</span><span className={styles.badge} data-kind="assumption">To confirm</span><span className={styles.accordionMeta}>{assumptions.length}</span></summary><div className={styles.accordionBody}><ul className={styles.bullets}>{assumptions.map(note=><li key={note}>{note}</li>)}</ul></div></details>}
    {knownDetails}
    <div className={styles.card} id={`${id}-contact`}><div className={styles.cardHead}><h3>Who is this estimate for?</h3></div><p className={styles.hint} style={{marginBottom:12}}>Your name is required. Add your email to get a copy and a link back to this estimate; you can also choose to be emailed while it is being prepared.</p><div className={styles.contactGrid}>{([['name','Your name','text'],['email','Email','email'],['phone','Phone','tel']] as const).map(([key,label,type])=><label className={styles.field} key={key} htmlFor={`${id}-contact-${key}`}><span>{label} {key!=='name'?<span className={styles.optional}>(optional)</span>:null}</span><input id={`${id}-contact-${key}`} ref={key==='name'?contactNameRef:key==='email'?contactEmailRef:undefined} type={type} autoComplete={key} required={key==='name'} aria-invalid={validationTarget==='contact'&&key!=='phone'&&(key==='name'?draft.contact.name.trim().length<2:Boolean(draft.contact.email.trim())&&!EMAIL.test(draft.contact.email))?true:undefined} aria-describedby={validationTarget==='contact'&&key!=='phone'?submitErrorId:undefined} value={draft.contact[key]} onChange={e=>{changeContact(key,e.target.value);if(validationTarget==='contact')setValidationTarget('');}} maxLength={key==='name'?120:key==='email'?200:40}/></label>)}</div><label className={styles.check} data-invalid={validationTarget==='confirmation'&&!confirmed?true:undefined}><input ref={confirmationRef} type="checkbox" required checked={confirmed} aria-invalid={validationTarget==='confirmation'&&!confirmed?true:undefined} aria-describedby={validationTarget==='confirmation'?submitErrorId:undefined} onChange={e=>{setConfirmed(e.target.checked);if(e.target.checked){setValidationTarget('');setError('');}}}/><span>These details reflect my project. I understand this is a preliminary estimate, subject to confirmed scope, selections and site conditions.</span></label></div>
    {alertCard}<p className={styles.hint}>Need to change something? Use <b>Add or edit details</b> below to update your description or attach more files. Your answers are kept.</p>
  </Message>;
  // The result screen shows the same estimate document as the PDF and email (reference, date, finish,
  // total and next steps come from the server's saved estimate, never recomputed here).
  const doc=estimateDoc;
  const resultStage=result&&<Message role="assistant"><div className={styles.stageHeading} ref={el=>{stageRef.current=el;}}>{doc&&<p className={styles.eyebrow}>Preliminary online estimate</p>}<h2 tabIndex={-1} data-stage-heading>{doc?.title||'Your project estimate'}</h2><p className={styles.lead}>{doc?.projectName||'Your planning range and project scope are organized below.'}</p>{doc&&<p className={styles.hint}>Estimate {doc.reference}{doc.issuedLabel?` | Prepared ${doc.issuedLabel}`:''}</p>}</div><div className={styles.rangeCard}><p className={styles.eyebrow}>{doc?.total?.label||priceLabel(result.range)}</p><h2>{doc?.total?.amount||(result.range?priceText(result.range):"Your scope is ready for pricing review")}</h2>{doc?.partialNote?<p><strong>{doc.partialNote}</strong></p>:<p>{result.message}</p>}</div>{doc&&<div className={styles.finishCard}><p className={styles.eyebrow}>{doc.finish.heading}</p><p className={styles.finishName}>{doc.finish.name}</p><p>{doc.finish.detail}</p><p className={styles.hint}>{doc.finish.basis}</p></div>}<p className={styles.delivery} role="status" data-state={deliveryState}>{deliveryState==='notRequested'?'Your estimate is saved here. You can download your PDF below.':deliveryState==='sent'?`Your estimate was sent to ${draft.contact.email}. Your project record is saved.`:deliveryState==='review'?'Your estimate is saved. The email could not be delivered automatically, so the team will check it and follow up. You do not need to submit again.':customerDelivery?`Your estimate is saved. We are sending a copy to ${draft.contact.email}.`:'Your estimate is saved. We are sending a copy to your email.'}</p><ul className={styles.deliveryList} aria-label="Delivery status"><li data-state="sent">Estimate saved<span>Saved</span></li><li data-state={deliveryState}>Email to you<span>{DELIVERY_LABEL[deliveryState]}</span></li><li data-state={staffState}>Our team notified<span>{DELIVERY_LABEL[staffState]}</span></li></ul><details className={styles.accordion} open aria-label="Estimate PDF attachment"><summary><span className={styles.accordionTitle}>Your estimate PDF</span><span className={styles.badge} data-kind={pdfState==='failed'?'excluded':'included'}>{PDF_STATE_LABEL[pdfState]}</span></summary><div className={styles.accordionBody}><p className={styles.hint} style={{marginBottom:12}}>Your branded PDF includes the planning range, scope, inclusions, exclusions, allowances and assumptions shown here.</p><button type="button" className={styles.secondary} onClick={downloadPdf} disabled={locked}><FileGlyph/> Download estimate PDF</button></div></details><P5EstimateDetails result={result} openFirst={false}/>{doc?<section className={styles.nextSteps} aria-label="Next steps"><h3>Next steps</h3><ol>{doc.nextSteps.map(([title,body])=><li key={title}><strong>{title}</strong><span>{body}</span></li>)}</ol><div className={styles.reviewCard}><a className={styles.primary} href={doc.review.mailto} onClick={()=>trackScopeEvent("onsiteRequested",draft.answers.service)}>{doc.review.label}</a><p><a href={doc.review.mailto}>{doc.review.email}</a> | <a href={doc.review.tel}>{doc.review.phone}</a></p></div></section>:<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Recommended next step</span></summary><div className={styles.accordionBody}><p>{result.nextStep}</p></div></details>}<p className={styles.disclaimer}>{doc?<><strong>{doc.notice.lead}</strong> {doc.notice.text}</>:result.disclaimer}</p><section className={styles.reviseCard} aria-labelledby={`${id}-revise`}><h3 id={`${id}-revise`}>Change this estimate</h3><p className={styles.hint}>Describe the change in your own words, for example &ldquo;Remove painting&rdquo;, &ldquo;Use upgraded cabinets&rdquo; or &ldquo;Update this using the revised plans&rdquo;. We keep this version and prepare an updated one; you can attach revised files next.</p><label className={styles.field} htmlFor={`${id}-revise-text`}><span>What would you like to change?</span><textarea id={`${id}-revise-text`} rows={3} maxLength={2000} value={reviseText} onChange={e=>setReviseText(e.target.value)}/></label><div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={()=>void reviseEstimate()}>Update my estimate</button></div>{versions.length>0&&<div className={styles.versionList}><p className={styles.eyebrow}>Earlier versions</p><ul>{versions.map(v=><li key={v.revision}><span>Version {v.revision}{v.total?` · ${v.total}`:''}{v.submittedAt?` · ${new Date(v.submittedAt).toLocaleDateString()}`:''}</span><button type="button" className={styles.ghost} onClick={()=>void downloadVersionPdf(v.revision)}>PDF</button></li>)}</ul></div>}</section>{alertCard}<div className={styles.actions}><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start another project</button></div></Message>;
  // Mounted for as long as the operation runs, not for as long as `busy` happens to hold a sentence.
  // The server's progress message goes briefly empty between steps, and the card was mounted on it:
  // it vanished and came back, and because it holds the stay-or-email choice, that reset the choice,
  // the address the customer had typed and the elapsed timer (owner report 2026-09-23, "disappears
  // too quickly"). Keeping one instance mounted keeps the customer's own input alive.
  const processingStage=(busy||preparingFiles||runKind)&&<Message role="assistant"><P5ProcessingStatus hasAttachments={Boolean(draft.uploads?.length||files.length||attachedProjectSource?.imageUrl)} message={preparingFiles?'Preparing your files...':busy||(runKind==='pricing'?'Preparing your estimate...':'Reviewing your project...')} processing={preparingFiles?null:processing} uploadPercent={uploadPercent} materials={materials} kind={operationKind} waitChoice={operationKind==='pricing'?waitChoice:null} onPause={busy?()=>operationBudget.current?.controller.abort(new ProcessingDeadlineError()):undefined}/></Message>;
  const stepLabel=result?'Estimate ready':`Step ${draft.step+1} of 3 · ${STEP_LABELS[draft.step]}`;const showBack=!result&&!busy&&draft.step>0;const collapsedWithProgress=layout==='embedded'&&!expanded&&hasProgress;
  const dock=locked&&stage!==2&&stage!==3?<div className={styles.dockHint} role="status">Working on your project. Your progress is saved.</div>
    :stage===3?<div className={styles.dockBar}><a className={styles.primary} href={estimateDoc?.review.mailto||brand.consultationPath} onClick={()=>trackScopeEvent("onsiteRequested",draft.answers.service)}>{estimateDoc?estimateDoc.review.label:'Schedule a consultation'}</a><a className={styles.secondary} href={`tel:${brand.phone.replace(/[^\d+]/g,'').replace(/^(?!\+)(\d{10})$/,'+1$1')}`}>Call {brand.phone}</a></div>
    :stage===2?<>{addingDetails&&composer}<div className={styles.dockBar} data-final-action><button type="submit" form={formId} className={styles.primary} disabled={locked} aria-describedby={error?submitErrorId:undefined}>{busy?'Preparing your estimate…':'Get my estimate'}</button></div><div className={styles.dockRow}><span className={styles.dockHint}>{contactReady?(confirmed?(hasEmail?'Your estimate opens right here and is emailed to you.':'Your estimate opens right here. You can download a PDF when it is ready.'):'Confirm your project details above, then get your estimate.'):'Add your name above. Email is optional; check it or leave it blank.'}</span><button type="button" className={styles.ghost} disabled={locked} onClick={()=>setAddingDetails(v=>!v)} aria-expanded={addingDetails}>{addingDetails?'Cancel editing':'Add or edit details'}</button></div></>
    :stage===1&&active?.handoff?<div className={styles.dockBar}><a className={styles.primary} href={active.handoff.url} onClick={e=>{e.preventDefault();void carryProject(active.handoff!.url);}}>{active.handoff.label}</a></div>
    // What the customer can attach is already said by the field's own placeholder and the attach
    // button. The only thing this line adds is that written limits are obeyed, so that is all it says
    // now: on a phone the old sentence ran to three lines of text the customer had just read.
    :<>{composer}{stage===0&&<p className={styles.dockHint}>Tell us things like “price only the trim” or “leave out plumbing” and we will follow them.</p>}</>;
  return <div ref={rootRef} role="region" aria-label="Project estimator" className={styles.root} data-p5-estimator data-version={ESTIMATOR_VERSION} data-release={estimatorRelease().sha.slice(0,12)} data-theme={theme.mode} data-layout={layout} data-expanded={frameActive?'true':undefined} data-step={stage} aria-busy={Boolean(busy)} style={{...(estimatorThemeStyle(theme) as React.CSSProperties),'--p5-top':`${topInset}px`,'--p5-bottom':`${bottomInset}px`} as React.CSSProperties}>
    <form id={formId} className={styles.app} onSubmit={submit} noValidate>
      <div className={styles.topbar}>{showBack?<button type="button" className={styles.navBtn} onClick={back} aria-label="Back to the previous step"><BackGlyph/><span data-label>Back</span></button>:<span className={styles.navSpacer} aria-hidden="true"/>}<div className={styles.topCenter}><span className={styles.brandLine}><span data-brand>{brand.name}</span><span data-sep aria-hidden="true"> · </span><span data-title>Project estimator</span></span><span className={styles.stepPill}>{stepLabel}</span></div>{frameActive?<button type="button" className={styles.navBtn} onClick={exit} aria-label={layout==='embedded'?'Exit full screen. Your progress is saved.':'Exit the estimator. Your progress is saved.'}><span data-label>Exit</span><CloseGlyph/></button>:<span className={styles.navSpacer} aria-hidden="true"/>}</div>
      {!result&&<div className={styles.rail} aria-hidden="true">{STEP_LABELS.map((label,index)=><span key={label} data-state={index===draft.step?'current':index<draft.step?'done':'upcoming'}/>)}</div>}
      <p className={styles.srOnly} aria-live="polite">{stepLabel}</p>
      <div ref={threadRef} className={styles.thread} data-p5-thread><div className={styles.threadInner}>{collapsedWithProgress?<Message role="assistant"><div className={styles.stageHeading}><Heading tabIndex={-1} className={styles.title}>{result?'Your estimate is ready':'Continue your estimate'}</Heading><p className={styles.lead}>{result?'Your planning range and project summary are saved on this device.':`Your project is saved on this device: ${known.length} ${known.length===1?'detail':'details'}${uploadedCount?` and ${uploadedCount} ${uploadedCount===1?'file':'files'}`:''}. ${stepLabel}.`}</p></div><div className={styles.actions}><button type="button" className={styles.primary} onClick={()=>setExpanded(true)}>{result?'Open my estimate':'Continue'} <span aria-hidden="true">→</span></button><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start a new project</button></div></Message>:<>{intro}{history}{stage===0&&!busy&&!preparingFiles&&<>{pausedCard&&<Message role="assistant">{pausedCard}</Message>}{(warning||error)&&<Message role="assistant">{warningCard}{alertCard}</Message>}</>}{questionStage}{reviewStage}{resultStage}{processingStage}{paused&&stage!==0&&!busy&&<Message role="assistant">{pausedCard}</Message>}{status&&!busy&&!preparingFiles&&!error&&<p className={styles.status} role="status">{status}</p>}{hasProgress&&!result&&!busy&&<div className={styles.actions} style={{marginTop:0}}><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start a different project</button></div>}</>}</div></div>
      {!collapsedWithProgress&&<div className={styles.dock}><div className={styles.dockInner}>{dock}</div></div>}
    </form>
  </div>;
}
