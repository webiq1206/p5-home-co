export type CoverageState='readable'|'blank'|'unspecified'|'illegible'|'outside-view';
export interface PageRecord {coverageState?:CoverageState;source:string;page:number;sheet:string;revision:string;status:'read'|'unreadable'|'partial';notes:string[]}
export interface DocumentCoverage {pages:PageRecord[];expectedPages:number;complete:boolean}
export interface Takeoff {
  id:string;description:string;building:string;floor:string;component:string;
  measurementRole?:'work-quantity'|'location'|'inspection-extent'|'existing-condition'|'unknown';
  observation?:{quantity:number;unit:string};
  quantity:number|null;unit:string;basis:'stated'|'calculated'|'uncertain';evidence:string;
  sources:{source:string;page:number;sheet:string;revision:string}[];
  supersedes:string[];issues:string[];
}
/** Page zero is a non-document citation, never a physical PDF page. */
export const isTypedScopeSource=(source:string)=>/^(?:typed scope|submitted scope|typed instructions|customer instructions|user instructions|user revision|user|customer)$/i.test(source.trim());
const sourceWords=(value:string)=>value.toLowerCase().replace(/\bby\b|×/g,'x').replace(/\s*x\s*/g,'x').replace(/\binches\b|\binch\b/g,'in').replace(/\bfeet\b|\bfoot\b/g,'ft').replace(/\s+/g,' ').trim();
/** Typed revisions must not be rebound to an old drawing page. Preserve an
 * exact customer quote, or an explicit rectangle with checked area arithmetic.
 * An unsupported typed quantity remains unresolved rather than acquiring a
 * false document citation. Physical file page coverage is unchanged. */
