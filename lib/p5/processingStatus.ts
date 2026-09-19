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
  reading:'Reading your documents', 'cross-referencing':'Checking your scope and quantities',inventory:'Organizing the requested scope',
  mapping:'Pricing your project',research:'Researching missing local rates',verification:'Checking scope and pricing coverage',retrying:'Recovering an interrupted step',
};
export function analysisMessage(hasAttachments:boolean,event:'start'|'busy'|'error'|'retry'='start'){
  if(event==='busy')return hasAttachments?'Your document review is already running. Saved progress will appear shortly.':'Your scope review is already running. Saved progress will appear shortly.';
  if(event==='error')return hasAttachments?'Your files could not be processed. They are still here. Please retry.':'Your project details could not be processed. They are saved. Please retry.';
  if(event==='retry')return hasAttachments?'Reviewing your saved documents...':'Reviewing your saved project details...';
  return hasAttachments?'Reading your documents and project details...':'Understanding your project...';
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
export function pricingActivity(instructions:string,input:unknown,search:boolean):ProcessingStatus{
  const data=input as {taskBatch?:{description:string}[];tasks?:{description:string}[];repairInstruction?:string};
  const phase=search?'research':instructions.startsWith('Inventory')?'inventory':instructions.startsWith('You are a construction estimator')?'mapping':instructions.startsWith('Convert the supplied research')?'research':'verification';
  const message=phase==='inventory'?'Identifying the included work, exclusions and item-level quantities.':phase==='mapping'?(data.repairInstruction?'Resolving findings from the coverage check.':'Pricing the quantities, materials and labor in your scope.'):phase==='research'?'Checking published cost evidence for items that need a supported allowance.':'Checking for missing items, duplicate counts, scope restrictions and pricing assumptions.';
  return {phase,message,updatedAt:new Date().toISOString(),currentItems:(data.taskBatch||(search?data.tasks:[])||[]).map(t=>t.description).filter(Boolean).slice(0,3)};
}
export function elapsedLabel(seconds:number){
  const total=Math.max(0,Math.floor(seconds));
  return total<60?`${total}s elapsed`:`${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s elapsed`;
}
