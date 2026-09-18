/** Free saved-run inspection. No API key, provider request, production database,
 * parser or worker is used. Query a disposable COPY of local QA storage. */
import {readdir,readFile,stat,realpath,mkdtemp,cp,rm} from 'node:fs/promises';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {Store} from '../src/store.mjs';
import {inspectReviewStreamState} from './resume-review-stream.mjs';
import {savedRunEvents,latestProviderFailure} from './saved-run-events.mjs';

/** Uses exactly the recovery predicates, but cannot start a worker or call AI.
 * The original database is never opened; the ledger is read without changes. */
export async function inspectReviewRecovery(options={}){
 return withSavedRun(options,async({db,file})=>{
  const documents=(await db.query('SELECT id,tenant,project,digest,state,page_count,error_code FROM p5ds_documents')).rows;
  if(documents.length!==1)throw Error('Expected one saved source document. No recovery was attempted.');
  const document=documents[0],store=new Store(db,{});
  const {diagnostic}=await inspectReviewStreamState(store,document,dirname(file));
  return {...diagnostic,lastSavedProviderFailure:latestProviderFailure(await savedRunEvents(db,document)),
   note:'Free inspection of copied local QA storage. No AI calls, PDF parsing, job changes, ledger changes or production connection.'};
 });
}

async function latestReport(root){
 const reports=[];
 for(const version of await readdir(root,{withFileTypes:true})){
  if(!version.isDirectory()||!/^[a-f0-9]{16}$/.test(version.name))continue;
  for(const fixture of await readdir(join(root,version.name),{withFileTypes:true})){
   if(!fixture.isDirectory()||!/^short-[a-f0-9]{16}$/.test(fixture.name))continue;
   const file=join(root,version.name,fixture.name,'report.json');
   try{reports.push({file,time:(await stat(file)).mtimeMs});}catch(e){if(e.code!=='ENOENT')throw e;}
  }
 }
 reports.sort((a,b)=>b.time-a.time);
 if(!reports.length)throw Error('No saved short-file report found. Do not start a paid run to create one.');
 return reports[0].file;
}

function pageSummary(page){
 const value=page.evidence,quotes=[...(value?.facts||[]),...(value?.items||[])].map(f=>f.evidence||'');
 return {page:page.page,kind:page.native.kind,nativeCharacters:page.native.text?.length||0,
  status:value?.status||'no-saved-evidence',evidenceCharacters:value?JSON.stringify(value).length:0,
  facts:value?.facts?.length||0,items:value?.items?.length||0,inclusions:value?.inclusions?.length||0,
  exclusions:value?.exclusions?.length||0,responsibilities:value?.responsibilities?.length||0,
  quotedCharacters:quotes.reduce((n,q)=>n+q.length,0),uniqueQuotedCharacters:[...new Set(quotes)].reduce((n,q)=>n+q.length,0)};
}

/** Call inspect against a disposable copy. The source is never opened by SQL. */
export async function withSavedRun({root=resolve('.p5-model-qa'),reportPath}={},inspect){
 root=await realpath(root);
 const file=await realpath(reportPath?resolve(reportPath):await latestReport(root));
 const within=relative(root,file);
 if(within.startsWith('..'+sep)||within==='..'||resolve(root,within)!==file||!/^([a-f0-9]{16})[\\/]short-[a-f0-9]{16}[\\/]report\.json$/.test(within))throw Error('Choose a saved short-file report inside .p5-model-qa.');
 const report=JSON.parse(await readFile(file,'utf8'));
 if(report.id!=='short'||report.expectedPages!==4)throw Error('Expected the saved four-page QA report.');
 const source=join(dirname(file),'database');
 if(await realpath(source)!==source)throw Error('QA database must be a local directory, not a link.');
 await stat(join(source,'PG_VERSION'));
 const copy=await mkdtemp(join(tmpdir(),'p5-qa-inspect-'));let db;
 try{
  await cp(source,join(copy,'database'),{recursive:true});
  db=new PGlite(join(copy,'database'));await db.waitReady;
  await db.query('BEGIN READ ONLY');
  const result=await inspect({db,report,file,root});
  await db.query('ROLLBACK');
  return result;
 }finally{try{if(db)await db.close();}finally{await rm(copy,{recursive:true,force:true});}}
}

export async function inspectSavedRun(options={}){
 return withSavedRun(options,async({db,report,file})=>{
  const pages=await db.query('SELECT page,native,evidence FROM p5ds_pages ORDER BY page');
  const jobs=await db.query("SELECT kind,state,attempts,error_code,payload->'pages' AS pages,result->>'reason' AS split_reason FROM p5ds_jobs ORDER BY created_at,id");
  const documents=(await db.query('SELECT id,tenant,project FROM p5ds_documents')).rows;
  const events=documents.length===1?await savedRunEvents(db,documents[0]):[];
  const keys=['provider','model','attempt','pages','imageCount','inputCharacters','maxOutputTokens','timeoutMs','queueMs','code','cancelled','usage','purpose','effort','idleTimeoutMs','stopReason','stream'];
  return {report:file,model:report.model,complete:report.complete,error:report.error,
   currentInvocationMs:report.currentInvocationMs,stageWork:report.stageWork,cost:report.cost,
   pages:pages.rows.map(pageSummary),jobs:jobs.rows,
   providerEvents:events.filter(e=>e.stage.includes('provider')).map(e=>({stage:e.stage,durationMs:e.duration_ms,...Object.fromEntries(keys.filter(k=>Object.hasOwn(e.detail||{},k)).map(k=>[k,e.detail[k]]))})),
   note:'Read saved data only. No provider calls, PDF rereading, production connection or checkpoint changes. Stream progress and final usage are included when available; incomplete input is not accepted as evidence.'};
 });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectSavedRun({reportPath:process.argv[2]}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
  console.error('Inspection stopped:',error.code||error.message);process.exitCode=1;
 });
}
