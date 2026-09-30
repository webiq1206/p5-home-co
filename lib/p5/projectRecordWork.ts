import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {readDraftById,DraftError,type Draft} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {claimWork,writeWork,renewWork,releaseWork} from './workStore.ts';
import {requestPricing,type PricingReply,type PricingRequest} from './scopePricing.ts';
import {PricingPending} from './pricingProgress.ts';
import {PROJECT_RECORD_VERSION,PROJECT_RECORD_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS,projectContractSchema} from './projectRecordContracts.ts';
import {projectHash,projectInput,projectRecordIntegrity,type ProjectRecord,type ProjectScope} from './projectRecord.ts';
import {interpretProjectRecord,priceProjectRecord} from './projectWorkflow.ts';
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from './costBook.ts';
import {priceBookRates,PRICE_BOOK_VERSION,finishTier} from './priceBook.ts';
import {withRateCard} from './rateCard.ts';
import {readProjectConversation,activeProjectChanges} from './projectConversation.ts';

const LATEST='project-record-latest-v1';
export const PROJECT_WORKFLOW_CONTRACT_HASH=projectHash({version:PROJECT_RECORD_VERSION,stages:[PROJECT_RECORD_INSTRUCTIONS,PROJECT_PRICE_INSTRUCTIONS,PROJECT_REVIEW_INSTRUCTIONS].map(instructions=>({instructions,schema:projectContractSchema(instructions)}))});
type QualificationResult=(Awaited<ReturnType<typeof interpretProjectRecord>>|Awaited<ReturnType<typeof priceProjectRecord>>)&{runEvidence?:{contractHash:string;completedStages:{requestHash:string;requestedModel:string|null;returnedModel:string|null;providerRequestIds:string[]}[]}};
type StoredWork={startedAt:string;replies:Record<string,PricingReply>;requests?:Record<string,{instructions:string;input:unknown;startedAt:string}>;record?:ProjectRecord;result?:QualificationResult};
/** Both a first completion and recovery of a saved completion pass through the
 * same atomic revision guard. Saving provider work is not publication. */
export async function publishProjectQualification(id:string,expectedRevision:number,result:QualificationResult,execute:typeof query=query){
 if(result.record&&!projectRecordIntegrity(result.record))throw new DraftError('The saved project review needs to be rebuilt from its current sources.',409);
 const rows=result.record?await execute(`INSERT INTO p5_estimator_work(draft_id,work_key,payload)
  SELECT id,$2,$4::jsonb FROM p5_estimator_drafts WHERE id=$1 AND revision=$3
  ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now() RETURNING work_key`,[id,LATEST,expectedRevision,JSON.stringify({draftRevision:expectedRevision,contractHash:PROJECT_WORKFLOW_CONTRACT_HASH,record:result.record,result})])
  :await execute('SELECT id FROM p5_estimator_drafts WHERE id=$1 AND revision=$2',[id,expectedRevision]);
 if(!rows.length)throw new DraftError('The project changed during review. Its newer information is preserved.',409);
 return result;
}
export function draftProjectScope(draft:Draft):ProjectScope{
 let analyzed:Record<string,string>={};
 try{const pairs=JSON.parse(draft.analyzedAnswers||'[]');if(Array.isArray(pairs)&&pairs.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='string')))analyzed=Object.fromEntries(pairs);}catch{/* A legacy snapshot with unknown provenance cannot attest an answer. */}
 const answerOrigins:NonNullable<ProjectScope['answerOrigins']>={};
 for(const [field,value]of Object.entries(draft.answers)){
  const explicitlyConfirmed=Object.entries(draft.wizard?.resolutions||{}).some(([key,v])=>key===field&&v===value)||Boolean(draft.reviewed?.text===draft.text&&Object.entries(draft.reviewed.answers).some(([key,v])=>key===field&&v===value));
  const extracted=analyzed[field]===value||Boolean(draft.extraction?.facts.some(f=>f.field===field&&f.value===value));
  answerOrigins[field]=explicitlyConfirmed||!draft.extraction?'customer':extracted?'reader':'unconfirmed';
 }
 return {text:draft.text,answers:draft.answers,answerOrigins,extraction:draft.extraction,uploads:draft.uploads,reviewedAt:draft.updatedAt,corrections:[]};
}
export async function readProjectQualification(id:string){
 const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,LATEST]);
 return row?.payload as {draftRevision:number;contractHash?:string;record:ProjectRecord;result?:unknown}|undefined;
}
/** Authenticated staff qualification only. The public submit path is not
 * switched until real-model and estimate-content acceptance passes. No email,
 * lead delivery, owner-policy mutation or learned-rate promotion occurs. */
