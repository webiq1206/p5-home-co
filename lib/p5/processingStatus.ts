import {bannedCustomerCopy} from './customerCopy.ts';
/** Public progress describes completed work and current operations, never model
 * reasoning, internal costs, invented completion percentages or guessed ETAs. */
export interface ProcessingStatus {
  inputKind?:'text'|'documents';
  phase:'queued'|'preparing'|'instructions'|'reading'|'cross-referencing'|'inventory'|'mapping'|'research'|'verification'|'retrying';
  message:string;
  updatedAt:string;
  startedAt?:string;
  readPages?:number;
  totalPages?:number;
  readSections?:number;
  totalSections?:number;
  currentItems?:string[];
  /** File/section names that are saved but still need retry or review. */
  failedItems?:string[];
  remainingItems?:number;
  /** Stages finished in this pricing run. There is no honest total - the
   * number of research batches and repair rounds is not known in advance - so
   * this counts up rather than filling a bar. */
  completedSteps?:number;
  /** When the CURRENT stage began, so the interface can show that this step is
   * still running instead of a total elapsed time that says nothing about
   * whether anything is happening. */
  stageStartedAt?:string;
}
export const processingTitles:Record<ProcessingStatus['phase'],string>={
  queued:'Getting your estimate started',preparing:'Preparing your documents',instructions:'Reading your estimating instructions',
  reading:'Reading your documents', 'cross-referencing':'Checking quantities',inventory:'Organizing the requested scope',
  mapping:'Preparing your estimate',research:'Preparing your estimate',verification:'Checking your estimate',retrying:'Recovering an interrupted step',
};
export function analysisMessage(hasAttachments:boolean,event:'start'|'busy'|'error'|'retry'='start'){
  if(event==='busy')return hasAttachments?'Your document review is already running. Saved progress will appear shortly.':'Your scope review is already running. Saved progress will appear shortly.';
  if(event==='error')return hasAttachments?'Your files could not be processed. They are still here. Please retry.':'Your project details could not be processed. They are saved. Please retry.';
  if(event==='retry')return hasAttachments?'Reviewing your saved documents...':'Reviewing your saved project details...';
  return hasAttachments?'Reading your documents and project details...':'Understanding your project...';
}
export function analysisAcknowledgement(captured:number,attachments:number,warning:boolean,remaining:number){
  const saved=`Thanks. I read ${attachments?`${attachments} ${attachments===1?'file':'files'} and `:''}your description and saved ${captured} project ${captured===1?'detail':'details'}.`;
  const next=warning
    ?attachments?'Some files still need review; see the note below.':'I could not finish reading your description; your text is saved. See the note below.'
    :remaining?`I have ${remaining===1?'one quick question':`${remaining} quick questions`} before your estimate.`
    :'That is everything I need. Review your project below, then add where to send your estimate.';
  return `${saved} ${next}`;
}
/** Explicit input context prevents stale or legacy document labels on text-only work. */
export function processingPresentation(message:string,processing:ProcessingStatus|null|undefined,uploadPercent:number|null,hasAttachments?:boolean){
  const documents=hasAttachments??(processing?.inputKind?processing.inputKind==='documents':Boolean(processing?.totalPages));
  const uploading=uploadPercent!==null;
  const total=documents?Math.max(0,processing?.totalPages||0):0;
  const read=Math.max(0,Math.min(total,processing?.readPages||0));
  const analysis=Boolean(processing&&['preparing','instructions','reading','cross-referencing'].includes(processing.phase));
  const staleDocumentMessage=!documents&&/\b(?:documents?|drawings?|files?|pages?|plans?)\b/i.test(message);
  const title=uploading?'Saving your files':processing?(!documents&&analysis?(processing.phase==='cross-referencing'?'Checking your scope and quantities':'Understanding your project'):processingTitles[processing.phase]):staleDocumentMessage?'Understanding your project':message.replace(/\.+$/,'');
  const detail=uploading?'Keep this tab open until your files are saved.':!documents&&analysis?'Checking your description, quantities and requested work.':total&&read<total?'Checking dimensions, notes and included work on each page.':processing?.phase==='retrying'?'Your progress is saved while the connection recovers.':processing?.message||'Checking your scope so we only ask about what is missing.';
  return {title,detail,total,read,uploading};
}
/** Item names shown on the progress card. Allowance stages carry the
 * estimator's own instructions to the pricing model rather than the customer's
 * wording, so they show no items; anything else that reads like an internal
 * instruction or a cost basis is withheld too. */
