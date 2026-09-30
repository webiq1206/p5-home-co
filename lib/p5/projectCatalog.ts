import type {PlanningRate} from './planningBooks.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import {priceBookRates,PRICE_BOOK_VERSION,finishTier} from './priceBook.ts';
import {withRateCard} from './rateCard.ts';
import {projectCatalogSchema} from './projectRecordContracts.ts';
import {ProjectRecordError,type ProjectRecord,type RecordProblem} from './projectRecord.ts';

/** A full index, not a keyword filter. Amounts and repeated provenance are
 * omitted during retrieval; the costing stage still receives the whole book. */
export function projectCatalogIndex(rates:PlanningRate[]){
 return rates.map(({code,description,type,unit})=>({code,name:description.split(' (')[0],type,unit}));
}
export function checkedProjectCandidates(record:ProjectRecord,rates:PlanningRate[],value:unknown){
 const result=projectCatalogSchema.parse(value),problems:RecordProblem[]=[];
 const wanted=new Set(record.requirements.filter(r=>r.status==='included'&&r.responsibility==='contractor').map(r=>r.id)),known=new Set(rates.map(r=>r.code)),seen=new Set<string>();
 for(const row of result.requirements){
  if(!wanted.has(row.requirementId)||seen.has(row.requirementId))problems.push({code:'catalog-requirement',ids:[row.requirementId],message:'Catalog discovery must address each included contractor requirement exactly once.'});
  seen.add(row.requirementId);
  if(!row.candidates.length&&!row.unmatchedReason.trim())problems.push({code:'catalog-gap',ids:[row.requirementId],message:'An unmatched requirement needs a reason explaining the catalog gap.'});
  const codes=new Set<string>();
  for(const candidate of row.candidates){
   if(!known.has(candidate.rateId)||codes.has(candidate.rateId))problems.push({code:'catalog-candidate',ids:[row.requirementId,candidate.rateId],message:'Candidate rates must be distinct IDs from the approved catalog.'});
   codes.add(candidate.rateId);
  }
 }
 for(const id of wanted)if(!seen.has(id))problems.push({code:'catalog-coverage',ids:[id],message:'Catalog discovery omitted an included contractor requirement.'});
 if(problems.length)throw new ProjectRecordError(problems);
 return result;
}
/** Accepted classification controls rate context. Old reader-populated service
 * answers cannot silently override the authoritative project record. */
export function projectConfiguration(saved:EstimatorConfiguration,record:ProjectRecord,finish?:string){
 return {...withRateCard(saved,priceBookRates({service:record.service,finish})),catalogVersion:`${saved.planningCatalog?.version||'missing'}+${PRICE_BOOK_VERSION}:${record.service}:${finishTier(finish)}`};
}
