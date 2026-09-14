"use client";
import {CLIENT_BUDGET_MS,ProcessingDeadlineError,remainingBudget,withinDeadline,fetchWithinDeadline,isProcessingDeadline} from '@/lib/p5/processingBudget';
import {completeSubmission} from '@/lib/p5/submitProgress';
import P5EstimateDetails from './P5EstimateDetails';
import P5ProcessingStatus from './P5ProcessingStatus';
import type {ProcessingStatus} from '@/lib/p5/processingStatus';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ESTIMATOR_BRAND as brand} from '@/lib/p5/brand';
import {estimatorTheme,estimatorThemeStyle} from '@/lib/p5/theme';
import {SCOPE_FIELDS,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP,coerceChoice,type ScopeField,type ScopeAnswers,type ScopeUpload} from '@/lib/p5/scope';
import {deriveScopeAnswers,questionForField,scopeQuestionsForBrand as scopeQuestions,scopeAssumptions,validateScopeAnswer,type ScopeQuestion} from '@/lib/p5/adaptive';
import {loadBrowserDraft,persistBrowserDraft,draftHeaders,cacheFiles,loadCachedFiles,clearCachedFiles,requireDraftReceipt,archiveBrowserDraft,listBrowserDraftRecoveries,replaceBrowserDraft,restoreBrowserDraft,type BrowserDraft,type BrowserDraftRecovery,type TranscriptEntry} from '@/lib/p5/browserDraft';
import {mergeProjectSource,type ProjectSource} from '@/lib/p5/projectSource';
import {resumeWizardDraft} from '@/lib/p5/wizardResume';
import {snapshotProjectFile} from '@/lib/p5/fileSnapshot';
import {transferLargeFiles} from '@/lib/p5/resumableTransfer';
import {transferProjectFiles} from '@/lib/p5/uploadTransfer';
import {fieldCategory} from '@/lib/p5/presentation';
import styles from './P5Estimator.module.css';
import {reportProgress,trackScopeEvent} from '@/lib/p5/progress';
import {displayScopeText,refreshAnalyzedScope,scopeFingerprint,scopeTextChanged,sourceSnapshot,sourceSnapshotsEqual} from '@/lib/p5/scopeReplacement';
import {ESTIMATOR_VERSION} from '@/lib/p5/version';

const textAnswers=(a:ScopeAnswers)=>JSON.stringify(Object.entries(a).filter(([k,v])=>SCOPE_FIELDS[k as ScopeField].kind==='text'&&v?.trim()).sort(([a],[b])=>a.localeCompare(b)));
const labels:Record<string,string>={handyman:'Home repairs',re10:'Inspection and RE-10 repairs','cabinet-product':'Cabinets, supply only','cabinet-install':'Cabinets with installation',kitchen:'Kitchen remodel',bathroom:'Bathroom remodel','whole-home':'Whole-home remodel',addition:'Home addition',adu:'ADU','new-construction':'New home','change-order':'Change order',rush:'Rush work',refresh:'Simple refresh','mid-range':'Standard finishes','high-end':'Premium finishes',luxury:'Custom luxury finishes',standard:'Standard',priority:'Priority',emergency:'Emergency',complex:'Complex',yes:'Yes',no:'No'};
const readable=(field:ScopeField,value:string)=>field==='cabinetRoom'?value.replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase()):labels[value]||value.replaceAll('-',' ');
const brandId=brand.id as string;
const SUGGESTIONS:Record<string,string[]>={
  construction:['Build a 2,500 sq ft home with an 800 sq ft garage in Eagle. Plans attached.','Add a 600 sq ft ADU above a detached garage in Boise.','Price only the framing and roofing from my plans; exclude finishes.'],
  remodeling:['Remodel our 8 x 10 hall bathroom. Keep the layout; new tile shower, vanity and floor.','Kitchen remodel, about 200 sq ft, new cabinets and quartz counters. Exclude appliances.','Finish a 900 sq ft basement with one bedroom and a bathroom.'],
  handyman:['Fix three sticking doors, replace two faucets and patch two drywall holes.','Install 120 ft of baseboard in two bedrooms. No painting; we will paint.','Complete the repairs on the attached RE-10 inspection report.'],
  cabinet:['Painted Shaker kitchen cabinets, 20 ft of base and 15 ft of uppers. Include installation.','Two bathroom vanity cabinets, supply only, 48 inches each.','Built-in bookcases for a home office, about 10 ft wide.'],
  p5:['Remodel our hall bathroom: new tile shower, vanity, toilet and floor.','Build a new home from the attached plans with a 3-car garage.','Handyman list: three doors, two faucets and drywall patches.'],
};
const composerPlaceholder='Describe your project or drop files here. Include sizes, what to include or exclude, and who supplies materials.';
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
const ASSISTANT_INITIAL=brand.name.replace(/^Boise\s+/,'').slice(0,1).toUpperCase();
/* Module-level so React keeps the subtree mounted between renders; a component
 * created inside the render would remount every message on each keystroke. */
function Avatar({role}:{role:'user'|'assistant'}){return <span className={styles.avatar} aria-hidden="true">{role==='assistant'?ASSISTANT_INITIAL:'You'}</span>;}
function Message({role,children,last}:{role:'user'|'assistant';children:React.ReactNode;last?:boolean}){return <div className={styles.msg} data-role={role} data-last-user={last?'':undefined}><Avatar role={role}/><div className={styles.bubble}>{children}</div></div>;}

export interface P5EstimatorProps {
  defaultService?:string;
  headingAs?:'h1'|'h2';
  projectSource?:ProjectSource;
  /** page: a fixed app frame below the site header. embedded: a card in the page that expands to the frame once the visitor engages. */
  layout?:'page'|'embedded';
  /** Called when the visitor exits a page-layout estimator. Defaults to browser history. */
  onExit?:()=>void;
}

