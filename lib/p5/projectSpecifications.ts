import type {ProjectRecord,RecordProblem} from './projectRecord.ts';
import type {ProjectPricingProposal} from './projectRecordContracts.ts';

/** Structural evidence gate, not a substitute for semantic specification review. */
export function projectSpecificationEvidence(record:ProjectRecord,line:ProjectPricingProposal['lines'][number],rateDescription:string){
 const problems:RecordProblem[]=[],disclosures:string[]=[];
 const fail=(message:string,ids:string[]=[])=>problems.push({code:'specification-evidence',ids:[line.id,...ids],message});
 const normalize=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim();
 const expected=new Map(line.requirementIds.flatMap(id=>record.requirements.find(r=>r.id===id)?.specifications.map((specification,index)=>[id+':'+index,{id,index,specification}]as const)||[]));
 const counts=new Map<string,number>();
 for(const check of line.specificationChecks){
  const key=check.requirementId+':'+check.specificationIndex,spec=expected.get(key);
  if(!spec){fail('Specification assessment does not belong to this priced work.',[check.requirementId]);continue;}
  counts.set(key,(counts.get(key)||0)+1);
  if(check.basis==='catalog'&&(normalize(check.catalogQuote).length<3||!normalize(rateDescription).includes(normalize(check.catalogQuote))))fail('Claimed specification support must quote this selected catalog entry exactly.',[spec.id]);
  if(check.basis==='scope-condition')for(const id of check.evidenceIds)if(!record.evidence.some(e=>e.id===id))fail('A scope condition must cite actual source evidence.',[spec.id,id]);
  if(check.basis==='allowance')disclosures.push(`${spec.specification}: ${check.disclosure}`);
 }
 for(const [key,spec]of expected)if(counts.get(key)!==1)fail('Each requested specification needs exactly one evidence assessment or a disclosed compatible allowance.',[spec.id]);
 return {problems,disclosures};
}
