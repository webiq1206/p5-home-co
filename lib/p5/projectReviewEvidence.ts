import {projectReviewSchema} from './projectRecordContracts.ts';
import {ProjectRecordError,type RecordProblem} from './projectRecord.ts';
import {quotationFeedback} from './quotationFeedback.ts';

/** A reviewer is also an untrusted model. Reject its invented catalog claims
 * before they can redirect an otherwise valid price proposal. */
export function verifiedReviewCatalog(raw:unknown,catalog:{code:string;description:string}[]){
 const review=projectReviewSchema.parse(raw),rates=new Map(catalog.map(rate=>[rate.code,rate])),problems:RecordProblem[]=[];
 const normalize=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim();
 const prefixes=[...new Set(catalog.map(rate=>rate.code.split('-')[0]).filter(prefix=>/^[A-Z][A-Z0-9]{0,11}$/.test(prefix)))];
 const references=prefixes.length?new RegExp('\\b(?:'+prefixes.join('|')+')-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\\b','g'):null;
 for(const finding of review.findings){
  // Reject an explicitly non-actionable finding; do not silently drop it or
  // approve the estimate. The workflow must obtain a corrected review.
  const correction=normalize(finding.requiredCorrection).replace(/[.!]+$/,'');
  if(/^(?:(?:required )?correction:\s*)?(?:none(?: (?:is )?(?:required|needed))?|no (?:correction|change|action)(?: (?:is )?(?:required|needed))?|n\/a)$/i.test(correction))
   problems.push({code:'review-nonactionable-finding',ids:[finding.id],message:'This finding explicitly requires no correction. Review this selection again: place confirmations in notes, or identify the actual defect and a concrete required change. Do not reprice a justified selection merely to satisfy a contradictory review.'});
  const cited=new Set(finding.catalogEvidence.map(item=>item.rateId));
  if(finding.code==='rate-fit'&&!cited.size)problems.push({code:'review-catalog-evidence',ids:[finding.id],message:'A rate-fit objection must cite the actual supplied rate descriptions, including every proposed alternative.'});
  for(const item of finding.catalogEvidence){
   const rate=rates.get(item.rateId);
   if(!rate)problems.push({code:'review-catalog-evidence',ids:[finding.id,item.rateId],message:'This reviewer-cited rate is absent from the supplied catalog. Correct the review against actual entries; do not change pricing to use an invented alternative.'});
   else if(!normalize(rate.description).includes(normalize(item.quote)))problems.push({code:'review-catalog-evidence',ids:[finding.id,item.rateId],message:quotationFeedback(item.quote,rate.description)});
  }
  for(const code of references?(finding.message+' '+finding.requiredCorrection).match(references)||[]:[])
   if(!rates.has(code)||!cited.has(code))problems.push({code:'review-catalog-evidence',ids:[finding.id,code],message:'Every catalog code in a finding must exist in the supplied catalog and carry exact catalogEvidence. Repair this unsupported review claim before requesting a pricing correction.'});
 }
 if(problems.length)throw new ProjectRecordError(problems);
 return review;
}