export function customerProgressItems(items:(string|undefined)[]):string[]{
  return items.filter((item):item is string=>Boolean(item)&&!bannedCustomerCopy(item!)&&!/^(?:PUBLIC|PRIVATE|Research|Obtain|Find|Determine)\b|direct[- ]cost|\brates?\b|\bper (?:square|linear) foot\b/i.test(item!)).slice(0,3);
}
export function pricingActivity(instructions:string,input:unknown,search:boolean):ProcessingStatus{
  const data=input as {taskBatch?:{description:string}[];tasks?:{description:string}[];repairInstruction?:string};
  const phase=search?'research':instructions.startsWith('Inventory')?'inventory':instructions.startsWith('You are a construction estimator')?'mapping':instructions.startsWith('Convert the supplied research')?'research':'verification';
  const message=phase==='inventory'?'Identifying the included work, exclusions and item-level quantities.':phase==='mapping'?(data.repairInstruction?'Checking your estimate against your project details.':'Pricing the quantities, materials and labor in your scope.'):phase==='research'?'Working out budget allowances for the items that need one.':'Checking for missing items, duplicate counts and your exclusions.';
  return {phase,message,updatedAt:new Date().toISOString(),currentItems:customerProgressItems(phase==='research'?[]:(data.taskBatch||[]).map(t=>t.description))};
}
export function elapsedLabel(seconds:number){
  const total=Math.max(0,Math.floor(seconds));
  return total<60?`${total}s elapsed`:`${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s elapsed`;
}

/**
 * What the customer actually provided, so progress names only materials that exist (owner rule
 * 2026-09-22): a typed or dictated description never mentions uploads, photos are "photos", and a PDF
 * is "plans" only when the reader reports drawing sheets, "specifications" only when it is named so.
 */
