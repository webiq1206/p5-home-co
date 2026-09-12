/** Public progress describes completed work and current operations, never model
 * reasoning, internal costs, invented completion percentages or guessed ETAs. */
export interface ProcessingStatus {
  phase:'queued'|'preparing'|'instructions'|'reading'|'cross-referencing'|'inventory'|'mapping'|'research'|'verification'|'retrying';
  message:string;
  updatedAt:string;
  startedAt?:string;
  readPages?:number;
  totalPages?:number;
  readSections?:number;
  totalSections?:number;
  currentItems?:string[];
}
export const processingTitles:Record<ProcessingStatus['phase'],string>={
  queued:'Getting your estimate started',preparing:'Preparing your documents',instructions:'Reading your estimating instructions',
  reading:'Reading your plans', 'cross-referencing':'Checking drawings and quantities',inventory:'Organizing the requested scope',
  mapping:'Matching your scope to the cost book',research:'Researching missing local rates',verification:'Checking scope and pricing coverage',retrying:'Recovering an interrupted step',
};
export function pricingActivity(instructions:string,input:unknown,search:boolean):ProcessingStatus{
  const data=input as {taskBatch?:{description:string}[];tasks?:{description:string}[];repairInstruction?:string};
  const phase=search?'research':instructions.startsWith('Inventory')?'inventory':instructions.startsWith('You are a construction estimator')?'mapping':instructions.startsWith('Convert the supplied research')?'research':'verification';
  const message=phase==='inventory'?'Identifying the included work, exclusions and item-level quantities.':phase==='mapping'?(data.repairInstruction?'Resolving findings from the coverage check.':'Matching quantities, materials and labor to your established rates.'):phase==='research'?'Checking published cost evidence for items that need a supported allowance.':'Checking for missing items, duplicate counts, scope restrictions and pricing assumptions.';
  return {phase,message,updatedAt:new Date().toISOString(),currentItems:(data.taskBatch||(search?data.tasks:[])||[]).map(t=>t.description).filter(Boolean).slice(0,3)};
}
export function elapsedLabel(seconds:number){
  const total=Math.max(0,Math.floor(seconds));
  return total<60?`${total}s elapsed`:`${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s elapsed`;
}
export function analysisRetryDelay(value:unknown){
  const delay=Number(value);
  return Math.max(500,Math.min(15000,Number.isFinite(delay)&&delay>0?delay:1000));
}
export function acceptAnalysisJob(current:string|undefined,incoming:unknown,required=false){
  if(typeof incoming!=='string'||!incoming){if(required||current)throw new Error('The saved analysis could not be matched to this project. Your inputs are intact; retry to resume.');return current;}
  if(current&&current!==incoming)throw new Error('Your saved project changed while it was being read. Your inputs are intact; retry to analyze the latest version.');
  return incoming;
}