export function bindTypedTakeoffSources(items:Takeoff[],text:string):void{
 const submitted=sourceWords(text);
 for(const item of items){
  const refs=item.sources.filter(ref=>isTypedScopeSource(ref.source));if(!refs.length)continue;
  const evidence=sourceWords(item.evidence).replace(/^(?:user|customer|typed scope):\s*/,'');
  const direct=evidence.length>=12&&submitted.includes(evidence);
  const rectangle=evidence.match(/\b(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\s*(in|ft)\b/);
  const subjects=['drywall','garage','porch','tile','floor','countertop','window','door','cabinet'].filter(word=>new RegExp('\\b'+word,'i').test(item.component+' '+item.description));
  const dimensional=rectangle&&['sf','square feet','sqft'].includes(item.unit.toLowerCase())
   &&Math.abs(Number(rectangle[1])*Number(rectangle[2])/(rectangle[3]==='in'?144:1)-Number(item.quantity))<.000001
   &&submitted.split(/[.!?;\n]+/).some(clause=>clause.includes(rectangle[0])&&subjects.some(word=>clause.includes(word)));
  for(const ref of refs){ref.source='typed scope';ref.page=0;ref.sheet='';}
  const areaRectangle=rectangle&&['sf','square feet','sqft'].includes(item.unit.toLowerCase());
  if(!(areaRectangle?dimensional:direct)){item.quantity=null;item.basis='uncertain';item.issues=[...new Set([...item.issues,'Confirm this quantity: its customer-instruction citation could not be verified; no drawing page is asserted for it.'])];}
 }
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
const NO_UNREADABLE_VIEWS=/\bno\s+(?:(?:supplied|reviewed)\s+)?(?:regions?|pages?|tiles?|sections?|crops?)\s+(?:were|was|are|is)\s+(?:blank\s+or\s+)?(?:unreadable|illegible)\b/gi;
export function blockingReviewNote(note:string):boolean{
  note=note.replace(NO_UNREADABLE_VIEWS,' ').replace(NEGATED_UNREADABLE,' ');
  return /unread section|could not be read|was not processed|unsupported (?:file|upload|document|specification)|unreadable|not readable|failed to read|no pages? (?:were|was|could be) read|automatic reading could not finish|automatic read failed|saved for manual review|could not read this file/i.test(note);
}
/**
 * A page counts as read when it was read in full, or read as "partial" with no note saying that
 * content could not be read. Live 2026-09-21: a budget with its numbers removed was read on every
 * page, each marked partial because the amounts were blank, and the estimator retried until it gave
 * up. A partial page whose note says part of it is unreadable still does not count.
 */
export const pageCovered=(p:{status:string;notes?:string[];coverageState?:CoverageState})=>{
 if(p.status==='unreadable')return false;
 if(p.coverageState)return ['readable','blank','unspecified'].includes(p.coverageState);
 return (p.status==='read'||p.status==='partial')&&!(p.notes||[]).some(blockingReviewNote);
};
function mergedCoverageState(rows:PageRecord[]):CoverageState|undefined{
 if(rows.some(row=>row.coverageState==='illegible'))return 'illegible';
 if(rows.some(row=>row.coverageState==='outside-view'))return 'outside-view';
 // Assess each original view under its own contract before merging notes.
 // A typed "unspecified" view may legitimately mention unreadable dimensions;
 // losing that state beside a valid legacy view reclassified its prose as a
 // new failure. A legacy view that actually fails still prevents promotion.
 if(rows.some(row=>!pageCovered(row))||rows.every(row=>!row.coverageState))return undefined;
 return rows.some(row=>row.coverageState==='unspecified')?'unspecified':rows.every(row=>row.coverageState==='blank')?'blank':'readable';
}
/** Status is evidence too. A successful view cannot erase an explicitly
 * unreadable detail merely because its note uses different wording. */
function mergedPageStatus(rows:PageRecord[]):PageRecord['status']{
  if(rows.some(row=>row.status==='unreadable'))return 'unreadable';
  return rows.every(row=>row.status==='read')?'read':'partial';
}
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
    if(v.coverageState!==undefined&&!['readable','blank','unspecified','illegible','outside-view'].includes(String(v.coverageState)))throw new Error('Invalid coverage state');
    return v as unknown as PageRecord;
  });
}
export function readTakeoffs(raw:unknown):Takeoff[]{
  if(!Array.isArray(raw))throw new Error('Invalid quantity takeoff');
  return raw.map(v=>{
    if(!isObject(v)||!['id','description','building','floor','component','unit','evidence'].every(k=>typeof v[k]==='string')||!v.id||!v.evidence||!(v.quantity===null||typeof v.quantity==='number'&&Number.isFinite(v.quantity)&&v.quantity>0)||!['stated','calculated','uncertain'].includes(String(v.basis))||!strings(v.supersedes)||!strings(v.issues)||!Array.isArray(v.sources)||!v.sources.length)throw new Error('Invalid takeoff evidence');
    for(const s of v.sources)if(!isObject(s)||!['source','sheet','revision'].every(k=>typeof s[k]==='string')||!Number.isInteger(s.page)||(Number(s.page)<1&&!(s.page===0&&isTypedScopeSource(String(s.source)))))throw new Error('Invalid takeoff page reference');
    if(v.basis==='uncertain'&&v.quantity!==null)throw new Error('An uncertain measurement must not masquerade as a measured quantity');
    const item={...v,issues:[...v.issues],sources:v.sources.map(source=>({...source}))} as unknown as Takeoff;
    if(item.measurementRole&&!['work-quantity','location','inspection-extent','existing-condition','unknown'].includes(item.measurementRole))throw new Error('Invalid measurement role');
    // Descriptive location units are never work units, including older records.
    if(/\bfrom (?:entry|entrance|access|cleanout)|camera station|inspection (?:distance|extent)\b/i.test(item.unit))item.measurementRole='location';
    const amount=item.quantity;
    if(amount!==null){
      const escaped=String(amount).replace('.', '\\.');
      const station=new RegExp('\\b(?:at|located at)\\s+(?:approximately\\s+)?'+escaped+'\\s*(?:feet|ft)\\s+from\\s+(?:the\\s+)?(?:camera\\s+)?(?:entry|entrance|access|cleanout)', 'i');
      if(station.test(item.evidence))item.measurementRole='location';
      if(/could not be evaluated|not (?:been )?inspected|unevaluated/i.test(item.evidence)&&new RegExp('\\b(?:remaining|uninspected)\\s+(?:approximate(?:ly)?\\s+)?'+escaped+'\\s*(?:feet|ft)', 'i').test(item.evidence))item.measurementRole='inspection-extent';
    }
    if(item.measurementRole&&item.measurementRole!=='work-quantity'&&item.quantity!==null){
      item.observation={quantity:item.quantity,unit:item.unit};
      item.quantity=null;item.basis='uncertain';
      item.issues=[...new Set([...item.issues,'Source observation is not a measured work quantity; establish the work extent or disclose a supported allowance.'])];
    }
    return item;
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
  expected.forEach((e,i)=>{
    if(bound.has(i)||expected.filter(candidate=>candidate.page===e.page).length!==1)return;
    for(const r of reported)if(!used.has(r)&&r.page===e.page)bind(i,r);
  });
  const exact=reported.some(r=>expected.some(e=>e.source===r.source&&e.page===r.page));
  // Section-relative numbering is safe only within one known source file.
  // An unidentified page 1 must not be assigned arbitrarily to one of two PDFs.
  const singleSource=new Set(expected.map(page=>page.source)).size===1;
  if(!exact&&singleSource&&expected.length>1)for(const r of reported)if(!used.has(r)&&r.page>=1&&r.page<=expected.length&&!bound.has(r.page-1))bind(r.page-1,r);
  const pages=expected.map((e,i)=>{
    const rows=bound.get(i)||[];
    if(!rows.length)return {...e,sheet:'',revision:'',status:'unreadable' as const,notes:['No completed review record was returned for this page.']};
    return {...rows[0],status:mergedPageStatus(rows),coverageState:mergedCoverageState(rows),notes:[...new Set(rows.flatMap(r=>r.notes))]};
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
    return {...rows[0],status:mergedPageStatus(rows),coverageState:mergedCoverageState(rows),notes:[...new Set(rows.flatMap(r=>r.notes))]};
  });
  // Partial receipts can name fewer pages than their declared document size.
  // Combining them must not redefine that smaller set as the whole upload.
  const sourceCounts=new Map<string,number>();
  if(!expected)for(const part of parts){
    const sources=[...new Set(part.pages.map(page=>page.source))];
    if(sources.length===1)sourceCounts.set(sources[0],Math.max(sourceCounts.get(sources[0])||0,part.expectedPages));
  }
  const expectedPages=expected?wanted.length:Math.max(wanted.length,...parts.map(part=>part.expectedPages),[...sourceCounts.values()].reduce((a,b)=>a+b,0));
  return {pages,expectedPages,complete:pages.length===expectedPages&&pages.every(pageCovered)};
}

/** Typed, complete coverage can retire its own contradictory prose note, but
 * cannot retire unrelated preparation or transport failures. */
export function blockingExtractionNotes(extraction:{reviewNotes:string[];documentCoverage?:DocumentCoverage}):string[]{
 const coverage=extraction.documentCoverage;
 const verified=coverage?.complete?coverage.pages.filter(page=>page.coverageState&&pageCovered(page)):[];
 const explained=new Set(verified.flatMap(page=>page.notes.flatMap(note=>[note,`${page.source}, page ${page.page}: ${page.status}. ${note}`])));
 return extraction.reviewNotes.filter(note=>blockingReviewNote(note)&&!explained.has(note));
}
