import type {ScopePriceResolution} from './costBook.ts';
import type {ReviewedScope} from './scope.ts';
import {MINOR_WORK_POLICY} from './minorWorkAllowance.ts';

type Task={id:string;description:string;existingLineIds?:string[]};
type Line={id:string;description:string;category:string;quantity:number;unitCost:number;evidence?:{reference:string}};
export type CopyDecision={original:string;replacement:string;reason:string;lineIds:string[]};
const consumablesCopy='Contractor-supplied installation consumables are covered by the shared preliminary job-support allowance; installation labor is priced separately.';
// This observed audit form mistakes two references to ONE line for two prices.
// Other findings (including any additional sentence) remain unmodified.
const sharedLineExplanation="The scope explicitly requires ONE action per door: remove existing lever AND install replacement on the same door with existing predrilled holes. The catalog description 'Door Hardware Installation (Labor), Openings' is ambiguous as to whether it covers removal, installation, or both. This single labor line should be assigned to ONE task (either combined removal+installation as a single operation, or removal only, or installation only), not duplicated across two tasks. Clarify the scope of PB-08-71-01 and consolidate to one per-door charge.";

/** Customer statements describe final positive charges, not retired proposals.
 * This changes copy only. Original notes and exact retained-line evidence are
 * returned for the internal decision trail; unknown warnings always survive. */
export function reconcileRetainedAuditCopy(notes:string[],scope:ReviewedScope,tasks:Task[],resolution:ScopePriceResolution,lines:Line[]):{notes:string[];decisions:CopyDecision[]}{
 const live=lines.filter(l=>l.quantity>0&&l.unitCost>0),labor=live.filter(l=>l.category==='field-labor');
 const pool=resolution.rules.find(r=>r.id==='minor-work-allowance'&&r.allowance&&r.category==='other-direct'&&r.unit==='job'
  &&r.quantity.fixed===1&&r.unitCost>=MINOR_WORK_POLICY.minimum&&r.evidence.basis==='owner-budget-allowance'
  &&r.evidence.reference.startsWith(MINOR_WORK_POLICY.version+';')
  &&live.some(l=>l.id===r.id&&l.quantity===1&&l.unitCost===r.unitCost));
 const covered=pool?.evidence.reference.split('\nCovered work:\n')[1]?.split('\n')||[];
 const consumables=tasks.find(t=>/^Supply contractor installation consumables$/i.test(t.description)
  &&t.existingLineIds?.length===1&&t.existingLineIds[0]===pool?.id&&covered.includes(t.description)
  &&!resolution.rules.some(r=>r.scopeTaskId===t.id&&(r.quantity.fixed||0)>0&&r.unitCost>0));
 const suppliesProven=Boolean(pool&&consumables&&labor.length&&labor.every(l=>/labor only/i.test(l.description))
  &&!live.some(l=>l.category==='materials'||l.category==='subcontractors'));
 const countWords=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
 const countText=/\bon (?:the )?same (\d+|one|two|three|four|five|six|seven|eight|nine|ten) doors?\b/i.exec(scope.text)?.[1].toLowerCase();
 const count=countText?(Number(countText)||countWords.indexOf(countText)):0;
 const decisions:CopyDecision[]=[];
 const reconciled=notes.map(original=>{
  let replacement=original,reason='',lineIds:string[]=[];
  if(suppliesProven){
   const taskClaim=/^(?:Supply contractor installation consumables(?:\s*\([^)]*\))?:\s*)?Installation consumables(?:\s*\([^)]*\))? are included within the labor-only rate(?: PB-08-71-01)?(?: \([^)]*\))?\./i;
   const generalClaim=/^Contractor-supplied (?:normal )?installation consumables(?:\s*\([^)]*\))? are included within the labor-only rate and the minor-work-allowance job-support budget\.$/i;
   if(taskClaim.test(original)||generalClaim.test(original)){
    replacement=generalClaim.test(original)?consumablesCopy:original.replace(taskClaim,consumablesCopy);
    reason='The consumables task references only the positive policy allowance, whose covered-work evidence names that task. All retained labor excludes materials; no separate material or installed-package charge is present.';
    lineIds=[pool!.id,...labor.map(l=>l.id)];
   }
  }
  const allegation=/^(?:To confirm:\s*)?Task ([\w-]+) and ([\w-]+): Duplicate labor charge\. Line ([\w-]+) \([^\n]*?\) is assigned to BOTH \1 and \2\. ([\s\S]+)$/.exec(original);
  if(allegation&&allegation[4]===sharedLineExplanation&&labor.length===1&&count>0){
   const [,removeId,installId,lineId]=allegation;
   const removal=tasks.find(t=>t.id===removeId),installation=tasks.find(t=>t.id===installId),line=labor[0];
   const rule=resolution.rules.find(r=>r.id===lineId&&r.scopeTaskId===installId);
   if(line.id===lineId&&line.quantity===count&&rule&&rule.quantity.fixed===count&&(rule.quantity.factor??1)===1
    &&/^Remove existing handles and install their replacements on the same doors:/.test(line.description)
    &&/\bPB-08-71-01\b/.test(line.evidence?.reference||'')
    &&removal?.existingLineIds?.includes(lineId)&&installation?.existingLineIds?.includes(lineId)
    &&/^Remove\b.*\b(?:levers?|handles?)\b/i.test(removal.description)&&! /\b(?:hinges?|frames?|other|different|additional)\b/i.test(removal.description)
    &&/^Install\b.*\b(?:levers?|handles?)\b/i.test(installation.description)
    &&! /\bnot\s+(?:on\s+)?(?:the\s+)?same\b|\b(?:other|different|additional)\s+doors?\b/i.test(scope.text)){
     replacement=`Removal and installation share one replacement labor charge for the same ${count} doors; it is priced once. Confirm existing hardware compatibility before a firm proposal.`;
     reason='Both named tasks reference the same single retained replacement-labor line. Its quantity matches the explicit same-door scope and its description records the deterministic removal/install correction; a shared reference is not a second charge.';
     lineIds=[lineId];
   }
  }
  if(replacement!==original)decisions.push({original,replacement,reason,lineIds});
  return replacement;
 });
 return {notes:[...new Set(reconciled)],decisions};
}
