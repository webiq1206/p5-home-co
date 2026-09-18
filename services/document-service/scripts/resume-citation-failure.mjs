import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {privateJson} from './model-qa-support.mjs';

/** One explicit migration for the pre-checkpoint failure reported by the owner.
 * No cost limit, original ledger entry, native page or completed evidence resets.
 * Call only while holding the consolidated qualification process lock. */
export async function resumeLegacyCitationFailure(store,document,directory){
 if(document.state!=='failed'||document.error_code!=='quote-not-in-source')return false;
 const marker=join(directory,'citation-recovery-v1.json');
 try{await stat(marker);throw Error('Citation recovery was already attempted. Inspect the saved response; no automatic paid restart.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8'));
 if(ledger.paused||ledger.calls?.length!==1||ledger.calls[0].status!=='usage-reported'||!ledger.calls[0].usage||ledger.calls[0].responseFile)throw Error('Legacy recovery requires the single known-charge response without a saved reply.');
 const pages=await store.pages(document.id),jobs=(await store.pool.query('SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind=\'review\' AND tenant=$2 AND project=$3) ORDER BY created_at',[document.id,document.tenant,document.project])).rows;
 const failed=jobs.filter(j=>j.state==='failed');
 if(pages.length!==4||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2'||failed.length!==1||failed[0].kind!=='read'||failed[0].result||failed[0].payload.pages?.join(',')!=='3'||jobs.some(j=>j.state==='running'))throw Error('Legacy saved job state differs from the reported failure. No work was restarted.');
 const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 // Durable audit record first. A crash leaves the marker and stops a blind retry.
 await privateJson(marker,{version:1,createdAt:new Date().toISOString(),reason:'Recover reported page-3 citation failure after adding durable evidence and bounded citation correction.',previousReport:report,previousLedger:ledger,previousJobs:jobs});
 await store.transaction(async c=>{
  await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),lease_token=null,lease_until=null,created_at=now() WHERE id=$1 AND state='failed' AND error_code='quote-not-in-source'",[failed[0].id]);
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE state='queued' AND (document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3))",[document.id,document.tenant,document.project]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1 AND state='failed'",[document.id]);
 });
 return true;
}
