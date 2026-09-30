import type {ReviewedScope} from './scope.ts';
import type {EstimatorConfiguration} from './costBook.ts';
import {requestPricing,type PricingRequest} from './scopePricing.ts';
import {PROJECT_RECORD_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,PROJECT_CATALOG_INSTRUCTIONS,projectPricingProposalSchema,type ProjectProposal} from './projectRecordContracts.ts';
import {checkedProjectCandidates,projectCatalogIndex} from './projectCatalog.ts';
import {projectInput,acceptProjectRecord,ProjectRecordError,type ProjectRecord,type RecordProblem} from './projectRecord.ts';
import {projectPriceSelection,compileProjectPrices,calculateProjectEstimate,projectReviewReceipt,validateProjectReview,type ProjectPriceSelection} from './projectPricing.ts';
import type {ProjectChange} from './projectConversation.ts';

export interface ProjectWorkflowOptions {request?:PricingRequest;previous?:ProjectRecord|null;changes?:ProjectChange[];now?:Date;deadline?:number}
export interface ProjectReadResult {status:'ready'|'questions'|'needs-resolution';record:ProjectRecord|null;problems:RecordProblem[];attempts:number}
function shapeProblems(error:unknown):RecordProblem[]{
 if(error instanceof ProjectRecordError)return error.problems;
 if(error&&typeof error==='object'&&'issues'in error&&Array.isArray(error.issues))return error.issues.map((issue:{path?:unknown[];message?:string})=>({code:'record-shape',ids:[],message:(issue.path||[]).join('.')+': '+issue.message}));
 throw error;
}
function budget(options:ProjectWorkflowOptions){const deadline=options.deadline||Date.now()+600000;return ()=>{const left=deadline-Date.now();if(left<1000)throw new Error('project-workflow-paused');return left;};}
export async function interpretProjectRecord(scope:ReviewedScope,options:ProjectWorkflowOptions={}):Promise<ProjectReadResult>{
 const input=projectInput(scope,options.changes),request=options.request||requestPricing,remaining=budget(options),now=options.now||new Date();
 // Incomplete uploads are repaired by the document reader, never ignored by
 // asking a text model to certify pages it did not receive.
 if(input.documentIssues.length)return {status:'needs-resolution',record:null,problems:input.documentIssues.map(message=>({code:'document-coverage',ids:[],message})),attempts:0};
 let problems:RecordProblem[]=[],candidate:ProjectProposal|unknown=null;
 for(let attempt=1;attempt<=2;attempt++){
  const response=await request(PROJECT_RECORD_INSTRUCTIONS,{sources:input.sources,previousRecord:options.previous||null,...(candidate?{previousProposal:candidate,correctionsRequired:problems}:{}),purpose:'Preliminary construction estimate; preserve exact project boundaries and disclose uncertainty.'},false,remaining());
  candidate=response.value;
  let record:ProjectRecord;
  try{record=acceptProjectRecord(candidate,input,options.previous||null,now);}catch(error){problems=shapeProblems(error);continue;}
  const audit=await request(PROJECT_REVIEW_INSTRUCTIONS,{sources:input.sources,record,selectedPrices:null,purpose:'Check scope completeness, quantity evidence, dependencies and question necessity before pricing.'},false,remaining());
  try{problems=validateProjectReview(record,audit.value).problems;}catch(error){problems=shapeProblems(error);}
  if(!problems.length)return {status:record.questions.some(q=>q.priority==='blocking')?'questions':'ready',record,problems:[],attempts:attempt};
 }
 return {status:'needs-resolution',record:null,problems,attempts:2};
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
 let selection:ProjectPriceSelection|null=null,candidate:unknown=null;
 problems=[];
 for(let attempt=1;attempt<=2;attempt++){
  const response=await request(PROJECT_PRICE_INSTRUCTIONS,{record,catalogCandidates,catalog,...(attempt>1?{previousProposal:candidate,previousSelection:selection,correctionsRequired:problems}:{})},false,remaining());
  candidate=response.value;
  try{projectPricingProposalSchema.parse(candidate);selection=projectPriceSelection(record,configuration,candidate);}catch(error){problems=shapeProblems(error);continue;}
  const compiled=compileProjectPrices(record,selection,configuration,now);
  if(compiled.problems.length){problems=compiled.problems;continue;}
  const selectedCatalogIds=new Set(selection.proposal.lines.map(line=>line.rateId));
  const responseReview=await request(PROJECT_REVIEW_INSTRUCTIONS,{sources:record.sources,record,selectedPrices:selection,selectedCatalog:catalog.filter(rate=>selectedCatalogIds.has(rate.code)),catalogCandidates,catalog,coverage:compiled.coverage},false,remaining());
  try{
   const receipt=projectReviewReceipt(record,selection,responseReview.value);
   const result=calculateProjectEstimate(record,selection,configuration,receipt,now);
   if(result.status==='estimated')return {...result,attempts:attempt};
   problems=result.problems;
  }catch(error){problems=shapeProblems(error);}
 }
 return {status:'needs-resolution' as const,record,selection,problems,attempts:2};
}
