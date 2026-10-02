import {minorWorkEligible,MINOR_WORK_POLICY,type MinorTask} from './minorWorkAllowance.ts';
import type {ScopePriceResolution} from './costBook.ts';
type Decision={issue:string;reason:string;lineIds:string[]};
type Audit={coveredTaskIds:string[];issues:string[];notes:string[];resolvedIssues:Decision[]};
type Line={id:string;quantity:number;unitCost:number;description?:string;category?:string;evidence?:{reference:string}};
const names=(issue:string,task:MinorTask)=>issue.toLowerCase().includes(task.description.toLowerCase())
 ||new RegExp(`(?:^|[^\\w-])${task.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w-])`,'i').test(issue);
// A policy can establish budget coverage, never resolve a different defect.
const integrity=/duplicat|double[- ]?(?:count|charg)|charged twice|overlap|\b(?:hazardous|asbestos|structural|excluded|exclusions?|owner-supplied|wrong|mismatch\w*|conflict\w*|omitt\w*|missing|absent|insufficient|underpriced|underbudget|additional work)\b|not (?:included|covered)|\bquantity\b.{0,50}\b(?:incorrect|exceed\w*)\b|\bincorrect\b.{0,50}\bquantity\b/i;
const evidenceDemand=/\bno\s+(?:independent(?:ly)?\s+)?(?:supported\s+)?(?:labor\s+)?pric(?:e|ing)\b|\bnot\s+(?:independently\s+)?priced\b|\bnot matched to (?:an? |the )?existing priced line\b|\bfull pricing coverage has not been verified\b|\b(?:requires?|needs?|must)\b.{0,60}\b(?:research|separate|measured|supplier|published)\b.{0,60}\b(?:rate|price|pricing|hours|quote)\b/i;

/** Owner policy, not a model opinion, determines whether a named incidental
 * has a budget. This only resolves evidence demands for eligible, explicitly
 * linked work on a real positive shared allowance. Unknown findings survive.
 * Return original findings and reasons for the internal decision trail. */
export function reconcileMinorWorkAudit(tasks:MinorTask[],resolution:ScopePriceResolution,live:Line[],audit:Audit,modelIssues:ReadonlySet<string>,proposedCodes:ReadonlyMap<string,ReadonlySet<string>>=new Map()):Decision[]{
 const pool=resolution.rules.find(rule=>rule.id==='minor-work-allowance'&&rule.evidence.basis==='owner-budget-allowance'
  &&rule.evidence.reference.startsWith(MINOR_WORK_POLICY.version+';')&&rule.category==='other-direct'&&rule.allowance
  &&rule.unit==='job'&&rule.quantity.fixed===1&&rule.unitCost>=MINOR_WORK_POLICY.minimum);
 if(!pool||!live.some(line=>line.id===pool.id&&line.quantity===1&&line.unitCost===pool.unitCost)
  ||!live.some(line=>line.id!==pool.id&&line.quantity>0&&line.unitCost>0))return [];
 const coveredDescriptions=new Set(pool.evidence.reference.split('\nCovered work:\n')[1]?.split('\n')||[]);
 const covered=tasks.filter(task=>task.existingLineIds.includes(pool.id)&&coveredDescriptions.has(task.description)
  &&! /^(?:install|replace|build|construct|purchase)\b/i.test(task.description)
  &&minorWorkEligible({...task,researchDescription:task.description}));
 const otherTask=(issue:string)=>tasks.some(task=>!covered.includes(task)&&names(issue.replace(new RegExp(`\\b(?:within|under|by)\\s+${task.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w-])`,'gi'),''),task));
 const mentionsCode=(text:string,code:string)=>new RegExp(`(?:^|[^\\w-])${code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w-])`,'i').test(text);
 const retired=new Set<string>();
 const retiredFinding=(issue:string)=>{
  if(otherTask(issue)||/hazard|asbestos|structural|excluded|quantity.{0,50}(?:conflict|mismatch|incorrect)|insufficient|underpriced|missing component/i.test(issue))return false;
  const labor=live.filter(line=>line.category==='field-labor'&&line.quantity*line.unitCost>0);
  // A removed material cannot duplicate a labor-only charge. Do not infer
  // that conclusion for installed packages or labor including consumables.
  if(!labor.length||!labor.every(line=>/labor[ -]only|materials? (?:priced )?separately/i.test(line.description||'')))return false;
  return covered.some(task=>{
   if(!names(issue,task)||! /\b(?:consumables?|sundries|installation supplies)\b/i.test(task.description)
    ||task.existingLineIds.some(id=>id!==pool.id)||resolution.rules.some(rule=>rule.scopeTaskId===task.id&&rule.unitCost>0))return false;
   return [...(proposedCodes.get(task.id)||[])].some(code=>{
    if(!mentionsCode(issue,code)||live.some(line=>line.quantity*line.unitCost>0&&mentionsCode(line.evidence?.reference||'',code)))return false;
    if(!/mismatch|not (?:functionally )?equivalent|not .{0,70}(?:hardware|consumables)|duplicate charge/i.test(issue))return false;
    retired.add(code);return true;
   });
  });
 };
 const resolves=(issue:string)=>(!integrity.test(issue)&&evidenceDemand.test(issue)&&covered.some(task=>names(issue,task))&&!otherTask(issue))||retiredFinding(issue);
 const decisions:Decision[]=[];
 const retain=(issue:string)=>{
  if(!resolves(issue))return true;
  if(!decisions.some(item=>item.issue===issue))decisions.push({issue,reason:retiredFinding(issue)?'The identified earlier material proposal is absent from all positive priced lines. This task is now linked exclusively to the owner-authorized minor-work allowance; retained labor explicitly excludes materials. The obsolete material mismatch or duplicate allegation does not describe the current estimate.':'Owner-authorized minor-work policy explicitly budgets the linked supporting operation, including incidental labor and supplies, as a preliminary job allowance. Separate measured hours or market quotes are not required for this coverage.',lineIds:[pool.id]});
  return false;
 };
 audit.issues=audit.issues.filter(retain);
 resolution.issues=resolution.issues.filter(issue=>!modelIssues.has(issue)||retain(issue));
 audit.notes=audit.notes.filter(note=>!resolves(note));
 // Historical proposal explanations cannot describe the final charges.
 const obsoleteNote=(note:string)=>[...retired].some(code=>mentionsCode(note,code))
  ||retired.size>0&&/consumables.{0,80}included in (?:the )?labor/i.test(note);
 resolution.assumptions=resolution.assumptions.filter(note=>!obsoleteNote(note));
 audit.notes=audit.notes.filter(note=>!obsoleteNote(note));
 audit.coveredTaskIds=[...new Set([...audit.coveredTaskIds,...covered.map(task=>task.id)])];
 audit.resolvedIssues.push(...decisions);
 return decisions;
}
