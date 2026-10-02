import type {CostRule,ScopePriceResolution} from './costBook.ts';

/** Owner-authorized estimating policy, October 1, 2026. These are budget
 * allowances, not claimed supplier quotes or reusable market observations. */
export const MINOR_WORK_POLICY={version:'minor-work-v1',minimum:75,maximum:750,share:.03} as const;
export type MinorTask={id:string;description:string;evidence:string;researchDescription:string;existingLineIds:string[];costClass?:string;policyParentDescription?:string};
const substantive=/\b(?:asbestos|lead paint|hazardous|mold remediation|structural|engineering|foundation|excavat\w*|roof replacement|whole[- ]house|dumpster|roll[- ]off|truckload|tons?|cubic yards?|permits?|electrical panel|rewir\w*|gas line|sewer|utility connection)\b/i;
/** Classify the remaining component, not a list of products that happens to
 * occur elsewhere in a project. Expensive or regulated work stays separate. */
export function minorWorkEligible(task:MinorTask):boolean{
 const text=task.researchDescription||task.description;
 if(!task.researchDescription||substantive.test(task.description+' '+text))return false;
 if(!text.startsWith('Price only the still-unpriced components of:')&&/\b(?:consumables?|sundries|installation supplies|minor materials|miscellaneous supplies)\b/i.test(text)&&! /\b(?:cabinets?|countertops?|windows?|appliances?|fixtures?)\s+(?:supply|purchase|replacement)\b/i.test(text))return true;
 if(/\b(?:cleanup|clean-up|site cleaning|debris|dispos\w*|haul[- ]?off|handling|protection|touch[- ]?up|adjustment)\b/i.test(text)
   &&(/\b(?:minor|small|incidental|light|routine|ordinary)\b/i.test(text)||/\b(?:levers?|handles?|knobs?|locksets?|fasteners?|packaging|offcuts?)\b/i.test(task.description)))return true;
 return task.costClass==='minor-job-support'&&/\b(?:supplies|handling|cleanup|disposal|protection|adjustment|touch[- ]?up)\b/i.test(task.description);
}

/** One shared job allowance covers its retained task IDs, regardless of how
 * many tiny rows the model emits. Never stack one minimum per incidental. */
export function applyMinorWorkAllowance(tasks:MinorTask[],resolution:ScopePriceResolution,existing:{id:string;quantity:number;unitCost:number}[],now:Date):string[]{
 // A mapper can request the shared policy line before it has been created.
 // Treat that explicit reference as a request for eligible minor coverage,
 // not as verified pricing or an orphaned identifier. Primary work still
 // fails the same eligibility check, and a positive project base is required.
 const eligible=tasks.filter(task=>minorWorkEligible(task)||!task.researchDescription&&task.existingLineIds.includes('minor-work-allowance')&&minorWorkEligible({...task,researchDescription:task.description}));
 if(!eligible.length)return [];
 const prior=resolution.rules.find(r=>r.id==='minor-work-allowance');
 const priced=[...existing.filter(l=>l.id!=='minor-work-allowance'&&!resolution.removeLineIds?.includes(l.id)),...resolution.rules.filter(r=>r!==prior).map(r=>({id:r.id,quantity:r.quantity.fixed||0,unitCost:r.unitCost}))];
 const base=[...new Map(priced.map(line=>[line.id,line])).values()].reduce((sum,line)=>sum+(line.quantity>0&&line.unitCost>0?line.quantity*line.unitCost:0),0);
 // An incidental allowance cannot stand in for an entirely unpriced project.
 if(base<=0)return [];
 const amount=Math.ceil(Math.min(MINOR_WORK_POLICY.maximum,Math.max(MINOR_WORK_POLICY.minimum,base*MINOR_WORK_POLICY.share))/5)*5;
 const descriptions=[...new Set([...(prior?.evidence.reference.split('\nCovered work:\n')[1]?.split('\n')||[]),...eligible.map(t=>t.description)])];
 const reference=`${MINOR_WORK_POLICY.version}; owner-authorized job-support budget. Base: ${base.toFixed(2)}. Shared minimum ${MINOR_WORK_POLICY.minimum}; ${MINOR_WORK_POLICY.share*100}% basis, capped at ${MINOR_WORK_POLICY.maximum}. No embedded reserve; standard project contingency applies once. Not supplier pricing.\nCovered work:\n${descriptions.join('\n')}`;
 const assignments=[...(prior?.minorWorkCoverage||[])];
 for(const task of eligible){
  const assignment={taskId:task.id,description:task.policyParentDescription||task.description,remainingComponent:task.researchDescription||task.description};
  if(!assignments.some(item=>item.taskId===assignment.taskId&&item.description===assignment.description))assignments.push(assignment);
 }
 const rule:CostRule={id:'minor-work-allowance',description:'Minor work, job supplies and handling allowance',category:'other-direct',unit:'job',quantity:{fixed:1,factor:1},unitCost:Math.max(prior?.unitCost||0,amount),allowance:true,priceBasis:'direct-cost',minorWorkCoverage:assignments,evidence:{basis:'owner-budget-allowance',reference,verifiedAt:now.toISOString(),validUntil:new Date(now.getTime()+90*86400000).toISOString()}};
 if(prior)Object.assign(prior,rule);else resolution.rules.push(rule);
 const pricedIds=new Set(priced.filter(line=>line.quantity>0&&line.unitCost>0).map(line=>line.id));
 for(const task of eligible){task.existingLineIds=[...new Set([...task.existingLineIds.filter(id=>pricedIds.has(id)),rule.id])];task.researchDescription='';}
 const disclosure='A shared preliminary allowance covers minor job supplies, handling, cleanup and other small supporting work listed in this estimate. Larger repairs, hazardous waste and major demolition are priced separately. Confirm actual conditions before a firm proposal.';
 if(!resolution.assumptions.includes(disclosure))resolution.assumptions.push(disclosure);
 const ids=new Set(eligible.map(t=>t.id));
 resolution.issues=resolution.issues.filter(issue=>!eligible.some(t=>issue===`${t.description}: no supported price.`||issue===`${t.description}: invalid existing price reference.`));
 return [...ids];
}
