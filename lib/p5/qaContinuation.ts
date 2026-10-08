import {intakeQuestions} from './intakeQuestions.ts';
import {createHash,randomUUID} from 'node:crypto';
import {query,transaction} from './database.ts';
import {getPool,transaction as siteTransaction} from '../../app/lib/db.ts';
import {QA_CASES,QA_OPERATION_KEY,isOperatorQaCase} from './qaCases.ts';
import {withinQaOperationPhase,type QaOperation,type QaIntent} from './qaOperationContext.ts';
import {DraftError,type Draft} from './store.ts';
import {scopeQuestionsForBrand,reconcileScope} from './adaptive.ts';
import {costQuestionFields} from './questionPolicy.ts';
import {SCOPE_FIELDS,type ScopeField} from './scope.ts';
import {scopeFingerprint} from './scopeReplacement.ts';
import {customerQuestionKey} from './customerAnswers.ts';
import {postScope} from './scopeEndpoint.ts';
import {putDraft} from './draftEndpoint.ts';
import {postSubmission} from './submitEndpoint.ts';
import {customerPdf,pdfFilename} from './pdf.ts';
import {customerPresentation,HIDE_CUSTOMER_UNIT_RATES} from './presentation.ts';

const RUN='p5-acceptance-20261004',TENANT='p5homeco.com',NEXT='qa-next-stage-v1',RECEIPT='qa-transition-v1:';
type Read=typeof query;
type Row=Awaited<ReturnType<Read>>[number];
type Action={kind:'reading'|'pricing'|'review'|'answer';questionId?:string;answer?:string};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const sourceHash=(d:Draft)=>hash([d.text,d.answers,d.extraction,d.reviewed,d.wizard,d.uploads]);
function identify(name:unknown){
  if(typeof name!=='string'||!Object.hasOwn(QA_CASES,name))throw new DraftError('Unknown QA continuation case.',404);
  const [id,label]=QA_CASES[name as keyof typeof QA_CASES];
  if(!isOperatorQaCase(id))throw new DraftError('QA continuation is restricted to P5.',403);
  return {name,id,label,project:'qa-paid-'+id};
}
const STATE=`SELECT pg_is_in_recovery() AS replica,now()::text AS checked_at,
 (SELECT jsonb_build_object('revision',revision,'status',status,'brand',brand,'payload',payload,'customer',customer_estimate,'submittedAt',submitted_at) FROM p5_estimator_drafts WHERE id=$1) AS draft,
 (SELECT jsonb_build_object('run_id',run_id,'allowance',allowance_microusd,'liability',liability_microusd,'historical',historical_microusd,'unknown',historical_unknown_microusd,'blocked',blocked) FROM p5ds_qa_runs WHERE run_id=$2) AS run,
 (SELECT run_id FROM p5ds_qa_projects WHERE tenant=$3 AND project=$4) AS binding,
 (SELECT count(*)::int FROM p5_estimator_files WHERE draft_id=$1) AS files,
 EXISTS(SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key='qa-bounded-provider-v1' AND payload->>'brokerRequired'='true') AS bounded,
 EXISTS(SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key='qa-no-provider-v1') AS deterministic,
 EXISTS(SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND (lease_until>now() OR (work_key LIKE 'background-v1-%' AND payload->>'state' IN ('queued','running')) OR (work_key='submit-request-v1' AND payload->>'state'='pending'))) AS busy,
 EXISTS(SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND work_key='submit-request-v1' AND coalesce(payload->>'notifyEmail','')<>'') AS "contactRequest",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('hash',request_hash,'status',status)) FROM p5ds_qa_calls WHERE run_id=$2 AND status<>'settled'),'[]'::jsonb) AS held,
 (SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key='qa-next-stage-v1') AS next,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('key',work_key,'payload',payload)) FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'qa-transition-v1:%'),'[]'::jsonb) AS receipts,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('revision',o.revision,'status',o.status,
   'suppressed',o.destination='suppressed:synthetic-qa',
   'untouched',o.attempts=0 AND o.provider_id IS NULL AND o.sent_at IS NULL AND o.locked_until IS NULL,
   'matchesSaved',o.payload->>'draftId'=$1::text AND o.payload->>'revision'=o.revision::text
     AND o.payload->>'brand'='P5 Home Co' AND o.payload->'contact'=o.payload->'customer'->'issue'->'contact'
     AND o.payload->'customer'=(SELECT customer_estimate FROM p5_estimator_drafts WHERE id=$1)))
   FROM p5_estimator_outbox o WHERE o.draft_id=$1 AND o.revision=(SELECT revision FROM p5_estimator_drafts WHERE id=$1)),'[]'::jsonb) AS delivery`;
