import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,stable} from '../src/core.mjs';
import {Store} from '../src/store.mjs';
import {isolatedPool,privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const EXPECTED_LEDGER='054f6fea8c1b92aa0fb9771f0c5c30dee108286c05f5c599c6ba0d2135d81960';
const EXPECTED_SHORT='71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc';
const EXPECTED={
 documentSha256:'381ef97cc6630e898ae5ae2f1af96c0470328f316bd24dff659edae05f79f735',
 jobTopologySha256:'4c071bc52deb172191580f9c73c063bdfee9393fb85678c948325831ec7857dc',
 nativePagesSha256:'33cbf658798c48e1565c490e11e91a32802eb9398dbde4f0054273feac807e44',
 pageEvidenceSha256:'0575bacfdfefd6e7c9d3965116dcffc3ca98be9ab7db65064ce9de80dcb894bf',
 verificationCheckpointSha256:'e5012ed719ac5f14d5f362402b254f432eba256f4fd3d04097be5e4307fe071d'
};
const refuse=message=>{throw Error(message+'. Nothing restarted.');};

export function verificationBoundarySnapshot(document,jobs,pages){
 const failed=jobs.find(job=>job.kind==='read'&&stable(job.payload?.pages)===stable([19]));
 const topology=jobs.map(job=>({id:job.id,kind:job.kind,state:job.state,errorCode:job.error_code,attempts:job.attempts,priority:job.priority,payload:job.payload,resultSha256:hash(stable(job.result||{}))}));
 return {documentSha256:hash(stable({id:document.id,digest:document.digest,state:document.state,error_code:document.error_code,page_count:document.page_count})),
  jobTopologySha256:hash(stable(topology)),nativePagesSha256:hash(stable(pages.map(page=>({page:page.page,native:page.native})))),
  pageEvidenceSha256:hash(stable(pages.map(page=>({page:page.page,evidence:page.evidence})))),
  verificationCheckpointSha256:hash(stable(failed?.result?.verificationCheckpoints?.['verify-19']))};
}

/** Requeue only the inspected 64-call page-19 checkpoint. Responses 62-64
 * remain cached; corrected visual claims are resolved deterministically as
 * uncertainty before unfinished pages continue. */
export async function resumePlansVerificationBoundary(store,document,directory,{expected=EXPECTED,expectedLedger=EXPECTED_LEDGER,expectedShort=EXPECTED_SHORT,expectedCalls=64,expectedUsd=3.675191}={}){
 const marker=join(directory,'plans-page19-verification-boundary-v1.json');
 let existing;
 try{existing=JSON.parse(await readFile(marker,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing&&existing.action!=='resume-plans-verification-boundary')refuse('The recovery marker differs');
 const ledgerBytes=await readFile(join(directory,'cost.json')),ledger=JSON.parse(ledgerBytes);
 const shortBytes=await readFile(join(directory,'..','short-ef5caf0682131935','cost.json'));
 if(hash(ledgerBytes)!==expectedLedger||hash(shortBytes)!==expectedShort)refuse('A preserved ledger changed');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||ledger.calls?.length!==expectedCalls||
  ledger.calls.some(c=>c.status!=='usage-reported'||c.httpStatus!==200||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0)||
  Math.abs(ledger.calls.reduce((n,c)=>n+c.reservedUsd,0)-expectedUsd)>1e-8)refuse('Plans accounting differs from the inspected known-charge calls');
 const pool=store.pool;
 {
  if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='source-correction-needs-independent-verification')refuse('Saved source state differs');
  const jobs=(await pool.query('SELECT * FROM p5ds_jobs ORDER BY created_at,id')).rows;
  if(jobs.some(job=>job.state==='running'))refuse('A saved job is active');
  const failed=jobs.find(job=>job.kind==='read'&&stable(job.payload?.pages)===stable([19])),review=jobs.find(job=>job.kind==='review');
  const checkpoint=failed?.result?.verificationCheckpoints?.['verify-19'];
  if(!failed||failed.state!=='failed'||failed.attempts!==4||failed.error_code!=='source-correction-needs-independent-verification'||
   !checkpoint?.raw||!checkpoint?.repair||!checkpoint?.sourceCorrection||checkpoint.sourceCitations||
   !checkpoint.repairStarted||!checkpoint.sourceCorrectionStarted||
   ![...checkpoint.sourceCorrection.facts,...checkpoint.sourceCorrection.items].some(c=>['visual','calculated'].includes(c.statement?.basis))||
   !review||review.state!=='failed'||review.error_code!=='source-reading-failed')refuse('Saved page-19 verification checkpoint differs');
  const pages=(await pool.query('SELECT page,native,evidence FROM p5ds_pages ORDER BY page')).rows;
  if(pages.length!==23||pages.filter(page=>page.evidence).length!==16||pages.some((page,index)=>page.page!==index+1||!page.native))refuse('Saved page coverage differs');
  const snapshot=verificationBoundarySnapshot(document,[...jobs].sort((a,b)=>a.id.localeCompare(b.id)),pages);
  for(const [name,value] of Object.entries(expected))if(snapshot[name]!==value)refuse(`Saved ${name} differs`);
  const archive={version:1,action:'resume-plans-verification-boundary',createdAt:existing?.createdAt||new Date().toISOString(),sourceCommit:existing?.sourceCommit||process.env.P5_QA_SOURCE_COMMIT||null,
   plansLedgerSha256:hash(ledgerBytes),shortLedgerSha256:hash(shortBytes),plansCalls:expectedCalls,plansEstimatedUsd:expectedUsd,
   previousDocument:{state:document.state,errorCode:document.error_code},failedJob:{id:failed.id,state:failed.state,attempts:failed.attempts,errorCode:failed.error_code},
   ...snapshot};
  if(existing&&stable(existing)!==stable(archive))refuse('The interrupted recovery archive differs');
  if(!existing)await privateJson(marker,archive);
  await store.transaction(async client=>{
   const locked=(await client.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
   if(locked?.state!=='failed'||locked.error_code!=='source-correction-needs-independent-verification')throw Error('Document changed during recovery. Inspect the archive.');
   const page=await client.query("UPDATE p5ds_jobs SET state='queued',error_code=null,priority=0,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND attempts=4 AND error_code='source-correction-needs-independent-verification' AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result)]);
   const finalReview=await client.query("UPDATE p5ds_jobs SET state='queued',error_code=null,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='source-reading-failed' RETURNING id",[review.id]);
   if(page.rowCount!==1||finalReview.rowCount!==1)throw Error('Saved recovery state changed. Inspect the archive.');
   await client.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
   await client.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
  });
 }
 return marker;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=resolve(process.argv[2]);
 const pool=await isolatedPool(join(directory,'database')),store=new Store(pool,{});
 try{const document=(await pool.query('SELECT * FROM p5ds_documents')).rows[0];console.log(JSON.stringify({resumed:true,marker:await resumePlansVerificationBoundary(store,document,directory)}));}
 catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
}