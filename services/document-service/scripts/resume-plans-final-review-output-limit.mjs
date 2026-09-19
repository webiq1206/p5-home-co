import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {privateJson,reservationAcknowledged,reservationFingerprint} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const LEDGER='3295ec5b12fc69ce7a949dd3c6489d97c4049736a7a7cf348ab5ced8fdebc1f4';
const SHORT='71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc';
const EVIDENCE='1e06fa856452dc082c16d479af2eb97d4c2a011d4eb8231ca10e64f06c122d3b';
const PAGE9='fdd90635e5c4da3642b40d144d7fba34b46920d4d567b0e3c68d74c27b73039a';

export function plansFinalReviewOutputLimitChecks({ledger,document,jobs,pages,shortLedgerSha256,ledgerSha256,evidenceSha256,page9Sha256,attempted=false}){
 const calls=Array.isArray(ledger.calls)?ledger.calls:[],last=calls.at(-1),review=jobs.filter(job=>job.kind==='review');
 const known=calls.filter(call=>call.status==='usage-reported'),unknown=calls.filter(call=>call.status==='charge-unknown');
 const total=calls.reduce((sum,call)=>sum+Number(call.reservedUsd||0),0);
 return {
  recoveryNotAttempted:!attempted,
  exactLedgers:ledgerSha256===LEDGER&&shortLedgerSha256===SHORT,
  expectedDocument:document.digest===SOURCE&&document.state==='complete'&&document.page_count===23,
  accountingPreserved:ledger.version===1&&ledger.model==='claude-sonnet-5'&&ledger.paused===true&&calls.length===88&&known.length===85&&unknown.length===3&&
   known.every(call=>call.usage&&!call.acknowledgement)&&Math.abs(known.reduce((sum,call)=>sum+call.reservedUsd,0)-5.418725)<=1e-8&&
   Math.abs(unknown[0]?.reservedUsd-.53427)<=1e-8&&reservationAcknowledged(unknown[0])&&Math.abs(unknown[1]?.reservedUsd-.53404)<=1e-8&&reservationAcknowledged(unknown[1])&&Math.abs(unknown[2]?.reservedUsd-.53404)<=1e-8&&Math.abs(total-7.021075)<=1e-8,
  exactUnknown:last===unknown[2]&&!last.usage&&!last.acknowledgement&&last.httpStatus===200&&last.failure?.code==='provider-invalid-stream'&&
   last.progress?.streaming===true&&last.progress.complete===false&&last.progress.stopReason==='max_tokens'&&last.progress.lastEvent==='message_stop',
  pagesPreserved:pages.length===23&&pages.every((page,index)=>page.page===index+1&&page.evidence)&&evidenceSha256===EVIDENCE&&page9Sha256===PAGE9,
  page9RemainsPartial:pages[8]?.evidence?.status==='partial'&&pages[8].evidence.items?.some(item=>item.id==='9-item-1'&&item.basis==='uncertain'&&item.quantity===null&&/assembly depth/i.test(item.component)),
  oneFailedReview:review.length===1&&review[0].state==='failed'&&review[0].attempts===19&&review[0].error_code==='qa-paused-unknown-provider-charge',
  sourceJobsComplete:jobs.every(job=>job.kind==='review'||job.state==='complete'),
  noActiveOperation:jobs.every(job=>job.state!=='running'),
 };
}

export async function inspectPlansFinalReviewOutputLimitState(store,document,directory){
 const marker=join(directory,'plans-final-review-output-limit-v1.json');
 let attempted=false;try{await stat(marker);attempted=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 const ledgerBytes=await readFile(join(directory,'cost.json'),'utf8'),ledger=JSON.parse(ledgerBytes);
 const shortBytes=await readFile(join(directory,'..','short-ef5caf0682131935','cost.json'),'utf8');
 const jobs=(await store.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,pages=await store.pages(document.id,null,true);
 const evidenceSha256=hash(stable(pages.map(page=>({page:page.page,evidence:page.evidence}))));
 const page9Sha256=hash(stable(pages.find(page=>page.page===9)?.evidence));
 const checks=plansFinalReviewOutputLimitChecks({ledger,document,jobs,pages,attempted,ledgerSha256:hash(ledgerBytes),shortLedgerSha256:hash(shortBytes),evidenceSha256,page9Sha256});
 const parserBytes=await readFile(new URL('../src/anthropic-stream.mjs',import.meta.url));
 checks.inspectedParser=hash(parserBytes)==='c545f6bfdedf2440ed7b77fde50619055cda986d4a28bb3c296c6af1f3c33489';
 checks.originalAttemptArchived=await stat(join(directory,'plans-final-review-recovery-v1.json')).then(()=>true,()=>false);
 checks.postFixAttemptArchived=await stat(join(directory,'plans-final-review-after-fix-v1.json')).then(()=>true,()=>false);
 let evidenceError=null;
 try{validateEvidence(validateSchema({pages:pages.map(page=>structuredClone(page.evidence))},EVIDENCE_SCHEMA),pages.map(page=>page.native));checks.evidenceValid=true;}
 catch(error){checks.evidenceValid=false;evidenceError=error.code||'saved-evidence-validation-failed';}
 return {eligible:Object.values(checks).every(Boolean),checks,failedChecks:Object.keys(checks).filter(key=>!checks[key]),evidenceError,marker,ledger,jobs,pages};
}

/** One explicitly authorized larger-output attempt after inspection of call 88. All historical unknowns remain fully
 * counted and fingerprint-acknowledged; only the failed review is requeued. */
export async function resumePlansFinalReviewOutputLimit(store,document,directory){
 const inspected=await inspectPlansFinalReviewOutputLimitState(store,document,directory);
 if(!inspected.eligible)throw Error((inspected.checks.recoveryNotAttempted?'Saved plans state differs: ':'Plans final-review recovery was already attempted: ')+inspected.failedChecks.join(', ')+'. Nothing restarted.');
 const {ledger,jobs,pages,marker}=inspected,last=ledger.calls.at(-1);
 await privateJson(marker,{version:1,action:'resume-plans-final-review-output-limit',createdAt:new Date().toISOString(),sourceCommit:process.env.P5_QA_SOURCE_COMMIT||null,
  previousLedger:ledger,previousJobs:jobs,pageEvidenceSha256:EVIDENCE,page9EvidenceSha256:PAGE9,
  knownUsageUsd:5.418725,unknownReservationUsd:1.60235,totalEstimatedUsd:7.021075});
 const acknowledged=structuredClone(ledger);
 acknowledged.calls[87].acknowledgement={action:'resume-reserved',reason:'inspected-call-88-terminal-output-limit',fingerprint:reservationFingerprint(last),createdAt:new Date().toISOString()};
 acknowledged.paused=false;
 if(!reservationAcknowledged(acknowledged.calls[87])||Math.abs(acknowledged.calls.reduce((sum,call)=>sum+call.reservedUsd,0)-7.021075)>1e-8)throw Error('Unknown reservation acknowledgement failed. Nothing restarted.');
 const review=jobs.find(job=>job.kind==='review');
 await store.transaction(async client=>{
  const changed=await client.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND attempts=19 AND error_code='qa-paused-unknown-provider-charge' RETURNING id",[review.id]);
  if(changed.rowCount!==1)throw Error('Saved final review changed during recovery. Inspect the archive.');
 });
 await privateJson(join(directory,'cost.json'),acknowledged);
 return {marker,pages:pages.length};
}