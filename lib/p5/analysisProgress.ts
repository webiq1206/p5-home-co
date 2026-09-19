import {combineCoverage,type DocumentCoverage} from './documentLedger.ts';

export interface ProgressUnit {
  pages?:{source:string;page:number}[];
  result?:{extraction:{documentCoverage?:DocumentCoverage}};
  error?:string;
}
/** A detail view is not another physical page. All views of an original page
 * must finish before it is counted as fully read. Unstarted views count too.
 * A page the reader has finished counts as checked even when it found parts
 * illegible or redacted; only pages with work still pending are unchecked.
 */
export function analysisProgress(units:ProgressUnit[],expected?:{source:string;page:number}[],hasAttachments=true){
  const parts=units.map(unit=>unit.result?.extraction.documentCoverage||{
    pages:(unit.pages||[]).map(p=>({...p,sheet:'',revision:'',status:'unreadable' as const,notes:[unit.error||'Analysis is pending.']})),
    expectedPages:unit.pages?.length||0,complete:false,
  });
  const coverage=combineCoverage(parts,expected);
  const key=(p:{source:string;page:number})=>JSON.stringify([p.source,p.page]);
  const finished=new Set(units.filter(u=>u.result).flatMap(u=>(u.pages||[]).map(key)));
  const pending=new Set(units.filter(u=>!u.result).flatMap(u=>(u.pages||[]).map(key)));
  const readPages=coverage.pages.filter(p=>finished.has(key(p))&&!pending.has(key(p))).length;
  const readSections=units.filter(u=>u.result).length;
  return {readPages,totalPages:coverage.expectedPages,readSections,totalSections:units.length,
    message:coverage.expectedPages?`Checked ${readPages} of ${coverage.expectedPages} pages. Reading source evidence.`:units.length?`Read ${readSections} of ${units.length} ${hasAttachments?'document':'scope'} sections.`:'Checking your description, quantities and requested work.'};
}

/** Bounded parallelism, never a sampling/page-count limit. */
export function analysisConcurrency(value=process.env.P5_ANALYSIS_CONCURRENCY){
  const requested=Number(value||12);
  return Number.isInteger(requested)&&requested>=1?Math.min(requested,24):12;
}
