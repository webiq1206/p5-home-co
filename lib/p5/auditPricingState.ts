import type {PlanningRate} from './planningBooks.ts';
import {MINOR_WORK_POLICY,minorWorkEligible} from './minorWorkAllowance.ts';

type Line={id:string;description:string;category:string;unit?:string;quantity:number|{fixed?:number;factor?:number};unitCost:number;scopeTaskId?:string;evidence?:{reference:string;basis?:string};allowance?:boolean;priceBasis?:string;minorWorkCoverage?:{taskId:string;description:string;remainingComponent:string}[]};
type Task={id:string;description:string;existingLineIds?:string[];notes?:string[];additions?:unknown[];[key:string]:unknown};
/** The audit must see the retained ledger as facts, not a mapper's narrative
 * about an earlier proposal. Unknown rates remain explicit and unauthenticated.
 * No issue is resolved here, and no money or scope is changed. */
export function auditPricingState(lines:Line[],tasks:Task[],rates:PlanningRate[]=[]){
 const quantity=(line:Line)=>typeof line.quantity==='number'?line.quantity:(line.quantity.fixed??NaN)*(line.quantity.factor??1);
 const retained=[...new Map(lines.map(line=>[line.id,line])).values()].filter(line=>Number.isFinite(quantity(line))&&Number.isFinite(line.unitCost)&&quantity(line)>0&&line.unitCost>0);
 const pool=retained.find(line=>line.id==='minor-work-allowance');
 const base=retained.filter(line=>line.id!=='minor-work-allowance').reduce((sum,line)=>sum+quantity(line)*line.unitCost,0);
 const minimum=Math.ceil(Math.min(MINOR_WORK_POLICY.maximum,Math.max(MINOR_WORK_POLICY.minimum,base*MINOR_WORK_POLICY.share))/5)*5;
 const validPool=Boolean(pool&&base>0&&pool.category==='other-direct'&&pool.allowance&&pool.priceBasis==='direct-cost'
  &&pool.unit==='job'&&quantity(pool)===1&&pool.unitCost>=minimum&&pool.unitCost<=MINOR_WORK_POLICY.maximum
  &&pool.evidence?.basis==='owner-budget-allowance'&&pool.evidence.reference.startsWith(MINOR_WORK_POLICY.version+';'));
 const assignments=validPool?(pool!.minorWorkCoverage||[]).filter(item=>tasks.some(task=>task.id===item.taskId&&task.description===item.description&&task.existingLineIds?.includes(pool!.id))
  &&minorWorkEligible({id:item.taskId,description:item.description,researchDescription:item.remainingComponent,evidence:'',existingLineIds:[pool!.id]})):[];
 const facts=retained.map(line=>{
  const rate=rates.find(rate=>line.evidence?.reference.startsWith(rate.source+'; '+rate.code+';')&&rate.unit===line.unit&&rate.amount===line.unitCost
   &&(rate.type==='Labor'?line.category==='field-labor':rate.type==='Material'?line.category==='materials':rate.type==='Subcontractor'?line.category==='subcontractors':true));
  return {id:line.id,category:line.category,unit:line.unit,quantity:quantity(line),unitCost:line.unitCost,directCost:quantity(line)*line.unitCost,
   scopeTaskId:line.scopeTaskId,description:rate?.description||line.description,
   canonicalRate:rate?{code:rate.code,type:rate.type,description:rate.description,source:rate.source}:null,
   policyAssignments:line.minorWorkCoverage||[]};
 });
 return {version:'retained-audit-state-v1',minorWorkPolicy:{
  version:MINOR_WORK_POLICY.version,basis:'owner-authorized preliminary direct-cost budget',
  minimum:MINOR_WORK_POLICY.minimum,maximum:MINOR_WORK_POLICY.maximum,share:MINOR_WORK_POLICY.share,
  positivePrimaryDirectCost:base,minimumCurrentBudget:minimum,validPool,
  lineId:validPool?pool!.id:null,amount:validPool?pool!.unitCost:null,
  assignments:assignments.map(item=>({taskId:item.taskId,description:item.description,component:item.remainingComponent})),
  includes:'Incidental labor and supplies for the assigned supporting components share ONE job budget. Separate measured hours, catalog items or supplier quotes are not prerequisites for this preliminary budget.',
  excludes:'Primary products and installations, substantive demolition, major disposal, structural and hazardous work. Assignments do not establish missing scope, quantities, exclusions or absence of overlap.',
  contingency:'This direct-cost budget contains no reserve. The approved project contingency applies once downstream; contingency is not task coverage.',
 },lines:facts,tasks:tasks.map(task=>({id:task.id,description:task.description,
  retainedLineIds:[...new Set([...(task.existingLineIds||[]),...retained.filter(line=>line.scopeTaskId===task.id).map(line=>line.id)])].filter(id=>retained.some(line=>line.id===id))}))};
}
