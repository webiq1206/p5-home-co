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
  const correction=normalize(finding.requiredCorrection);
  // Explanatory prose after "none required" does not turn an acknowledgement
  // into an actionable defect. Reject the contradictory review, including a
  // mixed correction, so the reviewer must restate any actual change. Never
  // remove the finding or accept the price from this wording alone.
  if(/^(?:(?:required )?correction:\s*)?(?:none(?: (?:is )?(?:required|needed))?|no (?:correction|change|action)(?: (?:is )?(?:required|needed))?|n\/a)(?=$|[\s.!:;,\u2013-\u2015-])/i.test(correction))
   problems.push({code:'review-nonactionable-finding',ids:[finding.id],message:'This finding explicitly requires no correction. Review this selection again: place confirmations in notes, or identify the actual defect and a concrete required change. Do not reprice a justified selection merely to satisfy a contradictory review.'});
  const cited=new Set(finding.catalogEvidence.map(item=>item.rateId));
  if(finding.code==='rate-fit'&&!cited.size)problems.push({code:'review-catalog-evidence',ids:[finding.id],message:'A rate-fit objection must cite the actual supplied rate descriptions, including every proposed alternative.'});
  for(const item of finding.catalogEvidence){
   const rate=rates.get(item.rateId);
   if(!rate)problems.push({code:'review-catalog-evidence',ids:[finding.id,item.rateId],message:'This reviewer-cited rate is absent from the supplied catalog. Correct the review against actual entries; do not change pricing to use an invented alternative.'});
   else if(!normalize(rate.description).includes(normalize(item.quote)))problems.push({code:'review-catalog-evidence',ids:[finding.id,item.rateId],message:quotationFeedback(item.quote,rate.description)});
  }
  for(const code of new Set(references?(finding.message+' '+finding.requiredCorrection).match(references)||[]:[])){
   const rate=rates.get(code);
   if(!rate||!cited.has(code))problems.push({code:'review-catalog-evidence',ids:[finding.id,code],message:rate
    ?`Finding ${finding.id} mentions ${code} but omits its catalogEvidence. Its actual catalog description is ${JSON.stringify(rate.description)}. Add a literal supporting excerpt and verify the claim against it. Repair the review before requesting a pricing correction.`
    :`Finding ${finding.id} mentions ${code}, which does not exist in the supplied catalog. Remove the unsupported claim or identify an actual entry with literal catalogEvidence. Do not change pricing to use an invented rate.`});
  }
 }
 if(problems.length)throw new ProjectRecordError(problems);
 return review;
}
