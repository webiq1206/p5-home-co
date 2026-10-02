import type {ScopePriceResolution} from './costBook.ts';

/** Reconcile affirmative generated copy against retained pricing, without
 * changing source evidence, the audit, prices, or unresolved objections. */
export function retainedConsumablesCopy(notes:string[],resolution:ScopePriceResolution):string[]{
 const pool=resolution.rules.find(r=>r.id==='minor-work-allowance'&&r.unitCost>0&&(r.quantity.fixed||0)>0
  &&r.evidence.basis==='owner-budget-allowance'&&/^minor-work-v1;/.test(r.evidence.reference)
  &&/\nCovered work:\n[\s\S]*consumables/i.test(r.evidence.reference));
 const labor=resolution.rules.filter(r=>r.category==='field-labor'&&r.unitCost>0&&(r.quantity.fixed||0)>0);
 if(!pool||!labor.length||!labor.every(r=>/labor only/i.test(r.description)))return notes;
 return [...new Set(notes.map(note=>! /\b(?:not|never|may|might|confirm|uncertain|unresolved|unless)\b/i.test(note)&&/^Contractor supplies (?:normal )?(?:installation )?consumables\b[^\n]*\bas part of (?:the )?(?:installation )?labor(?: and minor-work allowance)?\.$/i.test(note)
  ?'Contractor-supplied installation consumables are covered by the shared preliminary job-support allowance; installation labor is priced separately.'
  :note))];
}
