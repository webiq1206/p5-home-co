import {createHash} from 'node:crypto';
import {query,transaction} from './database.ts';
import {DraftError,type Draft} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {SCOPE_FIELDS,validateAnswer,validateExtraction,type ScopeAnswers} from './scope.ts';
import {manualScopeAnswers} from './adaptive.ts';
import {applyCabinetIntent} from './projectIntent.ts';
import {readCompletedAnalysis,recoverTypedAnalysis} from './savedAnalysis.ts';
import {reconcileScopeReading} from './reconcileScopeReading.ts';
import {retainedTypedReceipt,normalizeTypedReading} from './extraction.ts';

import {QA_CASES as CASES} from './qaCases.ts';
const RUN='p5-acceptance-20261004',TENANT='p5homeco.com',MODEL='claude-haiku-4-5-20251001';
const RECEIPT='qa-saved-reading-recovery-v1:';
type Read=typeof query;
type Row=Awaited<ReturnType<Read>>[number];
type Dependencies={read:Read;transact:typeof transaction};
const defaults:Dependencies={read:query,transact:transaction};
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const deny=(message:string):never=>{throw new DraftError(message,409);};
function identify(name:unknown){
  if((ESTIMATOR_BRAND.id as string)!=='p5'||ESTIMATOR_BRAND.domain!==TENANT||typeof name!=='string'||!Object.hasOwn(CASES,name))throw new DraftError('Unknown QA recovery case.',404);
  const [id,label]=CASES[name as keyof typeof CASES];return {name,id,label,project:'qa-paid-'+id};
}

/** One implicit statement snapshot; no schema bootstrap, credential read, broad
 * customer listing, provider IDs, queue driving or financial mutation. */
const SNAPSHOT=`SELECT pg_is_in_recovery() AS replica,now()::text AS checked_at,
 (SELECT jsonb_build_object('revision',revision,'status',status,'brand',brand,'payload',payload)
  FROM p5_estimator_drafts WHERE id=$1) AS draft,
 (SELECT jsonb_build_object('run_id',run_id,'historical_microusd',historical_microusd,
   'historical_unknown_microusd',historical_unknown_microusd,'allowance_microusd',allowance_microusd,
   'liability_microusd',liability_microusd,'blocked',blocked) FROM p5ds_qa_runs WHERE run_id=$2) AS run,
 (SELECT jsonb_build_object('run_id',run_id,'lot29',lot29) FROM p5ds_qa_projects WHERE tenant=$3 AND project=$4) AS binding,
 EXISTS(SELECT 1 FROM p5ds_qa_calls WHERE run_id=$2 AND status IN ('permitted','in_flight','unknown')) AS held,
 (SELECT count(*)::int FROM p5_estimator_files WHERE draft_id=$1) AS files,
 EXISTS(SELECT 1 FROM p5_estimator_work WHERE draft_id=$1 AND
   (lease_until>now() OR (work_key LIKE 'background-v1-%' AND payload->>'state' IN ('queued','running'))
    OR (work_key='submit-request-v1' AND payload->>'state'='pending'))) AS active,
 COALESCE((SELECT jsonb_agg(w) FROM (SELECT work_key,payload,(lease_until>now()) AS active
  FROM p5_estimator_work WHERE draft_id=$1 AND
   (work_key IN ('qa-bounded-provider-v1','qa-no-provider-v1') OR work_key LIKE 'analysis:%'
    OR work_key LIKE 'completed-analysis-v1-%' OR work_key LIKE 'background-v1-%'
    OR work_key LIKE 'qa-saved-reading-recovery-v1:%') ORDER BY work_key LIMIT 101) w),'[]'::jsonb) AS work,
 COALESCE((SELECT jsonb_agg(c) FROM (SELECT i.request_hash,i.boundary,i.request,c.response,c.actual_microusd,c.reserved_microusd
  FROM p5ds_qa_calls c JOIN p5ds_qa_intents i ON i.request_hash=c.request_hash AND i.run_id=c.run_id
  WHERE c.run_id=$2 AND i.tenant=$3 AND i.project=$4 AND c.status='settled'
  ORDER BY i.request_hash LIMIT 9) c),'[]'::jsonb) AS calls`;

