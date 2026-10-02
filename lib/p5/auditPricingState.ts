import type {PlanningRate} from './planningBooks.ts';

type Line={id:string;description:string;category:string;unit?:string;quantity:number|{fixed?:number;factor?:number};unitCost:number;scopeTaskId?:string;evidence?:{reference:string};minorWorkCoverage?:unknown[]};
type Task={id:string;description:string;existingLineIds?:string[];notes?:string[];additions?:unknown[];[key:string]:unknown};
/** The audit must see the retained ledger as facts, not a mapper's narrative
 * about an earlier proposal. Unknown rates remain explicit and unauthenticated.
 * No issue is resolved here, and no money or scope is changed. */
export function auditPricingState(lines:Line[],tasks:Task[],rates:PlanningRate[]=[]){
 const quantity=(line:Line)=>typeof line.quantity==='number'?line.quantity:(line.quantity.fixed??NaN)*(line.quantity.factor??1);
 const retained=lines.filter(line=>quantity(line)>0&&line.unitCost>0);
 const facts=retained.map(line=>{
  const rate=rates.find(rate=>line.evidence?.reference.startsWith(rate.source+'; '+rate.code+';')&&rate.unit===line.unit&&rate.amount===line.unitCost
   &&(rate.type==='Labor'?line.category==='field-labor':rate.type==='Material'?line.category==='materials':rate.type==='Subcontractor'?line.category==='subcontractors':true));
  return {id:line.id,category:line.category,unit:line.unit,quantity:quantity(line),unitCost:line.unitCost,directCost:quantity(line)*line.unitCost,
   scopeTaskId:line.scopeTaskId,description:rate?.description||line.description,
   canonicalRate:rate?{code:rate.code,type:rate.type,description:rate.description,source:rate.source}:null,
   policyAssignments:line.minorWorkCoverage||[]};
 });
 return {version:'retained-audit-state-v1',lines:facts,tasks:tasks.map(task=>({id:task.id,description:task.description,
  retainedLineIds:[...new Set([...(task.existingLineIds||[]),...retained.filter(line=>line.scopeTaskId===task.id).map(line=>line.id)])].filter(id=>retained.some(line=>line.id===id))}))};
}
