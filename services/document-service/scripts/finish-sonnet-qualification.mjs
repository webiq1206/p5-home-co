/** Consolidated, resumable qualification. Original reports/ledgers remain intact. */
import {readFile,mkdir,rm,stat,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withSavedRun,inspectReviewRecovery} from './inspect-sonnet-run.mjs';
import {runFixture} from './check-sonnet-documents.mjs';
import {privateJson} from './model-qa-support.mjs';
import {hash,validateEvidence,signedHeaders} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';

const SOURCE='ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018';
const PROFILE='completion-saved-evidence-v1';

export async function recoverSavedPages({root=resolve('.p5-model-qa')}={}){
 const probe=JSON.parse(await readFile(join(root,'probes','sonnet-medium-page2-v1-'+SOURCE.slice(0,16),'report.json'),'utf8'));
 if(probe.profile!=='sonnet-medium-page2-v1'||probe.model!=='claude-sonnet-5'||probe.effort!=='medium'||probe.sourceSha256!==SOURCE||probe.page!==2||probe.requestSucceeded!==true||!probe.structuralValidationPassed||probe.cost?.unknownChargeRequests!==0||probe.cost?.usage?.length!==1)throw Error('Expected the completed, usage-reported saved page-2 response.');
 return withSavedRun({root,reportPath:probe.sourceReport},async({db,report})=>{
  if(report.sourceSha256!==SOURCE||report.model!=='claude-sonnet-5')throw Error('Saved source checksum or model mismatch.');
  const docs=await db.query('SELECT id,digest,page_count FROM p5ds_documents');
  if(docs.rows.length!==1||docs.rows[0].digest!==SOURCE||docs.rows[0].page_count!==4)throw Error('Expected the original four-page source.');
  const pages=(await db.query('SELECT page,native,image,evidence FROM p5ds_pages WHERE document_id=$1 ORDER BY page',[docs.rows[0].id])).rows;
  if(pages.length!==4||pages.some((p,i)=>p.page!==i+1||p.native.page!==p.page||!p.image?.length)||probe.nativeText!==pages[1].native.text)throw Error('Saved native page manifest mismatch.');
  const recovered=validateEvidence(validateSchema(structuredClone(probe.result),EVIDENCE_SCHEMA),[pages[1].native]).pages[0];
  if(recovered.status!=='read'||recovered.regions.length||[...recovered.facts,...recovered.items].some(f=>['visual','calculated'].includes(f.basis)))throw Error('Saved page 2 still needs independent visual verification.');
  pages[1].evidence=recovered;
  for(const p of pages.filter(p=>p.evidence))validateEvidence(validateSchema({pages:[p.evidence]},EVIDENCE_SCHEMA),[p.native]);
  return {pages,previousRunEstimate:report.cost?.estimatedUsd??null,previousProbeEstimate:probe.cost?.estimatedUsd??null};
 });
}

/** Exclusive process lock. A crash leaves it for inspection instead of spending
 * again against possibly unfinished requests or opening the same SQL storage. */