async function snapshot(name:unknown,read:Read){
  const identity=identify(name);
  const [row]=await read(SNAPSHOT,[identity.id,RUN,TENANT,identity.project]);
  if(!row||row.replica!==false)deny('Recovery requires the application primary database.');
  const run=row.run;
  if(!run||run.run_id!==RUN||Number(run.historical_microusd)!==3250000||Number(run.historical_unknown_microusd)!==390000||Number(run.allowance_microusd)!==2000000||!Number.isSafeInteger(Number(run.liability_microusd))||Number(run.liability_microusd)<0||Number(run.liability_microusd)>2000000)deny('The existing QA budget binding could not be verified.');
  if(run.blocked!==false||row.held)deny('The QA run has an unresolved or active call.');
  if(row.binding?.run_id!==RUN)deny('This case is not bound to the existing QA run.');
  const stored=row.draft;
  if(!stored||stored.brand!=='p5'||stored.status!=='draft'||!Number.isSafeInteger(stored.revision)||stored.revision<1)deny('This QA draft is not available for recovery.');
  const p=stored.payload;
  if(!p||typeof p.text!=='string'||!p.answers||!p.contact||typeof p.contact.name!=='string'||!/^\[QA\](?:\s|$)/i.test(p.contact.name)||p.contact.email!==''||p.contact.phone!=='')deny('Synthetic contact safeguards could not be verified.');
  if(row.files!==0||p.uploads?.length)deny('This recovery control supports existing typed readings only.');
  if(row.active)deny('This case has active or pending work.');
  if(!Array.isArray(row.work)||row.work.length>100||!Array.isArray(row.calls)||row.calls.length>8)deny('The retained evidence needs independent review.');
  if(!row.work.some((w:Row)=>w.work_key==='qa-bounded-provider-v1'&&w.payload?.brokerRequired===true)||row.work.some((w:Row)=>w.work_key==='qa-no-provider-v1'))deny('The existing bounded-provider marker could not be verified.');
  const draft={...p,id:identity.id,revision:stored.revision,status:stored.status,brand:stored.brand,uploads:[]} as Draft;
  return {identity,row,draft};
}

function originalAnswers(call:Row,text:string):ScopeAnswers|null{
  const wire=call.request,response=call.response;
  if(!/^[a-f0-9]{64}$/.test(call.request_hash)||!wire||wire.model!==MODEL||response?.model!==MODEL||!Array.isArray(response.content)||!response.content.length||!Number.isSafeInteger(Number(call.actual_microusd))||call.actual_microusd===null||Number(call.actual_microusd)<0||!Number.isSafeInteger(Number(call.reserved_microusd))||Number(call.reserved_microusd)<1||Number(call.actual_microusd)>Number(call.reserved_microusd)||Number(call.reserved_microusd)>450000)return null;
  const usage=response.usage;
  if(!['tool_use','end_turn'].includes(response.stop_reason)||!usage||!Number.isSafeInteger(usage.input_tokens)||!Number.isSafeInteger(usage.output_tokens)||usage.input_tokens<0||usage.input_tokens>200000||usage.output_tokens<0||usage.output_tokens>wire.max_tokens||Number(usage.cache_creation_input_tokens||0)!==0||Number(usage.cache_read_input_tokens||0)!==0||usage.input_tokens+usage.output_tokens*5!==Number(call.actual_microusd))return null;
  if(!Number.isSafeInteger(wire.max_tokens)||wire.max_tokens<1||wire.max_tokens>48000||wire.stream!==false||wire.service_tier!=='standard_only'||200000+wire.max_tokens*5!==Number(call.reserved_microusd)||usage.server_tool_use&&Object.values(usage.server_tool_use).some(value=>Number(value)!==0))return null;
  if(typeof wire.system!=='string'||call.boundary!=='site:'+createHash('sha256').update(JSON.stringify(wire.system)).digest('hex')||wire.messages?.length!==1||wire.messages[0]?.role!=='user'||!Array.isArray(wire.messages[0].content)||wire.tools?.length!==1||wire.tools[0]?.name!=='record_scope_analysis'||wire.tools[0]?.type||wire.tool_choice?.name!=='record_scope_analysis')return null;
  const messages=wire.messages[0].content;
  // Typed-only requests have one JSON source block, with no image/document or
  // additional instructions. Do not infer an identity from today's answers.
  if(messages.length!==1||messages[0]?.type!=='text'||typeof messages[0].text!=='string')return null;
  try{
    const source=JSON.parse(messages[0].text),answers=source.previousAnswers;
    if(source.submittedScope!==text||Object.keys(source).sort().join(',')!=='previousAnswers,submittedScope'||!answers||typeof answers!=='object'||Array.isArray(answers))return null;
    for(const [field,value]of Object.entries(answers))if(!Object.hasOwn(SCOPE_FIELDS,field)||typeof value!=='string'||validateAnswer(field as keyof ScopeAnswers,value))return null;
    return answers;
  }catch{return null;}
}

