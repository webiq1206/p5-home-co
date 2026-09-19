import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA,READER_SYSTEM} from '../src/contracts.mjs';
import {CITATION_SYSTEM,citationInput,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {privateJson} from './model-qa-support.mjs';
const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const refuse=message=>{throw Error(message+'. Nothing restarted.');};

/** Continue only citation correction after the inspected thirteenth request
 * exhausted its output allowance entirely on thinking. The successful page-4
 * read stays intact. Caller holds the original qualification lock. */
export async function resumePlansCitationOutput(store,document,directory){
 const marker=join(directory,'plans-page4-citation-output-recovery-v1.json');
 try{await stat(marker);throw Error('Plans citation-output recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8')),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const priorBytes=await readFile(join(directory,'plans-page4-output-recovery-v1.json')),prior=JSON.parse(priorBytes);
 if(prior.action!=='resume-plans-output'||prior.previousRecoverySha256!==hash(await readFile(join(directory,'plans-spatial-page3-recovery-v1.json')))||prior.historicalRecoverySha256!==hash(await readFile(join(directory,'plans-citation-recovery-v1.json'))))refuse('An existing recovery archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='provider-output-limit'||report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='provider-output-limit')refuse('Saved document or report differs');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==13||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-.9384168)>1e-8||stable(prior.previousLedger?.calls)!==stable(calls.slice(0,11)))refuse('Plans ledger differs from the inspected thirteen known-charge requests');
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
 if(prior.pageFingerprints?.length!==23||pages.some((p,i)=>prior.pageFingerprints[i].page!==p.page||prior.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||prior.pageFingerprints[i].imageSha256!==hash(p.image))||prior.pageEvidence?.length!==3||pages.slice(0,3).some((p,i)=>stable(p.evidence)!==stable(prior.pageEvidence[i].evidence)))refuse('Saved source or completed evidence changed');
 validateEvidence(validateSchema({pages:pages.slice(0,3).map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.slice(0,3).map(p=>p.native));
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<4?j.state!=='complete':j.payload.pages[0]>4?j.state!=='queued'||j.attempts!==0:false)||!failed||failed.state!=='failed'||failed.attempts!==2||failed.error_code!=='provider-output-limit'||reviews.length!==1||!['queued','failed'].includes(reviews[0].state)||(reviews[0].state==='failed'&&reviews[0].error_code!=='source-reading-failed')||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refuse('Saved job state differs');
 const checkpoint=failed.result?.evidenceCheckpoint,raw=checkpoint?.raw,input=[{...pages[3].native,image:undefined,spans:undefined}];
 const complete=JSON.parse(saved[11].responseText),last=JSON.parse(saved[12].responseText),lastInput=JSON.parse(saved[12].request.messages?.[0]?.content?.[0]?.text||'{}');
 const completeRaw=JSON.parse((complete.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
 validateSchema(raw,EVIDENCE_SCHEMA);
 if(failed.result.readProfile!=='low-effort-v1'||failed.result.lowReadStarted!==true||checkpoint?.repairStarted!==true||checkpoint.repair||failed.result.verificationCheckpoints||raw.pages.length!==1||raw.pages[0].page!==4||checkpoint.key!==evidenceCheckpointKey({input,provider:'anthropic',model:'claude-sonnet-5',readProfile:'low-effort-v1'},READER_SYSTEM,EVIDENCE_SCHEMA)||stable(raw)!==stable(completeRaw)||complete.stop_reason!=='end_turn'||saved[11].request.output_config?.effort!=='low')refuse('Successful page-4 checkpoint differs');
 const citations=citationInput(raw,[pages[3].native]);
 if(!citations.statements.length||stable(lastInput)!==stable(citations)||saved[12].httpStatus!==200||saved[12].request.model!=='claude-sonnet-5'||saved[12].request.max_tokens!==2048||saved[12].request.output_config?.effort!=='medium'||saved[12].request.thinking||saved[12].request.system?.[0]?.text!==CITATION_SYSTEM||last.stop_reason!=='max_tokens'||last.usage?.input_tokens!==20308||last.usage?.output_tokens!==2048||(last.content||[]).filter(b=>b.type==='text').some(b=>b.text))refuse('Last citation response differs from the inspected empty output');
 await privateJson(marker,{version:1,action:'resume-plans-citation-output',createdAt:new Date().toISOString(),previousRecoverySha256:hash(priorBytes),previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:prior.pageEvidence,pageFingerprints:prior.pageFingerprints});
 const resumed=structuredClone(failed.result);resumed.evidenceCheckpoint.repairStarted=false;
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='provider-output-limit')throw Error('Document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',result=$3::jsonb,error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='provider-output-limit' AND attempts=2 AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result),JSON.stringify(resumed)]);
  if(changed.rowCount!==1)throw Error('Citation job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state=$2 RETURNING id",[reviews[0].id,reviews[0].state]);
  if(review.rowCount!==1)throw Error('Review changed during recovery. Inspect the archive.');
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
