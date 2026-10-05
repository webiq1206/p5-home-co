import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {selectSourceEquivalentAnalysis,type AnalysisReuseInput,type CompletedAnalysisCandidate} from './analysisReuse.ts';
import {hasVerifiedAnalysis} from './modelPolicy.ts';
import {analysisWorkKey} from './analysisWork.ts';
import {DraftError,type Draft} from './store.ts';
import {SCOPE_FIELDS,validateAnswer} from './scope.ts';
import {blockingExtractionNotes} from './documentLedger.ts';
import type {AnalysisResult} from './extraction.ts';
import type {ScopeAnswers,ScopeExtraction} from './scope.ts';

type Read=typeof query;
export type SavedAnalysisInput=AnalysisReuseInput&{extraction:ScopeExtraction|null;resolutions?:ScopeAnswers};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);

/** Store the original provider result before deterministic reconciliation. No
 * credentials, leases, provider permissions or accounting records are changed. */
export async function saveCompletedAnalysis(draftId:string,input:AnalysisReuseInput,analysis:AnalysisResult,write:Read=query){
 if(!hasVerifiedAnalysis(analysis))return;
 const payload={state:'complete',input:{kind:'analysis',text:input.text,answers:input.answers,draft:{uploads:input.uploads.map(({id,sha256})=>({id,sha256}))}},result:{analysis}};
 const key='completed-analysis-v1-'+createHash('sha256').update(stable(payload)).digest('hex');
 await write('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[draftId,key,JSON.stringify(payload)]);
}

/** Both synchronous and background retries consult the same draft-local saved
 * results. Identical copies are one result; conflicting results stay ambiguous. */
export async function readCompletedAnalysis(draftId:string,input:SavedAnalysisInput,read:Read=query){
 const rows=await read("SELECT work_key,payload FROM p5_estimator_work WHERE draft_id=$1 AND (work_key LIKE 'completed-analysis-v1-%' OR work_key LIKE 'background-v1-%') AND payload->>'state'='complete' AND payload->'input'->>'kind'='analysis' ORDER BY updated_at DESC",[draftId]);
 const unique=new Map<string,CompletedAnalysisCandidate>();
 for(const row of rows){
  const payload=row.payload;
  const identity=stable([payload?.input?.text,payload?.input?.answers,payload?.input?.draft?.uploads?.map((file:{id?:string;sha256?:string})=>[file.id,file.sha256]),payload?.result?.analysis]);
  if(!unique.has(identity))unique.set(identity,{workKey:String(row.work_key),payload});
 }
 return selectSourceEquivalentAnalysis([...unique.values()],input);
}

/** A historical typed read may have a checkpoint but no completed envelope.
 * The caller supplies only its original answer identity, never a result. The
 * content-addressed server checkpoint remains the sole source of analysis. */
export async function recoverTypedAnalysis(draft:Draft,input:SavedAnalysisInput,hint:string,read:Read=query){
 const denied=()=>new DraftError('The saved reading could not be matched to this project. No new reading was started.',409);
 if(hint.length>16000||input.uploads.length||!input.extraction)throw denied();
 let answers:ScopeAnswers;
 try{
  const value=JSON.parse(hint);
  if(!value||typeof value!=='object'||Array.isArray(value))throw denied();
  for(const [field,answer] of Object.entries(value)){
   if(!Object.hasOwn(SCOPE_FIELDS,field)||typeof answer!=='string'||validateAnswer(field as keyof ScopeAnswers,answer))throw denied();
  }
  answers=value;
 }catch{throw denied();}
 const keys=[analysisWorkKey(draft,input.text,answers,'local'),analysisWorkKey(draft,input.text,answers,'remote')];
 const rows=await read('SELECT work_key,payload,(lease_until>now()) AS active FROM p5_estimator_work WHERE draft_id=$1 AND work_key IN ($2,$3)',[draft.id,...keys]);
 if(rows.some(row=>row.active))throw denied();
 const candidates:CompletedAnalysisCandidate[]=rows.flatMap(row=>{
  const job=row.payload,analysis=job?.textDone as AnalysisResult|undefined;
  if(!analysis||!hasVerifiedAnalysis(analysis)||!analysis.provider||!analysis.analyzedAt||!Number.isFinite(Date.parse(analysis.analyzedAt))
   ||!Array.isArray(job.units)||job.units.length||job.prepared!==0||job.notes?.length||job.preparationFailures?.length
   ||job.expected?.length||job.cursor||blockingExtractionNotes(analysis.extraction).length
   ||(analysis.extraction.documentCoverage&&(!analysis.extraction.documentCoverage.complete||analysis.extraction.documentCoverage.expectedPages!==0||analysis.extraction.documentCoverage.pages.length)))return [];
  return [{workKey:String(row.work_key),payload:{state:'complete',input:{kind:'analysis',text:input.text,answers,draft:{uploads:[]}},result:{analysis}}}];
 });
 const recovered=selectSourceEquivalentAnalysis(candidates,input);
 if(!recovered)throw denied();
 return {...recovered,analysis:structuredClone(recovered.analysis)};
}
