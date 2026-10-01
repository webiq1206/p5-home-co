import {projectCompletionSchema,projectCompletionWireFor,type ProjectCompletion,type ProjectReview} from './projectRecordContracts.ts';
import {projectHash,ProjectRecordError,type ProjectInput,type ProjectRecord,type RecordProblem} from './projectRecord.ts';
import {quotationFeedback} from './quotationFeedback.ts';
import {sourcePassageIndex} from './projectCitations.ts';

export interface ProjectCompletionPlan extends ProjectCompletion {sourceHash:string;planHash:string;sourceChecks?:Record<string,string>}
const normalize=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim();
/** An independent source-first method is a model proposal, never new source
 * evidence. Keep its identity and original quotations available for audit. */
export function acceptProjectCompletion(raw:unknown,input:ProjectInput):ProjectCompletionPlan{
 const wire=raw&&typeof raw==='object'&&'sourceChecks'in raw?projectCompletionWireFor(input.sources).parse(raw):null;
 const passages=sourcePassageIndex(input.sources);
 const plan=wire?{reviewedSourceIds:input.sources.map(source=>source.id),sourceChecks:wire.sourceChecks,steps:wire.steps.map(step=>({...step,evidence:step.evidence.map(reference=>({...passages.get(reference.passageId)!}))}))}:projectCompletionSchema.parse(raw),problems:RecordProblem[]=[],sources=new Map(input.sources.map(source=>[source.id,source]));
 const fail=(code:string,ids:string[],message:string)=>problems.push({code,ids,message});
 const reviewed=new Set(plan.reviewedSourceIds);
 if(reviewed.size!==plan.reviewedSourceIds.length)fail('completion-source',[],'Each source must be reviewed once in the work method.');
 for(const id of reviewed)if(!sources.has(id))fail('completion-source',[id],'The work method references an unknown source.');
 for(const source of input.sources)if(!reviewed.has(source.id))fail('completion-source',[source.id],`The work method has not accounted for ${source.name} (${source.kind}, ${source.status}). Review this supplied source and reconcile it with the complete project before returning its ID. Do not silently omit it or assert that unreadable content was read.`);
 const seen=new Set<string>();
 for(const step of plan.steps){
  if(seen.has(step.id))fail('completion-id',[step.id],'Work-method step IDs must be unique.');seen.add(step.id);
  for(const evidence of step.evidence){const source=sources.get(evidence.sourceId);
   if(!source||!normalize(source.text).includes(normalize(evidence.quote))){
    const matches=input.sources.filter(candidate=>normalize(candidate.text).includes(normalize(evidence.quote)));
    const hint=matches.length?` This exact quotation occurs in ${matches.map(candidate=>`${candidate.id} (${candidate.name})`).join(', ')}. Verify its meaning and correct the citation explicitly; it has not been reassigned automatically.`:'';
    fail('completion-evidence',[step.id,evidence.sourceId],'The work method must quote the actual identified source. '+quotationFeedback(evidence.quote,source?.text)+hint);
   }
   if(source?.status==='unreadable'&&step.kind!=='decision-needed')fail('completion-evidence',[step.id,evidence.sourceId],'An unreadable source cannot establish a confirmed operation; identify its actual uncertainty.');
  }
 }
 if(problems.length)throw new ProjectRecordError(problems);
 return {...plan,sourceHash:input.sourceHash,planHash:projectHash({sourceHash:input.sourceHash,plan})};
}
export function completionReviewProblems(record:ProjectRecord,review:ProjectReview,plan:ProjectCompletionPlan):RecordProblem[]{
 const {planHash,sourceHash,...body}=plan,problems:RecordProblem[]=[];
 const fail=(code:string,ids:string[],message:string)=>problems.push({code,ids,message});
 if(sourceHash!==record.sourceHash||planHash!==projectHash({sourceHash,plan:body}))fail('stale-completion',[],'The work-method check must match these exact current sources and its saved content.');
 const requirements=new Map(record.requirements.map(requirement=>[requirement.id,requirement])),questions=new Map(record.questions.map(question=>[question.id,question]));
 const stepIds=new Set(plan.steps.map(step=>step.id)),evidenceIds=new Set(record.evidence.map(evidence=>evidence.id));
 for(const check of review.completionChecks)if(!stepIds.has(check.stepId))fail('completion-review',[check.stepId],'The completion review references an unknown method step.');
 for(const step of plan.steps){
  const checks=review.completionChecks.filter(check=>check.stepId===step.id);
  if(checks.length!==1){fail('completion-review',[step.id],'Every independently proposed method step needs exactly one explicit coverage decision.');continue;}
  const check=checks[0];
  for(const id of check.evidenceIds)if(!evidenceIds.has(id))fail('completion-evidence',[step.id,id],'The coverage decision must cite actual record evidence.');
  if(check.outcome==='missing'){fail('scope-omission',[step.id],`Missing ${step.operation} for ${step.subject}. Required correction: ${check.reason}`);continue;}
  if(check.outcome==='not-required')continue; // Its source-supported rationale is checked by the semantic reviewer.
  for(const id of check.requirementIds)if(!requirements.has(id))fail('completion-requirement',[step.id,id],'Completion coverage references an unknown requirement.');
  for(const id of check.questionIds)if(!questions.has(id)||questions.get(id)!.priority!=='blocking')fail('completion-question',[step.id,id],'A pending method decision must link a current blocking question.');
  const pending=check.questionIds.some(id=>questions.get(id)?.priority==='blocking');
  const represented=check.requirementIds.some(id=>{
   const requirement=requirements.get(id);
   return requirement&&['included','conditional'].includes(requirement.status)&&requirement.operation===step.operation&&(step.responsibility==='unassigned'||requirement.responsibility===step.responsibility);
  });
  if(step.kind==='decision-needed'&&!pending)fail('completion-decision',[step.id],'This unresolved method decision needs a linked question, or source evidence establishing why it is not required.');
  if(!represented&&!pending)fail('completion-operation',[step.id,...check.requirementIds],`The ${step.operation} operation for ${step.subject} is not represented. A different operation or broad installed item cannot silently absorb this work. Add its actual requirement, ask about a real uncertainty, or establish from source evidence why it is unnecessary.`);
 }
 return problems;
}
