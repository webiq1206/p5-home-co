/** One QA-only medium-effort read of saved page 2. Never starts a worker, parses
 * a PDF, retries, changes production defaults or writes the original checkpoint. */
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withSavedRun} from './inspect-sonnet-run.mjs';
import {privateJson,guardedSonnetFetch} from './model-qa-support.mjs';
import {Reader} from '../src/provider.mjs';
import {readConfig,validateEvidence,hash,ServiceError} from '../src/core.mjs';
import {READER_SYSTEM,EVIDENCE_SCHEMA} from '../src/contracts.mjs';

const PROFILE='sonnet-medium-page2-v1';
const SOURCE='ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018';

export async function checkSavedPage({root=resolve('.p5-model-qa'),reportPath,key=process.env.ANTHROPIC_API_KEY,env=process.env,request=fetch,log=console.log}={}){
 const saved=await withSavedRun({root,reportPath},async({db,report,file,root})=>{
  if(report.sourceSha256!==SOURCE||report.model!=='claude-sonnet-5'||report.complete!==false)throw Error('Expected the existing incomplete Sonnet four-page source test.');
  const docs=await db.query('SELECT id,digest,page_count FROM p5ds_documents');
  if(docs.rows.length!==1||docs.rows[0].digest!==SOURCE||docs.rows[0].page_count!==4)throw Error('Saved source manifest does not match the approved four-page fixture.');
  const {rows}=await db.query('SELECT page,native,image,evidence FROM p5ds_pages WHERE document_id=$1 ORDER BY page',[docs.rows[0].id]);
  if(rows.length!==4||rows.some((p,i)=>p.page!==i+1)||!rows[0].evidence||rows[1].evidence)throw Error('Expected saved page 1 and a missing page-2 result. No completed page will be reread.');
  const page=rows[1];
  if(page.native.page!==2||page.native.kind!=='text'||!(page.native.textQuality>=.9)||!page.native.text?.trim()||!page.image?.length)throw Error('Saved page-2 text or overview is unavailable.');
  return {page,file,root};
 });
 const directory=join(saved.root,'probes',PROFILE+'-'+SOURCE.slice(0,16)),file=join(directory,'report.json');
 // Atomic directory creation is a permanent one-attempt lock, including a crash
 // before report/ledger persistence. Code fingerprints do not reset this probe.
 try{
  const prior=JSON.parse(await readFile(file,'utf8'));
  if(prior.profile!==PROFILE||prior.sourceSha256!==SOURCE)throw Error('Saved probe report does not match.');
  return {...prior,cached:true};
 }catch(error){if(error.code!=='ENOENT')throw error;}
 if(!key)throw Error('Run this in the existing P5 Replit Shell. ANTHROPIC_API_KEY is unavailable here.');
 const config=readConfig({...env,DOCUMENT_PROVIDER:'anthropic',ANTHROPIC_API_KEY:key,DOCUMENT_MODEL:'claude-sonnet-5',DOCUMENT_VERIFY_MODEL:'claude-sonnet-5',DOCUMENT_DATABASE_URL:'qa-no-network-database',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'model-qa':'synthetic-page-probe-local-configuration-only'})});
 config.callMs=Math.min(config.callMs,40000);config.streamMs=config.callMs;config.maxOutput=Math.min(config.maxOutput,10000);
 await mkdir(join(saved.root,'probes'),{recursive:true,mode:0o700});
 try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('This probe was already started. Inspect its saved files; no automatic paid retry is allowed.');throw error;}
 const report={profile:PROFILE,sourceSha256:SOURCE,sourceReport:saved.file,page:2,model:config.model,effort:'medium',
  requestSucceeded:false,structuralValidationPassed:false,sourceQuoteValidationPassed:false,accuracyQualified:false,productionPerformanceQualified:false,
  timeoutMs:config.callMs,maxOutputTokens:config.maxOutput,report:file,events:[]};
 await privateJson(join(directory,'started.json'),report);
 const controller=new AbortController();
 const guard=await guardedSonnetFetch({file:join(directory,'cost.json'),limitUsd:.20,maxCalls:1,request,onPause:error=>controller.abort(error)});
 const input=[{...saved.page.native,image:undefined,spans:undefined}];
 const images=[{label:'Original page 2; overview, not proof of fine-detail legibility.',bytes:saved.page.image}];
 // Same production request builder, prompt, schema, parser and native quote
 // checks. The sole provider-request change is output_config.effort=medium.
 const reader=new Reader(config,{
  reserve:async()=>PROFILE,release:async()=>{},cooldown:async()=>{},
  metric:async(_job,stage,duration_ms,detail)=>report.events.push({stage,duration_ms:Math.round(duration_ms),detail:{...detail,effort:'medium'}})
 },async(url,options)=>{
  const body=JSON.parse(options.body);
  if(body.model!=='claude-sonnet-5'||body.tools||body.output_config?.format?.type!=='json_schema')throw new ServiceError('qa-unexpected-probe-request',422);
  body.output_config.effort='medium';report.requestSha256=hash(JSON.stringify(body));
  return guard.request(url,{...options,body:JSON.stringify(body)});
 });
 log('One saved page-2 request at medium effort; estimated reservation limit $0.20. No retries or full-file run.');
 const start=performance.now();
 try{
  const reply=await reader.call({kind:'read',attempts:1},READER_SYSTEM,{pages:input},images,EVIDENCE_SCHEMA,controller.signal);
  report.requestSucceeded=true;report.structuralValidationPassed=true;
  report.result=reply;
  validateEvidence(reply,input);report.sourceQuoteValidationPassed=true;
  const p=reply.pages[0];
  report.requiresVisualVerification=Boolean(p.regions.length||[...p.facts,...p.items].some(f=>['visual','calculated'].includes(f.basis)));
  report.readyForSourceReview=p.status==='read'&&!report.requiresVisualVerification;
 }catch(error){report.error=error.code||'qa-page-probe-failed';}
 finally{
  report.elapsedMs=Math.round(performance.now()-start);report.cost=guard.summary();
  report.nativeText=saved.page.native.text;
  const usage=report.events.find(e=>e.stage==='read-provider')?.detail.usage;
  report.outputTokens=usage?.output_tokens??null;report.thinkingTokens=usage?.output_tokens_details?.thinking_tokens??null;
  report.notes=['QA-only medium effort. Production settings, previous checkpoints and cost ledgers are unchanged.',
   'The $0.20 reservation is an additional experiment estimate, not an invoice or a guaranteed charge cap.',
   'Single cached-source page. No upload, PDF parsing, independent visual verification, reconciliation, pricing, PDF/email or website journey was tested.',
   'Structural and source-quote validity do not establish completeness or accuracy. Compare saved nativeText with result before a full-file run.'];
  await privateJson(file,report);
 }
 return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 checkSavedPage({reportPath:process.argv[2]}).then(report=>{
  console.log(JSON.stringify(report,null,2));
  if(!report.readyForSourceReview)process.exitCode=1;
 }).catch(error=>{console.error('Probe stopped:',error.code||error.message);process.exitCode=1;});
}
