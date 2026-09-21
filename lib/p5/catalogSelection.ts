import type {PlanningRate} from './planningBooks.ts';

/**
 * The slice of the owner's catalog one mapping batch is shown.
 *
 * Every rate used to be pasted into the mapping prompt, several times per estimate. That made the
 * book expensive to own: each rate added length to every call, and past a point the right rate was
 * harder to find in a longer list rather than easier. Sending the relevant slice instead means the
 * catalog can hold thousands of rates while each prompt gets shorter and the match gets sharper.
 *
 * Selection is deterministic and generous, in this order:
 *   1. rates whose words overlap the tasks being mapped, best overlap first;
 *   2. the trade labor rates, which almost any task can need;
 *   3. the foundation codes the planning model is built on, which must always be offered.
 * A task that matches nothing still sees the general rates, so a thin batch is never left with an
 * empty book, and `researchDescription` remains the honest answer when nothing fits.
 */
const STOP=new Set(['with','from','that','this','into','each','only','and','the','for','per','all','any','are','not','its','their','them','were','been','over','under','also','other','such','than','then','when','where','which','while','shall','must','may','can','will','one','two','three','installed','install','supply','provide','repair','replace','remove','existing','new','required','requires','work','material','materials','labor','site','area','job','item','items','project','owner','seller','buyer','please','confirm','verify','field','stated','unstated','typical','standard','ordinary']);
const words=(value:unknown)=>String(value??'').toLowerCase().match(/[a-z]{3,}/g)||[];
/** Words that carry meaning for matching a rate to a task. */
export function meaningfulWords(value:unknown):Set<string> {
  return new Set(words(value).filter(word=>!STOP.has(word)).map(word=>word.replace(/(?:ing|ed|es|s)$/,'')));
}
const overlap=(rate:Set<string>,task:Set<string>)=>{
  let shared=0;
  for(const word of rate)if(task.has(word))shared++;
  return shared;
};
/** A rate every batch should see: trade labor by the hour, and the codes the planning model needs. */
const GENERAL=/^(?:REF-|RC-LAB-|RC-GC-|RC-DISP-|RC-EQ-|RC-MOB-|RC-PERMIT-|RC-CLEAN-|RC-INSPECT-)/;
export const FOUNDATION_CODES=['03-17-01-M','03-17-01-L','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
export const CATALOG_SLICE=Number(process.env.P5_CATALOG_SLICE||160);
export function relevantCatalog<T extends Pick<PlanningRate,'code'|'description'>>(rates:readonly T[],tasks:readonly {description?:string;evidence?:string}[],limit=CATALOG_SLICE):T[]{
  if(rates.length<=limit)return [...rates];
  const wanted=new Set<string>();
  for(const task of tasks)for(const word of meaningfulWords(`${task.description||''} ${task.evidence||''}`))wanted.add(word);
  const required=new Set(FOUNDATION_CODES);
  const scored=rates.map((rate,index)=>({rate,index,
    score:required.has(rate.code)?Number.MAX_SAFE_INTEGER:GENERAL.test(rate.code)?1e6-index:overlap(meaningfulWords(`${rate.code.replace(/-/g,' ')} ${rate.description}`),wanted)}));
  // Best overlap first; ties keep the owner's own order so the same batch always gets the same book.
  scored.sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=scored.filter(entry=>entry.score>0).slice(0,limit);
  return chosen.sort((a,b)=>a.index-b.index).map(entry=>entry.rate);
}
