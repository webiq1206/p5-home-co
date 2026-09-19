
/** Offline replay of the inspected complete call-89 receipt. No provider client
 * is constructed and no production database is opened. */
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {EVIDENCE_SCHEMA,REVIEW_SCHEMA,validateReview} from '../src/contracts.mjs';
import {validateSchema} from '../src/schema.mjs';
import {parseReply} from '../src/provider.mjs';
import {normalizeReviewFactBasis} from '../src/review-basis.mjs';
import {isolatedPool,privateJson,targetedChecks} from './model-qa-support.mjs';

const LEDGER='97451dd224826b78191d729a2a12acb75a1e73f29a253bb04c3c83eff0b50bfa';
const REQUEST='03b470c95cc21fdaadb311071d2383446c5f37d48b1acba425a6dd823096219a';
const RESPONSE='3b60e63c968fe5fdccd567d5652b6e3a671f8282889608d328fc5d32c956f7f8';
const EVIDENCE='1e06fa856452dc082c16d479af2eb97d4c2a011d4eb8231ca10e64f06c122d3b';
export async function replayPlansReviewReceipt(directory){
 const marker=join(directory,'plans-review-receipt-replay-v1.json');
 if(await stat(marker).then(()=>true,()=>false))throw Error('Receipt replay already attempted; no work changed.');
 const ledgerBytes=await readFile(join(directory,'cost.json'),'utf8');
 if(hash(ledgerBytes)!==LEDGER)throw Error('Saved ledger changed; no work changed.');
 const ledger=JSON.parse(ledgerBytes),last=ledger.calls.at(-1);
 if(ledger.calls.length!==89||last.status!=='usage-reported'||last.requestSha256!==REQUEST||last.responseSha256!==RESPONSE||!/^responses[\\/]0089\.json$/.test(last.responseFile||''))throw Error('Unexpected saved receipt.');
 const checkpoint=JSON.parse(await readFile(join(directory,last.responseFile),'utf8'));
 if(checkpoint.requestSha256!==REQUEST||hash(JSON.stringify(checkpoint.request))!==REQUEST||hash(checkpoint.responseText)!==RESPONSE||checkpoint.httpStatus!==200)throw Error('Receipt integrity failed.');
 const input=JSON.parse(checkpoint.request.messages[0].content[0].text);
 if(input.documents?.length!==1||hash(stable(input.documents[0].pages.map(page=>({page:page.page,evidence:page.evidence}))))!==EVIDENCE)throw Error('Saved request evidence differs.');
 const pool=await isolatedPool(join(directory,'database'));
 try{
  const jobs=(await pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,review=jobs.filter(job=>job.kind==='review');
  if(jobs.some(job=>job.state==='running')||review.length!==1||review[0].state!=='failed'||review[0].attempts!==20||review[0].error_code!=='invalid-provider-schema')throw Error('Review state changed.');
  const pages=(await pool.query('SELECT page,native,evidence FROM p5ds_pages ORDER BY page')).rows;
  if(pages.length!==23||hash(stable(pages.map(page=>({page:page.page,evidence:page.evidence}))))!==EVIDENCE)throw Error('Stored page evidence differs.');
  validateEvidence(validateSchema({pages:pages.map(page=>structuredClone(page.evidence))},EVIDENCE_SCHEMA),pages.map(page=>page.native));
  const manifest=pages.map(page=>({source:input.documents[0].source,page:page.page,sheet:page.evidence.sheet,revision:page.evidence.revision,status:page.evidence.status,notes:page.evidence.notes}));
  const raw=parseReply('anthropic',JSON.parse(checkpoint.responseText),'submit_document_review');
  const result=validateReview(validateSchema(normalizeReviewFactBasis(raw,input),REVIEW_SCHEMA),manifest);
  const quality=targetedChecks('plans',result,23);
  if(hash(await readFile(join(directory,'cost.json'),'utf8'))!==LEDGER)throw Error('Ledger changed before replay.');
  await privateJson(marker,{version:1,action:'offline-complete-receipt-replay',previousReview:review[0],ledgerSha256:LEDGER,requestSha256:REQUEST,responseSha256:RESPONSE,evidenceSha256:EVIDENCE,createdAt:new Date().toISOString()});
  const changed=await pool.query("UPDATE p5ds_jobs SET state='complete',result=$2::jsonb,error_code=null,updated_at=now() WHERE id=$1 AND state='failed' AND attempts=20 AND error_code='invalid-provider-schema' RETURNING id",[review[0].id,JSON.stringify(result)]);
  if(changed.rowCount!==1)throw Error('Review changed during offline acceptance; inspect archive.');
  const report={reviewComplete:true,providerCallsAdded:0,ledgerSha256:LEDGER,evidenceSha256:EVIDENCE,knownUsageUsd:5.825737,unknownReservationUsd:1.60235,totalGuardedUsd:7.428087,
   pages:manifest.map(({page,status})=>({page,status})),facts:result.facts.length,inferredFacts:result.facts.filter(f=>f.basis==='inferred').length,takeoffs:result.takeoffs.length,
   fullyRead:manifest.every(page=>page.status==='read'),quality,qualificationPassed:quality.passed};
  await privateJson(join(directory,'plans-review-receipt-replay-report.json'),report);
  return report;
 }finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 replayPlansReviewReceipt(resolve('.p5-model-qa/28ae638a423cc02f/plans-4565acfa74cc3590'))
 .then(report=>console.log(JSON.stringify(report))).catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
