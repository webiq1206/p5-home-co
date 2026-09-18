import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {privateJson,reservationFingerprint} from './model-qa-support.mjs';

/** Explicit, one-time recovery of the owner's reported interruption. Retain the
 * full unconfirmed charge within the SAME budget, and archive the original state.
 * No permission to acknowledge a future unknown charge is implied. */
export async function resumeReservedStream(store,document,directory){
 const marker=join(directory,'reserved-stream-recovery-v1.json');
 try{await stat(marker);throw Error('Reserved-charge recovery was already attempted. No automatic paid restart.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8'));
 const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at",[document.id,document.tenant,document.project])).rows;
 const pages=await store.pages(document.id),failed=jobs.filter(j=>j.kind==='read'&&j.state==='failed');
 if(document.digest!=='ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018'||document.state!=='failed'||document.error_code!=='qa-paused-unknown-provider-charge'||
  ledger.version!==1||ledger.model!=='claude-sonnet-5'||!ledger.paused||ledger.calls?.length!==2||ledger.calls[0].status!=='usage-reported'||!ledger.calls[0].usage||ledger.calls[1].status!=='charge-unknown'||ledger.calls[1].usage||ledger.calls[1].acknowledgement||
  ledger.calls.some(c=>!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||ledger.calls.reduce((n,c)=>n+c.reservedUsd,0)>=1||
  pages.length!==4||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2'||failed.length!==1||failed[0].error_code!=='qa-paused-unknown-provider-charge'||failed[0].payload.pages?.join(',')!=='3'||failed[0].result||jobs.some(j=>j.state==='running'||j.state==='failed'&&j.kind!=='read'&&!(j.kind==='review'&&j.error_code==='source-reading-failed')))throw Error('Saved state differs from the reported interrupted page-3 call. Nothing was restarted.');
 await privateJson(marker,{version:1,createdAt:new Date().toISOString(),action:'resume-reserved',previousLedger:ledger,previousReport:report,previousJobs:jobs});
 const acknowledged=structuredClone(ledger);
 acknowledged.calls[1].acknowledgement={action:'resume-reserved',fingerprint:reservationFingerprint(ledger.calls[1]),createdAt:new Date().toISOString()};
 acknowledged.paused=false;
 // Marker is durable before either mutation. A crash stops instead of silently
 // authorizing another attempt or dropping the original charge.
 await store.transaction(async c=>{
  await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),lease_token=null,lease_until=null,created_at=now() WHERE id=$1 AND state='failed' AND error_code='qa-paused-unknown-provider-charge'",[failed[0].id]);
  await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),lease_token=null,lease_until=null,created_at=now() WHERE tenant=$1 AND project=$2 AND kind='review' AND state='failed' AND error_code='source-reading-failed'",[document.tenant,document.project]);
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE state='queued' AND (document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3))",[document.id,document.tenant,document.project]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1 AND state='failed'",[document.id]);
 });
 await privateJson(join(directory,'cost.json'),acknowledged);
 return true;
}