async function prepare(state:Awaited<ReturnType<typeof snapshot>>){
  const {row,draft,identity}=state;
  const eligible=row.calls.map((call:Row)=>({call,answers:originalAnswers(call,draft.text)})).filter((c:Row)=>c.answers!==null);
  if(eligible.length!==1)deny('Exactly one settled typed-reading identity is required.');
  const {call,answers}=eligible[0];
  let paidExtraction;
  try{paidExtraction=retainedTypedReceipt(call.response,draft.text,answers);}
  catch{deny('The settled response does not contain a verified typed reading.');}
  const visitorAnswers=applyCabinetIntent(draft.text,ESTIMATOR_BRAND.services,manualScopeAnswers(draft.answers,draft.extraction,draft.wizard?.resolutions||{})).answers;
  const input={text:draft.text,answers:visitorAnswers,uploads:[],extraction:draft.extraction,resolutions:draft.wizard?.resolutions};
  // The existing selectors operate only on rows from the same atomic snapshot.
  const matches=new Map<string,NonNullable<Awaited<ReturnType<typeof readCompletedAnalysis>>>>();
  const evidence:unknown[]=[];
  for(const retained of row.work){
    const readSaved:Read=async(statement,values=[])=>{
      if(!statement.startsWith('SELECT'))deny('Saved-reading inspection must be read-only.');
      if(values[0]!==draft.id)deny('Saved-reading identity changed.');
      return values.length===3?(values.slice(1).includes(retained.work_key)?[retained]:[]):
        ((retained.work_key.startsWith('completed-analysis-v1-')||retained.work_key.startsWith('background-v1-'))&&retained.payload?.state==='complete'&&retained.payload?.input?.kind==='analysis'?[retained]:[]);
    };
    let candidate=await readCompletedAnalysis(draft.id,input,readSaved);
    if(!candidate&&retained.work_key.startsWith('analysis:')){
      try{candidate=await recoverTypedAnalysis(draft,input,JSON.stringify(answers),readSaved);}
      catch(error){if(!(error instanceof DraftError))throw error;}
    }
    if(candidate){
      if(candidate.analysis.model!==MODEL||candidate.analysis.provider!=='Anthropic')deny('The retained reading has incompatible provider evidence.');
      let checkpointExtraction;
      try{checkpointExtraction=normalizeTypedReading(validateExtraction(structuredClone(candidate.analysis.extraction)),draft.text,answers);}
      catch{deny('The retained checkpoint cannot be verified.');}
      if(digest(checkpointExtraction)!==digest(paidExtraction))deny('The checkpoint does not match its settled reading.');
      evidence.push({workKey:retained.work_key,payload:retained.payload});
      matches.set(digest(checkpointExtraction),{...candidate,analysis:{...structuredClone(candidate.analysis),extraction:checkpointExtraction!}});
    }
  }
  if(matches.size!==1)deny('The saved reading is missing or conflicting. No new reading was started.');
  const recovered=[...matches.values()][0];
  // analyzeWithAnthropic persists provider.kind, whose canonical value is
  // capitalized. Do not normalize arbitrary provider provenance into a match.
  if(recovered.analysis.model!==MODEL||recovered.analysis.provider!=='Anthropic')deny('The retained reading has incompatible provider evidence.');
  const reconciled=reconcileScopeReading(draft,draft.text,visitorAnswers,recovered.analysis);
  if(!reconciled.analysis||reconciled.payload.extraction?.reviewNotes?.length)deny('The retained reading still needs review.');
  // Keep every unrelated saved field and the exact original authoring text.
  const payload={...row.draft.payload,...reconciled.payload};
  // JSONB does not preserve the broker wire's insertion order. Its stored hash
  // is the relational receipt identity, not something to recompute from JSONB.
  // Bind this operation to all retained request, response and checkpoint bytes
  // represented canonically so any subsequent evidence edit invalidates it.
  const operation=digest([RECEIPT,identity.id,draft.revision,row.draft.payload,call,evidence]);
  const changedFields=Object.keys(SCOPE_FIELDS).filter(field=>draft.answers[field as keyof ScopeAnswers]!==payload.answers[field as keyof ScopeAnswers]);
  return {payload,operation,changedFields,retainedFacts:recovered.analysis.extraction.facts.length};
}

