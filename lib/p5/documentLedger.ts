export interface PageRecord {source:string;page:number;sheet:string;revision:string;status:'read'|'unreadable'|'partial';notes:string[]}
export interface DocumentCoverage {pages:PageRecord[];expectedPages:number;complete:boolean}
export interface Takeoff {
  id:string;description:string;building:string;floor:string;component:string;
  quantity:number|null;unit:string;basis:'stated'|'calculated'|'uncertain';evidence:string;
  sources:{source:string;page:number;sheet:string;revision:string}[];
  supersedes:string[];issues:string[];
}
/** A review note blocks a customer range only when a document, section or
 * page could not be read at all, so the quantities behind the price may be
 * missing. Other notes (a dropped takeoff, an unconfirmed photo observation,
 * a duplicate page record) travel with the range as items to confirm.
 *
 * Kept in this dependency-free module so page coverage, reading and pricing share one rule. */
/** A reader stating content is NOT unreadable ("all legible, no unreadable content", "blank
 * table, not unreadable content"). Live 2026-09-21 these notes alone blocked a fully read
 * 27-page plan set. Only the negated phrase is removed; the rest of the note is still tested. */
const NEGATED_UNREADABLE=/\b(?:no|not|nothing|none|without)\s+(?:[a-z]+\s+){0,2}?(?:unreadable|illegible)\b/gi;
export function blockingReviewNote(note:string):boolean{
  note=note.replace(NEGATED_UNREADABLE,' ');
  return /unread section|could not be read|was not processed|unsupported (?:file|upload|document|specification)|unreadable|not readable|failed to read|no pages? (?:were|was|could be) read|automatic reading could not finish|automatic read failed|saved for manual review|could not read this file/i.test(note);
}
/**
 * A page counts as read when it was read in full, or read as "partial" with no note saying that
 * content could not be read. Live 2026-09-21: a budget with its numbers removed was read on every
 * page, each marked partial because the amounts were blank, and the estimator retried until it gave
 * up. A partial page whose note says part of it is unreadable still does not count.
 */
export const pageCovered=(p:{status:string;notes?:string[]})=>p.status==='read'||p.status==='partial'&&!(p.notes||[]).some(blockingReviewNote);
const isObject=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
/**
 * The page review list as a list. Readers sometimes return one page as a bare object, or the pages
 * keyed by number ({"1":{...},"2":{...}}); live on the Marcliffe RE-10 that shape threw away a
 * page that had been read, and the visitor was told the file could not be read. The records inside
 * are still validated one by one below; only the container is normalised.
 */
export function pageRecordList(raw:unknown):unknown{
  if(Array.isArray(raw)||!isObject(raw))return raw;
  if('page' in raw&&'status' in raw)return [raw];
  // Keyed by page ({"1":{...}}) or wrapped ({"records":[...]}, seen live on a permit set): take the
  // page records wherever they sit, one level down.
  const found=Object.values(raw).flatMap(value=>Array.isArray(value)?value.filter(isObject):isObject(value)?[value]:[]).filter(v=>'page' in v);
  return found.length?found:raw;
}
export function readPageRecords(input:unknown):PageRecord[]{
  const raw=pageRecordList(input);
  if(!Array.isArray(raw))throw new Error('Missing page-by-page review record');
  return raw.map(v=>{
    if(!isObject(v)||!['source','sheet','revision'].every(k=>typeof v[k]==='string')||!Number.isInteger(v.page)||Number(v.page)<1||!['read','unreadable','partial'].includes(String(v.status))||!strings(v.notes))throw new Error('Invalid page review record');
    return v as unknown as PageRecord;
  });
}
export function readTakeoffs(raw:unknown):Takeoff[]{
  if(!Array.isArray(raw))throw new Error('Invalid quantity takeoff');
  return raw.map(v=>{
    if(!isObject(v)||!['id','description','building','floor','component','unit','evidence'].every(k=>typeof v[k]==='string')||!v.id||!v.evidence||!(v.quantity===null||typeof v.quantity==='number'&&Number.isFinite(v.quantity)&&v.quantity>0)||!['stated','calculated','uncertain'].includes(String(v.basis))||!strings(v.supersedes)||!strings(v.issues)||!Array.isArray(v.sources)||!v.sources.length)throw new Error('Invalid takeoff evidence');
    for(const s of v.sources)if(!isObject(s)||!['source','sheet','revision'].every(k=>typeof s[k]==='string')||!Number.isInteger(s.page)||Number(s.page)<1)throw new Error('Invalid takeoff page reference');
    if(v.basis==='uncertain'&&v.quantity!==null)throw new Error('An uncertain measurement must not masquerade as a measured quantity');
    return v as unknown as Takeoff;
  });
}
const normalized=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
/** Repeated schedules/details describe the same physical work, not additions.
 * Only explicit supersession removes an earlier observation. Conflicts survive.
 */
