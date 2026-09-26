import type {PlanningRate} from './planningBooks.ts';
import {TRADE_SYNONYMS} from './tradeVocabulary.ts';

/**
 * The slice of the owner's catalog one mapping batch is shown.
 *
 * Every rate used to be pasted into the mapping prompt, several times per estimate, so each rate
 * cost length on every call and past a point the right rate was harder to find in a longer list.
 * A batch is now shown the lines it can plausibly use, which lets the catalog hold the owner's
 * whole price book while each prompt stays short.
 *
 * Scopes rarely use the book's own words, so a line is chosen by meaning as well as spelling:
 *   - a CONCEPT shared through lib/p5/tradeVocabulary.ts ("receptacle" and "outlet", "spigot" and
 *     "hose bib") counts most;
 *   - a word shared with the line's own name counts next;
 *   - a word shared only with its section or division ("Electrical", "Plumbing") counts least, so
 *     a broad trade word never crowds out the specific line.
 * Always offered, whatever the words: the owner's foundation codes the planning model is built
 * on, and every trade's hourly labor rate, so a task that matches nothing specific can still be
 * priced as time. Selection is deterministic and keeps the catalog's own order.
 */
const STOP=new Set(['with','from','that','this','into','each','only','and','the','for','per','all','any','are','not','its','their','them','were','been','over','under','also','other','such','than','then','when','where','which','while','shall','must','may','can','will','one','two','three','four','five','six','installed','install','supply','provide','existing','new','required','requires','work','material','materials','labor','site','area','job','item','items','project','owner','seller','buyer','please','confirm','verify','field','stated','unstated','typical','standard','ordinary','price','priced','separately','included','includes','only','finish','grade','range','mid','high','end','builder','luxury','remodel','premium','home','house','residence','front','back','north','south','east','west','left','right','room','rooms','needs','need','needed','replace','replacement','per','and','or']);
const normalized=(value:unknown)=>` ${String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()} `;
// 'construction' and 'construct', 'installation' and 'install' are one word for matching (2026-09-22: the
// book's 'New home construction' line was never offered for 'construct one new residence').
const stem=(word:string)=>word.length>6?word.replace(/(?:ation|ion|ing|ies|ied|ed|es|s)$/,''):word.replace(/(?:ing|ies|ied|ed|es|s)$/,'');
const words=(value:unknown)=>normalized(value).trim().split(' ').filter(word=>word.length>=3&&!STOP.has(word));
/** Words that carry meaning for matching a rate to a task. */
export function meaningfulWords(value:unknown):Set<string> {
  return new Set(words(value).map(stem));
}
/** Phrases, pre-normalised, so each group can be tested against normalised text. */
const GROUPS=TRADE_SYNONYMS.map(group=>group.map(phrase=>normalized(phrase)));
/** The concepts a text names, by index into TRADE_SYNONYMS. */
export function conceptsOf(value:unknown):Set<number> {
  const text=normalized(value);
  // Also try a crude singular, so "receptacles" names the same concept as "receptacle".
  const singular=` ${text.trim().split(' ').map(stem).join(' ')} `;
  const found=new Set<number>();
  GROUPS.forEach((group,index)=>{if(group.some(phrase=>text.includes(phrase)||singular.includes(` ${stem(phrase.trim())} `)))found.add(index);});
  return found;
}
const shared=<V>(a:Set<V>,b:Set<V>)=>{let n=0;for(const v of a)if(b.has(v))n++;return n;};
/** A rate's own name, as distinct from the section and division it is filed under. */
const nameOf=(description:string)=>{const cut=description.indexOf(' (');return cut>0?description.slice(0,cut):description;};
export const FOUNDATION_CODES=['03-17-01-M','03-17-01-L','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
/** Rates every batch should see: the planning model's foundation, and hourly trade labor. */
const LEGACY_GENERAL=/^(?:REF-|RC-LAB-|RC-GC-|RC-DISP-|RC-EQ-|RC-MOB-|RC-PERMIT-|RC-CLEAN-|RC-INSPECT-)/;
const alwaysOffered=(rate:{code:string;type?:string;unit?:string})=>FOUNDATION_CODES.includes(rate.code)||LEGACY_GENERAL.test(rate.code)||(rate.type==='Labor'&&/^(?:HR|HRS)$/i.test(String(rate.unit||'')));
export const CATALOG_SLICE=Number(process.env.P5_CATALOG_SLICE||220);
export function relevantCatalog<T extends Pick<PlanningRate,'code'|'description'>&Partial<Pick<PlanningRate,'type'|'unit'>>>(rates:readonly T[],tasks:readonly {description?:string;evidence?:string}[],limit=CATALOG_SLICE,must:ReadonlySet<string>=new Set()):T[]{
  if(rates.length<=limit)return [...rates];
  const text=tasks.map(task=>`${task.description||''} ${task.evidence||''}`).join(' ');
  const wanted=meaningfulWords(text),concepts=conceptsOf(text);
  const scored=rates.map((rate,index)=>{
    // Codes the full-book shortlist named (bookShortlist.ts) are always offered.
    if(alwaysOffered(rate)||must.has(rate.code))return {rate,index,score:Number.MAX_SAFE_INTEGER};
    const name=nameOf(rate.description);
    const score=shared(conceptsOf(name),concepts)*6+shared(meaningfulWords(name),wanted)*3+shared(meaningfulWords(`${rate.code.replace(/-/g,' ')} ${rate.description.slice(name.length)}`),wanted);
    return {rate,index,score};
  });
  // Best match first; ties keep the catalog's own order, so the same batch always gets the same book.
  scored.sort((a,b)=>b.score-a.score||a.index-b.index);
  const required=scored.filter(entry=>must.has(entry.rate.code));
  const optional=scored.filter(entry=>!must.has(entry.rate.code)&&entry.score>0).slice(0,Math.max(0,limit-required.length));
  return [...required,...optional].sort((a,b)=>a.index-b.index).map(entry=>entry.rate);
}