export interface ProjectMaterials {text:boolean;photos:number;documents:number;specifications:number}
export function projectMaterials(files:readonly {name:string;type?:string}[],text=''):ProjectMaterials{
  const photos=files.filter(f=>/^image\//i.test(f.type||'')||/\.(?:jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)).length;
  const docs=files.filter(f=>!(/^image\//i.test(f.type||'')||/\.(?:jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)));
  return {text:Boolean(text.trim()),photos,documents:docs.length,specifications:docs.filter(f=>/\bspec(?:ification)?s?\b|project manual/i.test(f.name)).length};
}
const DRAWING_ITEM=/detail regions|detail views|supplied whole|\bsheet\b/i;
/** The heading for the stage that is actually running, in the customer's terms. */
export function stageTitle(processing:ProcessingStatus|null|undefined,materials:ProjectMaterials|null|undefined):string{
  if(!processing)return 'Getting your estimate started';
  const m=materials||{text:true,photos:0,documents:0,specifications:0};
  switch(processing.phase){
    case 'queued':return 'Getting your estimate started';
    case 'preparing':case 'instructions':case 'reading':{
      if(!m.photos&&!m.documents)return 'Reviewing your project details';
      const items=processing.currentItems||[];
      if(items.some(i=>DRAWING_ITEM.test(i)))return 'Reviewing your plans';
      if(m.photos&&!m.documents)return 'Reviewing your photos';
      if(m.specifications&&m.specifications===m.documents&&!m.photos)return 'Reviewing your specifications';
      if(m.photos&&items.some(i=>/\.(?:jpe?g|png|heic|heif|webp|gif)\b/i.test(i)))return 'Reviewing your photos';
      return 'Reviewing your documents';
    }
    case 'cross-referencing':return 'Calculating quantities';
    case 'inventory':return 'Building the scope of work';
    case 'mapping':case 'research':return 'Applying pricing';
    case 'verification':return 'Checking your estimate';
    case 'retrying':return 'Recovering an interrupted step';
  }
  return processingTitles[processing.phase]||'Working on your project';
}
/**
 * An honest time range for what is left, from the actual workload and the timings measured on the live
 * sites (2026-09-21/22 benchmarks: text pages about 10 s each read 12 at a time, drawing tiles about
 * 40 s each six at a time, pricing 1 to 4 minutes by scope size). It is recomputed from the stage and
 * the pages still unread on every update, never a fixed countdown; past its high end it says so.
 */
/** What each pricing phase costs, low and high seconds. One table, so the whole-job estimate below
 * cannot drift from the per-phase one. */
const PRICING_PHASE_COST=(docs:boolean):Record<string,[number,number]>=>({queued:[5,15],inventory:docs?[20,60]:[10,40],mapping:docs?[30,120]:[20,80],research:[0,90],verification:[15,60]});
export function remainingRange(processing:ProcessingStatus|null|undefined,materials:ProjectMaterials|null|undefined,kind:'analysis'|'pricing',stageSeconds=0):{low:number;high:number}|null{
  const m=materials||{text:true,photos:0,documents:0,specifications:0};
  const docs=m.documents>0||m.photos>0;
  const pricingCosts=Object.values(PRICING_PHASE_COST(docs));
  const throughEstimate=(read:{low:number;high:number})=>({low:read.low+pricingCosts.reduce((n,[low])=>n+low,0),high:read.high+pricingCosts.reduce((n,[,high])=>n+high,0)});
  // A running job whose progress record has not reached the page yet still has a knowable shape: the
  // whole pipeline for this kind, less the time already spent. Returning null here left the customer
  // on "Assessing how long your estimate will take" for an entire eight-minute wait, because a
  // background-driven submission never sends a progress record at all (owner report 2026-09-23).
  if(!processing){
    if(kind==='analysis')return throughEstimate({low:Math.max(5,(docs?40:15)-stageSeconds),high:Math.max(20,(docs?180:40)-stageSeconds)});
    const costs=Object.values(PRICING_PHASE_COST(docs));
    const low=costs.reduce((total,[l])=>total+l,0),high=costs.reduce((total,[,h])=>total+h,0);
    return {low:Math.max(10,low-stageSeconds),high:Math.max(40,high-stageSeconds)};
  }
  if(kind==='analysis'){
    const total=Math.max(0,processing.totalPages||0),read=Math.max(0,Math.min(total,processing.readPages||0)),left=total-read;
    const drawings=(processing.currentItems||[]).some(i=>DRAWING_ITEM.test(i));
    if(!docs)return throughEstimate({low:Math.max(5,15-stageSeconds),high:Math.max(15,40-stageSeconds)});
    if(processing.phase==='cross-referencing')return throughEstimate({low:10,high:40});
    if(!total)return throughEstimate({low:20+m.photos*3,high:60+m.photos*8+m.documents*30});
    const batches=Math.ceil(left/(drawings?6:12));
    return throughEstimate({low:Math.max(10,batches*(drawings?35:8)+10),high:Math.max(30,batches*(drawings?75:25)+30)});
  }
  const order:ProcessingStatus['phase'][]=['queued','inventory','mapping','research','verification'];
  const cost=PRICING_PHASE_COST(docs);
  const at=Math.max(0,order.indexOf(processing.phase==='retrying'?'mapping':processing.phase));
  let low=0,high=0;
  order.slice(at).forEach((p,i)=>{const [l,h]=cost[p]||[10,40];low+=i===0?Math.max(0,l-stageSeconds):l;high+=i===0?Math.max(10,h-stageSeconds):h;});
  return {low:Math.max(5,low),high:Math.max(low+15,high)};
}
export function remainingLabel(range:{low:number;high:number}|null,overdue=false):string{
  if(overdue)return 'Taking longer than usual. Still working, and every finished step is saved.';
  if(!range)return '';
  const min=(s:number)=>Math.max(1,Math.round(s/60));
  if(range.high<=60)return 'Less than a minute left';
  if(min(range.low)===min(range.high))return `About ${min(range.high)} minute${min(range.high)===1?'':'s'} left`;
  return `About ${min(range.low)} to ${min(range.high)} minutes left`;
}

/**
 * The sentence shown beside "Stay here" and "Email me when it's ready" (owner rule 2026-09-22): the same
 * live range as the progress line, an honest "still working it out" while the first range is computed,
 * and a plain statement when the work runs past its range. Never a fixed countdown.
 */
export function waitSentence(range:{low:number;high:number}|null|undefined,assessing:boolean,overdue=false):string{
  if(assessing)return 'Assessing how long your estimate will take.';
  if(overdue)return 'This is taking longer than usual. It keeps going whether you stay or not.';
  if(!range)return '';
  const left=remainingLabel(range).replace(/^About /,'about ').replace(/ left$/,'').replace(/^Less than a minute$/,'less than a minute');
  return `Your estimate should be ready in ${left}.`;
}
