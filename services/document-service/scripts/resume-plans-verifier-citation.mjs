import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA,READER_SYSTEM,VERIFIER_SYSTEM} from '../src/contracts.mjs';
import {CITATION_SYSTEM,citationInput,applyCitations,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {prepareSourceRepair,applySourceRepairs} from '../src/evidence-source-repair.mjs';
import {reconcileVerification} from '../src/pipeline.mjs';
import {SPAN_COORDINATES} from '../src/page-geometry.mjs';
import {privateJson} from './model-qa-support.mjs';
const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const refuse=message=>{throw Error(message+'. Nothing restarted.');};
const parsed=cache=>JSON.parse(JSON.parse(cache.responseText).content.filter(b=>b.type==='text').map(b=>b.text).join(''));
const inputOf=cache=>JSON.parse(cache.request.messages?.[0]?.content?.[0]?.text||'{}');
export async function resumePlansVerifierCitation(store,document,directory){
 const marker=join(directory,'plans-page8-verifier-citation-v1.json');
 try{await stat(marker);throw Error('Plans verifier-citation recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8')),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const names=['plans-page7-repair-evidence-v1.json','plans-page7-empty-fact-v1.json','plans-page5-source-correction-v1.json','plans-page4-source-recovery-v1.json','plans-page4-citation-output-recovery-v1.json','plans-page4-output-recovery-v1.json','plans-spatial-page3-recovery-v1.json'];
 const archives=await Promise.all(names.map(name=>readFile(join(directory,name)))),records=archives.map(b=>JSON.parse(b)),previous=records[0];
 if(previous.action!=='resume-plans-repair-evidence'||records.slice(0,6).some((r,i)=>r.previousRecoverySha256!==hash(archives[i+1]))||records[5].historicalRecoverySha256!==hash(await readFile(join(directory,'plans-citation-recovery-v1.json'))))refuse('An existing recovery archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='unsupported-source-statement'||report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='unsupported-source-statement')refuse('Saved document or report differs');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==34||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-2.1054914)>1e-8||stable(previous.previousLedger?.calls)!==stable(calls.slice(0,28)))refuse('Plans ledger differs from the inspected thirty-four known-charge requests');
 const saved=[];
 for(const [i,call] of calls.entries()){
  const file='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==file)refuse('Unexpected paid response path');
  const cache=JSON.parse(await readFile(join(directory,file),'utf8'));
  if(cache.requestSha256!==call.requestSha256||hash(JSON.stringify(cache.request))!==call.requestSha256||hash(cache.responseText)!==call.responseSha256||cache.httpStatus!==call.httpStatus)refuse('Paid response integrity check failed');
  if(i>=28&&(cache.request.model!=='claude-sonnet-5'||JSON.parse(cache.responseText).model!=='claude-sonnet-5'||JSON.parse(cache.responseText).stop_reason!=='end_turn'))refuse('New request or response model differs');
  saved.push(cache);
 }
 const pages=await store.pages(document.id,null,true),jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2,3,4,5,6,7'||[0,1,2,4,6].some(i=>pages[i].evidence.status!=='partial')||[3,5].some(i=>pages[i].evidence.status!=='read'))refuse('Saved page coverage differs');
 if(previous.pageFingerprints?.length!==23||pages.some((p,i)=>previous.pageFingerprints[i].page!==p.page||previous.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||previous.pageFingerprints[i].imageSha256!==hash(p.image))||previous.pageEvidence?.length!==6||previous.pageEvidence.some(p=>stable(p.evidence)!==stable(pages[p.page-1]?.evidence)))refuse('Saved source or completed evidence changed');
 const input7=[{...pages[6].native,image:undefined,spans:undefined}],raw7=parsed(saved[22]),prepared7=prepareSourceRepair(raw7,input7,citationInput(raw7,input7),parsed(saved[23]));
 const prior7=validateEvidence(applySourceRepairs(prepared7.grounded,input7,prepared7.rejected,parsed(saved[28])),input7).pages[0],verify7Input=inputOf(saved[29]);
 const checked7=validateEvidence(validateSchema(parsed(saved[29]),EVIDENCE_SCHEMA),verify7Input.pages).pages[0];
 if(stable(reconcileVerification(prior7,checked7))!==stable(pages[6].evidence)||saved[29].request.system?.[0]?.text!==VERIFIER_SYSTEM||verify7Input.pages?.length!==1||verify7Input.pages[0].page!==7||verify7Input.pages[0].spanCoordinates!==SPAN_COORDINATES||verify7Input.pages[0].text!==pages[6].native.text)refuse('Page 7 differs from its saved verification and reconciliation');
 validateEvidence(validateSchema({pages:pages.slice(0,7).map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.slice(0,7).map(p=>p.native));
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review'),failed=reads.find(j=>j.payload.pages?.[0]===8);
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<8?j.state!=='complete':j.payload.pages[0]>8?j.state!=='queued'||j.attempts!==0||j.priority!==5:false)||!failed||failed.state!=='failed'||failed.attempts!==1||failed.priority!==5||failed.error_code!=='unsupported-source-statement'||reviews.length!==1||reviews[0].state!=='failed'||reviews[0].attempts!==16||reviews[0].priority!==2||reviews[0].error_code!=='source-reading-failed'||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refuse('Saved job state differs');
 const input8=[{...pages[7].native,image:undefined,spans:undefined}],read=failed.result?.evidenceCheckpoint,verified=failed.result?.verificationCheckpoints?.['verify-8'],verifyInput=inputOf(saved[32]);
 const keys=['key','raw','repair','repairStarted','version'].sort();
 if(failed.result.readProfile||failed.result.lowReadStarted||stable(Object.keys(failed.result.verificationCheckpoints||{}))!==stable(['verify-8'])||!read||!verified||[read,verified].some(c=>stable(Object.keys(c).sort())!==stable(keys)||c.repairStarted!==true)||stable(read.raw)!==stable(parsed(saved[30]))||stable(read.repair)!==stable(parsed(saved[31]))||stable(verified.raw)!==stable(parsed(saved[32]))||stable(verified.repair)!==stable(parsed(saved[33])))refuse('Saved page-8 checkpoints differ');
 if(read.key!==evidenceCheckpointKey({input:input8,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA)||verified.key!==evidenceCheckpointKey({input:verifyInput.pages,prior:verifyInput.prior,provider:'anthropic',model:'claude-sonnet-5'},VERIFIER_SYSTEM,EVIDENCE_SCHEMA)||verifyInput.pages?.length!==1||verifyInput.pages[0].page!==8||verifyInput.pages[0].text!==pages[7].native.text||verifyInput.pages[0].spanCoordinates!==SPAN_COORDINATES||saved[30].request.system?.[0]?.text!==READER_SYSTEM||saved[32].request.system?.[0]?.text!==VERIFIER_SYSTEM)refuse('Saved source or verification identity differs');
 const readCitations=citationInput(read.raw,input8),prior8=validateEvidence(applyCitations(read.raw,input8,readCitations,read.repair),input8).pages[0],verifyCitations=citationInput(verified.raw,verifyInput.pages);
 if(stable(prior8)!==stable(verifyInput.prior)||read.raw.pages.length!==1||read.raw.pages[0].facts.length!==3||read.raw.pages[0].items.length!==4||read.raw.pages[0].regions.length!==3||stable(inputOf(saved[31]))!==stable(readCitations)||stable(inputOf(saved[33]))!==stable(verifyCitations)||[31,33].some(i=>saved[i].request.system?.[0]?.text!==CITATION_SYSTEM||saved[i].request.thinking?.type!=='disabled'))refuse('Saved read or citation input differs');
 const prepared=prepareSourceRepair(verified.raw,verifyInput.pages,verifyCitations,verified.repair);
 if(stable(prepared.rejected)!==stable(['8:items:2'])||verified.raw.pages[0].items[2].id!=='BS3-Section1'||verified.raw.pages[0].items[2].basis!=='stated'||stable(verified.repair)!==stable({citations:[{key:'8:facts:1',supported:true,lines:[48,82]},{key:'8:items:2',supported:false,lines:[]}]}))refuse('Rejected verifier statement differs');
 await privateJson(marker,{version:1,action:'resume-plans-verifier-citation',createdAt:new Date().toISOString(),previousRecoverySha256:hash(archives[0]),previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:pages.slice(0,7).map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:previous.pageFingerprints});
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='unsupported-source-statement')throw Error('Document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,priority=0,lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='unsupported-source-statement' AND attempts=1 AND priority=5 AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result)]);
  if(changed.rowCount!==1)throw Error('Failed source job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND attempts=16 AND priority=2 AND error_code='source-reading-failed' RETURNING id",[reviews[0].id]);
  if(review.rowCount!==1)throw Error('Review changed during recovery. Inspect the archive.');
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
