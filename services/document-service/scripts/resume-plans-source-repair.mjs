import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {privateJson} from './model-qa-support.mjs';
const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const REJECTED=['4:facts:1','4:items:0','4:items:1','4:items:7','4:items:10','4:items:12','4:items:23','4:items:42'].sort();
const refuse=message=>{throw Error(message+'. Nothing restarted.');};

/** A new read is permitted only for the inspected, rejected page-4 draft.
 * Its raw response, failed citations and every prior charge remain archived.
 * No accepted page is reread and no unsupported claim is promoted. */
export async function resumePlansSourceRepair(store,document,directory){
 const marker=join(directory,'plans-page4-source-recovery-v1.json');
 try{await stat(marker);throw Error('Plans source recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8')),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const previousBytes=await readFile(join(directory,'plans-page4-citation-output-recovery-v1.json')),previous=JSON.parse(previousBytes);
 const outputBytes=await readFile(join(directory,'plans-page4-output-recovery-v1.json')),output=JSON.parse(outputBytes);
 if(previous.action!=='resume-plans-citation-output'||previous.previousRecoverySha256!==hash(outputBytes)||output.action!=='resume-plans-output'||output.previousRecoverySha256!==hash(await readFile(join(directory,'plans-spatial-page3-recovery-v1.json')))||output.historicalRecoverySha256!==hash(await readFile(join(directory,'plans-citation-recovery-v1.json'))))refuse('An existing recovery archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='unsupported-source-statement'||report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='unsupported-source-statement')refuse('Saved document or report differs');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==14||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-.9904528)>1e-8||stable(previous.previousLedger?.calls)!==stable(calls.slice(0,13)))refuse('Plans ledger differs from the inspected fourteen known-charge requests');
 const saved=[];
 for(const [i,call] of calls.entries()){
  const file='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==file)refuse('Unexpected paid response path');
  const cache=JSON.parse(await readFile(join(directory,file),'utf8'));
  if(cache.requestSha256!==call.requestSha256||hash(JSON.stringify(cache.request))!==call.requestSha256||hash(cache.responseText)!==call.responseSha256||cache.httpStatus!==call.httpStatus)refuse('Paid response integrity check failed');
  saved.push(cache);
 }
 const pages=await store.pages(document.id,null,true),jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review'),failed=reads.find(j=>j.payload.pages?.[0]===4);
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2,3'||pages.slice(0,3).some(p=>p.evidence.status!=='partial'))refuse('Saved page coverage differs');
 if(previous.pageFingerprints?.length!==23||pages.some((p,i)=>previous.pageFingerprints[i].page!==p.page||previous.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||previous.pageFingerprints[i].imageSha256!==hash(p.image))||previous.pageEvidence?.length!==3||pages.slice(0,3).some((p,i)=>stable(p.evidence)!==stable(previous.pageEvidence[i].evidence)))refuse('Saved source or completed evidence changed');
 validateEvidence(validateSchema({pages:pages.slice(0,3).map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.slice(0,3).map(p=>p.native));
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<4?j.state!=='complete':j.payload.pages[0]>4?j.state!=='queued'||j.attempts!==0:false)||!failed||failed.state!=='failed'||failed.attempts!==3||failed.error_code!=='unsupported-source-statement'||reviews.length!==1||!['queued','failed'].includes(reviews[0].state)||(reviews[0].state==='failed'&&reviews[0].error_code!=='source-reading-failed')||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refuse('Saved job state differs');
 const checkpoint=failed.result?.evidenceCheckpoint,raw=checkpoint?.raw,input=[{...pages[3].native,image:undefined,spans:undefined}];
 const oldCheckpoint=previous.previousJobs?.find(j=>j.kind==='read'&&j.payload.pages?.[0]===4)?.result?.evidenceCheckpoint;
 const complete=JSON.parse(saved[11].responseText),last=JSON.parse(saved[13].responseText),lastInput=JSON.parse(saved[13].request.messages?.[0]?.content?.[0]?.text||'{}');
 const completeRaw=JSON.parse((complete.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('')),repair=JSON.parse((last.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
 validateSchema(raw,EVIDENCE_SCHEMA);validateSchema(repair,CITATION_SCHEMA);
 const historicalSystem=saved[11].request.system?.[0]?.text;
 if(typeof historicalSystem!=='string'||!historicalSystem||failed.result.readProfile!=='low-effort-v1'||failed.result.lowReadStarted!==true||checkpoint?.repairStarted!==true||failed.result.verificationCheckpoints||raw.pages.length!==1||raw.pages[0].page!==4||raw.pages[0].facts.length!==3||raw.pages[0].items.length!==45||raw.pages[0].facts[1].field!=='projectMonths'||raw.pages[0].facts[1].value!==''||checkpoint.key!==oldCheckpoint?.key||stable(raw)!==stable(oldCheckpoint?.raw)||checkpoint.key!==evidenceCheckpointKey({input,provider:'anthropic',model:'claude-sonnet-5',readProfile:'low-effort-v1'},historicalSystem,EVIDENCE_SCHEMA)||stable(raw)!==stable(completeRaw)||stable(checkpoint.repair)!==stable(repair)||complete.stop_reason!=='end_turn'||saved[11].request.model!=='claude-sonnet-5'||saved[11].request.output_config?.effort!=='low')refuse('Rejected page-4 checkpoint differs');
 const citations=citationInput(raw,[pages[3].native]);
 if(stable(lastInput)!==stable(citations)||saved[13].httpStatus!==200||saved[13].request.model!=='claude-sonnet-5'||saved[13].request.max_tokens!==2048||saved[13].request.output_config?.effort!=='medium'||saved[13].request.thinking?.type!=='disabled'||saved[13].request.system?.[0]?.text!==CITATION_SYSTEM||last.stop_reason!=='end_turn'||last.usage?.input_tokens!==20308||last.usage?.output_tokens!==1142||repair.citations.length!==citations.statements.length||new Set(repair.citations.map(c=>c.key)).size!==repair.citations.length||repair.citations.some(c=>!citations.statements.some(s=>s.key===c.key))||stable(repair.citations.filter(c=>!c.supported).map(c=>c.key).sort())!==stable(REJECTED))refuse('Last citation response differs from the inspected source rejection');
 await privateJson(marker,{version:1,action:'resume-plans-source-repair',createdAt:new Date().toISOString(),previousRecoverySha256:hash(previousBytes),previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:previous.pageEvidence,pageFingerprints:previous.pageFingerprints});
 // The rejected draft remains in the permanent archive and response cache.
 // A fresh prompt needs a fresh draft; this does not clear any accepted evidence.
 const resumed={readProfile:'low-effort-v1',readProfileReason:'inspected-source-mismatch'};
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='unsupported-source-statement')throw Error('Document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',result=$3::jsonb,error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='unsupported-source-statement' AND attempts=3 AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result),JSON.stringify(resumed)]);
  if(changed.rowCount!==1)throw Error('Source job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state=$2 RETURNING id",[reviews[0].id,reviews[0].state]);
  if(review.rowCount!==1)throw Error('Review changed during recovery. Inspect the archive.');
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