async function readState(name:unknown,read:Read=query){
  const identity=identify(name),[row]=await read(STATE,[identity.id,RUN,TENANT,identity.project]);
  if(!row||row.replica!==false)throw new DraftError('A current application primary snapshot is required.',409);
  const d=row.draft,r=row.run;
  if(!d||d.brand!=='p5'||!['draft','submitted'].includes(d.status)||!Number.isSafeInteger(d.revision)||d.revision<1)throw new DraftError('The existing QA draft could not be verified.',409);
  if(row.binding!==RUN||!row.bounded||row.deterministic||!r||r.run_id!==RUN||Number(r.allowance)!==2000000||Number(r.historical)!==3250000||Number(r.unknown)!==390000||!Number.isSafeInteger(Number(r.liability))||Number(r.liability)<0||Number(r.liability)>2000000)throw new DraftError('Existing QA accounting and bindings must be verified.',409);
  const p=d.payload;
  if(typeof p?.text!=='string'||!p.answers||!/^\[QA\](?:\s|$)/i.test(p.contact?.name||'')||p.contact?.email!==''||p.contact?.phone!==''||row.contactRequest)throw new DraftError('Synthetic contact safeguards failed.',409);
  if(row.files!==0||p.uploads?.length)throw new DraftError('This controlled path currently supports the existing typed cases only.',409);
  const draft={...p,id:identity.id,brand:'p5',revision:d.revision,status:d.status,uploads:[]} as Draft;
  const token=hash([identity.id,d,row.next,r,row.held]);
  return {identity,row,draft,token};
}
/** Existing SELECT-only primary snapshot; never bootstraps or acquires a lease. */
export {readState as readQaContinuationSnapshot};
type State=Awaited<ReturnType<typeof readState>>;
async function questions(draft:Draft){
  if(!draft.extraction)return [];
  const conflicts=reconcileScope(draft.answers,draft.extraction,draft.wizard?.resolutions||{}).conflicts;
  if(draft.intake?.questionMemory?.entries.length)return intakeQuestions({...draft,conflicts,transcript:draft.intake.transcript});
  return scopeQuestionsForBrand(draft.answers,draft.extraction,conflicts,draft.wizard?.skipped||[],await costQuestionFields(draft.answers),draft.text);
}
function nextIsCurrent(state:State){return state.row.next?.revision===state.draft.revision&&state.row.next?.sourceHash===sourceHash(state.draft);}
async function intent(state:State,read:Read=query){
  if(!nextIsCurrent(state)||!state.row.next?.intent)return null;
  const expected=state.row.next.intent as QaIntent;
  const [row]=await read(`SELECT i.request_hash,i.boundary,i.request,i.maximum_microusd,c.status,c.actual_microusd
    FROM p5ds_qa_intents i LEFT JOIN p5ds_qa_calls c ON c.request_hash=i.request_hash AND c.run_id=i.run_id
    WHERE i.run_id=$1 AND i.tenant=$2 AND i.project=$3 AND i.request_hash=$4`,[RUN,TENANT,state.identity.project,expected.requestHash]);
  if(!row||hash([row.request_hash,row.boundary,row.request,row.maximum_microusd])!==state.row.next.evidenceHash)throw new DraftError('The captured request changed. Prepare it again without spending.',409);
  if(expected.tenant!==TENANT||expected.project!==state.identity.project||expected.requestHash!==row.request_hash||expected.boundary!==row.boundary||expected.model!==row.request.model||expected.maximum!==Number(row.maximum_microusd)||expected.maximum>450000)throw new DraftError('Captured request identity mismatch.',409);
  return {expected,status:row.status||'captured',actual:row.actual_microusd};
}
export interface QaContinuationView {
  case:string;label:string;revision:number;token:string;stage:string;blocked:string|null;checkedAt:string;
  qaAllowance:number;qaLiability:number;overallCap:number;accounting:{historical:number;historicalUnknownIncluded:number;blocked:boolean;permitted:number;inFlight:number;unknown:number};intent?:QaIntent&{status:string};
  question?:{id:string;label:string;prompt:string;options:string[]};fields:{label:string;value:string}[];
  result?:unknown;pdf:boolean;lastOutcome?:string;
}
export async function inspectQaContinuation(name:unknown):Promise<QaContinuationView>{
  const state=await readState(name),{draft,row,identity}=state,pending=await intent(state);
  const held=row.held as {hash:string;status:string}[];
  const blocked=row.busy?'An explicit operation is still active. Inspect again after it finishes.':row.run.blocked||held.some(c=>['unknown','in_flight'].includes(c.status))?'Uncertain or in-flight charges remain held.':held.some(c=>c.status==='permitted'&&c.hash!==pending?.expected.requestHash)?'A different reviewed request is still reserved.':null;
  const available=await questions(draft),question=available[0];
  const stage=draft.status==='submitted'?'saved':pending?String(row.next.action.kind):!draft.extraction||draft.analyzedFingerprint!==scopeFingerprint(draft.text)?'reading':draft.reviewed?'pricing':question?'details':'review';
  return {case:identity.name,label:identity.label,revision:draft.revision,token:state.token,stage,blocked,checkedAt:row.checked_at,qaAllowance:2000000,qaLiability:Number(row.run.liability),overallCap:20000000,accounting:{historical:Number(row.run.historical),historicalUnknownIncluded:Number(row.run.unknown),blocked:row.run.blocked===true,permitted:held.filter(c=>c.status==='permitted').length,inFlight:held.filter(c=>c.status==='in_flight').length,unknown:held.filter(c=>c.status==='unknown').length},
    ...(pending?{intent:{...pending.expected,status:pending.status}}:{}),
    ...(stage==='details'&&question?{question:{id:customerQuestionKey(question)!,label:question.label,prompt:question.reason,options:question.values||[]}}:{}),
    fields:Object.entries(draft.answers).filter(([field])=>Object.hasOwn(SCOPE_FIELDS,field)&&SCOPE_FIELDS[field as ScopeField].kind!=='text').map(([field,value])=>({label:SCOPE_FIELDS[field as ScopeField].label,value:String(value)})),
    ...(draft.status==='submitted'&&row.draft.customer?{result:customerPresentation(row.draft.customer,{hideUnitRates:HIDE_CUSTOMER_UNIT_RATES})}:{}),pdf:draft.status==='submitted'&&Boolean(row.draft.customer),lastOutcome:row.next?.outcome};
}

