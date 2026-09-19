import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA,READER_SYSTEM,VERIFIER_SYSTEM} from '../src/contracts.mjs';
import {CITATION_SYSTEM,citationInput,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {prepareSourceRepair,emptyFactKeys} from '../src/evidence-source-repair.mjs';
import {privateJson} from './model-qa-support.mjs';
const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const refuse=message=>{throw Error(message+'. Nothing restarted.');};
const parsed=cache=>JSON.parse(JSON.parse(cache.responseText).content.filter(b=>b.type==='text').map(b=>b.text).join(''));

/** Recover only the inspected 24-call snapshot. Keep both original checkpoints,
 * every completed page and every charge. Earlier failed work must run first. */
export async function resumePlansEmptyFact(store,document,directory){
 const marker=join(directory,'plans-page7-empty-fact-v1.json');
 try{await stat(marker);throw Error('Plans empty-fact recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8')),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const previousBytes=await readFile(join(directory,'plans-page5-source-correction-v1.json')),previous=JSON.parse(previousBytes);
 const sourceBytes=await readFile(join(directory,'plans-page4-source-recovery-v1.json')),source=JSON.parse(sourceBytes);
 const citationBytes=await readFile(join(directory,'plans-page4-citation-output-recovery-v1.json')),citation=JSON.parse(citationBytes);
 const outputBytes=await readFile(join(directory,'plans-page4-output-recovery-v1.json')),output=JSON.parse(outputBytes);
 if(previous.action!=='resume-plans-source-correction'||previous.previousRecoverySha256!==hash(sourceBytes)||source.previousRecoverySha256!==hash(citationBytes)||citation.previousRecoverySha256!==hash(outputBytes)||output.previousRecoverySha256!==hash(await readFile(join(directory,'plans-spatial-page3-recovery-v1.json')))||output.historicalRecoverySha256!==hash(await readFile(join(directory,'plans-citation-recovery-v1.json'))))refuse('An existing recovery archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='empty-source-fact'||report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='empty-source-fact')refuse('Saved document or report differs');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==24||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-1.5931982)>1e-8||stable(previous.previousLedger?.calls)!==stable(calls.slice(0,18)))refuse('Plans ledger differs from the inspected twenty-four known-charge requests');
 const saved=[];
 for(const [i,call] of calls.entries()){
  const file='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==file)refuse('Unexpected paid response path');
  const cache=JSON.parse(await readFile(join(directory,file),'utf8'));
  if(cache.requestSha256!==call.requestSha256||hash(JSON.stringify(cache.request))!==call.requestSha256||hash(cache.responseText)!==call.responseSha256||cache.httpStatus!==call.httpStatus)refuse('Paid response integrity check failed');
  if(i>=18&&(cache.request.model!=='claude-sonnet-5'||JSON.parse(cache.responseText).model!=='claude-sonnet-5'||JSON.parse(cache.responseText).stop_reason!=='end_turn'))refuse('New request or response model differs');
  saved.push(cache);
 }
 const pages=await store.pages(document.id,null,true),jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2,3,4,6'||pages.slice(0,3).some(p=>p.evidence.status!=='partial')||pages[3].evidence.status!=='read'||pages[5].evidence.status!=='read')refuse('Saved page coverage differs');
 if(previous.pageFingerprints?.length!==23||pages.some((p,i)=>previous.pageFingerprints[i].page!==p.page||previous.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||previous.pageFingerprints[i].imageSha256!==hash(p.image))||previous.pageEvidence?.length!==4||pages.slice(0,4).some((p,i)=>stable(p.evidence)!==stable(previous.pageEvidence[i].evidence)))refuse('Saved source or completed evidence changed');
 const verified6=validateEvidence(validateSchema(parsed(saved[21]),EVIDENCE_SCHEMA),[pages[5].native]).pages[0];
 if(stable(verified6)!==stable(pages[5].evidence)||saved[21].request.system?.[0]?.text!==VERIFIER_SYSTEM)refuse('Completed page 6 differs from its saved verification');
 const completed=pages.filter(p=>p.evidence);validateEvidence(validateSchema({pages:completed.map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),completed.map(p=>p.native));
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review'),pending=reads.find(j=>j.payload.pages?.[0]===5),failed=reads.find(j=>j.payload.pages?.[0]===7);
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>[1,2,3,4,6].includes(j.payload.pages[0])?j.state!=='complete':j.payload.pages[0]>=8?j.state!=='queued'||j.attempts!==0||j.priority!==5:false)||!pending||pending.state!=='queued'||pending.attempts!==1||pending.priority!==5||pending.error_code!==null||!failed||failed.state!=='failed'||failed.attempts!==1||failed.priority!==5||failed.error_code!=='empty-source-fact'||reviews.length!==1||reviews[0].state!=='failed'||reviews[0].attempts!==14||reviews[0].error_code!=='source-reading-failed'||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refuse('Saved job state differs');
 const archived5=previous.previousJobs?.find(j=>j.id===pending.id);
 if(!archived5||stable(archived5.result)!==stable(pending.result))refuse('Pending page 5 checkpoint changed');
 for(const [job,pageNumber,readIndex,citeIndex,facts,items] of [[pending,5,16,17,7,18],[failed,7,22,23,7,17]]){
  const checkpoint=job.result?.evidenceCheckpoint,raw=checkpoint?.raw,input=[{...pages[pageNumber-1].native,image:undefined,spans:undefined}];
  validateSchema(raw,EVIDENCE_SCHEMA);
  if(job.result.readProfile||job.result.lowReadStarted||job.result.verificationCheckpoints||checkpoint.repairStarted!==true||['sourceCorrectionStarted','sourceCorrection','sourceCitationsStarted','sourceCitations'].some(k=>Object.hasOwn(checkpoint,k))||raw.pages.length!==1||raw.pages[0].page!==pageNumber||raw.pages[0].facts.length!==facts||raw.pages[0].items.length!==items||checkpoint.key!==evidenceCheckpointKey({input,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA)||stable(raw)!==stable(parsed(saved[readIndex]))||stable(checkpoint.repair)!==stable(parsed(saved[citeIndex]))||saved[readIndex].request.system?.[0]?.text!==READER_SYSTEM||saved[readIndex].request.output_config?.effort!=='medium')refuse('Saved read or checkpoint differs');
  const citations=citationInput(raw,input),request=saved[citeIndex].request;
  if(stable(JSON.parse(request.messages?.[0]?.content?.[0]?.text||'{}'))!==stable(citations)||request.system?.[0]?.text!==CITATION_SYSTEM||request.max_tokens!==2048||request.thinking?.type!=='disabled')refuse('Saved citation input differs');
  const prepared=prepareSourceRepair(raw,input,citations,checkpoint.repair);
  if(pageNumber===5&&stable(prepared.rejected.sort())!==stable(['5:items:9','5:items:10'].sort()))refuse('Pending source corrections differ');
  if(pageNumber===7&&(stable(prepared.rejected)!==stable(['7:facts:0'])||stable(emptyFactKeys(raw))!==stable(['7:facts:0'])||stable(raw.pages[0].facts[0])!==stable({field:'sqft',value:'',evidence:'',basis:'uncertain'})||raw.pages[0].regions.length!==2||stable(checkpoint.repair)!==stable({citations:[{key:'7:facts:5',supported:true,lines:[31,65]},{key:'7:facts:6',supported:true,lines:[51,53]}]})))refuse('Empty fact or its citation response differs');
 }
 if(JSON.parse(saved[22].responseText).usage?.input_tokens!==4698||JSON.parse(saved[22].responseText).usage?.output_tokens!==2875||JSON.parse(saved[23].responseText).usage?.input_tokens!==2032||JSON.parse(saved[23].responseText).usage?.output_tokens!==63)refuse('Latest paid usage differs');
 await privateJson(marker,{version:1,action:'resume-plans-empty-fact',createdAt:new Date().toISOString(),previousRecoverySha256:hash(previousBytes),previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:completed.map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:previous.pageFingerprints});
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='empty-source-fact')throw Error('Document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='empty-source-fact' AND attempts=1 AND priority=5 AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result)]);
  if(changed.rowCount!==1)throw Error('Failed source job changed during recovery. Inspect the archive.');
  const earlier=await c.query("UPDATE p5ds_jobs SET priority=0 WHERE id=$1 AND state='queued' AND error_code IS NULL AND attempts=1 AND priority=5 AND result=$2::jsonb RETURNING id",[pending.id,JSON.stringify(pending.result)]);
  if(earlier.rowCount!==1)throw Error('Pending source job changed during recovery. Inspect the archive.');
  await c.query('UPDATE p5ds_jobs SET priority=1 WHERE id=$1',[failed.id]);
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='source-reading-failed' AND attempts=14 RETURNING id",[reviews[0].id]);
  if(review.rowCount!==1)throw Error('Review changed during recovery. Inspect the archive.');
  // Equalize age before assigning explicit precedence to existing failed work.
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
