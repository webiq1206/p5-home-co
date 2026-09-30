import type {EstimatorConfiguration} from './costBook.ts';
import {requestPricing,type PricingRequest} from './scopePricing.ts';
import {PROJECT_RECORD_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,PROJECT_CATALOG_INSTRUCTIONS,PROJECT_COMPLETION_INSTRUCTIONS,type ProjectProposal} from './projectRecordContracts.ts';
import {acceptProjectCompletion,type ProjectCompletionPlan} from './projectCompletion.ts';
import {checkedProjectCandidates,projectCatalogIndex} from './projectCatalog.ts';
import {projectInput,acceptProjectRecord,ProjectRecordError,type ProjectRecord,type ProjectScope,type RecordProblem} from './projectRecord.ts';
import {projectPriceSelection,projectPriceProposalFromWire,compileProjectPrices,calculateProjectEstimate,projectReviewReceipt,validateProjectReview,type ProjectPriceSelection} from './projectPricing.ts';
import type {ProjectChange} from './projectConversation.ts';
import {verifiedReviewCatalog} from './projectReviewEvidence.ts';
import {projectSourceContext} from './projectCitations.ts';

export interface ProjectWorkflowOptions {request?:PricingRequest;previous?:ProjectRecord|null;changes?:ProjectChange[];now?:Date;deadline?:number;completionPlan?:ProjectCompletionPlan}
export interface ProjectReadResult {status:'ready'|'questions'|'needs-resolution';record:ProjectRecord|null;problems:RecordProblem[];attempts:number;completionPlan?:ProjectCompletionPlan}
function shapeProblems(error:unknown):RecordProblem[]{
 if(error instanceof ProjectRecordError)return error.problems;
 if(error&&typeof error==='object'&&'issues'in error&&Array.isArray(error.issues))return error.issues.map((issue:{path?:unknown[];message?:string})=>({code:'record-shape',ids:[],message:(issue.path||[]).join('.')+': '+issue.message}));
 throw error;
}
function budget(options:ProjectWorkflowOptions){const deadline=options.deadline||Date.now()+600000;return ()=>{const left=deadline-Date.now();if(left<1000)throw new Error('project-workflow-paused');return left;};}
export async function interpretProjectRecord(scope:ProjectScope,options:ProjectWorkflowOptions={}):Promise<ProjectReadResult>{
 const input=projectInput(scope,options.changes),request=options.request||requestPricing,remaining=budget(options),now=options.now||new Date();
 const citedSources=projectSourceContext(input.sources);
 // Incomplete uploads are repaired by the document reader, never ignored by
 // asking a text model to certify pages it did not receive.
 if(input.documentIssues.length)return {status:'needs-resolution',record:null,problems:input.documentIssues.map(message=>({code:'document-coverage',ids:[],message})),attempts:0};
 let problems:RecordProblem[]=[],candidate:ProjectProposal|unknown=null,completionCandidate:unknown=null,completionPlan:ProjectCompletionPlan|undefined;
 for(let attempt=1;attempt<=2&&!completionPlan;attempt++){
  const response=await request(PROJECT_COMPLETION_INSTRUCTIONS,{sources:citedSources,...(attempt>1?{previousProposal:completionCandidate,correctionsRequired:problems}:{})},false,remaining());
  completionCandidate=response.value;
  try{completionPlan=acceptProjectCompletion(completionCandidate,input);}catch(error){problems=shapeProblems(error);}
 }
 if(!completionPlan)return {status:'needs-resolution',record:null,problems,attempts:2};
 problems=[];
 for(let attempt=1;attempt<=2;attempt++){
  const response=await request(PROJECT_RECORD_INSTRUCTIONS,{sources:citedSources,completionPlan,previousRecord:options.previous||null,...(candidate?{previousProposal:candidate,correctionsRequired:problems}:{}),purpose:'Preliminary construction estimate; preserve exact project boundaries and disclose uncertainty.'},false,remaining());
  candidate=response.value;
  let record:ProjectRecord;
  try{record=acceptProjectRecord(candidate,input,options.previous||null,now);}catch(error){problems=shapeProblems(error);continue;}
  const audit=await request(PROJECT_REVIEW_INSTRUCTIONS,{stage:'scope-with-questions',sources:input.sources,completionPlan,record,selectedPrices:null,purpose:'Accept a faithful intermediate scope WITH useful questions. Missing source measurements or selections represented as unknown/conditional and addressed by necessary questions are expected, not defects. Check that no work or uncertainty is silently omitted.'},false,remaining());
  try{problems=validateProjectReview(record,audit.value,completionPlan).problems;}catch(error){problems=shapeProblems(error);}
  if(!problems.length)return {status:record.questions.some(q=>q.priority==='blocking')?'questions':'ready',record,completionPlan,problems:[],attempts:attempt};
 }
 return {status:'needs-resolution',record:null,completionPlan,problems,attempts:2};
}

