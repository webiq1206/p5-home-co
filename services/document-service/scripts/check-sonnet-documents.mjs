/** Opt-in private qualification with the REAL parser, Reader, Pipeline and Store.
 * No production DB, HTTP endpoint, deployment, email or pricing call is used.
 * Private fixture bundle contains original PDFs, never executable source. */
import {readFile,mkdir,chmod,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {Reader} from '../src/provider.mjs';
import {parsePdf} from '../src/parser.mjs';
import {readConfig,hash,validateEvidence,ServiceError,providerCallLimit} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {citationInput} from '../src/evidence-citations.mjs';
import {resumeReviewStream} from './resume-review-stream.mjs';
import {resumeReservedStream} from './resume-reserved-stream.mjs';
import {resumeLegacyCitationFailure} from './resume-citation-failure.mjs';
import {resumePlansCitation} from './resume-plans-citation.mjs';
import {resumePlansOutput} from './resume-plans-output.mjs';
import {resumePlansCitationOutput} from './resume-plans-citation-output.mjs';
import {resumePlansSourceRepair} from './resume-plans-source-repair.mjs';
import {resumePlansSourceCorrection} from './resume-plans-source-correction.mjs';
import {resumePlansEmptyFact} from './resume-plans-empty-fact.mjs';
import {resumePlansRepairEvidence} from './resume-plans-repair-evidence.mjs';
import {summarizeStages} from '../src/benchmark-metrics.mjs';
import {isolatedPool,guardedSonnetFetch,privateJson,targetedChecks} from './model-qa-support.mjs';
import {savedRunEvents,latestProviderFailure} from './saved-run-events.mjs';

// Sequential diagnostic queues need their own window. This does not alter the
// production job deadline, per-call timeout, provider capacity or cost guards.
export function qualificationWindow(config,id){
 const windowMs=id==='plans'?1200000:Math.max(600000,config.jobMs);
 return {windowMs,jobMs:Math.max(windowMs,config.jobMs)};
}
export function admitBeforeDeadline(deadline,callMs,now=performance.now()){
 if(deadline-now<callMs+5000)throw new ServiceError('qa-window-complete-before-next-request',422);
}

export async function runFixture(fixture,{root,key,parseOnly=false,request=fetch,log=console.log,seedPages=[],recoverLegacyCitationFailure=false,resumeReserved=false,resumeReview=false,resumePlans=false,resumeOutput=false,resumeCitationOutput=false,resumeSourceRepair=false,resumeSourceCorrection=false,resumeEmptyFact=false,resumeRepairEvidence=false}={}){
 const bytes=Buffer.from(fixture.pdfBase64,'base64');
 if(!['short','plans'].includes(fixture.id)||hash(bytes)!==fixture.sha256||bytes.length>25*1024*1024||fixture.pages!==({short:4,plans:23})[fixture.id])throw Error('Invalid fixture bundle or source digest.');
 const providerLimit=fixture.id==='short'?1:3,maxCalls=fixture.id==='short'?12:64;
 const directory=join(root,fixture.id+'-'+fixture.sha256.slice(0,16));await mkdir(directory,{recursive:true,mode:0o700});
 const sourceSummary={id:fixture.id,sourceSha256:fixture.sha256,sourceBytes:bytes.length,expectedPages:fixture.pages};
 if(parseOnly){
  const started=performance.now(),pages=[];
  await parsePdf(bytes,{maxPages:fixture.pages,timeoutMs:180000,onPage:p=>pages.push({page:p.page,kind:p.kind,nativeMs:p.nativeMs,renderMs:p.renderMs,characters:p.text.length,digitCharacters:(p.text.match(/\d/g)||[]).length})});
  if(pages.length!==fixture.pages)throw Error('Fixture page count differs from its manifest.');
  const report={...sourceSummary,test:'parser-only',liveAI:false,pages,elapsedMs:Math.round(performance.now()-started)};
  await privateJson(join(directory,'parser-report.json'),report);log(JSON.stringify(report));return report;
 }
 if(!key)throw Error('ANTHROPIC_API_KEY is unavailable. Run this inside the existing P5 Replit Shell. Do not paste the key into chat.');
 const config=readConfig({...process.env,DOCUMENT_PROVIDER:'anthropic',ANTHROPIC_API_KEY:key,DOCUMENT_MODEL:'claude-sonnet-5',DOCUMENT_VERIFY_MODEL:'claude-sonnet-5',DOCUMENT_DATABASE_URL:'qa-isolated-pglite-not-a-network-database',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'model-qa':randomBytes(32).toString('hex')})});
 // Diagnostic QA is sequential so a single unknown charge can stop all further
 // paid calls. Production concurrency and processing code remain unchanged.
 config.slots=1;config.parserSlots=1;config.maxPages=fixture.pages;config.maxOutput=Math.min(config.maxOutput,10000);
 const timing=qualificationWindow(config,fixture.id);config.jobMs=timing.jobMs;
 const controller=new AbortController(),limit=timing.windowMs,deadline=performance.now()+limit;
 let stop,document,review,started,runType='new',recoveryPreflight=false;
 const makeCostGuard=()=>guardedSonnetFetch({file:join(directory,'cost.json'),limitUsd:providerLimit,maxCalls,request,reuseResponses:true,onRequest:n=>log(fixture.id+': provider request '+n),onPause:error=>controller.abort(error)});
 let costGuard=await makeCostGuard();
 const pool=await isolatedPool(join(directory,'database')),store=new Store(pool,config);
 const reader=new Reader(config,store,(url,options)=>{
  admitBeforeDeadline(deadline,providerCallLimit(config));
  return costGuard.request(url,{...options,signal:AbortSignal.any([options.signal,controller.signal])});
 });
 const parser=(data,options)=>{
  if(!options.crop&&seedPages.length===fixture.pages)return (async()=>{
   await options.onManifest(fixture.pages);
   for(const p of seedPages){controller.signal.throwIfAborted();if(!options.skipPages?.includes(p.page))await options.onPage({...p.native,page:p.page,image:p.image,parseMs:0,nativeMs:0,renderMs:0});}
  })();
  return parsePdf(data,{...options,signal:AbortSignal.any([options.signal,controller.signal])});
 };
 const pipeline=new Pipeline(store,reader,config,parser);
 let report={...sourceSummary,test:'isolated-live-provider',liveAI:true,model:'claude-sonnet-5',verificationModel:'claude-sonnet-5',complete:false,uploadMs:null,productionQueueMs:null,customerWaitMs:null,productionPerformanceQualified:false,accuracyQualified:false};
 const timer=setTimeout(()=>controller.abort(),limit);
 try{
  await store.init();started=performance.now();
  const receipt=await store.putDocument('model-qa','source-check','fixture.pdf',bytes);document=receipt.document;
  runType=receipt.cached?'resume-or-cache':'new';
  if(resumeRepairEvidence&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansRepairEvidence(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-repair-evidence';log('plans: archived the invalid source correction; retained six committed pages, original page-7 read/citations and all 28 charges.');
  }
  if(resumeEmptyFact&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansEmptyFact(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-empty-fact';log('plans: preserved both saved checkpoints and every charge; prioritizing pending page 5 and failed page 7 before untouched pages.');
  }
  if(resumeSourceCorrection&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansSourceCorrection(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-source-correction';log('plans: preserved page 5 and its citations, all completed evidence and every charge; correcting only its two rejected source items before ordinary verification.');
  }
  if(resumeSourceRepair&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansSourceRepair(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-source-repair';log('plans: archived the rejected page-4 draft and citations; preserved completed evidence and every charge. Re-reading only the failed page under corrected source rules.');
  }
  if(resumeCitationOutput&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansCitationOutput(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-citation-output';log('plans: preserved the complete page-4 read and every prior charge; continuing only its inspected citation correction before normal verification.');
  }
  if(resumeOutput&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansOutput(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-output';log('plans: archived the inspected page-4 output limit; retained completed evidence and all charges. One bounded lower-effort page read, with unchanged citation and visual verification.');
  }
  if(resumePlans&&fixture.id==='plans'){
   recoveryPreflight=true;
   await resumePlansCitation(store,document,directory);
   recoveryPreflight=false;
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-plans-citation';log('plans: archived the rejected page-3 draft; retained all native pages, prior evidence statuses and charges. Strict source validation remains enabled.');
  }
  if(resumeReview&&fixture.id==='short'){
   recoveryPreflight=true;
   await resumeReviewStream(store,document,directory);
   recoveryPreflight=false;
   costGuard=await makeCostGuard();
   runType='resume-review-stream';log('short: all four completed pages and prior charges preserved; resuming final review only.');
  }
  if(resumeReserved&&fixture.id==='short'){
   await resumeReservedStream(store,document,directory);
   costGuard=await makeCostGuard();document=await store.document('model-qa','source-check',document.id);
   runType='resume-reserved-stream';log('short: full prior reservation retained; pages 1 and 2 preserved; unfinished work uses bounded streaming.');
  }
  if(recoverLegacyCitationFailure&&fixture.id==='short'&&await resumeLegacyCitationFailure(store,document,directory)){
   document=await store.document('model-qa','source-check',document.id);
   runType='resume-citation-recovery';log('short: preserved pages 1 and 2 and prior charges; resuming unfinished work with citation recovery.');
  }
  if(receipt.cached)report.reusedPages=(await store.pages(document.id)).filter(p=>p.evidence).map(p=>p.page);
  if(!receipt.cached&&seedPages.length){
   if(seedPages.length!==fixture.pages||seedPages.some((p,i)=>p.page!==i+1||p.native.page!==p.page||!p.image?.length))throw Error('Invalid saved-page manifest.');
   // Native pages were saved by the real parser in the prior source run. No
   // original PDF is parsed again; already validated evidence is imported once.
   await pipeline.prepare(await store.claim(['parse']),controller.signal);
   const reused=[];
   await store.transaction(async c=>{
    for(const p of seedPages.filter(p=>p.evidence)){
     const value=validateEvidence(validateSchema({pages:[structuredClone(p.evidence)]},EVIDENCE_SCHEMA),[p.native]).pages[0];
     if(value.status!=='read'||value.regions.length)throw Error('Saved evidence is incomplete.');
     await c.query('UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2',[document.id,p.page,JSON.stringify(value)]);reused.push(p.page);
    }
    await store.finalize(document.id,c);
   });
   runType='resume-saved-source';report.reusedPages=reused;
   log(fixture.id+': reused validated pages '+reused.join(', ')+'; only unfinished pages will call the provider.');
  }
  review=await pipeline.submitReview('model-qa','source-check',{documents:[{id:document.id,source:'fixture.pdf'}],text:'Extract all included work, preserve exclusions and responsibility boundaries. Missing or redacted values must remain missing. Do not generate prices.',answers:{}});
  if(document.state==='failed'||review.state==='failed')throw Error('Saved failure requires inspection; this command does not automatically restart exhausted work.');
  stop=pipeline.start();let last='';
  while(true){
   controller.signal.throwIfAborted();
   [document,review]=await Promise.all([store.document('model-qa','source-check',document.id),store.job('model-qa','source-check',review.id)]);
   const progress=await store.documentProgress(document.id),status=`${document.state}; checked ${progress.checked}/${document.page_count??'?'}; review ${review.state}`;
   if(status!==last){log(fixture.id+': '+status);last=status;}
   if(document.state==='failed'||review.state==='failed')throw Error(document.error_code||review.error_code||'Processing failed');
   if(document.state==='complete'&&review.state==='complete')break;
   await new Promise(r=>setTimeout(r,500));
  }
  const coverage=await store.coverage(document.id);
  report.result=review.result;
  report.pageEvidence=(await store.pages(document.id)).map(p=>({page:p.page,nativeText:p.native.text,evidence:p.evidence}));
  report.quality=targetedChecks(fixture.id,review.result,fixture.pages);
  report.complete=coverage.length===fixture.pages&&coverage.every(p=>p.status==='read')&&report.quality.passed;
  if(!report.complete)report.error='Targeted source checks or page verification did not pass. Inspect the private report before another paid run.';
 }catch(error){
  report.error=error.name==='AbortError'?'qa-wall-time-limit':error.code||error.message;
  if(error.recoveryDiagnostic)report.recoveryDiagnostic=error.recoveryDiagnostic;
  if(recoveryPreflight)report.preflightRejected=true;
 }
 finally{
  clearTimeout(timer);controller.abort();if(stop)await stop();
  report.runType=runType;report.currentInvocationMs=started?Math.round(performance.now()-started):0;
  const events=await savedRunEvents(pool,document);
  report.stageWork=summarizeStages(events);report.events=events;report.cost=costGuard.summary();
  report.providerFailure=report.complete||report.preflightRejected?null:latestProviderFailure(events);
  if(report.preflightRejected)report.lastSavedProviderFailure=latestProviderFailure(events);
  if(document){
   const pages=await store.pages(document.id);
   report.pageEvidence=pages.map(p=>({page:p.page,nativeText:p.native.text,evidence:p.evidence}));
   const drafts=(await pool.query("SELECT id,payload,result,error_code FROM p5ds_jobs WHERE document_id=$1 AND result ? 'evidenceCheckpoint'",[document.id])).rows;
   report.savedDrafts=drafts.flatMap(j=>Object.entries({read:j.result.evidenceCheckpoint,...j.result.verificationCheckpoints}).map(([stage,saved])=>({jobId:j.id,stage,error:j.error_code,pages:j.payload.pages,...saved,citationIssues:citationInput(saved.raw,pages.map(p=>p.native))})));
  }
  report.qaProviderSlots=config.slots;
  report.qaWindowMs=limit;report.qaJobDeadlineMs=config.jobMs;
  report.notes=['Uses actual production processing code in isolated local SQL storage. This is not the deployed website/worker or its queue.',
   ...(seedPages.length?['Native source pages and validated evidence were reused from a previous paid run. This is not a cold full-file performance measurement.']:[]),
   'QA provider concurrency is one for diagnosis and cost containment. This is not a production concurrency benchmark.',
   'QA uses the same bounded provider stream handling as production code, with a separate sequential queue window.',
   'No network upload is measured. Token counting adds QA overhead; summed parallel stages do not equal wall time.',
   'One run is not a percentile benchmark. Cached/resumed runs are not cold processing performance.',
   'No price, branded PDF, email, live adapter activation or 99.9% accuracy claim follows from this test.'];
  // A preflight rejection is a separate attempt, not a new provider result.
  // Preserve the primary paid-run report and its history for recovery archives.
  report.reportPath=join(directory,report.preflightRejected?'recovery-preflight-report.json':'report.json');
  await privateJson(report.reportPath,report);await pool.end();
 }
 log(JSON.stringify({id:fixture.id,complete:report.complete,error:report.error,model:report.model,currentInvocationMs:report.currentInvocationMs,cost:report.cost,quality:report.quality,providerFailure:report.providerFailure,recoveryDiagnostic:report.recoveryDiagnostic,lastSavedProviderFailure:report.lastSavedProviderFailure,report:report.reportPath}));
 return report;
}

async function main(){
 const bundlePath=resolve(process.argv[2]||'p5-sonnet-fixtures.json'),mode=process.argv[3]||'live';
 if(!['live','parse'].includes(mode))throw Error('Use live or parse as the optional mode.');
 if((await stat(bundlePath)).size>40*1024*1024)throw Error('QA bundle exceeds the allowed size.');
 await chmod(bundlePath,0o600);
 const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
 if(bundle.version!==1||bundle.fixtures?.length!==2||bundle.fixtures[0].id!=='short'||bundle.fixtures[1].id!=='plans')throw Error('Expected the private four-page and 23-page fixture bundle.');
 // Isolate checkpoints after any maintained processing-code change.
 const fingerprint=createHash('sha256');
 for(const file of ['core','contracts','pipeline','provider','parser','parser-worker','schema','store'])fingerprint.update(await readFile(new URL('../src/'+file+'.mjs',import.meta.url)));
 const root=resolve('.p5-model-qa',fingerprint.digest('hex').slice(0,16));
 console.log(mode==='parse'?'Parser checks only. No provider calls.':'Sonnet-only QA: four-page file first; 23-page plans only if its targeted checks pass.');
 console.log('Live runs reserve estimated costs up to $1 for the short file and $3 for the plans. Existing provider limits are not raised.');
 console.log('Uses private local checkpoints, never DATABASE_URL. No republish or production configuration change.');
 console.log('QA sends one request at a time and stops on the first interrupted or unknown-charge request. Inspect saved work before any further paid attempt.');
 for(const fixture of bundle.fixtures){
  const result=await runFixture(fixture,{root,key:process.env.ANTHROPIC_API_KEY,parseOnly:mode==='parse'});
  if(mode==='live'&&!result.complete){process.exitCode=1;console.log('Stopped before the next fixture. Upload the private report for review.');return;}
 }
 console.log('Finished requested checks. Upload the report files for source review. This is not full accuracy or deployment qualification.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Check stopped:',error.code||error.message);process.exitCode=1;});
