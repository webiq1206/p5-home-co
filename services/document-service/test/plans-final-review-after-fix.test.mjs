import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reservationFingerprint} from '../scripts/model-qa-support.mjs';
import {plansFinalReviewAfterFixChecks} from '../scripts/resume-plans-final-review-after-fix.mjs';

const calls=Array.from({length:85},(_,index)=>({status:'usage-reported',usage:{input_tokens:1,output_tokens:1},reservedUsd:index===0?5.418725:0}));
calls.push({status:'charge-unknown',reservedUsd:.53427,httpStatus:200,failure:{code:'provider-invalid-stream'},progress:{streaming:true,complete:false}});
calls[85].acknowledgement={action:'resume-reserved',fingerprint:reservationFingerprint(calls[85])};
calls.push({status:'charge-unknown',reservedUsd:.53404,httpStatus:200,failure:{code:'provider-invalid-stream'},progress:{streaming:true,complete:false}});
const page=index=>({page:index,evidence:{page:index,status:index===9?'partial':'read',facts:[],items:index===9?[{id:'9-item-1',basis:'uncertain',quantity:null,component:'Floor/truss assembly depth'}]:[],regions:[],notes:[]}});
const input={ledger:{version:1,model:'claude-sonnet-5',paused:true,calls},document:{digest:'4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786',state:'complete',page_count:23},
 jobs:[{kind:'review',state:'failed',attempts:18,error_code:'qa-paused-unknown-provider-charge'},{kind:'read',state:'complete'}],pages:Array.from({length:23},(_,i)=>page(i+1)),
 shortLedgerSha256:'71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc',ledgerSha256:'8058c445c35fcf4ceedfd526f95eeb4c7bd41910678534e234a084be1b615bbd',
 evidenceSha256:'1e06fa856452dc082c16d479af2eb97d4c2a011d4eb8231ca10e64f06c122d3b',page9Sha256:'fdd90635e5c4da3642b40d144d7fba34b46920d4d567b0e3c68d74c27b73039a'};

test('post-fix recovery preserves both unknown charges and refuses changed or repeated work',()=>{
 assert.ok(Object.values(plansFinalReviewAfterFixChecks(input)).every(Boolean));
 for(const mutate of [
  value=>value.ledger.calls.pop(),
  value=>{value.attempted=true},
  value=>{value.ledger.calls[86].reservedUsd=0},
  value=>{value.ledger.calls[86].acknowledgement={action:'resume-reserved'}},
  value=>{value.jobs[0].attempts=19},
  value=>{value.ledgerSha256='changed'},
  value=>{value.ledger.calls[85].reservedUsd=0},
  value=>{value.ledger.calls[85].acknowledgement={action:'resume-reserved'}},
  value=>{value.pages[8].evidence.status='read'},
  value=>{value.jobs[1].state='queued'},
 ]){
  const changed=structuredClone(input);mutate(changed);
  assert.ok(Object.values(plansFinalReviewAfterFixChecks(changed)).some(value=>!value));
 }
});