export async function priceProjectRecord(record:ProjectRecord,configuration:EstimatorConfiguration,options:ProjectWorkflowOptions={}){
 const request=options.request||requestPricing,remaining=budget(options),now=options.now||new Date();
 if(record.questions.some(q=>q.priority==='blocking'))return {status:'questions' as const,record,problems:record.questions.filter(q=>q.priority==='blocking').map(q=>({code:'customer-question',ids:[q.id],message:q.prompt}))};
 const catalog=configuration.planningCatalog?.rates||[];
 let catalogCandidates:ReturnType<typeof checkedProjectCandidates>|null=null,catalogCandidate:unknown=null,problems:RecordProblem[]=[];
 for(let attempt=1;attempt<=2&&!catalogCandidates;attempt++){
  const response=await request(PROJECT_CATALOG_INSTRUCTIONS,{record,catalogIndex:projectCatalogIndex(catalog),...(attempt>1?{previousProposal:catalogCandidate,correctionsRequired:problems}:{})},false,remaining());
  catalogCandidate=response.value;
  try{catalogCandidates=checkedProjectCandidates(record,catalog,catalogCandidate);}catch(error){problems=shapeProblems(error);}
 }
 if(!catalogCandidates)return {status:'needs-resolution' as const,record,selection:null,problems,attempts:2};
 const candidateIds=new Set(catalogCandidates.requirements.flatMap(item=>item.candidates.map(candidate=>candidate.rateId)));
 const focusedCatalog=catalog.filter(rate=>candidateIds.has(rate.code));
 let selection:ProjectPriceSelection|null=null,candidate:unknown=null;
 problems=[];
 for(let attempt=1;attempt<=2;attempt++){
  // Discovery searches the entire index. Keep the first costing context on
  // those semantic matches; a failed proposal can still use the complete book.
  const response=await request(PROJECT_PRICE_INSTRUCTIONS,{record,catalogCandidates,catalog:attempt===1?focusedCatalog:catalog,catalogCoverage:attempt===1?'Semantically retrieved candidates from the complete approved index. The reviewer checks the complete book, which is available on correction.':'Complete approved catalog for resolving the recorded corrections.',...(attempt>1?{previousProposal:candidate,previousSelection:selection,correctionsRequired:problems}:{})},false,remaining());
  candidate=response.value;
  try{selection=projectPriceSelection(record,configuration,projectPriceProposalFromWire(record,configuration,candidate));}catch(error){problems=shapeProblems(error);continue;}
  const compiled=compileProjectPrices(record,selection,configuration,now);
  if(compiled.problems.length){problems=compiled.problems;continue;}
  const selectedCatalogIds=new Set(selection.proposal.lines.map(line=>line.rateId));
  const reviewContext={stage:'priced-estimate',sources:record.sources,completionPlan:options.completionPlan||null,record,selectedPrices:selection,selectedCatalog:catalog.filter(rate=>selectedCatalogIds.has(rate.code)),catalogCandidates,catalog,coverage:compiled.coverage};
  let verifiedReview:ReturnType<typeof verifiedReviewCatalog>|null=null,previousReview:unknown=null,reviewProblems:RecordProblem[]=[];
  for(let reviewAttempt=1;reviewAttempt<=2&&!verifiedReview;reviewAttempt++){
   const responseReview=await request(PROJECT_REVIEW_INSTRUCTIONS,{...reviewContext,...(reviewAttempt>1?{previousReview,correctionsRequired:reviewProblems,repairInstruction:'Repair the review only. Keep the current selected prices unchanged while verifying every catalog claim against the supplied catalog.'}:{})},false,remaining());
   previousReview=responseReview.value;
   try{verifiedReview=verifiedReviewCatalog(previousReview,catalog);}catch(error){reviewProblems=shapeProblems(error);}
  }
  if(!verifiedReview)return {status:'needs-resolution' as const,record,selection,problems:reviewProblems,attempts:attempt};
  try{
   const receipt=projectReviewReceipt(record,selection,verifiedReview,options.completionPlan);
   const result=calculateProjectEstimate(record,selection,configuration,receipt,now,options.completionPlan);
   if(result.status==='estimated')return {...result,attempts:attempt};
   problems=result.problems;
  }catch(error){problems=shapeProblems(error);}
 }
 return {status:'needs-resolution' as const,record,selection,problems,attempts:2};
}
