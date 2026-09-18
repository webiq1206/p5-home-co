import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {privateJson,reservationFingerprint,reservationAcknowledged} from './model-qa-support.mjs';
import {validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';

/** One explicit recovery for the reported sixth-call stream parser failure.
 * All source pages and every existing charge stay intact. A later unknown
 * charge still pauses; neither this mode nor normal resume acknowledges it. */
export async function resumeReviewStream(store,document,directory){
 const marker=join(directory,'review-stream-recovery-v1.json');
 try{await stat(marker);throw Error('Review-stream recovery was already attempted. Inspect the saved result before another paid run.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8'));
 const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at",[document.id,document.tenant,document.project])).rows;
 const pages=await store.pages(document.id),reviews=jobs.filter(j=>j.kind==='review');
 const calls=ledger.calls||[],last=calls.at(-1),total=calls.reduce((n,c)=>n+c.reservedUsd,0);
 if(document.digest!=='ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018'||document.state!=='complete'||
  ledger.version!==1||ledger.model!=='claude-sonnet-5'||!ledger.paused||calls.length!==6||
  [0,2,3,4].some(i=>calls[i].status!=='usage-reported'||!calls[i].usage)||
  calls[1].status!=='charge-unknown'||!reservationAcknowledged(calls[1])||
  last.status!=='charge-unknown'||last.usage||last.acknowledgement||last.httpStatus!==200||last.failure?.code!=='provider-invalid-stream'||
  !last.progress?.streaming||last.progress.complete!==false||last.progress.toolCharacters!==24214||last.progress.events!==3467||
  calls.some(c=>!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||!Number.isFinite(total)||Math.abs(total-.4967534)>1e-8||
  pages.length!==4||pages.some((p,i)=>p.page!==i+1||p.evidence?.status!=='read')||
  reviews.length!==1||reviews[0].state!=='failed'||reviews[0].error_code!=='qa-paused-unknown-provider-charge'||
  reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id||
  jobs.some(j=>j.kind!=='review'&&j.state!=='complete'))throw Error('Saved state differs from the reported completed-source review failure. Nothing was restarted.');
 validateEvidence(validateSchema({pages:pages.map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.map(p=>p.native));
 await privateJson(marker,{version:1,createdAt:new Date().toISOString(),action:'resume-review',previousLedger:ledger,previousReport:report,previousJobs:jobs});
 const acknowledged=structuredClone(ledger);
 // Reuse the existing reservation fingerprint contract, binding acceptance to
 // this exact historical record. The reservation is never discounted or erased.
 acknowledged.calls[5].acknowledgement={action:'resume-reserved',reason:'reported-review-stream-parser-failure',fingerprint:reservationFingerprint(last),createdAt:new Date().toISOString()};
 acknowledged.paused=false;
 await store.transaction(async c=>{
  const updated=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),lease_token=null,lease_until=null,created_at=now() WHERE id=$1 AND state='failed' AND error_code='qa-paused-unknown-provider-charge' RETURNING id",[reviews[0].id]);
  if(updated.rowCount!==1)throw Error('Saved review changed during recovery. Inspect the recovery archive.');
 });
 await privateJson(join(directory,'cost.json'),acknowledged);
 return true;
}