export function P5Estimator({defaultService='',headingAs='h1',projectSource,layout='embedded',onExit}:P5EstimatorProps){
  const [draft,setDraft]=useState<BrowserDraft|null>(null);const current=useRef<BrowserDraft|null>(null);
  const [files,setFiles]=useState<File[]>([]);const filesRef=useRef<File[]>([]);const fileInput=useRef<HTMLInputElement|null>(null);const composerRef=useRef<HTMLTextAreaElement|null>(null);
  const [busy,setBusy]=useState('');const busyRef=useRef(false);const [error,setError]=useState('');const [warning,setWarning]=useState('');const [status,setStatus]=useState('');
  const [uploadPercent,setUploadPercent]=useState<number|null>(null);const [preparingFiles,setPreparingFiles]=useState(false);const [dragging,setDragging]=useState(false);
  const [processing,setProcessing]=useState<ProcessingStatus|null>(null);const lastProcessing=useRef<ProcessingStatus|null>(null);
  const [paused,setPaused]=useState<Paused|null>(null);const resuming=useRef(false);
  const [missingFields,setMissingFields]=useState<MissingField[]>([]);const [verificationItems,setVerificationItems]=useState<string[]>([]);
  const started=useRef(false);
  const [reply,setReply]=useState('');
  const [editText,setEditText]=useState('');const [addingDetails,setAddingDetails]=useState(false);
  const [recoveries,setRecoveries]=useState<BrowserDraftRecovery[]>([]);
  const [result,setResult]=useState<any>(null);const [delivery,setDelivery]=useState<any[]>([]);const deliveryChecks=useRef(0);const [confirmed,setConfirmed]=useState(false);
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
  /** Append to the conversation record kept with the draft on this device. */
  const log=(...entries:TranscriptEntry[])=>{const d=current.current;if(!d||!entries.length)return;apply({...d,transcript:[...(d.transcript||[]),...entries]});};
  const questions=(d:BrowserDraft)=>scopeQuestions(d.answers,d.extraction,d.conflicts||[],d.wizard?.skipped||[],d.pricedFields||[]);
  const resume=(d:BrowserDraft)=>{const next=questions(d)[0]||null;setActive(next);setReply(d.pendingReply?.id===next?.instructionId?d.pendingReply?.answer||'':'');apply(resumeWizardDraft(d,Boolean(next)));};
  const engage=()=>{if(layout==='embedded'&&!expanded)setExpanded(true);};
  /** Scroll the conversation, never the page, so a stage heading or a field is in view. */
  const scrollThread=(el:HTMLElement|null,block:'start'|'center'='start')=>{
    const thread=threadRef.current;if(!el)return;
    const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior:ScrollBehavior=reduced?'auto':'smooth';
    if(!thread||getComputedStyle(thread).overflowY==='visible'){el.scrollIntoView({block:block==='start'?'start':'center',behavior});return;}
    const offset=el.getBoundingClientRect().top-thread.getBoundingClientRect().top+thread.scrollTop;
    const top=block==='start'?offset-8:offset-thread.clientHeight/2+el.offsetHeight/2;
    thread.scrollTo({top:Math.max(0,top),behavior});
  };
  /** Instant positioning for a new stage: its heading sits at the top of the conversation area. */
  const positionThread=(el:HTMLElement|null)=>{
    const thread=threadRef.current;if(!el)return;
    if(!thread||getComputedStyle(thread).overflowY==='visible'){el.scrollIntoView({block:'start'});return;}
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
      if(!d.dirty&&current.current.updatedAt===d.updatedAt&&saved.revision>=d.revision){const restored={...d,...saved,key:d.key,step:d.step,updatedAt:d.updatedAt,transcript:d.transcript} as BrowserDraft;resume(restored);}
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
  /* The frame owns the screen: the document scroll is locked, the site's
   * mobile bars step aside (see globals.css) and the frame sits beneath the
   * fixed site header and above the on-screen keyboard. */
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
    apply({...current.current,revision:saved.revision,extraction:saved.extraction,uploads:saved.uploads,pricedFields:data.pricedFields||[],...(unchanged?{answers:saved.answers,wizard:saved.wizard,conflicts:[...(data.conflicts||[]),...(current.current.conflicts||[]).filter(c=>!data.conflicts?.some((v:any)=>v.field===c.field))],dirty:false,reviewedRevision:reviewed?saved.revision:undefined}:{})});
    return saved;
  }
  /* Autosave only what the visitor changed. Saving an unchanged draft would
   * clear the server's reviewed flag and make a pricing poll fail with
   * "Review and confirm the extracted scope" after a long price run. */
  useEffect(()=>{
    if(!draft?.contact.email||busy||result||!draft.dirty||paused)return;
    const timer=setTimeout(()=>{if(!busyRef.current)void serialized(()=>save()).then(()=>setStatus('Project saved.')).catch(()=>setStatus('Saved on this device. We will retry saving when connected.'));},1800);
    return()=>clearTimeout(timer);
  },[draft?.text,JSON.stringify(draft?.answers),JSON.stringify(draft?.contact),busy,Boolean(result),Boolean(draft?.dirty),Boolean(paused)]);
  /** One bounded operation at a time. A deadline is a pause with the work
   * preserved server-side, never a failure that discards progress. */
  async function run(label:string,operation:()=>Promise<void>,kind:Paused['kind']|null=null){
    if(busyRef.current)return;busyRef.current=true;setBusy(label);setProcessing(null);lastProcessing.current=null;setError('');setPaused(null);recognition.current?.stop();
    const budget={deadline:Date.now()+CLIENT_BUDGET_MS,controller:new AbortController()};operationBudget.current=budget;
    try{await withinDeadline(()=>serialized(async()=>{checkOperation();await withinDeadline(operation,budget.deadline);checkOperation();}),budget.deadline);}
    catch(e){
      const userPaused=budget.controller.signal.aborted&&Date.now()<budget.deadline;
      if(userPaused)setStatus('Your progress is saved. Continue whenever you are ready.');
      else if(isProcessingDeadline(e)&&kind)setPaused({kind,processing:lastProcessing.current});
      else{
        const message=e instanceof Error?e.message:'';
        if(/review and confirm the extracted scope/i.test(message)){const d=current.current;if(d){apply({...d,step:2});setActive(null);}setError('Your project changed since it was confirmed. Check the summary below, confirm your details, then tap Get my estimate again.');}
        else setError(isProcessingDeadline(e)?'This is taking longer than expected. Your completed work is saved; continue to pick up where it stopped.':e instanceof TypeError?'The connection was interrupted. Your saved details are intact. Keep this tab open and retry.':message||'This step could not finish. Your work is still here.');
      }
    }
    finally{budget.controller.abort();if(operationBudget.current===budget)operationBudget.current=null;busyRef.current=false;setBusy('');setUploadPercent(null);setProcessing(null);}
  }
  useEffect(()=>{
    if(!paused||busy)return;
    let cancelled=false;
    const kind=paused.kind;
    let inFlight=false;
    const tick=async()=>{
      const d=current.current;if(!d||cancelled||inFlight)return;inFlight=true;try{await check(d);}finally{inFlight=false;}
    };
    const check=async(d:NonNullable<typeof current.current>)=>{
      try{
        if(kind==='pricing'){
          if(d.dirty){setPaused(null);apply({...d,step:2});setActive(null);setError('Your project changed while it was being priced. Check the summary, confirm your details, then tap Get my estimate again.');return;}
          const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,background:true,retry:false})});
          const data=await response.json();if(cancelled)return;
          if(response.status===202&&data.pending){if(data.processing)setPaused(p=>p&&p.kind===kind?{...p,processing:data.processing}:p);return;}
          setPaused(null);
          if(!response.ok){if(data.pricingReviewRequired){setMissingFields(parseMissing(data.missingFields));setVerificationItems(parseItems(data.verificationItems));}setError(data.error||'Your estimate could not be completed. Your saved work is intact; please retry.');return;}
          if(data.result){setResult(data.result);setDelivery(data.delivery||[]);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);setStatus('');}
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
  const parseMissing=(value:unknown):MissingField[]=>Array.isArray(value)?value.filter((f:any)=>f&&typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field)).map((f:any)=>({field:f.field as ScopeField,label:String(f.label||SCOPE_FIELDS[f.field as ScopeField].label)})):[];
  const parseItems=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).slice(0,8):[];
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
    // Record what the visitor sent before the work starts so a pause or retry never repeats it.
    const message=pendingUserMessage.current;pendingUserMessage.current=null;
    if(message&&(message.text.trim()||message.files.length))log(newEntry('user',message.text,{files:message.files,kind:'scope',caption:message.caption}));
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
    const next={...current.current!,...saved,key:d.key,step:1,updatedAt:Date.now(),dirty:false,conflicts:data.conflicts||[],pricedFields:data.pricedFields||[],analysisWarning:data.warning||"",sourceImageUrl:current.current?.sourceDetached?undefined:projectSource?.imageUrl,analyzedText:d.text,analyzedAnswers:textAnswers(saved.answers),transcript:current.current!.transcript} as BrowserDraft;
    apply(next);setWarning(data.warning||'');if(pending.length)trackScopeEvent(d.uploads?.length?'additionalDocuments':'documentUploaded',saved.answers.service);trackScopeEvent(data.warning?'analysisFailed':'analysisCompleted',saved.answers.service);filesRef.current=[];setFiles([]);
    try{await clearCachedFiles(d.id);}catch{setStatus('Files are uploaded. Local file cleanup will retry later.');}
    const remaining=questions(next);
    const captured=Object.keys(next.answers).filter(k=>k!=='estimatingInstructions'&&next.answers[k as ScopeField]?.trim()).length;
    const read=next.uploads?.length||0;
    const ack=[`Thanks. I read ${read?`${read} ${read===1?'file':'files'} and `:''}your description and saved ${captured} project ${captured===1?'detail':'details'}.`,data.warning?'Some files still need review; see the note below.':remaining.length?`I have ${remaining.length===1?'one quick question':`${remaining.length} quick questions`} before your estimate.`:'That is everything I need. Review your project below, then add where to send your estimate.'].join(' ');
    log(newEntry('assistant',ack,{kind:'ack'}));
    setStatus('');showQuestions(current.current!);
  }
  const needsAnalysis=()=>{const d=current.current;return Boolean(d&&(d.analysisWarning||!d.sourceDetached&&projectSource?.imageUrl&&d.sourceImageUrl!==projectSource.imageUrl||filesRef.current.length||d.text.trim()&&d.text!==d.analyzedText||textAnswers(d.answers)!=='[]'&&textAnswers(d.answers)!==d.analyzedAnswers));};
  // Delivery finishes inside the submitting request when it can; otherwise a
  // status check every few seconds drives the remaining sends on the host and
  // the message below reflects the real state instead of a hopeful one.
  useEffect(()=>{
    if(!result||!delivery.length||!delivery.some(d=>d.status==='pending'||d.status==='retry'||d.status==='sending')||deliveryChecks.current>=10)return;
    const d=current.current;if(!d)return;let cancelled=false;
    const timer=setTimeout(async()=>{
      deliveryChecks.current+=1;
      try{const response=await fetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(d),'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision})});const value=await response.json();if(!cancelled&&mounted.current&&Array.isArray(value.delivery)&&value.delivery.length)setDelivery(value.delivery);}catch{}
    },6000);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[result,delivery]);
  // The composer grows with its text, like a chat box, and scrolls past about ten lines.
  useEffect(()=>{const el=composerRef.current;if(!el)return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,220)+'px';},[draft?.text,draft?.answers.estimatingInstructions,draft?.step,reply,editText,addingDetails]);
  const begin=()=>run('Reading your project...',async()=>{
    if(!current.current?.text.trim()&&!filesRef.current.length&&!current.current?.uploads?.length&&!Object.values(current.current?.answers||{}).some(v=>v?.trim())){pendingUserMessage.current=null;setError('Describe your project or add a file to continue.');return;}
    if(needsAnalysis()||(current.current?.uploads?.length&&!current.current.extraction))await analyze();
    else{pendingUserMessage.current=null;await save();showQuestions(current.current!);}
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
    try{if(copied.reduce((n,f)=>n+f.size,0)>22*1024*1024)throw new Error('Large files stay in this tab until upload.');await cacheFiles(current.current.id,copied);setStatus('Files ready. Send your message to read them with your project details.');}catch{setStatus('Files are ready in this tab. Device storage is unavailable; keep this tab open until upload completes.');}finally{setPreparingFiles(false);}
  }
  /** Talk to text where the browser supports it. Final phrases are appended to the active text box. */
  function speak(){
    if(listening){recognition.current?.stop();return;}
    const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Constructor)return;
    const r:Recognition=new Constructor();recognition.current=r;r.continuous=true;r.interimResults=false;r.lang='en-US';
    r.onresult=(event:any)=>{let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+' ';if(text.trim()){const d=current.current;if(!d)return;if(composerMode==='project')changeProjectText(`${displayScopeText(d.text,d.answers.estimatingInstructions)} ${text}`.trim());else if(composerMode==='edit')setEditText(v=>`${v} ${text}`.trim());else setReply(v=>`${v} ${text}`.trim());}};
    r.onerror=()=>{setListening(false);setError("Microphone input is unavailable. You can type, upload, or use your keyboard's dictation button.");};r.onend=()=>setListening(false);
    try{setListening(true);setError('');r.start();}catch{setListening(false);setError('The microphone could not start. You can still type or add files.');}
  }
  /** Record the exchange for the question that was just answered. */
  const logExchange=(question:ScopeQuestion,answerText:string)=>log(newEntry('assistant',question.reason,{kind:'question',label:question.label}),newEntry('user',answerText,{kind:'answer'}));
  async function advance({skip=false,clarification}:{skip?:boolean;clarification?:string}={}){
    if(!current.current)return;
    if(active?.instructionId){
      const text=(clarification??reply).trim();
      if(!text){setError('Add an answer or select an option.');return;}
      const payload={id:active.instructionId,answer:text};
      await run('Saving your answer...',async()=>{await save(false,payload);const saved=current.current!;apply({...saved,analyzedAnswers:textAnswers(saved.answers),pendingReply:undefined});setReply('');showQuestions(current.current!);});
      return;
    }
    if(active?.conflict&&!current.current.wizard?.resolutions[active.field]){setError('Choose the detail to use, or enter a correction.');return;}
    if(active){const value=current.current.answers[active.field]||'';const issue=validateScopeAnswer(active.field,value);if(!skip&&(issue||!value.trim())){setError(issue||'Add this detail, or choose Not sure yet.');return;}
      if(skip){if(active.field==='service'||active.conflict)return;const d=current.current;change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:[...new Set([...(d.wizard?.skipped||[]),active.field])]}});}}
    await run('Saving your answer...',async()=>{await save();const saved=current.current!;apply({...saved,analyzedAnswers:textAnswers(saved.answers)});setReply('');showQuestions(current.current!);});
  }
  const choose=(value:string)=>{
    if(!active||busyRef.current)return;engage();setError('');
    if(active.instructionId){setReply(value);change({pendingReply:{id:active.instructionId,answer:value}});logExchange(active,value);void advance({clarification:value});return;}
    answer(active.field,value);logExchange(active,readable(active.field,value));void advance();
  };
  const skipQuestion=()=>{if(!active||busyRef.current)return;engage();logExchange(active,'Not sure yet');void advance({skip:true});};
  /** Open one missing detail as a question, keeping every other answer. */
  const jumpToField=(field:ScopeField)=>{
    const d=current.current;if(!d)return;engage();
    change({wizard:{...d.wizard,resolutions:d.wizard?.resolutions||{},skipped:(d.wizard?.skipped||[]).filter(k=>k!==field)}});
    setActive(questionForField(field,d.answers));setMissingFields([]);setVerificationItems([]);setError('');setAddingDetails(false);
    apply({...current.current!,step:1});
  };
  async function downloadPdf(){await run('Preparing your PDF...',async()=>{const response=await operationFetch('/api/p5-estimator/pdf',{headers:draftHeaders(current.current!)});if(!response.ok)throw new Error('The PDF could not be downloaded. Your submission is saved; please retry.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`${brand.id}-project-summary.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
  const focusCorrection=(element:HTMLElement|null)=>requestAnimationFrame(()=>{if(!element)return;element.focus({preventScroll:true});scrollThread(element,'center');});
  async function submit(event:React.FormEvent){
    event.preventDefault();if(busyRef.current)return;if(draft?.step!==2){await begin();return;}
    // A file the reader could not finish is named here instead of silently re-running the read on every click; the visitor retries the read, removes the file, or prices the rest.
    if(current.current?.analysisWarning&&!filesRef.current.length&&(current.current.text||'')===(current.current.analyzedText||'')){setError('Some of your files could not be read, so they cannot be priced yet. Use Retry document reading, or remove the file to price the rest of your project.');return;}
    if(needsAnalysis()){await begin();return;}
    const d=current.current!;
    if(questions(d).length){showQuestions(d);return;}
    for(const [key,value]of Object.entries(d.answers)){const issue=validateScopeAnswer(key as ScopeField,value!);if(issue){setEditField(key as ScopeField);setError(`${SCOPE_FIELDS[key as ScopeField].label}: ${issue}`);requestAnimationFrame(()=>document.getElementById(`${id}-${key}`)?.focus());return;}}
    const invalidName=d.contact.name.trim().length<2;const invalidEmail=!EMAIL.test(d.contact.email);
    if(invalidName||invalidEmail){setValidationTarget('contact');setError(invalidName&&invalidEmail?'Enter your name and a valid email address to see your estimate.':invalidName?'Enter your name to see your estimate.':'Enter a valid email address to see your estimate.');focusCorrection(invalidName?contactNameRef.current:contactEmailRef.current);return;}
    if(!confirmed){setValidationTarget('confirmation');setError('Please confirm your project details before continuing.');focusCorrection(confirmationRef.current);return;}
    engage();
    await run('Preparing your estimate...',async()=>{
      trackScopeEvent('contactSubmitted',d.answers.service);const budget=operationBudget.current!;const saved=await save(true);
      const checkSubmission=()=>{if(operationBudget.current!==budget)throw new ProcessingDeadlineError();checkOperation();};
      let retry=!resuming.current;resuming.current=false;
      let data:any;
      try{
        data=await completeSubmission(()=>{checkSubmission();const shouldRetry=retry;retry=false;return operationFetch('/api/p5-estimator/submit',{method:'POST',headers:{...draftHeaders(current.current!),'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision,background:true,retry:shouldRetry})});},(message,detail)=>{checkSubmission();setBusy(message);track(detail);},undefined,budget.deadline);
      }catch(failure){
        const details=(failure as any)?.details;
        if(details?.pricingReviewRequired){setMissingFields(parseMissing(details.missingFields));setVerificationItems(parseItems(details.verificationItems));throw new Error(details.error||'A few more details are needed before pricing.');}
        throw failure;
      }
      checkSubmission();setResult(data.result);setDelivery(data.delivery||[]);if(data.result?.range)trackScopeEvent('estimateGenerated',d.answers.service);if(data.delivery?.some((v:any)=>v.channel==='customer'&&v.status==='sent'))trackScopeEvent('estimateEmailed',d.answers.service);setStatus('');
    },'pricing');
  }
  const continuePaused=()=>{const kind=paused?.kind;setPaused(null);resuming.current=true;if(kind==='pricing'){const form=document.getElementById(`${id}-form`) as HTMLFormElement|null;if(form)form.requestSubmit();else void begin();}else void begin();};
  const changeProjectText=(text:string)=>{
    const d=current.current;if(!d)return;
    if(!scopeTextChanged(displayScopeText(d.text,d.answers.estimatingInstructions),text)){
      change({text,answers:{...d.answers,estimatingInstructions:''}});return;
    }
    // Editing the visible scope is an ordinary additive change. Preserve
    // independent authored answers; only a deliberate replacement starts a
    // blank draft and archives the old project.
    change({...refreshAnalyzedScope(d,text),text});setReply('');setActive(null);setWarning('');setRecoveries(listBrowserDraftRecoveries(d.namespace));
  };
  const switchProject=async(recovery?:BrowserDraftRecovery)=>{
    if(busyRef.current||preparingFiles||!current.current)return;
    const d=current.current;
    if(!window.confirm(recovery?'Restore this saved project? Your current project will be kept in recovery.':'Start a new project with no previous answers or files? Your current project and files will be kept in recovery.'))return;
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
        if(saved.status==='submitted')throw new Error('This project was already submitted and cannot be edited. Its recovery is retained; start a new project instead.');
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
          }else next={...next,...saved,key:next.key,namespace:next.namespace,step:0,dirty:false,transcript:next.transcript} as BrowserDraft;
        }
      }
      filesRef.current=pending;setFiles(pending);setResult(null);setDelivery([]);setError('');setWarning('');setConfirmed(false);setReply('');setAddingDetails(false);setMissingFields([]);setVerificationItems([]);started.current=false;
      resume(next);setRecoveries(listBrowserDraftRecoveries(next.namespace));setStatus(recovery?'Saved project restored. Review it before continuing.':'New project started. Previous answers and uploaded files are not included.');
    });
  };
  /* ---- Composer -------------------------------------------------------- */
  const stage=result?3:draft?.step??0;
  const composerMode:'project'|'answer'|'edit'=stage===0?'project':stage===1?'answer':'edit';
  const composerText=draft?displayScopeText(draft.text,draft.answers.estimatingInstructions):'';
  const composerValue=composerMode==='project'?composerText:composerMode==='answer'?reply:editText;
  const setComposerValue=(value:string)=>{if(composerMode==='project')changeProjectText(value);else if(composerMode==='answer'){setReply(value);if(active?.instructionId)change({pendingReply:{id:active.instructionId,answer:value}});}else setEditText(value);};
  /** Fold a longer remark into the project description and read it again, keeping every answer. */
  const addToProject=(text:string)=>{
    const d=current.current!;const combined=`${displayScopeText(d.text,d.answers.estimatingInstructions)}\n\n${text}`.trim();
    changeProjectText(combined);setReply('');pendingUserMessage.current={text,files:filesRef.current.map(f=>f.name),caption:'Added to your project'};void begin();
  };
  const send=()=>{
    const d=current.current;if(!d||busyRef.current||preparingFiles)return;engage();setError('');
    if(composerMode==='answer'&&active){
      const text=reply.trim();
      if(!text){if(filesRef.current.length){addToProject('');return;}setError('Type an answer, choose an option, or tap Not sure yet.');return;}
      if(active.instructionId){logExchange(active,text);void advance({clarification:text});return;}
      const definition=SCOPE_FIELDS[active.field];
      if(definition.kind==='choice'){
        const match=coerceChoice(active.field,text)||active.values?.find(v=>v.toLowerCase()===text.toLowerCase()||readable(active.field,v).toLowerCase()===text.toLowerCase());
        if(match){answer(active.field,match);logExchange(active,readable(active.field,match));void advance();return;}
        if(text.length>40||filesRef.current.length){addToProject(text);return;}
        setError('Choose one of the options above, or describe the change to your project in a full sentence.');return;
      }
      if(definition.kind==='number'){
        const issue=validateScopeAnswer(active.field,text);
        if(!issue){answer(active.field,text);logExchange(active,text);void advance();return;}
        if(text.length>40||filesRef.current.length){addToProject(text);return;}
        setError(issue);return;
      }
      if(active.conflict&&active.values?.length){answer(active.field,text);logExchange(active,text);void advance();return;}
      answer(active.field,text);logExchange(active,text);void advance();return;
    }
    if(composerMode==='edit'){
      const text=editText.trim();
      if(text&&scopeTextChanged(composerText,text)){changeProjectText(text);pendingUserMessage.current={text,files:filesRef.current.map(f=>f.name),caption:'Updated project'};}
      else pendingUserMessage.current=filesRef.current.length?{text:'',files:filesRef.current.map(f=>f.name),caption:'Added files'}:null;
      setAddingDetails(false);void begin();return;
    }
    const hasScope=(d.transcript||[]).some(e=>e.kind==='scope');
    pendingUserMessage.current={text:composerText,files:[...(d.uploads||[]).map(f=>f.name),...filesRef.current.map(f=>f.name)],caption:hasScope?'Updated project':undefined};
    void begin();
  };
  const composerKey=(event:React.KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing)return;
    // Enter sends on a keyboard-and-mouse device; on touch devices Enter adds a line and the send control submits.
    if(typeof window.matchMedia==='function'&&!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
    event.preventDefault();if(canSend)send();
  };
  /* ---- Stage scrolling ------------------------------------------------- */
  const stageKey=draft?`${stage}:${active?.instructionId||active?.field||''}:${result?'result':''}:${expanded}`:'';
  const lastStage=useRef('');
  const working=Boolean(busy)||preparingFiles;
  useLayoutEffect(()=>{
    // Each distinct stage or question starts with its heading in view once the
    // work that produced it has finished; typing, autosave and ordinary
    // re-renders never move the conversation.
    if(!draft||!stageKey||working||stageKey===lastStage.current)return;lastStage.current=stageKey;
    const position=()=>{const target=stageRef.current;if(target){positionThread(target);(target.querySelector('[data-stage-heading]') as HTMLElement|null)?.focus({preventScroll:true});}else threadRef.current?.scrollTo({top:0});};
    position();requestAnimationFrame(position);
  },[stageKey,working,Boolean(draft)]);
  const sentMessageRef=useRef(false);
  useEffect(()=>{
    // After the visitor sends a message the conversation shows that message and the progress card beneath it.
    if(!busy||!sentMessageRef.current)return;sentMessageRef.current=false;
    requestAnimationFrame(()=>{const last=threadRef.current?.querySelector<HTMLElement>('[data-last-user]');if(last)scrollThread(last,'start');});
  },[busy]);
  useEffect(()=>{if(error&&!missingFields.length){const el=threadRef.current?.querySelector<HTMLElement>('[role=alert]');if(el)requestAnimationFrame(()=>scrollThread(el,'center'));}},[error]);
  useEffect(()=>{if(addingDetails){setEditText(composerText);requestAnimationFrame(()=>composerRef.current?.focus());}},[addingDetails]);
  if(!draft)return <div ref={rootRef} className={styles.root} data-p5-estimator data-theme={theme.mode} data-layout={layout} style={estimatorThemeStyle(theme) as React.CSSProperties} role="status"><div className={styles.loading}>Loading your project...</div></div>;
  const attachedProjectSource=projectSource&&!draft.sourceDetached?projectSource:undefined;
  const known=Object.keys(draft.answers).filter(k=>k!=='estimatingInstructions'&&draft.answers[k as ScopeField]?.trim()) as ScopeField[];
  const knownGroups=[...new Set(known.map(fieldCategory))].map(title=>({title,fields:known.filter(k=>fieldCategory(k)===title)}));
  const uploadedCount=draft.uploads?.length||0;
  const contactReady=draft.contact.name.trim().length>=2&&EMAIL.test(draft.contact.email);
  const submitErrorId=`${id}-submit-error`;const formId=`${id}-form`;
  const transcript=draft.transcript||[];
  const hasProgress=transcript.length>0||draft.step>0||Boolean(result)||uploadedCount>0;
  const locked=Boolean(busy)||preparingFiles;
  const canSend=!locked&&(composerMode==='project'?Boolean(composerText.trim()||files.length||uploadedCount||attachedProjectSource):composerMode==='answer'?Boolean(reply.trim()||files.length):Boolean(editText.trim()||files.length));
  const customerDelivery=delivery.find(d=>d.channel==='customer');
  const deliveryState=!delivery.length?'pending':delivery.every(d=>d.status==='sent')?'sent':delivery.some(d=>d.status==='needs-review')?'review':'pending';
  const assumptions=scopeAssumptions(draft.answers,draft.wizard?.skipped);
  const lastUserIndex=transcript.map(e=>e.role).lastIndexOf('user');
  const exit=()=>{if(layout==='embedded'){setExpanded(false);return;}if(onExit){onExit();return;}if(window.history.length>1)window.history.back();else window.location.assign('/');};
  const back=()=>{const d=current.current;if(!d||busyRef.current)return;setError('');if(d.step===2){const remaining=questions(d);if(remaining.length){setActive(remaining[0]);apply({...d,step:1});}else apply({...d,step:0});}else if(d.step===1){setActive(null);apply({...d,step:0});}};
  const field=(key:ScopeField)=>{const definition=SCOPE_FIELDS[key];const value=draft?.answers[key]||'';const fieldId=`${id}-${key}`;
    return <div key={key} className={styles.field}><label htmlFor={fieldId}>{definition.label}</label>{definition.kind==='choice'?<select id={fieldId} value={value} onChange={e=>answer(key,e.target.value)}><option value="">Choose an answer</option>{definition.options.filter(v=>key!=='service'||(brand.services as readonly string[]).includes(v)).map(v=><option key={v} value={v}>{readable(key,v)}</option>)}</select>:definition.kind==='number'?<input id={fieldId} inputMode="decimal" value={value} onChange={e=>answer(key,e.target.value)} placeholder="Approximate is fine"/>:<textarea id={fieldId} rows={3} value={value} onChange={e=>answer(key,e.target.value)} />}</div>;};
  const composer=<div className={styles.composer} data-dragging={dragging} onDragEnter={e=>{e.preventDefault();setDragging(true);}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);void addFiles(e.dataTransfer.files);}}>
    <label htmlFor={`${id}-scope`} className={styles.srOnly}>{composerMode==='answer'?'Your answer':'Tell us about your project'}</label>
    {Boolean(files.length||(composerMode!=='answer'&&uploadedCount))&&<ul className={styles.chips} aria-label="Project files">
      {composerMode!=='answer'&&draft.uploads?.map(f=><li key={f.id} className={styles.chip}><FileGlyph/><span className={styles.chipText}><span>{f.name}</span><small>Saved</small></span></li>)}
      {files.map((f,i)=><li key={`${f.name}-${i}`} className={styles.chip}><FileGlyph/><span className={styles.chipText}><span>{f.name}</span><small>Ready</small></span><button type="button" className={styles.chipRemove} aria-label={`Remove ${f.name}`} onClick={async()=>{const next=filesRef.current.filter((_,index)=>i!==index);filesRef.current=next;setFiles(next);try{await cacheFiles(draft.id,next);}catch{setStatus('File removed from this session. Local storage could not be updated.');}}}><span aria-hidden="true">×</span></button></li>)}
    </ul>}
    <textarea ref={composerRef} id={`${id}-scope`} className={styles.composerText} rows={composerMode==='answer'?1:2} value={composerValue} onChange={e=>setComposerValue(e.target.value)} onKeyDown={composerKey} disabled={locked} placeholder={composerMode==='answer'?'Type your answer':composerMode==='edit'?'Edit your project description or add details':composerPlaceholder}/>
    <div className={styles.composerBar}>
      <div className={styles.composerTools}>
        <button type="button" className={styles.iconBtn} aria-label="Attach files" title="Attach plans, photos, estimates or documents" disabled={locked} onClick={()=>fileInput.current?.click()}><AttachGlyph/></button>
        <input ref={fileInput} id={`${id}-files`} className={styles.srOnly} type="file" accept={accept} multiple tabIndex={-1} aria-label="Upload project files" onChange={e=>{const input=e.currentTarget;const selected=Array.from(input.files||[]);void addFiles(selected).then(()=>{input.value='';});}}/>
        {speechAvailable&&<button type="button" className={styles.iconBtn} data-listening={listening} aria-pressed={listening} aria-label={listening?'Stop listening':'Talk instead'} title={listening?'Stop listening':'Talk instead'} disabled={locked} onClick={speak}><MicGlyph/></button>}
        <span className={styles.composerHint}>{dragging?'Drop files to add them':locked?'Working on your project':'Type, talk, or attach files'}</span>
      </div>
      <button type="button" className={styles.send} aria-label={composerMode==='answer'?'Send answer':'Continue'} title={composerMode==='answer'?'Send answer':'Continue'} onClick={()=>{sentMessageRef.current=true;send();}} disabled={!canSend}><span aria-hidden="true">↑</span></button>
    </div>
  </div>;
  const knownDetails=known.length>0&&<div>
    <p className={styles.sectionLabel} style={{marginTop:0}}>Your project details</p>
    {knownGroups.map(group=><details key={group.title} className={styles.accordion} open={group.title==='Project at a glance'||group.fields.includes(editField as ScopeField)}>
      <summary><span className={styles.accordionTitle}>{group.title}</span><span className={styles.accordionMeta}>{group.fields.length} {group.fields.length===1?'detail':'details'}</span></summary>
      <div className={styles.accordionBody}><dl className={styles.rows}>{group.fields.map(k=><div key={k}><dt>{SCOPE_FIELDS[k].label}</dt><dd>{editField===k?<div>{field(k)}<button type="button" className={styles.secondary} onClick={()=>{const issue=validateScopeAnswer(k,draft.answers[k]||'');if(issue){setError(issue);return;}setEditField('');setError('');log(newEntry('user',`Changed ${SCOPE_FIELDS[k].label.toLowerCase()} to ${readable(k,draft.answers[k]||'')}`,{kind:'note'}));}}>Done</button></div>:readable(k,draft.answers[k]!)}</dd>{editField!==k&&<button type="button" className={styles.iconButton} aria-label={`Edit ${SCOPE_FIELDS[k].label}`} onClick={()=>setEditField(k)}>Edit</button>}</div>)}</dl></div>
    </details>)}
  </div>;
  const pausedCard=paused&&<section className={styles.notice} role="status" aria-live="polite">
    <h3>{paused.kind==='analysis'?'Still reading your project':'Still preparing your estimate'}</h3>
    <p>{paused.processing?.totalPages?`${Math.min(paused.processing.totalPages,paused.processing.readPages||0)} of ${paused.processing.totalPages} pages are checked so far. `:''}This is taking longer than the usual minute. Your completed work is saved and processing continues in the background; this page checks every few seconds and will show the result as soon as it is ready.</p>
    <div className={styles.actions}><button type="button" className={styles.primary} onClick={continuePaused}>Keep going</button><button type="button" className={styles.ghost} onClick={()=>setPaused(null)}>Come back later</button></div>
  </section>;
  const alertCard=error&&<div id={submitErrorId} className={styles.alert} role="alert" aria-live="assertive">
    {missingFields.length>0||verificationItems.length>0?<><h3>A few more details are needed</h3><p>{error}</p>
      {verificationItems.length>0&&<ul>{verificationItems.map(item=><li key={item}>{item}</li>)}</ul>}
      {missingFields.length>0&&<ul className={styles.missingList}>{missingFields.map(m=><li key={m.field}><button type="button" className={styles.secondary} onClick={()=>jumpToField(m.field)}><span>{m.label}</span><span aria-hidden="true">→</span></button></li>)}</ul>}
    </>:<p>{error}</p>}
  </div>;
  const warningCard=warning&&!busy&&<div className={styles.notice}><p>{warning}</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={()=>{engage();void run('Reading your saved documents...',analyze,'analysis');}}>Retry document reading</button></div></div>;
  const intro=<Message role="assistant">
    <div className={styles.stageHeading} ref={stage===0?(el=>{stageRef.current=el;}):undefined}>
      <Heading tabIndex={-1} data-stage-heading className={styles.title}>{attachedProjectSource?'Your design is ready to estimate':hasProgress?'Your project estimate':'Let’s estimate your project'}</Heading>
      <p className={styles.lead}>{attachedProjectSource?'Your design selections are included. Add anything else, then send it.':'Describe the work in your own words, or attach plans, photos and documents. I will ask only about what is missing, then show your planning range.'}</p>
    </div>
    {attachedProjectSource&&knownDetails}
    {!hasProgress&&!composerText.trim()&&!files.length&&<div className={styles.suggestions} aria-label="Example projects">{(SUGGESTIONS[brandId]||SUGGESTIONS.p5).map(text=><button key={text} type="button" className={styles.suggestion} onClick={()=>{changeProjectText(text);composerRef.current?.focus();}}>{text}</button>)}</div>}
    {recoveries.length>0&&!hasProgress&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Saved project recovery</span><span className={styles.accordionMeta}>{recoveries.length}</span></summary><div className={styles.accordionBody}><ul className={styles.bullets} style={{listStyle:'none',paddingLeft:0}}>{recoveries.map(recovery=><li key={recovery.key}><button type="button" className={styles.secondary} onClick={()=>void switchProject(recovery)}>Restore {recovery.draft.text.slice(0,65)||'untitled project'}</button><details><summary className={styles.hint}>View saved details</summary><p style={{whiteSpace:'pre-wrap'}}>{displayScopeText(recovery.draft.text,recovery.draft.answers.estimatingInstructions)}</p><dl className={styles.rows}>{Object.entries(recovery.draft.answers).filter(([key])=>key!=='estimatingInstructions').map(([key,value])=><div key={key}><dt>{SCOPE_FIELDS[key as ScopeField]?.label||key}</dt><dd>{value}</dd></div>)}</dl>{recovery.draft.uploads?.map(file=><p key={file.id} className={styles.hint}>{file.name}</p>)}</details></li>)}</ul></div></details>}
  </Message>;
  const history=transcript.map((entry,index)=><Message key={entry.id} role={entry.role} last={index===lastUserIndex}>
    {entry.role==='assistant'&&entry.kind==='question'&&entry.label&&<p className={styles.eyebrow}>{entry.label}</p>}
    {entry.caption&&<p className={styles.eyebrow} style={{color:'inherit',opacity:.7}}>{entry.caption}</p>}
    {entry.text&&<p className={styles.msgText}>{entry.text}</p>}
    {entry.files&&entry.files.length>0&&<ul className={styles.files} aria-label="Attached files">{entry.files.map((name,i)=><li key={name+i}><FileGlyph/>{name}</li>)}</ul>}
    {entry.kind==='ack'&&draft.step===1&&index===transcript.length-1&&known.length>0&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>What I captured so far</span><span className={styles.accordionMeta}>{known.length} {known.length===1?'detail':'details'}</span></summary><div className={styles.accordionBody}><dl className={styles.rows}>{known.map(k=><div key={k}><dt>{SCOPE_FIELDS[k].label}</dt><dd>{readable(k,draft.answers[k]!)}</dd></div>)}</dl></div></details>}
  </Message>);
  const questionStage=draft.step===1&&!busy&&!preparingFiles&&<Message role="assistant">
    {!active&&warningCard}
    {active?<section key={active.instructionId||active.field} ref={el=>{stageRef.current=el;}} className={styles.question} aria-label="Project question">
      <p className={styles.eyebrow}>{active.label}</p><h2 tabIndex={-1} data-stage-heading>{active.reason}</h2>
      {active.detail&&<details className={styles.context}><summary className={styles.hint}>Why we ask</summary><p className={styles.hint}>{active.detail}</p></details>}
      {warningCard}
      {active.values?.length?<div className={styles.choices} role="group" aria-label="Suggested answers">{active.values.map(value=><button type="button" className={styles.choice} key={value} onClick={()=>choose(value)} aria-pressed={(active.instructionId?reply:draft.answers[active.field])===value}>{active.instructionId?value:readable(active.field,value)}</button>)}</div>:null}
      {alertCard}
      <div className={styles.questionActions}>
        {active.field!=='service'&&!active.conflict&&!active.instructionId&&<button type="button" className={styles.secondary} onClick={skipQuestion}>Not sure yet</button>}
        <span className={styles.hint}>{active.values?.length?'Choose an option, or type an answer below.':'Type your answer below and send it.'}</span>
      </div>
    </section>:<div ref={el=>{stageRef.current=el;}} className={styles.card}><h3 tabIndex={-1} data-stage-heading>Your details are complete.</h3><p className={styles.hint}>Review your project and add where to send your estimate.</p><div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>{engage();showQuestions(current.current!);}}>Review your project <span aria-hidden="true">→</span></button></div></div>}
  </Message>;
  const reviewStage=draft.step===2&&!result&&!busy&&!preparingFiles&&<Message role="assistant">
    <div className={styles.stageHeading} ref={el=>{stageRef.current=el;}}>
      <h2 tabIndex={-1} data-stage-heading>Review your project</h2>
      <p className={styles.lead}>Here is what I captured. Check it, correct anything that is off, then add where to send your estimate.</p>
    </div>
    <div className={styles.card}>
      <div className={styles.cardHead}><h3>Project summary</h3><span className={styles.badge} data-kind="included">Captured</span></div>
      <dl className={styles.summaryRows}>
        <div><dt>Project</dt><dd>{draft.answers.service?readable('service',draft.answers.service):'Not set'}</dd></div>
        {draft.answers.location&&<div><dt>Location</dt><dd>{draft.answers.location}</dd></div>}
        {draft.answers.sqft&&<div><dt>Area</dt><dd>{Number(draft.answers.sqft.replaceAll(',','')).toLocaleString('en-US')} sq ft</dd></div>}
        {draft.answers.finish&&<div><dt>Finish</dt><dd>{readable('finish',draft.answers.finish)}</dd></div>}
        <div><dt>Details saved</dt><dd>{known.length}</dd></div>
        <div><dt>Files</dt><dd>{uploadedCount?`${uploadedCount} uploaded`:'None'}</dd></div>
      </dl>
      {draft.extraction?.summary&&<p className={styles.hint} style={{marginTop:12}}>{draft.extraction.summary.slice(0,280)}{draft.extraction.summary.length>280?'…':''}</p>}
    </div>
    {warningCard}
    {(draft.extraction?.instructions||draft.extraction?.documentCoverage)&&<div><P5EstimateDetails result={{instructions:draft.extraction.instructions,documentCoverage:draft.extraction.documentCoverage}} openFirst={false} showGlance={false}/></div>}
    {assumptions.length>0&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Assumptions and details to confirm</span><span className={styles.badge} data-kind="assumption">To confirm</span><span className={styles.accordionMeta}>{assumptions.length}</span></summary><div className={styles.accordionBody}><ul className={styles.bullets}>{assumptions.map(note=><li key={note}>{note}</li>)}</ul></div></details>}
    {knownDetails}
    <div className={styles.card} id={`${id}-contact`}>
      <div className={styles.cardHead}><h3>Where should we send your estimate?</h3></div>
      <p className={styles.hint} style={{marginBottom:12}}>Your name and email are required to view your estimate. Phone is optional.</p>
      <div className={styles.contactGrid}>{([['name','Your name','text'],['email','Email','email'],['phone','Phone','tel']] as const).map(([key,label,type])=><label className={styles.field} key={key} htmlFor={`${id}-contact-${key}`}><span>{label} {key==='phone'?<span className={styles.optional}>(optional)</span>:null}</span><input id={`${id}-contact-${key}`} ref={key==='name'?contactNameRef:key==='email'?contactEmailRef:undefined} type={type} autoComplete={key} required={key!=='phone'} aria-invalid={validationTarget==='contact'&&key!=='phone'&&(key==='name'?draft.contact.name.trim().length<2:!EMAIL.test(draft.contact.email))?true:undefined} aria-describedby={validationTarget==='contact'&&key!=='phone'?submitErrorId:undefined} value={draft.contact[key]} onChange={e=>{changeContact(key,e.target.value);if(validationTarget==='contact')setValidationTarget('');}} maxLength={key==='name'?120:key==='email'?200:40}/></label>)}</div>
      <label className={styles.check} data-invalid={validationTarget==='confirmation'&&!confirmed?true:undefined}><input ref={confirmationRef} type="checkbox" required checked={confirmed} aria-invalid={validationTarget==='confirmation'&&!confirmed?true:undefined} aria-describedby={validationTarget==='confirmation'?submitErrorId:undefined} onChange={e=>{setConfirmed(e.target.checked);if(e.target.checked){setValidationTarget('');setError('');}}}/><span>These details reflect my project. I understand this is a preliminary estimate, subject to confirmed scope, selections and site conditions.</span></label>
    </div>
    {pausedCard}{alertCard}
    <p className={styles.hint}>Need to change something? Use <b>Add or edit details</b> below to update your description or attach more files. Your answers are kept.</p>
  </Message>;
  const resultStage=result&&<Message role="assistant">
    <div className={styles.stageHeading} ref={el=>{stageRef.current=el;}}>
      <h2 tabIndex={-1} data-stage-heading>Your project summary</h2>
      <p className={styles.lead}>Here is your preliminary planning range and everything it covers.</p>
    </div>
    <div className={styles.rangeCard}><p className={styles.eyebrow}>{result.range?'Preliminary planning range':'Status'}</p><h2>{result.range?`${result.range.low.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})} to ${result.range.high.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`:"Your scope is ready for pricing review"}</h2><p>{result.message}</p></div>
    <p className={styles.delivery} role="status" data-state={deliveryState}>{deliveryState==='sent'?`Your summary was emailed to ${draft.contact.email} and the team has your record.`:deliveryState==='review'?'Your estimate is saved. The email could not be delivered automatically, so the team will check it and follow up. You do not need to submit again; you can download the summary below.':customerDelivery?`Your estimate is saved. We are sending a copy to ${draft.contact.email}.`:'Your estimate is saved. We are sending a copy to your email.'}</p>
    <P5EstimateDetails result={result}/>
    <div className={styles.card}><h3>Recommended next step</h3><p>{result.nextStep}</p><div className={styles.resultActions}><a className={styles.primary} href={brand.consultationPath} onClick={()=>trackScopeEvent("onsiteRequested",draft.answers.service)}>Schedule a consultation</a><a className={styles.secondary} href="tel:+12084771169">Call {brand.phone}</a></div></div>
    <p className={styles.disclaimer}>{result.disclaimer}</p>
    {alertCard}
    <div className={styles.actions}><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start another project</button></div>
  </Message>;
  const processingStage=(busy||preparingFiles)&&<Message role="assistant"><P5ProcessingStatus message={preparingFiles?'Preparing your files...':busy} processing={preparingFiles?null:processing} uploadPercent={uploadPercent} onPause={busy?()=>operationBudget.current?.controller.abort(new ProcessingDeadlineError()):undefined}/></Message>;
  const stepLabel=result?'Estimate ready':`Step ${draft.step+1} of 3 · ${STEP_LABELS[draft.step]}`;
  const showBack=!result&&!busy&&draft.step>0;
  const collapsedWithProgress=layout==='embedded'&&!expanded&&hasProgress;
  const dock=locked&&stage!==2&&stage!==3?<div className={styles.dockHint} role="status">Working on your project. Your progress is saved.</div>
    :stage===3?<div className={styles.dockBar}><a className={styles.primary} href={brand.consultationPath} onClick={()=>trackScopeEvent("onsiteRequested",draft.answers.service)}>Schedule a consultation</a><button type="button" className={styles.secondary} onClick={downloadPdf} disabled={locked}>Download PDF</button></div>
    :stage===2?<>{addingDetails&&composer}<div className={styles.dockBar}><button type="submit" form={formId} className={styles.primary} disabled={locked} aria-describedby={error?submitErrorId:undefined}>{busy?'Preparing your estimate…':'Get my estimate'}</button></div><div className={styles.dockRow}><span className={styles.dockHint}>{contactReady&&confirmed?'Your estimate opens right here and is emailed to you.':'Add your name and email above, then confirm your details.'}</span><button type="button" className={styles.ghost} disabled={locked} onClick={()=>setAddingDetails(v=>!v)} aria-expanded={addingDetails}>{addingDetails?'Cancel editing':'Add or edit details'}</button></div></>
    :<>{composer}{stage===0&&<p className={styles.dockHint}>PDF, images, Word, spreadsheets and text. Instructions such as “price only the trim” or “exclude plumbing” are followed throughout.</p>}</>;
  return <div ref={rootRef} role="region" aria-label="Project estimator" className={styles.root} data-p5-estimator data-version={ESTIMATOR_VERSION} data-theme={theme.mode} data-layout={layout} data-expanded={frameActive?'true':undefined} data-step={stage} aria-busy={Boolean(busy)} style={{...(estimatorThemeStyle(theme) as React.CSSProperties),'--p5-top':`${topInset}px`,'--p5-bottom':`${bottomInset}px`} as React.CSSProperties}>
    <form id={formId} className={styles.app} onSubmit={submit} noValidate>
      <div className={styles.topbar}>
        {showBack?<button type="button" className={styles.navBtn} onClick={back} aria-label="Back to the previous step"><BackGlyph/><span data-label>Back</span></button>:<span className={styles.navSpacer} aria-hidden="true"/>}
        <div className={styles.topCenter}><span className={styles.brandLine}>{brand.name} · Project estimator</span><span className={styles.stepPill}>{stepLabel}</span></div>
        {frameActive?<button type="button" className={styles.navBtn} onClick={exit} aria-label={layout==='embedded'?'Exit full screen. Your progress is saved.':'Exit the estimator. Your progress is saved.'}><span data-label>Exit</span><CloseGlyph/></button>:<span className={styles.navSpacer} aria-hidden="true"/>}
      </div>
      {!result&&<div className={styles.rail} aria-hidden="true">{STEP_LABELS.map((label,index)=><span key={label} data-state={index===draft.step?'current':index<draft.step?'done':'upcoming'}/>)}</div>}
      <p className={styles.srOnly} aria-live="polite">{stepLabel}</p>
      <div ref={threadRef} className={styles.thread}>
        <div className={styles.threadInner}>
          {collapsedWithProgress?<Message role="assistant">
            <div className={styles.stageHeading}><Heading tabIndex={-1} className={styles.title}>{result?'Your estimate is ready':'Continue your estimate'}</Heading><p className={styles.lead}>{result?'Your planning range and project summary are saved on this device.':`Your project is saved on this device: ${known.length} ${known.length===1?'detail':'details'}${uploadedCount?` and ${uploadedCount} ${uploadedCount===1?'file':'files'}`:''}. ${stepLabel}.`}</p></div>
            <div className={styles.actions}><button type="button" className={styles.primary} onClick={()=>setExpanded(true)}>{result?'Open my estimate':'Continue'} <span aria-hidden="true">→</span></button><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start a new project</button></div>
          </Message>:<>
            {intro}
            {history}
            {stage===0&&!busy&&!preparingFiles&&<>{pausedCard&&<Message role="assistant">{pausedCard}</Message>}{(warning||error)&&<Message role="assistant">{warningCard}{alertCard}</Message>}</>}
            {questionStage}
            {reviewStage}
            {resultStage}
            {processingStage}
            {paused&&stage!==0&&!busy&&<Message role="assistant">{pausedCard}</Message>}
            {status&&!busy&&!preparingFiles&&!error&&<p className={styles.status} role="status">{status}</p>}
            {hasProgress&&!result&&!busy&&<div className={styles.actions} style={{marginTop:0}}><button type="button" className={styles.ghost} onClick={()=>void switchProject()}>Start a different project</button></div>}
          </>}
        </div>
      </div>
      {!collapsedWithProgress&&<div className={styles.dock}><div className={styles.dockInner}>{dock}</div></div>}
    </form>
  </div>;
}
