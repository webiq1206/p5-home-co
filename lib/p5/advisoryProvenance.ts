import {createHash} from 'node:crypto';
import {z} from 'zod';

const text=z.string().trim().min(1).max(4000);
const references={taskIds:z.array(text),lineIds:z.array(text)};
const notice=z.object({message:text,...references}).strict();
export const advisoryReviewSchema=z.object({
 assumptions:z.array(z.object({id:text,kind:z.enum(['advisory','current-blocker','superseded-proposal']),
  basis:z.enum(['scope-assumption','removed-proposal','canonical-rate-inclusions','retained-charge-count','policy-assignment']),
  message:text,...references,retiredCodes:z.array(text)}).strict()),
 advisories:z.array(notice),blockers:z.array(notice),
}).strict();
export type AdvisoryReview=z.infer<typeof advisoryReviewSchema>;
type Line={id:string;description:string;category:string;unit?:string;quantity:number|{fixed?:number;factor?:number};unitCost:number;evidence?:{reference:string};scopeTaskId?:string};
type Task={id:string;description:string;existingLineIds?:string[]};
export type AssumptionEntry={id:string;text:string;origin:'assumption'|'prior-issue'};
export type AdvisoryReviewRecord={version:'advisory-provenance-v1';ledger:AssumptionEntry[];review:AdvisoryReview;lineSignatures:Record<string,string>;taskSignatures:Record<string,string>;issues:string[];notes:string[]};
const unique=(values:string[])=>[...new Set(values)];
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantity=(line:Line)=>typeof line.quantity==='number'?line.quantity:(line.quantity.fixed??NaN)*(line.quantity.factor??1);
const live=(lines:Line[])=>[...new Map(lines.filter(line=>quantity(line)>0&&line.unitCost>0).map(line=>[line.id,line])).values()];
const signature=(line:Line)=>hash({id:line.id,description:line.description,category:line.category,unit:line.unit,quantity:quantity(line),unitCost:line.unitCost,reference:line.evidence?.reference||''});
const taskSignature=(task:Task,lines:Line[])=>hash({id:task.id,description:task.description,lineIds:unique([...(task.existingLineIds||[]),...lines.filter(line=>line.scopeTaskId===task.id).map(line=>line.id)]).sort()});
export function assumptionLedger(assumptions:string[],priorIssues:string[]):AssumptionEntry[]{
 const issues=new Set(priorIssues);
 return unique([...assumptions,...priorIssues]).map(text=>({id:'assumption-'+hash(text).slice(0,20),text,origin:issues.has(text)?'prior-issue':'assumption'}));
}
/** Stamp the exact audit input on the server, never accept a model-supplied
 * snapshot. Replayed stage replies are stamped against their original input. */
export function stampAdvisoryReview(ledger:AssumptionEntry[],review:AdvisoryReview,lines:Line[],tasks:Task[],issues:string[],notes:string[]):AdvisoryReviewRecord{
 const priced=live(lines);
 return {version:'advisory-provenance-v1',ledger:structuredClone(ledger),review:structuredClone(review),
  lineSignatures:Object.fromEntries(priced.map(line=>[line.id,signature(line)])),taskSignatures:Object.fromEntries(tasks.map(task=>[task.id,taskSignature(task,priced)])),issues:[...issues],notes:[...notes]};
}
type Finding={message:string;lineIds:string[];taskIds:string[];original?:string};
export type AdvisoryDisposition={reviewedTexts:string[];advisories:Finding[];blockers:Finding[];superseded:Finding[];invalid:Finding[]};
/** A typed disposition is necessary, but positive retained evidence is also
 * required. Unknown IDs, changed prices/quantities/coverage and incomplete
 * contracts fall back to pending review. A current blocker cannot disappear
 * through the legacy model-opinion release heuristics. */