export async function withQualificationLock(root,work){
 await mkdir(root,{recursive:true,mode:0o700});
 const lock=join(root,'running.lock');
 try{await mkdir(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Qualification is already running or was interrupted. Inspect its saved report before restarting.');throw error;}
 try{return await work();}finally{await rm(lock,{recursive:true});}
}

async function siteChecks(){
 const sites=['p5homeco.com','boiseremodeling.co','boiseconstruction.co','boisehandyman.co','boisecabinet.co'];
 let keys={};try{keys=JSON.parse(process.env.P5_DOCUMENT_TENANTS_JSON||'{}');}catch{}
 const checks=[];
 for(const site of sites){
  const item={site,entryAvailable:false,documentHostAuthenticated:false,adapterActivation:'not verified',customerJourney:'not verified'};
  try{const r=await fetch('https://'+site+(site==='p5homeco.com'?'/quote':site==='boisecabinet.co'?'/estimate':'/'),{signal:AbortSignal.timeout(15000)});item.entryHttpStatus=r.status;item.entryAvailable=r.ok;}catch{item.entryError='unreachable-or-timeout';}
  if(keys[site])try{const r=await fetch('https://p5homeco.com/api/p5-documents/readyz',{headers:signedHeaders(keys[site],'GET','/readyz',site),signal:AbortSignal.timeout(15000)});item.documentHostStatus=r.status;item.documentHostAuthenticated=r.ok&&(await r.json()).ok===true;}catch{item.documentHostError='unreachable-or-timeout';}
  checks.push(item);
 }return checks;
}

async function main(){
 if(process.argv[2]==='inspect-review'){
  const root=resolve('.p5-model-qa'),profile=join(root,hash(PROFILE).slice(0,16));
  try{await stat(join(profile,'running.lock'));throw Error('Qualification is running or was interrupted. Inspection will not open active storage.');}catch(e){if(e.code!=='ENOENT')throw e;}
  console.log(JSON.stringify(await inspectReviewRecovery({root,reportPath:join(profile,'short-'+SOURCE.slice(0,16),'report.json')}),null,2));
  return;
 }
 const resumeReserved=process.argv[2]==='resume-reserved',resumeReview=process.argv[2]==='resume-review',resumePlans=process.argv[2]==='resume-plans-citation',resumeOutput=process.argv[2]==='resume-plans-output',resumeCitationOutput=process.argv[2]==='resume-plans-citation-output',resumeSourceRepair=process.argv[2]==='resume-plans-source-repair',resumeSourceCorrection=process.argv[2]==='resume-plans-source-correction',resumeEmptyFact=process.argv[2]==='resume-plans-empty-fact',resumeRepairEvidence=process.argv[2]==='resume-plans-repair-evidence',resumeVerifierCitation=process.argv[2]==='resume-plans-verifier-citation',resumeVerificationBoundary=process.argv[2]==='resume-plans-verification-boundary';
 const bundlePath=resolve(process.argv[resumeReserved||resumeReview||resumePlans||resumeOutput||resumeCitationOutput||resumeSourceRepair||resumeSourceCorrection||resumeEmptyFact||resumeRepairEvidence||resumeVerifierCitation||resumeVerificationBoundary?3:2]||'p5-sonnet-fixtures.json');
 if((await stat(bundlePath)).size>40*1024*1024)throw Error('QA bundle exceeds the allowed size.');
 await chmod(bundlePath,0o600);
 const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
 if(bundle.version!==1||bundle.fixtures?.length!==2||bundle.fixtures[0].id!=='short'||bundle.fixtures[0].sha256!==SOURCE||bundle.fixtures[1].id!=='plans')throw Error('Expected the existing private four-page and 23-page bundle.');
 const base=resolve('.p5-model-qa'),recovered=await recoverSavedPages({root:base});
 // A fixed named qualification profile does not reset budgets when code changes.
 const root=join(base,hash(PROFILE).slice(0,16));
 await withQualificationLock(root,async()=>{
 const report={profile:PROFILE,previousRunEstimate:recovered.previousRunEstimate,previousProbeEstimate:recovered.previousProbeEstimate,fixtures:[],sites:await siteChecks(),allSitesQualified:false};
 console.log('Recovered saved evidence without AI calls. Additional estimated limits: $1 unfinished short-file work; $3 plans only after short-file checks pass.');
 console.log('Prior ledgers stay unchanged. One request at a time; stop on unknown charges. Cached completion is not a cold performance benchmark.');
 console.log('Streaming: 40-second idle default, 120-second total default. Sequential QA windows: 10 minutes short, 20 minutes plans. Existing $1/$3 estimated limits remain.');
 if(resumeReserved||resumeReview)console.log('Explicit recovery retains the full previous unknown reservation as spent. Any new unknown charge pauses again.');
 const file=join(root,'qualification-report.json');
 for(const fixture of bundle.fixtures){
  const r=await runFixture(fixture,{root,key:process.env.ANTHROPIC_API_KEY,...(fixture.id==='short'?{seedPages:recovered.pages,recoverLegacyCitationFailure:true,resumeReserved,resumeReview}:{resumePlans,resumeOutput,resumeCitationOutput,resumeSourceRepair,resumeSourceCorrection,resumeEmptyFact,resumeRepairEvidence,resumeVerifierCitation,resumeVerificationBoundary})});
  report.fixtures.push({id:r.id,complete:r.complete,error:r.error,reusedPages:r.reusedPages,elapsedMs:r.currentInvocationMs,cost:r.cost,quality:r.quality,providerFailure:r.providerFailure,recoveryDiagnostic:r.recoveryDiagnostic,lastSavedProviderFailure:r.lastSavedProviderFailure,report:r.reportPath});
  await privateJson(file,report);
  if(!r.complete){process.exitCode=1;break;}
 }
 console.log(JSON.stringify({...report,report:file},null,2));
 console.log('This report identifies passed and unfinished checks. Pricing, PDF/email, live adapter activation and all-site customer journeys are not certified by document QA.');
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Qualification stopped:',error.code||error.message);process.exitCode=1;});
