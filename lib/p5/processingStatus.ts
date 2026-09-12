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
