import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {VERIFIER_SYSTEM} from '../src/contracts.mjs';
import {hash,stable} from '../src/core.mjs';
import {Store} from '../src/store.mjs';
import {isolatedPool,privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const LEDGER='4de2a6a1fb0f1b7d92f1f7337f7733dfca85b11d130aa0ef415a9daa8ddf23fb';
const SHORT='71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc';
const EXPECTED={document:'9d75522212643ceffec0275809b920c6a7f3f689eca47b532863388165efb21f',jobs:'f6e20cf5d29ed99227b61dfd0414ff49b7d501afa3c6b0105ff086096aea9de1',native:'33cbf658798c48e1565c490e11e91a32802eb9398dbde4f0054273feac807e44',images:'14b042c6a58bf21b266f95227b684734ad9ab50617f59f62b5c7b5550bff0f0a',evidence:'7a173e39e504712090d5accbecb23211d7e0a67f8da39dc4037b15cbd3e13b7d',checkpoint:'0d111d61765511b22ba227c54837f4bbae4a342879a06fc57b51d87f4fc4c294'};
const refuse=message=>{throw Error(message+'. Nothing restarted.');};

export async function resumePlansPage21VerificationOutput(store,document,directory){
 const marker=join(directory,'plans-page21-verification-output-v1.json');
 try{await stat(marker);refuse('Page-21 verification-output recovery was already attempted');}catch(error){if(error.code!=='ENOENT')throw error;}
 const ledgerBytes=await readFile(join(directory,'cost.json')),shortBytes=await readFile(join(directory,'..','short-ef5caf0682131935','cost.json')),ledger=JSON.parse(ledgerBytes);
 if(hash(ledgerBytes)!==LEDGER||hash(shortBytes)!==SHORT||ledger.paused||ledger.calls?.length!==74||ledger.calls.some(call=>call.status!=='usage-reported')||Math.abs(ledger.calls.reduce((sum,call)=>sum+call.reservedUsd,0)-4.7047425)>1e-8)refuse('Saved accounting differs');
 const last=ledger.calls.at(-1),cache=JSON.parse(await readFile(join(directory,last.responseFile),'utf8')),response=JSON.parse(cache.responseText);
 if(cache.requestSha256!==last.requestSha256||hash(JSON.stringify(cache.request))!==last.requestSha256||hash(cache.responseText)!==last.responseSha256||cache.httpStatus!==200||response.stop_reason!=='max_tokens'||response.usage?.output_tokens!==10000||cache.request.max_tokens!==10000||cache.request.output_config?.effort!==undefined||cache.request.system?.[0]?.text!==VERIFIER_SYSTEM)refuse('Saved call 74 is not the inspected independent-verification output limit');
 const jobs=(await store.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,pages=(await store.pool.query('SELECT page,native,image,evidence FROM p5ds_pages ORDER BY page')).rows;
 const failed=jobs.find(job=>job.kind==='read'&&stable(job.payload?.pages)===stable([21])),review=jobs.find(job=>job.kind==='review'),checkpoint=failed?.result?.evidenceCheckpoint;
 const topology=jobs.map(job=>({id:job.id,kind:job.kind,state:job.state,errorCode:job.error_code,attempts:job.attempts,priority:job.priority,payload:job.payload,resultSha256:hash(stable(job.result||{}))}));
 const snapshot={document:hash(stable({id:document.id,digest:document.digest,state:document.state,error_code:document.error_code,page_count:document.page_count})),jobs:hash(stable(topology)),native:hash(stable(pages.map(page=>({page:page.page,native:page.native})))),images:hash(stable(pages.map(page=>({page:page.page,imageSha256:hash(page.image)})))),evidence:hash(stable(pages.map(page=>({page:page.page,evidence:page.evidence})))),checkpoint:hash(stable(checkpoint))};
 if(Object.keys(EXPECTED).some(key=>snapshot[key]!==EXPECTED[key])||document.digest!==SOURCE||failed?.state!=='failed'||failed.attempts!==2||failed.error_code!=='provider-output-limit'||review?.state!=='failed'||review.error_code!=='source-reading-failed'||!checkpoint?.raw||!checkpoint?.repair||checkpoint.sourceRepairProfile!=='low-effort-v1'||!checkpoint.lowSourceRepairStarted||!checkpoint.sourceCorrection||checkpoint.sourceCitations||failed.result.verificationProfiles||failed.result.verificationCheckpoints||pages.filter(page=>page.evidence).length!==20)refuse('Saved page-21 verification checkpoint differs');
 const archive={version:1,action:'resume-plans-page21-verification-output',createdAt:new Date().toISOString(),sourceCommit:process.env.P5_QA_SOURCE_COMMIT||null,plansLedgerSha256:hash(ledgerBytes),shortLedgerSha256:hash(shortBytes),calls:74,estimatedUsd:4.7047425,...snapshot};
 await privateJson(marker,archive);
 const next={...failed.result,verificationProfiles:{'verify-21':'low-effort-v1'},verificationProfileReasons:{'verify-21':'provider-output-limit'}};
 await store.transaction(async client=>{
  const changed=await client.query("UPDATE p5ds_jobs SET state='queued',result=$2::jsonb,error_code=null,priority=0,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND attempts=2 AND error_code='provider-output-limit' AND result=$3::jsonb RETURNING id",[failed.id,JSON.stringify(next),JSON.stringify(failed.result)]);
  const finalReview=await client.query("UPDATE p5ds_jobs SET state='queued',error_code=null,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND error_code='source-reading-failed' RETURNING id",[review.id]);
  if(changed.rowCount!==1||finalReview.rowCount!==1)throw Error('Page-21 recovery state changed during recovery.');
  await client.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
  await client.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1 AND state='failed' AND error_code='provider-output-limit'",[document.id]);
 });
 return marker;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=resolve(process.argv[2]),pool=await isolatedPool(join(directory,'database')),store=new Store(pool,{});
 try{const document=(await pool.query('SELECT * FROM p5ds_documents')).rows[0];console.log(JSON.stringify({resumed:true,marker:await resumePlansPage21VerificationOutput(store,document,directory)}));}
 catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
}