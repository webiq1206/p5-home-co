import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const refused=message=>{throw Error(message+'. Nothing restarted.');};

/** One recovery of the inspected eleven-call page-4 output limit. The existing
 * qualification lock must be held. No old marker, cache, evidence or charge is
 * removed. A fresh failure requires inspection before any further paid work. */
export async function resumePlansOutput(store,document,directory){
 const marker=join(directory,'plans-page4-output-recovery-v1.json');
 try{await stat(marker);throw Error('Plans output recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=JSON.parse(await readFile(join(directory,'cost.json'),'utf8'));
 const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 const previousMarkerBytes=await readFile(join(directory,'plans-spatial-page3-recovery-v1.json'));
 const previousMarker=JSON.parse(previousMarkerBytes);
 const historicalMarkerBytes=await readFile(join(directory,'plans-citation-recovery-v1.json'));
 if(previousMarker.legacyMarkerSha256!==hash(historicalMarkerBytes))refused('Historical archive changed');
 const calls=ledger.calls;
 if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='provider-output-limit')refused('Unexpected saved plans document');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||!Array.isArray(calls)||calls.length!==11||calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0||!Number.isFinite(c.reservedUsd)||c.reservedUsd<0)||Math.abs(calls.reduce((n,c)=>n+c.reservedUsd,0)-.7937253)>1e-8)refused('Plans ledger differs from the inspected known-charge state');
 if(previousMarker.version!==1||previousMarker.previousReport?.sourceSha256!==SOURCE||stable(previousMarker.previousLedger?.calls)!==stable(calls.slice(0,7)))refused('Prior page-3 recovery does not match the retained ledger');
 if(report.id!=='plans'||report.sourceSha256!==SOURCE||report.expectedPages!==23||report.complete!==false||report.error!=='provider-output-limit')refused('Plans report differs from the inspected failure');
 for(const [i,call] of calls.entries()){
  const expected='responses/'+String(i+1).padStart(4,'0')+'.json';
  if(call.responseFile?.replaceAll('\\','/')!==expected)refused('Unexpected paid response path');
  const saved=JSON.parse(await readFile(join(directory,expected),'utf8'));
  if(saved.requestSha256!==call.requestSha256||hash(JSON.stringify(saved.request))!==call.requestSha256||hash(saved.responseText)!==call.responseSha256||saved.httpStatus!==call.httpStatus)refused('Paid response integrity check failed');
  if(i===10){
   const response=JSON.parse(saved.responseText),input=JSON.parse(saved.request.messages?.[0]?.content?.[0]?.text||'{}');
   if(saved.httpStatus!==200||saved.request.model!=='claude-sonnet-5'||saved.request.max_tokens!==10000||saved.request.output_config?.effort!=='medium'||input.pages?.length!==1||input.pages[0].page!==4||response.stop_reason!=='max_tokens'||response.usage?.input_tokens!==9999||response.usage?.output_tokens!==10000||call.usage.output_tokens!==10000)refused('Last response differs from the inspected page-4 truncation');
  }
 }
 const pages=await store.pages(document.id,null,true);
 const jobs=(await store.pool.query("SELECT * FROM p5ds_jobs WHERE document_id=$1 OR (kind='review' AND tenant=$2 AND project=$3) ORDER BY created_at,id",[document.id,document.tenant,document.project])).rows;
 const reads=jobs.filter(j=>j.kind==='read'),parse=jobs.filter(j=>j.kind==='parse'),reviews=jobs.filter(j=>j.kind==='review'),failed=reads.find(j=>j.payload.pages?.[0]===4);
 if(pages.length!==23||pages.some((p,i)=>p.page!==i+1||p.native?.page!==p.page||!p.image?.length)||pages.filter(p=>p.evidence).map(p=>p.page).join(',')!=='1,2,3'||pages.slice(0,3).some(p=>p.evidence.status!=='partial'))refused('Saved plans page manifest differs');
 if(previousMarker.pageFingerprints?.length!==23||pages.some((p,i)=>previousMarker.pageFingerprints[i].page!==p.page||previousMarker.pageFingerprints[i].nativeSha256!==hash(JSON.stringify(p.native))||previousMarker.pageFingerprints[i].imageSha256!==hash(p.image))||previousMarker.pageEvidence?.length!==2||pages.slice(0,2).some((p,i)=>stable(p.evidence)!==stable(previousMarker.pageEvidence[i].evidence)))refused('Previously saved source or evidence changed');
 validateEvidence(validateSchema({pages:pages.slice(0,3).map(p=>structuredClone(p.evidence))},EVIDENCE_SCHEMA),pages.slice(0,3).map(p=>p.native));
 if(jobs.length!==25||jobs.some(j=>j.state==='running')||parse.length!==1||parse[0].state!=='complete'||reads.length!==23||new Set(reads.map(j=>j.payload.pages?.[0])).size!==23||reads.some(j=>j.payload.pages?.length!==1||!Number.isInteger(j.payload.pages[0])||j.payload.pages[0]<1||j.payload.pages[0]>23)||reads.some(j=>j.payload.pages[0]<4?j.state!=='complete':j.payload.pages[0]>4?j.state!=='queued'||j.attempts!==0:false)||!failed||failed.state!=='failed'||failed.error_code!=='provider-output-limit'||failed.attempts!==1||failed.result!==null||reviews.length!==1||reviews[0].state!=='failed'||reviews[0].error_code!=='source-reading-failed'||reviews[0].payload.documents?.length!==1||reviews[0].payload.documents[0].id!==document.id)refused('Saved plans job state differs');
 await privateJson(marker,{version:1,createdAt:new Date().toISOString(),action:'resume-plans-output',previousLedger:ledger,previousReport:report,previousJobs:jobs,pageEvidence:pages.slice(0,3).map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:previousMarker.pageFingerprints,previousRecoverySha256:hash(previousMarkerBytes),historicalRecoverySha256:hash(historicalMarkerBytes)});
 await store.transaction(async c=>{
  const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
  if(locked?.state!=='failed'||locked.error_code!=='provider-output-limit')throw Error('Saved document changed during recovery. Inspect the archive.');
  const profile={readProfile:'low-effort-v1',readProfileReason:'provider-output-limit'};
  const changed=await c.query("UPDATE p5ds_jobs SET state='queued',result=$2::jsonb,error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='provider-output-limit' AND attempts=1 AND result IS NULL RETURNING id",[failed.id,JSON.stringify(profile)]);
  if(changed.rowCount!==1)throw Error('Saved page job changed during recovery. Inspect the archive.');
  const review=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,available_at=now(),created_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='source-reading-failed' RETURNING id",[reviews[0].id]);
  if(review.rowCount!==1)throw Error('Saved review changed during recovery. Inspect the archive.');
  await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
 });
 return true;
}