export function reconcileTakeoffs(items:Takeoff[]):{items:Takeoff[];issues:string[]}{
  const output=new Map<string,Takeoff>();const issues:string[]=[];
  for(const item of items){
    const key=[item.building,item.floor,item.component,item.id].map(normalized).join('|');
    const prior=output.get(key);
    if(!prior){output.set(key,{...item,sources:[...item.sources],issues:[...item.issues]});continue;}
    const sourceKey=(s:Takeoff['sources'][number])=>`${s.source}:${s.sheet}:${s.revision}`;
    if(prior.sources.every(s=>item.supersedes.includes(sourceKey(s)))){output.set(key,item);continue;}
    if(item.sources.every(s=>prior.supersedes.includes(sourceKey(s))))continue;
    if(item.quantity!==prior.quantity||normalized(item.unit)!==normalized(prior.unit)){
      prior.quantity=null;prior.basis='uncertain';
      prior.issues.push(`Conflicting quantities for ${item.description}; reconcile the cited drawings and schedules before treating this as a measured quantity.`);
    }
    prior.sources=[...new Map([...prior.sources,...item.sources].map(s=>[JSON.stringify(s),s])).values()];
    prior.issues=[...new Set([...prior.issues,...item.issues])];
  }
  for(const item of output.values())issues.push(...item.issues);
  return {items:[...output.values()],issues:[...new Set(issues)]};
}
/**
 * Bind the reader's page records to the pages this unit actually sent.
 *
 * Live 2026-09-21 (27-page permit set): pages that were read came back "unreadable, no completed
 * review record" because the reader labelled them differently from the ledger: the file name
 * spelled another way, or the page numbered within its section (1, 2) instead of the original
 * (8, 9). Takeoff citations were already re-bound for a single-page unit; the page record was not.
 * Binding, in order and never across pages that were not sent:
 *  1. exact file and page;
 *  2. a single-page unit owns every record it returns (it can only describe that page);
 *  3. the same page number under a differently spelled file name;
 *  4. section-relative numbering (1..n) mapped by position, only when nothing matched exactly.
 * Several records for one page (tiles, repeats) combine to the worst status, as combineCoverage does.
 * A page with no record at all is still unreadable, so a page that was never read still blocks.
 */
export function coverageFor(expected:{source:string;page:number}[],reported:PageRecord[]):DocumentCoverage{
  const bound=new Map<number,PageRecord[]>();const used=new Set<PageRecord>();
  const bind=(i:number,r:PageRecord)=>{used.add(r);bound.set(i,[...(bound.get(i)||[]),{...r,source:expected[i].source,page:expected[i].page}]);};
  expected.forEach((e,i)=>{for(const r of reported)if(r.source===e.source&&r.page===e.page)bind(i,r);});
  if(expected.length===1)for(const r of reported)if(!used.has(r))bind(0,r);
  expected.forEach((e,i)=>{if(bound.has(i))return;for(const r of reported)if(!used.has(r)&&r.page===e.page)bind(i,r);});
  const exact=reported.some(r=>expected.some(e=>e.source===r.source&&e.page===r.page));
  if(!exact&&expected.length>1)for(const r of reported)if(!used.has(r)&&r.page>=1&&r.page<=expected.length&&!bound.has(r.page-1))bind(r.page-1,r);
  const pages=expected.map((e,i)=>{
    const rows=bound.get(i)||[];
    if(!rows.length)return {...e,sheet:'',revision:'',status:'unreadable' as const,notes:['No completed review record was returned for this page.']};
    return {...rows[0],status:rows.every(r=>r.status==='read')?'read' as const:rows.some(r=>r.status==='read'||r.status==='partial')?'partial' as const:'unreadable' as const,notes:[...new Set(rows.flatMap(r=>r.notes))]};
  });
  return {pages,expectedPages:expected.length,complete:pages.length===expected.length&&pages.every(pageCovered)};
}
/** Multiple detail-tile batches must ALL be read before one physical page is read. */
export function combineCoverage(parts:DocumentCoverage[],expected?:{source:string;page:number}[]):DocumentCoverage{
  const grouped=new Map<string,PageRecord[]>();
  for(const p of parts.flatMap(c=>c.pages)){const key=JSON.stringify([p.source,p.page]);grouped.set(key,[...(grouped.get(key)||[]),p]);}
  const wanted=expected||[...grouped.values()].map(p=>({source:p[0].source,page:p[0].page}));
  const pages=wanted.map(p=>{
    const rows=grouped.get(JSON.stringify([p.source,p.page]))||[];
    if(!rows.length)return {...p,sheet:'',revision:'',status:'unreadable' as const,notes:['This page was not processed. Review or retry it before relying on the takeoff.']};
    return {...rows[0],status:rows.every(r=>r.status==='read')?'read' as const:rows.some(r=>r.status==='read'||r.status==='partial')?'partial' as const:'unreadable' as const,notes:[...new Set(rows.flatMap(r=>r.notes))]};
  });
  return {pages,expectedPages:wanted.length,complete:pages.every(pageCovered)};
}
