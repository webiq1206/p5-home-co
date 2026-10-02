import type {ScopePriceResolution,CostRule} from './costBook.ts';

type Addition={code:string;quantity:number;quantityEvidence:string;building?:string;floor?:string};
type Task={id:string;description:string;additions:Addition[];existingLineIds:string[];researchDescription:string};
const supporting=(text:string)=>/^(?:remove|removal|dispose|disposal|cleanup|clean up|protect|protection|align|alignment|level|leveling)\b/i.test(text)
 &&! /\b(?:additional|separate|hazardous|asbestos|structural)\b/i.test(text);
const included=(text:string)=>/\b(?:included|covered)\s+(?:in|by|within|as part of)\b/i.test(text)
 &&/\b(?:installation|install|replacement|labor|assembly)\b/i.test(text)
 &&! /\b(?:not|may|might|possibly|unless|except|excluded|separate|additional)\b/i.test(text);
const place=(line:{building?:string;floor?:string})=>JSON.stringify([line.building||'',line.floor||''].map(s=>s.trim().toLowerCase()));
const uses=(rule:CostRule,code:string)=>(rule.evidence?.reference||'').split(';').some(part=>part.trim()===code);

/** Reconcile explicit included-work evidence, not merely similar descriptions.
 * A supporting operation cannot add the complete installation charge again
 * when its own quantity evidence says that operation is already included.
 * Retain both task IDs, bound to the one validated positive labor component.
 * Ambiguous matches, different quantities/locations and separate work survive
 * unchanged for the ordinary audit; generic suspected duplicates are not merged. */
export function reconcileIncludedWork(tasks:Task[],result:ScopePriceResolution){
 for(const task of tasks.filter(task=>supporting(task.description))){
  for(const addition of [...task.additions]){
   if(!included(addition.quantityEvidence))continue;
   const same=(rule:CostRule)=>rule.category==='field-labor'&&rule.unitCost>0
    &&rule.quantity.fixed===addition.quantity&&place(rule)===place(addition)&&uses(rule,addition.code);
   const own=result.rules.filter(rule=>rule.scopeTaskId===task.id&&same(rule));
   if(own.length!==1)continue;
   const matches=result.rules.filter(rule=>rule.scopeTaskId!==task.id&&same(rule)&&rule.unit===own[0].unit&&rule.unitCost===own[0].unitCost
    &&tasks.some(other=>other.id===rule.scopeTaskId&&!supporting(other.description)&&/^(?:install|replace|installation|replacement)\b/i.test(other.description)));
   if(matches.length!==1)continue;
   result.rules=result.rules.filter(rule=>rule!==own[0]);
   task.additions=task.additions.filter(item=>item!==addition);
   task.existingLineIds=[...new Set([...task.existingLineIds,matches[0].id])];
   result.assumptions.push(`${task.description}: included in the matching installation labor and charged once.`);
  }
 }
}
