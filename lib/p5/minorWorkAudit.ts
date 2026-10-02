import {minorWorkEligible,MINOR_WORK_POLICY,type MinorTask} from './minorWorkAllowance.ts';
import type {ScopePriceResolution} from './costBook.ts';
type Decision={issue:string;reason:string;lineIds:string[]};
type Audit={coveredTaskIds:string[];issues:string[];notes:string[];resolvedIssues:Decision[]};
type Line={id:string;quantity:number;unitCost:number};
const names=(issue:string,task:MinorTask)=>issue.toLowerCase().includes(task.description.toLowerCase())
 ||new RegExp(`(?:^|[^\\w-])${task.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w-])`,'i').test(issue);
// A policy can establish budget coverage, never resolve a different defect.
const integrity=/duplicat|double[- ]?(?:count|charg)|charged twice|overlap|\b(?:hazardous|asbestos|structural|excluded|exclusions?|owner-supplied|wrong|mismatch\w*|conflict\w*|omitt\w*|missing|absent|insufficient|underpriced|underbudget|additional work)\b|not (?:included|covered)|\bquantity\b.{0,50}\b(?:incorrect|exceed\w*)\b|\bincorrect\b.{0,50}\bquantity\b/i;
const evidenceDemand=/\bno\s+(?:independent(?:ly)?\s+)?(?:supported\s+)?(?:labor\s+)?pric(?:e|ing)\b|\bnot\s+(?:independently\s+)?priced\b|\bnot matched to (?:an? |the )?existing priced line\b|\bfull pricing coverage has not been verified\b|\b(?:requires?|needs?|must)\b.{0,60}\b(?:research|separate|measured|supplier|published)\b.{0,60}\b(?:rate|price|pricing|hours|quote)\b/i;

/** Owner policy, not a model opinion, determines whether a named incidental
 * has a budget. This only resolves evidence demands for eligible, explicitly
 * linked work on a real positive shared allowance. Unknown findings survive.
 * Return original findings and reasons for the internal decision trail. */
export function reconcileMinorWorkAudit(tasks:MinorTask[],resolution:ScopePriceResolution,live:Line[],audit:Audit,modelIssues:ReadonlySet<string>):Decision[]{
 const pool=resolution.rules.find(rule=>rule.id==='minor-work-allowance'&&rule.evidence.basis==='owner-budget-allowance'
  &&rule.evidence.reference.startsWith(MINOR_WORK_POLICY.version+';')&&rule.category==='other-direct'&&rule.allowance
  &&rule.unit==='job'&&rule.quantity.fixed===1&&rule.unitCost>=MINOR_WORK_POLICY.minimum);
 if(!pool||!live.some(line=>line.id===pool.id&&line.quantity===1&&line.unitCost===pool.unitCost)
  ||!live.some(line=>line.id!==pool.id&&line.quantity>0&&line.unitCost>0))return [];
 const coveredDescriptions=new Set(pool.evidence.reference.split('\nCovered work:\n')[1]?.split('\n')||[]);
 const covered=tasks.filter(task=>task.existingLineIds.includes(pool.id)&&coveredDescriptions.has(task.description)
  &&! /^(?:install|replace|build|construct|purchase)\b/i.test(task.description)
  &&minorWorkEligible({...task,researchDescription:task.description}));
 const resolves=(issue:string)=>!integrity.test(issue)&&evidenceDemand.test(issue)&&covered.some(task=>names(issue,task))
  &&!tasks.some(task=>!covered.includes(task)&&names(issue.replace(new RegExp(`\\b(?:within|under|by)\\s+${task.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w-])`,'gi'),''),task));
 const decisions:Decision[]=[];
 const retain=(issue:string)=>{
  if(!resolves(issue))return true;
  if(!decisions.some(item=>item.issue===issue))decisions.push({issue,reason:'Owner-authorized minor-work policy explicitly budgets the linked supporting operation, including incidental labor and supplies, as a preliminary job allowance. Separate measured hours or market quotes are not required for this coverage.',lineIds:[pool.id]});
  return false;
 };
 audit.issues=audit.issues.filter(retain);
 resolution.issues=resolution.issues.filter(issue=>!modelIssues.has(issue)||retain(issue));
 audit.notes=audit.notes.filter(note=>!resolves(note));
 audit.coveredTaskIds=[...new Set([...audit.coveredTaskIds,...covered.map(task=>task.id)])];
 audit.resolvedIssues.push(...decisions);
 return decisions;
}
