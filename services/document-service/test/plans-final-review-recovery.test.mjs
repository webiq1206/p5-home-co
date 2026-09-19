import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plansFinalReviewChecks} from '../scripts/resume-plans-final-review.mjs';

const calls=Array.from({length:85},(_,index)=>({status:'usage-reported',usage:{input_tokens:1,output_tokens:1},reservedUsd:index===0?5.418725:0}));
calls.push({status:'charge-unknown',reservedUsd:.53427,httpStatus:200,failure:{code:'provider-invalid-stream'},progress:{streaming:true,complete:false}});
const page=index=>({page:index,evidence:{page:index,status:index===9?'partial':'read',facts:[],items:index===9?[{id:'9-item-1',basis:'uncertain',quantity:null,component:'Floor/truss assembly depth'}]:[],regions:[],notes:[]}});
const input={ledger:{version:1,model:'claude-sonnet-5',paused:true,calls},document:{digest:'4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786',state:'complete',page_count:23},
 jobs:[{kind:'review',state:'failed',attempts:17,error_code:'qa-paused-unknown-provider-charge'},{kind:'read',state:'complete'}],pages:Array.from({length:23},(_,i)=>page(i+1)),
 shortLedgerSha256:'71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc',ledgerSha256:'de50e95b4d3f50dc8c16a19122563998926e2a826b8dfe3ff2a22d2da358542a',
 evidenceSha256:'1e06fa856452dc082c16d479af2eb97d4c2a011d4eb8231ca10e64f06c122d3b',page9Sha256:'fdd90635e5c4da3642b40d144d7fba34b46920d4d567b0e3c68d74c27b73039a'};

test('final review admission requires every prior call, reservation and corrected page',()=>{
 assert.ok(Object.values(plansFinalReviewChecks(input)).every(Boolean));
 for(const mutate of [
  value=>value.ledger.calls.pop(),
  value=>{value.ledger.calls[85].reservedUsd=0},
  value=>{value.ledger.calls[85].acknowledgement={action:'resume-reserved'}},
  value=>{value.pages[8].evidence.status='read'},
  value=>{value.jobs[1].state='queued'},
 ]){
  const changed=structuredClone(input);mutate(changed);
  assert.ok(Object.values(plansFinalReviewChecks(changed)).some(value=>!value));
 }
});