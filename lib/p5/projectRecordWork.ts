import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {readDraftById,DraftError,type Draft} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {claimWork,writeWork,renewWork,releaseWork} from './workStore.ts';
import {requestPricing,type PricingReply,type PricingRequest} from './scopePricing.ts';
import {PricingPending} from './pricingProgress.ts';
import {PROJECT_RECORD_VERSION} from './projectRecordContracts.ts';
import {projectHash,projectInput,type ProjectRecord} from './projectRecord.ts';
import {interpretProjectRecord,priceProjectRecord} from './projectWorkflow.ts';
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from './costBook.ts';
import {priceBookRates,PRICE_BOOK_VERSION,finishTier} from './priceBook.ts';
import {withRateCard} from './rateCard.ts';
import type {ReviewedScope} from './scope.ts';

const LATEST='project-record-latest-v1';
type StoredWork={startedAt:string;replies:Record<string,PricingReply>;record?:ProjectRecord;result?:unknown};
export function draftProjectScope(draft:Draft):ReviewedScope{
 return {text:draft.text,answers:draft.answers,extraction:draft.extraction,uploads:draft.uploads,reviewedAt:draft.updatedAt,corrections:[]};
}
export async function readProjectQualification(id:string){
 const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,LATEST]);
 return row?.payload as {draftRevision:number;record:ProjectRecord;result?:unknown}|undefined;
}
/** Authenticated staff qualification only. The public submit path is not
 * switched until real-model and estimate-content acceptance passes. No email,
 * lead delivery, owner-policy mutation or learned-rate promotion occurs. */
export async function runProjectQualification(id:string,expectedRevision:number,phase:'interpret'|'price',deadline=Date.now()+170000){
 if(ESTIMATOR_BRAND.domain!=='p5homeco.com')throw new DraftError('Project-record qualification is restricted to P5 Home Co.',403);
 const draft=await readDraftById(id);
 if(!draft||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Project not found.',404);
 if(draft.revision!==expectedRevision)throw new DraftError('The project changed. Reload before reviewing it.',409);
 const scope=draftProjectScope(draft),input=projectInput(scope);
 const prior=await readProjectQualification(id);
 if(phase==='interpret'&&prior?.record?.version===PROJECT_RECORD_VERSION&&prior.record.sourceHash===input.sourceHash&&prior.draftRevision===expectedRevision)
  return {status:prior.record.questions.some(q=>q.priority==='blocking')?'questions':'ready',record:prior.record,problems:[],attempts:0,reused:true};
 if(phase==='price'&&(!prior?.record||prior.record.sourceHash!==input.sourceHash))throw new DraftError('Interpret the current sources before selecting prices.',409);
 const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 const saved=(policy?.payload||EMPTY_CONFIGURATION) as EstimatorConfiguration;
 const rates=priceBookRates(draft.answers);
 const configuration:EstimatorConfiguration={...withRateCard(saved,rates),catalogVersion:`${saved.planningCatalog?.version||'missing'}+${PRICE_BOOK_VERSION}:${finishTier(draft.answers.finish)}`};
 const workKey='project-record-work:'+projectHash({contract:PROJECT_RECORD_VERSION,phase,revision:expectedRevision,sourceHash:input.sourceHash,catalog:phase==='price'?configuration:null,previous:prior?.record?.recordHash||null});
 const claim=await claimWork(id,workKey,{startedAt:new Date().toISOString(),replies:{}},210);
 if(!claim)throw new PricingPending('This project review is already running.',3000);
 const payload=claim.payload as StoredWork;
 const persist=()=>writeWork(id,workKey,claim.token,payload);
 const renewal=setInterval(()=>void renewWork(id,workKey,claim.token,210).catch(()=>{}),30000);
 try{
  if(payload.result)return payload.result;
  const staged:PricingRequest=async(instructions,context,search)=>{
   if(search)throw new Error('Project-record qualification does not authorize implicit web research.');
   const key=projectHash({instructions,context,search});
   if(payload.replies[key])return payload.replies[key];
   const left=deadline-Date.now();if(left<15000)throw new PricingPending('The completed review stages are saved. Continue to finish the remaining stages.',2000);
   const checkpoint=async(reply:PricingReply)=>{payload.replies[key]=reply;await persist();};
   return requestPricing(instructions,context,false,Math.min(left,150000),{draftId:id,customerKey:createHash('sha256').update('project-record-qualification:'+id).digest('hex'),revision:expectedRevision},undefined,checkpoint);
  };
  const options={request:staged,previous:prior?.record||null,now:new Date(payload.startedAt),deadline};
  const result=phase==='interpret'?await interpretProjectRecord(scope,options):await priceProjectRecord(prior!.record,configuration,options);
  payload.result=result;payload.record=result.record||undefined;await persist();
  if(result.record){
   // The SELECT guard makes revision checking and publication one statement.
   // An answer arriving during an AI call cannot publish a stale record.
   const rows=await query(`INSERT INTO p5_estimator_work(draft_id,work_key,payload)
    SELECT id,$2,$4::jsonb FROM p5_estimator_drafts WHERE id=$1 AND revision=$3
    ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now() RETURNING work_key`,[id,LATEST,expectedRevision,JSON.stringify({draftRevision:expectedRevision,record:result.record,result})]);
   if(!rows.length)throw new DraftError('The project changed during review. Its newer information is preserved.',409);
  }
  return result;
 }finally{clearInterval(renewal);await releaseWork(id,workKey,claim.token);}
}
