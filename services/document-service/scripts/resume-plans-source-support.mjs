import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,stable} from '../src/core.mjs';
import {isolatedPool,privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const EXPECTED_LEDGER='049ff4a19b6bc34fa80118655278f78eeb3cea33446e2253ed10b46c5f3565a4';
const EXPECTED_SHORT='71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc';
const refuse=message=>{throw Error(message+'. Nothing restarted.');};

/** Admit only the inspected 61-call checkpoint. No provider is available here;
 * this function archives state and requeues the failed page for the deterministic
 * uncertainty policy, while leaving all other queued work and accounting intact. */
export async function resumePlansSourceSupport(directory){
 const marker=join(directory,'plans-page19-source-support-v1.json');
 try{await stat(marker);throw Error('Plans page-19 source-support recovery was already attempted. Inspect its saved result.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledgerBytes=await readFile(join(directory,'cost.json')),ledger=JSON.parse(ledgerBytes);
 const shortBytes=await readFile(join(directory,'..','short-ef5caf0682131935','cost.json'));
 if(hash(ledgerBytes)!==EXPECTED_LEDGER||hash(shortBytes)!==EXPECTED_SHORT)refuse('A preserved ledger changed');
 if(ledger.version!==1||ledger.model!=='claude-sonnet-5'||ledger.paused||ledger.calls?.length!==61||
  ledger.calls.some(c=>c.status!=='usage-reported'||!Number.isSafeInteger(c.usage?.input_tokens)||c.usage.input_tokens<0||!Number.isSafeInteger(c.usage?.output_tokens)||c.usage.output_tokens<0)||
  Math.abs(ledger.calls.reduce((n,c)=>n+c.reservedUsd,0)-3.3895915)>1e-8)refuse('Plans accounting differs from the inspected 61 known-charge calls');
 const pool=await isolatedPool(join(directory,'database'));
 try{
  const documents=(await pool.query('SELECT * FROM p5ds_documents')).rows;
  if(documents.length!==1)refuse('Saved document count differs');
  const document=documents[0];
  if(document.digest!==SOURCE||document.page_count!==23||document.state!=='failed'||document.error_code!=='unsupported-source-statement')refuse('Saved source state differs');
  const jobs=(await pool.query("SELECT * FROM p5ds_jobs ORDER BY created_at,id")).rows;
  if(jobs.some(j=>j.state==='running'))refuse('A saved job is active');
  const failed=jobs.find(j=>j.kind==='read'&&stable(j.payload?.pages)===stable([19]));
  const checkpoint=failed?.result?.evidenceCheckpoint,citations=checkpoint?.sourceCitations?.citations;
  if(!failed||failed.state!=='failed'||failed.attempts!==1||failed.error_code!=='unsupported-source-statement'||!checkpoint?.sourceCorrection||
   !Array.isArray(citations)||stable(citations.filter(c=>!c.supported).map(c=>c.key))!==stable(['19:items:10','19:items:11'])||
   citations.some(c=>!c.supported&&c.lines.length))refuse('Saved page-19 support checkpoint differs');
  const pages=(await pool.query('SELECT page,native,evidence FROM p5ds_pages ORDER BY page')).rows;
  if(pages.length!==23||pages.filter(p=>p.evidence).length!==16||pages.some((p,i)=>p.page!==i+1||!p.native))refuse('Saved page coverage differs');
  await privateJson(marker,{version:1,action:'resume-plans-source-support',createdAt:new Date().toISOString(),sourceCommit:process.env.P5_QA_SOURCE_COMMIT||null,
   plansLedgerSha256:hash(ledgerBytes),shortLedgerSha256:hash(shortBytes),plansCalls:61,plansEstimatedUsd:3.3895915,
   previousDocument:{state:document.state,errorCode:document.error_code},failedJob:{id:failed.id,state:failed.state,attempts:failed.attempts,errorCode:failed.error_code},
   pageEvidenceSha256:hash(stable(pages.map(p=>({page:p.page,evidence:p.evidence}))))});
  await pool.transaction(async c=>{
   const locked=(await c.query('SELECT state,error_code FROM p5ds_documents WHERE id=$1 FOR UPDATE',[document.id])).rows[0];
   if(locked?.state!=='failed'||locked.error_code!=='unsupported-source-statement')throw Error('Document changed during recovery. Inspect the archive.');
   const changed=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,priority=0,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND attempts=1 AND error_code='unsupported-source-statement' AND result=$2::jsonb RETURNING id",[failed.id,JSON.stringify(failed.result)]);
   if(changed.rowCount!==1)throw Error('Page-19 job changed during recovery. Inspect the archive.');
   await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
   await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1",[document.id]);
  });
 }finally{await pool.end();}
 return marker;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=resolve(process.argv[2]||'.p5-model-qa/28ae638a423cc02f/plans-4565acfa74cc3590');
 resumePlansSourceSupport(directory).then(marker=>console.log(JSON.stringify({resumed:true,marker}))).catch(error=>{console.error('Recovery stopped:',error.message);process.exitCode=1;});
}