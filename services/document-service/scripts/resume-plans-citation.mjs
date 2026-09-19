import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash} from '../src/core.mjs';
import {privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const REJECTED="5' PUID easements on north and south property lines; unverified fill zone along east/rear property line";

/** Explicit, one-time recovery of the inspected seven-call plans failure.
 * The caller holds the fixed qualification lock. No validation is relaxed:
 * page 3 gets a new read and the ordinary independent visual verification.
 * Completed evidence (including partial status), native pages, images, caches,
 * and all prior charges survive. A further failure needs another inspection.
 */
export async function resumePlansCitation(store,document,directory){
 const marker=join(directory,'plans-citation-recovery-v1.json');
 try{await stat(marker);throw Error('Plans citation recovery was already attempted. Inspect the saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8'));
 const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const calls=ledger.calls,expectedCost=.551956;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='unsupported-source-statement')throw Error('Unexpected saved plans document. Nothing restarted.');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==7||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-expectedCost)>1e-8)throw Error('Plans ledger differs from the inspected known-charge state. Nothing restarted.');
 if(report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='unsupported-source-statement')throw Error('Plans report differs from the inspected failure. Nothing restarted.');
 for(const [i,call] of calls.entries()){
  const expected='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==expected)throw Error('Unexpected paid response path. Nothing restarted.');
  const saved=JSON.parse(await readFile(join(directory,expected),'utf8'));
  if(saved.requestSha256!==call.requestSha256||hash(JSON.stringify(saved.request))!==call.requestSha256||hash(saved.responseText)!==call.responseSha256||saved.httpStatus!==call.httpStatus)throw Error('Paid response integrity check failed. Nothing restarted.');
 }
 const pages=await store.pages(document.id,null,true);
 const jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review');
 const failed=reads.find(j=>j.payload.pages?.length===1&&j.payload.pages[0]===3);
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2'||pages.slice(0,2).some(p=>p.evidence.status!=='partial'))throw Error('Saved plans page manifest differs. Nothing restarted.');
 if(parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<3?j.state!=='complete':j.payload.pages[0]>3?j.state!=='queued'||j.attempts!==0:false)||!failed||failed.state!=='failed'||failed.attempts!==2||failed.error_code!=='unsupported-source-statement'||reviews.length!==1||reviews[0].state!=='failed'||reviews[0].error_code!=='source-reading-failed'||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id||jobs.some(j=>j.state==='running')||jobs.length!==25)throw Error('Saved plans job state differs. Nothing restarted.');
 const checkpoint=failed.result?.evidenceCheckpoint,raw=checkpoint?.raw;
 const statement=raw?.pages?.length===1&&raw.pages[0].page===3?raw.pages[0].facts?.[7]:null;
 const rejections=checkpoint?.repair?.citations?.filter(c=>!c.supported);
 if(statement?.field!=='site'||statement.value!==REJECTED||statement.basis!=='stated'||rejections?.length!==1||rejections[0].key!=='3:facts:7'||rejections[0].lines?.length!==0||failed.result?.verificationCheckpoints)throw Error('Saved rejected statement differs. Nothing restarted.');
 // Archive first. An interruption after this point cannot authorize another run.
 await privateJson(marker,{version:1,createdAt:new Date().toISOString(),reason:'Re-read the inspected unsupported spatial claim with drawing relationships classified as visual. Strict citations and independent verification remain required.',previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:pages.filter(p=>p.evidence).map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:pages.map(p=>({page:p.page,nativeSha256:hash(JSON.stringify(p.native)),imageSha256:hash(p.image)}))});
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='unsupported-source-statement')throw Error('Saved document changed during recovery. Inspect the archive.');
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',result=null,error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='unsupported-source-statement' AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result)]);
  if(changed.rowCount!==1)throw Error('Saved page job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='source-reading-failed' RETURNING id",[reviews[0].id]);
  if(review.rowCount!==1)throw Error('Saved review changed during recovery. Inspect the archive.');
  // Time spent waiting for this inspected repair is not processing time.
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