export type QaReadingInspection={case:string;label:string;id:string;revision:number;checkedAt:string;eligible:boolean;applied:boolean;reason:string|null;operation?:string;changedFields?:string[];retainedFacts?:number};
function view(state:Awaited<ReturnType<typeof snapshot>>):QaReadingInspection{
  const {identity,draft,row}=state;
  return {case:identity.name,label:identity.label,id:identity.id,revision:draft.revision,checkedAt:row.checked_at,eligible:false,applied:false,reason:null};
}
function receiptFor(state:Awaited<ReturnType<typeof snapshot>>,operation?:string){
  return state.row.work.find((w:Row)=>w.work_key.startsWith(RECEIPT)&&(!operation||w.work_key===RECEIPT+operation)&&w.payload?.appliedRevision===state.draft.revision&&w.payload?.appliedPayloadHash===digest(state.row.draft.payload));
}
export async function inspectQaSavedReading(name:unknown,dependencies:Dependencies=defaults):Promise<QaReadingInspection>{
  const state=await snapshot(name,dependencies.read),result=view(state);
  if(receiptFor(state))return {...result,applied:true};
  try{const plan=await prepare(state);return {...result,eligible:true,operation:plan.operation,changedFields:plan.changedFields,retainedFacts:plan.retainedFacts};}
  catch(error){if(error instanceof DraftError)return {...result,reason:error.message};throw error;}
}

/** Explicit administrator action only. No public draft key is issued or read.
 * Lock the existing run first, matching its provider admission lock order.
 * The only writes are this draft's deterministic payload and an idempotency
 * receipt; the original paid evidence and every accounting row stay intact. */
export async function applyQaSavedReading(name:unknown,expectedRevision:unknown,operation:unknown,actorId:string,dependencies:Dependencies=defaults):Promise<QaReadingInspection>{
  const identity=identify(name);
  if(!Number.isSafeInteger(expectedRevision)||Number(expectedRevision)<1||typeof operation!=='string'||!/^([a-f0-9]{64})$/.test(operation))throw new DraftError('Inspect the saved reading before applying it.',400);
  return dependencies.transact(async read=>{
    await read('SELECT run_id FROM p5ds_qa_runs WHERE run_id=$1 FOR UPDATE',[RUN]);
    await read('SELECT id FROM p5_estimator_drafts WHERE id=$1 FOR UPDATE NOWAIT',[identity.id]);
    await read('SELECT tenant FROM p5ds_qa_projects WHERE tenant=$1 AND project=$2 FOR SHARE',[TENANT,identity.project]);
    await read('SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 FOR UPDATE',[identity.id]);
    await read('SELECT request_hash FROM p5ds_qa_intents WHERE run_id=$1 AND tenant=$2 AND project=$3 FOR SHARE',[RUN,TENANT,identity.project]);
    await read('SELECT slot FROM p5ds_qa_calls WHERE run_id=$1 FOR SHARE',[RUN]);
    const state=await snapshot(name,read);
    const prior=receiptFor(state,operation);
    if(prior&&prior.payload.sourceRevision===expectedRevision)return {...view(state),applied:true};
    if(state.draft.revision!==expectedRevision)deny('This QA draft changed. Inspect it again before applying.');
    const plan=await prepare(state);
    if(plan.operation!==operation)deny('The saved-reading evidence changed. Inspect it again.');
    const saved=await read("UPDATE p5_estimator_drafts SET payload=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 AND status='draft' RETURNING revision",[JSON.stringify(plan.payload),identity.id,expectedRevision]);
    if(saved.length!==1)deny('The QA draft changed while applying its saved reading.');
    const revision=Number(saved[0].revision);
    await read('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb)',[identity.id,RECEIPT+operation,JSON.stringify({sourceRevision:expectedRevision,appliedRevision:revision,appliedPayloadHash:digest(plan.payload),actorId})]);
    return {...view(state),revision,applied:true,changedFields:plan.changedFields,retainedFacts:plan.retainedFacts};
  });
}