export function resolveAdvisoryProvenance(records:AdvisoryReviewRecord[],lines:Line[],tasks:Task[],canonicalIds:Set<string>,policyCoverage:{taskId:string;lineIds:string[];allowanceComponents:string[]}[]):AdvisoryDisposition{
 const result:AdvisoryDisposition={reviewedTexts:[],advisories:[],blockers:[],superseded:[],invalid:[]};
 const priced=live(lines),ids=new Set(priced.map(line=>line.id));
 const taskById=new Map(tasks.map(task=>[task.id,task]));
 for(const record of records){
  if(!record||record.version!=='advisory-provenance-v1'||!Array.isArray(record.ledger)||!record.lineSignatures||!record.taskSignatures||!Array.isArray(record.issues)||!Array.isArray(record.notes)
   ||!advisoryReviewSchema.safeParse(record.review).success||record.ledger.some(entry=>!entry||typeof entry.text!=='string'||entry.id!=='assumption-'+hash(entry.text).slice(0,20)||!['assumption','prior-issue'].includes(entry.origin))){
   result.invalid.push({message:'The saved advisory review could not be validated.',lineIds:[...ids],taskIds:[]});continue;
  }
  const entries=new Map(record.ledger.map(entry=>[entry.id,entry]));
  const referencesValid=(item:{lineIds:string[];taskIds:string[]})=>item.lineIds.every(id=>ids.has(id)&&record.lineSignatures[id]===signature(priced.find(line=>line.id===id)!))
   &&item.taskIds.every(id=>taskById.has(id)&&record.taskSignatures[id]===taskSignature(taskById.get(id)!,priced));
  const located=(item:Finding)=>({...item,lineIds:item.lineIds.filter(id=>ids.has(id))});
  const counts=new Map<string,number>();for(const decision of record.review.assumptions)counts.set(decision.id,(counts.get(decision.id)||0)+1);
  for(const decision of record.review.assumptions){
   const entry=entries.get(decision.id);
   if(!entry)continue;
   const finding={message:decision.message,original:entry.text,lineIds:decision.lineIds,taskIds:decision.taskIds};
   if(counts.get(decision.id)!==1){result.invalid.push(located(finding));continue;}
   if(decision.kind==='current-blocker'){
    result.blockers.push(located(finding));result.reviewedTexts.push(entry.text);continue;
   }
   if(!referencesValid(decision)){result.invalid.push(located(finding));continue;}
   if(decision.kind==='advisory'&&entry.origin==='assumption'&&decision.basis==='scope-assumption'){
    result.advisories.push(located(finding));result.reviewedTexts.push(entry.text);continue;
   }
   if(decision.kind!=='superseded-proposal'||!decision.taskIds.length||!decision.lineIds.length){result.invalid.push(located(finding));continue;}
   const linked=unique(decision.taskIds.flatMap(id=>policyCoverage.find(item=>item.taskId===id)?.lineIds||[]));
   const grounded=decision.lineIds.every(id=>linked.includes(id));
   const codeMentioned=(code:string,text:string)=>text.split(/[^A-Za-z0-9-]+/).includes(code);
   const namesCurrent=decision.lineIds.some(id=>codeMentioned(id,entry.text)||priced.find(line=>line.id===id)?.evidence?.reference.split(';').some(part=>/^PB-[\w-]+$/.test(part.trim())&&codeMentioned(part.trim(),entry.text)));
   const namesTask=decision.taskIds.some(id=>codeMentioned(id,entry.text)||entry.text.includes(taskById.get(id)!.description));
   const proof=grounded&&(
    decision.basis==='removed-proposal'&&decision.retiredCodes.length>0&&decision.retiredCodes.every(code=>codeMentioned(code,entry.text)&&!priced.some(line=>codeMentioned(code,line.evidence?.reference||'')))
    ||decision.basis==='canonical-rate-inclusions'&&namesCurrent&&decision.lineIds.every(id=>canonicalIds.has(id))
    ||decision.basis==='retained-charge-count'&&(namesCurrent||namesTask)&&linked.filter(id=>priced.some(line=>line.id===id&&line.category==='field-labor')).length===1&&decision.lineIds.length===1&&priced.some(line=>line.id===decision.lineIds[0]&&line.category==='field-labor')
    ||decision.basis==='policy-assignment'&&namesTask&&decision.lineIds.includes('minor-work-allowance')&&decision.taskIds.every(id=>policyCoverage.some(item=>item.taskId===id&&item.allowanceComponents.length>0&&item.lineIds.includes('minor-work-allowance')))
   );
   if(proof){result.superseded.push(located(finding));result.reviewedTexts.push(entry.text);}
   else result.invalid.push(located(finding));
  }
  for(const blocker of record.review.blockers)result.blockers.push(located({...blocker,original:blocker.message}));
  for(const advisory of record.review.advisories){
   if(referencesValid(advisory))result.advisories.push(located(advisory));
   else result.invalid.push(located(advisory));
  }
  // A response cannot omit a legacy issue by merely supplying an empty typed
  // blocker array. Every unrepresented issue remains a current blocker.
  for(const issue of record.issues)if(!record.review.blockers.some(item=>item.message===issue))result.blockers.push({message:issue,original:issue,lineIds:[...ids],taskIds:[]});
  for(const entry of record.ledger)if(entry.origin==='prior-issue'&&!result.reviewedTexts.includes(entry.text))result.blockers.push({message:entry.text,original:entry.text,lineIds:[...ids],taskIds:[]});
 }
 result.reviewedTexts=unique(result.reviewedTexts);
 // Multiple audit sections may disagree. A concern retained by any section
 // wins over another section's attempted resolution.
 const unresolved=new Set([...result.blockers,...result.invalid].map(item=>item.original).filter(Boolean));
 result.reviewedTexts=result.reviewedTexts.filter(text=>!unresolved.has(text)||result.blockers.some(item=>item.original===text));
 result.superseded=result.superseded.filter(item=>!unresolved.has(item.original));
 return result;
}
