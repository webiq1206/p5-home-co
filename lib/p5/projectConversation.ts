import {query,transaction} from './database.ts';
import {DraftError} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {projectHash,projectRecordIntegrity,type ProjectRecord} from './projectRecord.ts';
import {assertQaOperationAccess} from './qaOperationFence.ts';

const KEY='project-conversation-v1';
export interface ProjectChange {
 sequence:number;draftRevision:number;requestId:string;requestHash:string;kind:'answer'|'revision';
 questionId:string|null;prompt:string;requirementIds:string[];quantityIds:string[];
 response:string;recordHash:string;createdAt:string;
}
export interface ProjectChangeRequest {
 requestId:string;revision:number;recordHash:string;kind:'answer'|'revision';questionId?:string;response:string;
}
export async function readProjectConversation(id:string,execute:typeof query=query):Promise<ProjectChange[]>{
 const [row]=await execute('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,KEY]);
 return row?.payload?.changes||[];
}
/** A revised answer replaces only its earlier answer. Other answers and all
 * ordered scope revisions remain available, including their question context. */
export function activeProjectChanges(changes:ProjectChange[]):ProjectChange[]{
 const latest=new Map<string,number>();
 for(const change of changes)if(change.kind==='answer')latest.set(change.questionId!,change.sequence);
 return changes.filter(change=>change.kind==='revision'||latest.get(change.questionId!)===change.sequence).sort((a,b)=>a.sequence-b.sequence);
}
/** No fixed answer-field list and no scenario parser. The exact question and
 * answer become evidence for a newly interpreted project revision. */
export async function saveProjectChange(id:string,request:ProjectChangeRequest,within:typeof transaction=transaction){
 if(ESTIMATOR_BRAND.domain!=='p5homeco.com')throw new DraftError('Project-record qualification is restricted to P5 Home Co.',403);
 if(!request||!Number.isSafeInteger(request.revision)||request.revision<1||!['answer','revision'].includes(request.kind)||!/^[-a-f0-9]{36}$/i.test(request.requestId||'')||typeof request.response!=='string'||!request.response.trim()||request.response.length>10000||!/^([a-f0-9]{64})$/.test(request.recordHash||''))throw new DraftError('A current project, question and nonempty response are required.');
 const response=request.response.trim(),requestHash=projectHash({...request,response});
 return within(async execute=>{
  const [draft]=await execute('SELECT revision,status,brand FROM p5_estimator_drafts WHERE id=$1 FOR UPDATE',[id]);
  await assertQaOperationAccess(id,execute);
  if(!draft||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Project not found.',404);
  if(draft.status!=='draft')throw new DraftError('Start a new project revision before changing this submitted estimate.',409);
  const changes=await readProjectConversation(id,execute),repeated=changes.find(change=>change.requestId===request.requestId);
  if(repeated){
   if(repeated.requestHash!==requestHash)throw new DraftError('This saved response cannot be reused for different changes.',409);
   return {revision:Number(draft.revision),savedRevision:repeated.draftRevision,reused:true};
  }
  if(Number(draft.revision)!==request.revision)throw new DraftError('The project changed. Reload its current questions before answering.',409);
  const [latest]=await execute('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,'project-record-latest-v1']);
  const record=latest?.payload?.record as ProjectRecord|undefined;
  if(!record||latest.payload.draftRevision!==request.revision||!projectRecordIntegrity(record)||record.recordHash!==request.recordHash)throw new DraftError('The project review changed. Reload before submitting this response.',409);
  const earlier=activeProjectChanges(changes).find(change=>change.kind==='answer'&&change.questionId===request.questionId);
  const earlierStillApplies=earlier&&earlier.requirementIds.every(id=>record.requirements.some(r=>r.id===id&&!['excluded','existing'].includes(r.status)))&&earlier.quantityIds.every(id=>record.quantities.some(q=>q.id===id));
  const question=request.kind==='answer'?(record.questions.find(q=>q.id===request.questionId)||(earlierStillApplies?{id:earlier.questionId!,prompt:earlier.prompt,requirementIds:earlier.requirementIds,quantityIds:earlier.quantityIds}:null)):null;
  if(request.kind==='answer'&&!question)throw new DraftError('That question is no longer current. Reload the project review.',409);
  const revision=request.revision+1;
  const change:ProjectChange={sequence:(changes.at(-1)?.sequence||0)+1,draftRevision:revision,requestId:request.requestId,requestHash,kind:request.kind,questionId:question?.id||null,prompt:question?.prompt||'Customer scope revision',requirementIds:question?.requirementIds||[],quantityIds:question?.quantityIds||[],response,recordHash:record.recordHash,createdAt:new Date().toISOString()};
  // Holding the draft row lock serializes competing answers and the revision
  // guard used to publish model work. A partial write rolls back completely.
  await execute("UPDATE p5_estimator_drafts SET revision=$2,payload=jsonb_set(payload,'{reviewed}','null'::jsonb),updated_at=now() WHERE id=$1",[id,revision]);
  await execute('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[id,KEY,JSON.stringify({changes:[...changes,change]})]);
  return {revision,savedRevision:revision,reused:false};
 });
}
