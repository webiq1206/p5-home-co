import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA,READER_SYSTEM,VERIFIER_SYSTEM} from '../src/contracts.mjs';
import {CITATION_SYSTEM,citationInput,applyCitations,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {SOURCE_REPAIR_SYSTEM,SOURCE_REPAIR_EVIDENCE_RULE,prepareSourceRepair,applySourceRepairs} from '../src/evidence-source-repair.mjs';
import {reconcileVerification} from '../src/pipeline.mjs';
import {privateJson} from './model-qa-support.mjs';
const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const refuse=message=>{throw Error(message+'. Nothing restarted.');};
const parsed=cache=>JSON.parse(JSON.parse(cache.responseText).content.filter(b=>b.type==='text').map(b=>b.text).join(''));

/** One inspected replacement attempt under clarified evidence/geometry rules.
 * Original read, citations, invalid correction and every charge stay archived. */
export async function resumePlansRepairEvidence(store,document,directory){
 const marker=join(directory,'plans-page7-repair-evidence-v1.json');
 try{await stat(marker);throw Error('Plans repair-evidence recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8')),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const names=['plans-page7-empty-fact-v1.json','plans-page5-source-correction-v1.json','plans-page4-source-recovery-v1.json','plans-page4-citation-output-recovery-v1.json','plans-page4-output-recovery-v1.json','plans-spatial-page3-recovery-v1.json'];
 const archives=await Promise.all(names.map(name=>readFile(join(directory,name)))),records=archives.map(b=>JSON.parse(b)),previous=records[0];
 if(previous.action!=='resume-plans-empty-fact'||records.slice(0,5).some((r,i)=>r.previousRecoverySha256!==hash(archives[i+1]))||records[4].historicalRecoverySha256!==hash(await readFile(join(directory,'plans-citation-recovery-v1.json'))))refuse('An existing recovery archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='unsupported-evidence'||report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='unsupported-evidence')refuse('Saved document or report differs');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==28||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-1.8452506)>1e-8||stable(previous.previousLedger?.calls)!==stable(calls.slice(0,24)))refuse('Plans ledger differs from the inspected twenty-eight known-charge requests');
 const saved=[];
 for(const [i,call] of calls.entries()){
  const file='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==file)refuse('Unexpected paid response path');
  const cache=JSON.parse(await readFile(join(directory,file),'utf8'));
  if(cache.requestSha256!==call.requestSha256||hash(JSON.stringify(cache.request))!==call.requestSha256||hash(cache.responseText)!==call.responseSha256||cache.httpStatus!==call.httpStatus)refuse('Paid response integrity check failed');
  if(i>=24&&(cache.request.model!=='claude-sonnet-5'||JSON.parse(cache.responseText).model!=='claude-sonnet-5'||JSON.parse(cache.responseText).stop_reason!=='end_turn'))refuse('New request or response model differs');
  saved.push(cache);
 }
 const pages=await store.pages(document.id,null,true),jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2,3,4,5,6'||[0,1,2,4].some(i=>pages[i].evidence.status!=='partial')||[3,5].some(i=>pages[i].evidence.status!=='read'))refuse('Saved page coverage differs');
 if(previous.pageFingerprints?.length!==23||pages.some((p,i)=>previous.pageFingerprints[i].page!==p.page||previous.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||previous.pageFingerprints[i].imageSha256!==hash(p.image))||previous.pageEvidence?.length!==5||previous.pageEvidence.some(p=>stable(p.evidence)!==stable(pages[p.page-1]?.evidence)))refuse('Saved source or completed evidence changed');
 const input5=[{...pages[4].native,image:undefined,spans:undefined}],raw5=parsed(saved[16]),prepared5=prepareSourceRepair(raw5,input5,citationInput(raw5,input5),parsed(saved[17]));
 const prior5=validateEvidence(applySourceRepairs(prepared5.grounded,input5,prepared5.rejected,parsed(saved[24])),input5).pages[0],verifiedRaw5=parsed(saved[25]);
 const checked5=validateEvidence(applyCitations(verifiedRaw5,[pages[4].native],citationInput(verifiedRaw5,[pages[4].native]),parsed(saved[26])),[pages[4].native]).pages[0];
 if(stable(reconcileVerification(prior5,checked5))!==stable(pages[4].evidence)||saved[25].request.system?.[0]?.text!==VERIFIER_SYSTEM||saved[26].request.system?.[0]?.text!==CITATION_SYSTEM||stable(parsed(saved[26]).citations.map(c=>c.key))!==stable(['5:facts:3','5:facts:4','5:facts:5']))refuse('Page 5 differs from its saved correction, verification, citations or reconciliation');
 validateEvidence(validateSchema({pages:pages.slice(0,6).map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.slice(0,6).map(p=>p.native));
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review'),failed=reads.find(j=>j.payload.pages?.[0]===7);
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<7?j.state!=='complete':j.payload.pages[0]>7?j.state!=='queued'||j.attempts!==0||j.priority!==5:false)||!failed||failed.state!=='failed'||failed.attempts!==2||failed.priority!==1||failed.error_code!=='unsupported-evidence'||reviews.length!==1||reviews[0].state!=='queued'||reviews[0].attempts!==14||reviews[0].priority!==2||reviews[0].error_code!==null||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refuse('Saved job state differs');
 const checkpoint=failed.result?.evidenceCheckpoint,input7=[{...pages[6].native,image:undefined,spans:undefined}],raw=checkpoint?.raw;
 validateSchema(raw,EVIDENCE_SCHEMA);
 if(failed.result.readProfile||failed.result.lowReadStarted||failed.result.verificationCheckpoints||checkpoint.repairStarted!==true||checkpoint.sourceCorrectionStarted!==true||Object.hasOwn(checkpoint,'sourceCitationsStarted')||Object.hasOwn(checkpoint,'sourceCitations')||checkpoint.key!==evidenceCheckpointKey({input:input7,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA)||stable(raw)!==stable(parsed(saved[22]))||stable(checkpoint.repair)!==stable(parsed(saved[23]))||stable(checkpoint.sourceCorrection)!==stable(parsed(saved[27])))refuse('Saved page-7 checkpoint differs');
 const prepared=prepareSourceRepair(raw,input7,citationInput(raw,input7),checkpoint.repair),answer=checkpoint.sourceCorrection,request=saved[27].request,response=JSON.parse(saved[27].responseText);
 if(stable(prepared.rejected)!==stable(['7:facts:0'])||stable(raw.pages[0].facts[0])!==stable({field:'sqft',value:'',evidence:'',basis:'uncertain'})||answer.facts?.length!==1||answer.items?.length||answer.regions?.length||answer.facts[0].key!=='7:facts:0'||answer.facts[0].statement.field!=='otherDetails'||answer.facts[0].statement.basis!=='uncertain'||answer.facts[0].statement.evidence!==''||!answer.facts[0].statement.value.trim()||!answer.facts[0].reason.trim())refuse('Inspected empty-evidence correction differs');
 if(request.system?.[0]?.text!==SOURCE_REPAIR_SYSTEM.replace(SOURCE_REPAIR_EVIDENCE_RULE,'')||stable(JSON.parse(request.messages?.[0]?.content?.[0]?.text||'{}'))!==stable(prepared.input)||response.usage?.input_tokens!==7341||response.usage?.output_tokens!==181)refuse('Inspected source-correction request differs');
 const retained=structuredClone(failed.result);delete retained.evidenceCheckpoint.sourceCorrection;delete retained.evidenceCheckpoint.sourceCorrectionStarted;
 const archived7=previous.previousJobs?.find(j=>j.id===failed.id);
 if(!archived7||stable(retained)!==stable(archived7.result))refuse('Earlier read or citations changed');
 await privateJson(marker,{version:1,action:'resume-plans-repair-evidence',createdAt:new Date().toISOString(),previousRecoverySha256:hash(archives[0]),previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:pages.slice(0,6).map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:previous.pageFingerprints});
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='unsupported-evidence')throw Error('Document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,result=$2::jsonb,priority=0,lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='unsupported-evidence' AND attempts=2 AND priority=1 AND result=$3::jsonb RETURNING id",[failed.id,JSON.stringify(retained),JSON.stringify(failed.result)]);
  if(changed.rowCount!==1)throw Error('Failed source job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE id=$1 AND state='queued' AND attempts=14 AND priority=2 AND error_code IS NULL RETURNING id",[reviews[0].id]);
  if(review.rowCount!==1)throw Error('Review changed during recovery. Inspect the archive.');
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
