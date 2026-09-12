import {combineCoverage,type DocumentCoverage} from './documentLedger.ts';

export interface ProgressUnit {
  pages?:{source:string;page:number}[];
  result?:{extraction:{documentCoverage?:DocumentCoverage}};
  error?:string;
}
/** A detail view is not another physical page. All views of an original page
 * must finish before it is counted as fully read. Unstarted views count too.
 */
export function analysisProgress(units:ProgressUnit[],expected?:{source:string;page:number}[]){
  const parts=units.map(unit=>unit.result?.extraction.documentCoverage||{
    pages:(unit.pages||[]).map(p=>({...p,sheet:'',revision:'',status:'unreadable' as const,notes:[unit.error||'Analysis is pending.']})),
    expectedPages:unit.pages?.length||0,complete:false,
  });
  const coverage=combineCoverage(parts,expected);
  const readPages=coverage.pages.filter(p=>p.status==='read').length;
  const readSections=units.filter(u=>u.result).length;
  return {readPages,totalPages:coverage.expectedPages,readSections,totalSections:units.length,
    message:coverage.expectedPages?`Read ${readPages} of ${coverage.expectedPages} pages. Checking drawings, schedules and scope.`:`Read ${readSections} of ${units.length} document sections.`};
}

/** Bounded parallelism, never a sampling/page-count limit. */
export function analysisConcurrency(value=process.env.P5_ANALYSIS_CONCURRENCY){
  const requested=Number(value||6);
  return Number.isInteger(requested)&&requested>=1?Math.min(requested,8):6;
}
