export interface PageRecord {source:string;page:number;sheet:string;revision:string;status:'read'|'unreadable'|'partial';notes:string[]}
export interface DocumentCoverage {pages:PageRecord[];expectedPages:number;complete:boolean}
export interface Takeoff {
  id:string;description:string;building:string;floor:string;component:string;
  quantity:number|null;unit:string;basis:'stated'|'calculated'|'uncertain';evidence:string;
  sources:{source:string;page:number;sheet:string;revision:string}[];
  supersedes:string[];issues:string[];
}
const isObject=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
export function readPageRecords(raw:unknown):PageRecord[]{
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
export function coverageFor(expected:{source:string;page:number}[],reported:PageRecord[]):DocumentCoverage{
  const pages=expected.map(e=>{
    const matches=reported.filter(r=>r.source===e.source&&r.page===e.page);
    return matches.length===1?matches[0]:{...e,sheet:'',revision:'',status:'unreadable' as const,notes:[matches.length?'Duplicate page review records require verification.':'No completed review record was returned for this page.']};
  });
  return {pages,expectedPages:expected.length,complete:pages.length===expected.length&&pages.every(p=>p.status==='read')};
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
  return {pages,expectedPages:wanted.length,complete:pages.every(p=>p.status==='read')};
}