export async function runProjectQualification(id:string,expectedRevision:number,phase:'interpret'|'price',deadline=Date.now()+170000){
 if(ESTIMATOR_BRAND.domain!=='p5homeco.com')throw new DraftError('Project-record qualification is restricted to P5 Home Co.',403);
 const draft=await readDraftById(id);
 if(!draft||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Project not found.',404);
 if(draft.revision!==expectedRevision)throw new DraftError('The project changed. Reload before reviewing it.',409);
 const changes=activeProjectChanges((await readProjectConversation(id)).filter(change=>change.draftRevision<=expectedRevision));
 const scope=draftProjectScope(draft),input=projectInput(scope,changes);
 const prior=await readProjectQualification(id);
 const previous=prior?.record&&projectRecordIntegrity(prior.record)?prior.record:null;
 if(phase==='interpret'&&previous&&previous.sourceHash===input.sourceHash&&prior?.draftRevision===expectedRevision&&prior.contractHash===PROJECT_WORKFLOW_CONTRACT_HASH)
  return {status:prior.record.questions.some(q=>q.priority==='blocking')?'questions':'ready',record:prior.record,problems:[],attempts:0,reused:true};
 if(phase==='price'&&(!previous||previous.sourceHash!==input.sourceHash||prior?.draftRevision!==expectedRevision||prior.contractHash!==PROJECT_WORKFLOW_CONTRACT_HASH))throw new DraftError('Interpret the current sources before selecting prices.',409);
 const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 const saved=(policy?.payload||EMPTY_CONFIGURATION) as EstimatorConfiguration;
 const rates=priceBookRates(draft.answers);
 const configuration:EstimatorConfiguration={...withRateCard(saved,rates),catalogVersion:`${saved.planningCatalog?.version||'missing'}+${PRICE_BOOK_VERSION}:${finishTier(draft.answers.finish)}`};
 const workKey='project-record-work:'+projectHash({contract:PROJECT_WORKFLOW_CONTRACT_HASH,phase,revision:expectedRevision,sourceHash:input.sourceHash,catalog:phase==='price'?configuration:null,previous:previous?.recordHash||null});
 const claim=await claimWork(id,workKey,{startedAt:new Date().toISOString(),replies:{}},210);
 if(!claim)throw new PricingPending('This project review is already running.',3000);
 const payload=claim.payload as StoredWork;
 const persist=()=>writeWork(id,workKey,claim.token,payload);
 const renewal=setInterval(()=>void renewWork(id,workKey,claim.token,210).catch(()=>{}),30000);
 try{
  if(payload.result)return await publishProjectQualification(id,expectedRevision,payload.result);
  const staged:PricingRequest=async(instructions,context,search)=>{
   if(search)throw new Error('Project-record qualification does not authorize implicit web research.');
   const key=projectHash({instructions,context,search});
   if(payload.replies[key])return payload.replies[key];
   const left=deadline-Date.now();if(left<15000)throw new PricingPending('The completed review stages are saved. Continue to finish the remaining stages.',2000);
   payload.requests??={};payload.requests[key]={instructions,input:context,startedAt:new Date().toISOString()};await persist();
   const checkpoint=async(reply:PricingReply)=>{payload.replies[key]=reply;await persist();};
   return requestPricing(instructions,context,false,Math.min(left,150000),{draftId:id,customerKey:createHash('sha256').update('project-record-qualification:'+id).digest('hex'),revision:expectedRevision},undefined,checkpoint);
  };
  const options={request:staged,previous,changes,now:new Date(payload.startedAt),deadline};
  const workflowResult=phase==='interpret'?await interpretProjectRecord(scope,options):await priceProjectRecord(previous!,configuration,options);
  const result:QualificationResult={...workflowResult,runEvidence:{contractHash:PROJECT_WORKFLOW_CONTRACT_HASH,completedStages:Object.entries(payload.replies).map(([requestHash,reply])=>({requestHash,requestedModel:reply.model||null,returnedModel:reply.responseModel||null,providerRequestIds:reply.providerRequestIds||[]}))}};
  payload.result=result;payload.record=result.record||undefined;await persist();
  return await publishProjectQualification(id,expectedRevision,result);
 }finally{clearInterval(renewal);await releaseWork(id,workKey,claim.token);}
}
