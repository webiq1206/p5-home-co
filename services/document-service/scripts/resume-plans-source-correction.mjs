import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA,READER_SYSTEM,VERIFIER_SYSTEM} from '../src/contracts.mjs';
import {CITATION_SYSTEM,citationInput,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {prepareSourceRepair} from '../src/evidence-source-repair.mjs';
import {privateJson} from './model-qa-support.mjs';
const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const refuse=message=>{throw Error(message+'. Nothing restarted.');};
const parsed=cache=>JSON.parse(JSON.parse(cache.responseText).content.filter(b=>b.type==='text').map(b=>b.text).join(''));

/** Reuse the inspected page-5 read and citations; let the bounded production
 * correction revise only its two rejected items before normal verification. */
export async function resumePlansSourceCorrection(store,document,directory){
 const marker=join(directory,'plans-page5-source-correction-v1.json');
 try{await stat(marker);throw Error('Plans source correction was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8')),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const previousBytes=await readFile(join(directory,'plans-page4-source-recovery-v1.json')),previous=JSON.parse(previousBytes);
 const citationBytes=await readFile(join(directory,'plans-page4-citation-output-recovery-v1.json')),citation=JSON.parse(citationBytes);
 const outputBytes=await readFile(join(directory,'plans-page4-output-recovery-v1.json')),output=JSON.parse(outputBytes);
 if(previous.action!=='resume-plans-source-repair'||previous.previousRecoverySha256!==hash(citationBytes)||citation.previousRecoverySha256!==hash(outputBytes)||output.previousRecoverySha256!==hash(await readFile(join(directory,'plans-spatial-page3-recovery-v1.json')))||output.historicalRecoverySha256!==hash(await readFile(join(directory,'plans-citation-recovery-v1.json'))))refuse('An existing recovery archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='invalid-citation-line'||report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='invalid-citation-line')refuse('Saved document or report differs');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==18||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-1.3259193)>1e-8||stable(previous.previousLedger?.calls)!==stable(calls.slice(0,14)))refuse('Plans ledger differs from the inspected eighteen known-charge requests');
 const saved=[];
 for(const [i,call] of calls.entries()){
  const file='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==file)refuse('Unexpected paid response path');
  const cache=JSON.parse(await readFile(join(directory,file),'utf8'));
  if(cache.requestSha256!==call.requestSha256||hash(JSON.stringify(cache.request))!==call.requestSha256||hash(cache.responseText)!==call.responseSha256||cache.httpStatus!==call.httpStatus)refuse('Paid response integrity check failed');
  saved.push(cache);
 }
 const pages=await store.pages(document.id,null,true),jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review'),failed=reads.find(j=>j.payload.pages?.[0]===5);
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2,3,4'||pages.slice(0,3).some(p=>p.evidence.status!=='partial')||pages[3].evidence.status!=='read')refuse('Saved page coverage differs');
 if(previous.pageFingerprints?.length!==23||pages.some((p,i)=>previous.pageFingerprints[i].page!==p.page||previous.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||previous.pageFingerprints[i].imageSha256!==hash(p.image))||previous.pageEvidence?.length!==3||pages.slice(0,3).some((p,i)=>stable(p.evidence)!==stable(previous.pageEvidence[i].evidence)))refuse('Saved source or completed evidence changed');
 const verifiedPage4=validateEvidence(validateSchema(parsed(saved[15]),EVIDENCE_SCHEMA),[pages[3].native]).pages[0];
 if(stable(verifiedPage4)!==stable(pages[3].evidence)||JSON.parse(saved[15].responseText).stop_reason!=='end_turn'||saved[14].request.model!=='claude-sonnet-5'||saved[15].request.model!=='claude-sonnet-5'||saved[15].request.system?.[0]?.text!==VERIFIER_SYSTEM)refuse('Completed page 4 differs from its saved verification');
 validateEvidence(validateSchema({pages:pages.slice(0,4).map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.slice(0,4).map(p=>p.native));
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<5?j.state!=='complete':j.payload.pages[0]>5?j.state!=='queued'||j.attempts!==0:false)||!failed||failed.state!=='failed'||failed.attempts!==1||failed.error_code!=='invalid-citation-line'||reviews.length!==1||reviews[0].state!=='failed'||reviews[0].error_code!=='source-reading-failed'||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refuse('Saved job state differs');
 const checkpoint=failed.result?.evidenceCheckpoint,raw=checkpoint?.raw,input=[{...pages[4].native,image:undefined,spans:undefined}],repair=parsed(saved[17]);
 validateSchema(raw,EVIDENCE_SCHEMA);
 if(failed.result.readProfile||failed.result.lowReadStarted||failed.result.verificationCheckpoints||checkpoint.repairStarted!==true||checkpoint.sourceCorrectionStarted||checkpoint.sourceCorrection||checkpoint.sourceCitationsStarted||checkpoint.sourceCitations||raw.pages.length!==1||raw.pages[0].page!==5||raw.pages[0].facts.length!==7||raw.pages[0].items.length!==18||checkpoint.key!==evidenceCheckpointKey({input,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA)||stable(raw)!==stable(parsed(saved[16]))||stable(checkpoint.repair)!==stable(repair)||saved[16].request.system?.[0]?.text!==READER_SYSTEM||saved[16].request.model!=='claude-sonnet-5'||saved[16].request.output_config?.effort!=='medium'||JSON.parse(saved[16].responseText).stop_reason!=='end_turn')refuse('Saved page-5 read or checkpoint differs');
 const citations=citationInput(raw,[pages[4].native]),last=JSON.parse(saved[17].responseText),request=saved[17].request;
 if(stable(JSON.parse(request.messages?.[0]?.content?.[0]?.text||'{}'))!==stable(citations)||request.model!=='claude-sonnet-5'||request.system?.[0]?.text!==CITATION_SYSTEM||request.max_tokens!==2048||request.output_config?.effort!=='medium'||request.thinking?.type!=='disabled'||last.stop_reason!=='end_turn'||last.usage?.input_tokens!==9049||last.usage?.output_tokens!==169||stable(repair.citations.find(c=>c.key==='5:facts:5')?.lines)!==stable([427,441,425,443,445]))refuse('Last citation response differs from the inspected order failure');
 const prepared=prepareSourceRepair(raw,input,citations,repair);
 if(stable(prepared.rejected.sort())!==stable(['5:items:9','5:items:10'].sort())||raw.pages[0].items[9].id!=='WIN-2640C'||raw.pages[0].items[10].id!=='WIN-2646C')refuse('Rejected source statements differ');
 await privateJson(marker,{version:1,action:'resume-plans-source-correction',createdAt:new Date().toISOString(),previousRecoverySha256:hash(previousBytes),previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:pages.slice(0,4).map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:previous.pageFingerprints});
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='invalid-citation-line')throw Error('Document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='invalid-citation-line' AND attempts=1 AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result)]);
  if(changed.rowCount!==1)throw Error('Source job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='source-reading-failed' RETURNING id",[reviews[0].id]);
  if(review.rowCount!==1)throw Error('Review changed during recovery. Inspect the archive.');
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query('UPDATE p5ds_jobs SET priority=0 WHERE id=$1',[failed.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