async function acquire(name:unknown,token:string,actorId:string){
  return transaction(async read=>{
    const identity=identify(name);
    await read('SELECT run_id FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[RUN]);
    await read('SELECT id FROM p5_estimator_drafts WHERE id=$1 FOR UPDATE NOWAIT',[identity.id]);
    const state=await readState(name,read);
    if(state.token!==token||state.row.busy)throw new DraftError('The QA case changed or is busy. Inspect again.',409);
    if(state.row.run.blocked||(state.row.held as Row[]).some(c=>['unknown','in_flight'].includes(c.status)))throw new DraftError('Uncertain charges must remain held.',409);
    const leaseToken=randomUUID();
    await read(`INSERT INTO p5_estimator_work(draft_id,work_key,payload,lease_token,lease_until)
      VALUES($1,$2,$3::jsonb,$4,now()+interval '330 seconds') ON CONFLICT(draft_id,work_key)
      DO UPDATE SET payload=EXCLUDED.payload,lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,updated_at=now()`,[identity.id,QA_OPERATION_KEY,JSON.stringify({actorId,sourceRevision:state.draft.revision,sourceHash:sourceHash(state.draft)}),leaseToken]);
    return {state,leaseToken};
  });
}
async function invoke(action:Action,state:State):Promise<Response>{
  const {draft}=state;
  const headers={'x-p5-draft-id':draft.id,origin:'https://p5homeco.com'};
  if(action.kind==='reading'){
    const body=new FormData();body.set('text',draft.text);body.set('revision',String(draft.revision));body.set('scopeFingerprint',scopeFingerprint(draft.text));body.set('resumable','true');body.set('background','false');body.set('retry','false');
    return postScope(new Request('https://p5homeco.com/api/p5-estimator/scope',{method:'POST',headers,body}));
  }
  if(action.kind==='pricing')return postSubmission(new Request('https://p5homeco.com/api/p5-estimator/submit',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({revision:draft.revision,background:false,retry:false})}));
  const body:Row={text:draft.text,answers:{...draft.answers},contact:draft.contact,revision:draft.revision,wizard:structuredClone(draft.wizard||{skipped:[],resolutions:{}}),reviewed:action.kind==='review'};
  if(action.kind==='answer'){
    const current=(await questions(draft)).find(q=>customerQuestionKey(q)===action.questionId);
    if(!current||typeof action.answer!=='string'||!action.answer.trim()||action.answer.length>4000)throw new DraftError('This answer needs its current question.',409);
    if(current.instructionId)body.clarification={id:current.instructionId,answer:action.answer};
    else{body.answers[current.field]=action.answer;body.wizard.resolutions={...body.wizard.resolutions,[current.field]:action.answer};}
  }
  return putDraft(new Request('https://p5homeco.com/api/p5-estimator/draft',{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)}));
}
async function assertLease(id:string,leaseToken:string,read:Read){
  const [lease]=await read('SELECT lease_token,(lease_until>now()) AS active FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,QA_OPERATION_KEY]);
  if(!lease?.active||lease.lease_token!==leaseToken)throw new DraftError('The operator lease expired. Inspect retained progress before continuing.',409);
}
async function saveNext(state:State,action:Action,operation:QaOperation,response:Response,receiptKey:string,outcomeOverride?:string){
  const value=await response.json().catch(()=>({}));
  return transaction(async read=>{
  await read('SELECT id FROM p5_estimator_drafts WHERE id=$1 FOR UPDATE NOWAIT',[state.identity.id]);
  await assertLease(state.identity.id,operation.leaseToken,read);
  const latest=await readState(state.identity.name,read);
  let evidenceHash:string|undefined;
  if(operation.capturedIntent){
    const captured=operation.capturedIntent;
    if(captured.tenant!==TENANT||captured.project!==state.identity.project||!/^[a-f0-9]{64}$/.test(captured.requestHash))throw new DraftError('Broker capture identity mismatch.',409);
    const [row]=await read('SELECT request_hash,boundary,request,maximum_microusd FROM p5ds_qa_intents WHERE run_id=$1 AND tenant=$2 AND project=$3 AND request_hash=$4',[RUN,TENANT,state.identity.project,captured.requestHash]);
    if(!row)throw new DraftError('The captured request was not retained.',409);
    evidenceHash=hash([row.request_hash,row.boundary,row.request,row.maximum_microusd]);
  }
  const outcome=outcomeOverride||(operation.capturedIntent?'Exact request captured; no additional call was admitted.':response.status===202?'Stage is pending. Inspect its retained progress before continuing.':response.ok?'Stage completed.':String(value.error||value.message||'This stage is paused.').slice(0,500));
  const payload={revision:latest.draft.revision,sourceHash:sourceHash(latest.draft),action,intent:operation.capturedIntent||null,evidenceHash,outcome};
  await read('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[state.identity.id,NEXT,JSON.stringify(payload)]);
  await read('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[state.identity.id,receiptKey,JSON.stringify({actorId:operation.actorId,completedAt:new Date().toISOString()})]);
  return latest;
  });
}

export async function continueQaCase(input:{case:unknown;token:unknown;action:unknown;questionId?:unknown;answer?:unknown},actorId:string){
  if(typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token)||!['prepare','approve','continue','answer'].includes(String(input.action)))throw new DraftError('Inspect this QA case before continuing.',400);
  const identity=identify(input.case),operationId=hash(input),receiptKey=RECEIPT+operationId;
  const [prior]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[identity.id,receiptKey]);
  if(prior)return inspectQaContinuation(input.case);
  const {state,leaseToken}=await acquire(input.case,input.token,actorId);
  const phase=async(action:Action,current:State,control:QaOperation['control'])=>{
    const operation:QaOperation={draftId:identity.id,leaseToken,actorId,control,active:true};
    const response=await withinQaOperationPhase(operation,()=>invoke(action,current));
    return {operation,response};
  };
  try{
      let action:Action;
      if(input.action==='answer')action={kind:'answer',questionId:String(input.questionId||''),answer:String(input.answer||'')};
      else if(nextIsCurrent(state)&&state.row.next?.intent)action=state.row.next.action;
      else action={kind:!state.draft.extraction||state.draft.analyzedFingerprint!==scopeFingerprint(state.draft.text)?'reading':state.draft.reviewed?'pricing':'review'};
      // Rebuild in capture-only mode before issuing permission. A changed book,
      // source or prompt cannot consume a permit approved for an older request.
      let result=await phase(action,state,{mode:'capture'}),outcomeOverride:string|undefined;
      if(input.action==='approve'&&result.operation.capturedIntent){
        const reviewed=await intent(state);
        if(!reviewed||stable(reviewed.expected)!==stable(result.operation.capturedIntent)){
          outcomeOverride='The next request changed. No new permission was issued. Review the new exact identity before approving.';
        }else{
        if(reviewed.status==='captured'){
          // Existing operator API, on the same primary pool. This short atomic
          // reservation commits before any provider request is started.
          const {QaBudget}=await import('../../services/document-service/src/qa-budget.mjs');
          await siteTransaction(async client=>{
            const read:Read=async(statement,values=[])=>(await client.query(statement,values)).rows;
            await read('SELECT run_id FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[RUN]);
            await read('SELECT id FROM p5_estimator_drafts WHERE id=$1 FOR UPDATE NOWAIT',[identity.id]);
            await assertLease(identity.id,leaseToken,read);
            const budget=new QaBudget({pool:getPool(),transaction:(work:(connection:typeof client)=>Promise<unknown>)=>work(client)},{});
            await budget.permit(reviewed.expected.requestHash,'qa-admin-'+reviewed.expected.requestHash,`Administrator ${actorId} approved this exact ${action.kind} request for the existing synthetic case ${identity.id}.`,reviewed.expected);
          });
        }else if(reviewed.status!=='permitted')throw new DraftError('Only an unused exact approval can dispatch. Settled work uses free continuation.',409);
        result=await phase(action,state,{mode:'exact',expected:reviewed.expected});
        }
      }
      await saveNext(state,action,result.operation,result.response,receiptKey,outcomeOverride);
  }finally{
    await query('UPDATE p5_estimator_work SET lease_until=NULL,lease_token=NULL,updated_at=now() WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3',[identity.id,QA_OPERATION_KEY,leaseToken]);
  }
  return inspectQaContinuation(input.case);
}

export async function qaSavedPdf(name:unknown,revision:unknown){
  const state=await readState(name);
  if(state.draft.status!=='submitted'||state.draft.revision!==Number(revision)||!state.row.draft.customer)throw new DraftError('A saved estimate at this exact revision is required.',409);
  const bytes=await customerPdf(state.identity.id,state.row.draft.customer,state.row.draft.submittedAt);
  return new Response(new Uint8Array(bytes),{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="${pdfFilename(state.identity.id,'customer')}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}
