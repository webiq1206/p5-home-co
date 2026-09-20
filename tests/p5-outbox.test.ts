import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deliveryRetryDecision} from '../lib/p5/outbox.ts';

test('only idempotent email inside the provider window and attempt budget is retried',()=>{
 const now=Date.UTC(2026,8,19,12);
 assert.equal(deliveryRetryDecision('customer:x@example.invalid',true,1,new Date(now),now),'retry');
 assert.equal(deliveryRetryDecision('admin:x@example.invalid',true,5,new Date(now-22*3600000),now),'retry');
 // CRM has no verified replay contract: an ambiguous acknowledgement is reconciled, never resent.
 assert.equal(deliveryRetryDecision('crm',true,1,new Date(now),now),'needs-review');
 assert.equal(deliveryRetryDecision('customer:x@example.invalid',false,1,new Date(now),now),'needs-review');
 assert.equal(deliveryRetryDecision('customer:x@example.invalid',true,6,new Date(now),now),'needs-review');
 assert.equal(deliveryRetryDecision('customer:x@example.invalid',true,1,new Date(now-23*3600000),now),'needs-review');
 assert.equal(deliveryRetryDecision('customer:x@example.invalid',true,1,new Date(Date.now()-24*3600000)),'needs-review');
});

test('a revision-scoped run claims, recovers and alerts only that saved revision',()=>{
 const source=readFileSync('lib/p5/outbox.ts','utf8');
 assert.ok(source.includes('processOutbox(options:{draftId?:string;revision?:number;limit?:number}={})'));
 // Claim.
 assert.ok(source.includes('($1::uuid IS NULL OR draft_id=$1::uuid) AND ($3::integer IS NULL OR revision=$3::integer)'));
 assert.ok(source.includes('[options.draftId||null,limit,options.revision??null]'));
 // Interrupted-worker detection and recovery carry the same scope, so a status
 // check for one draft never reclassifies an in-flight send of another draft.
 assert.ok(source.includes("status='sending' AND locked_until<now() AND ($1::uuid IS NULL OR draft_id=$1::uuid) AND ($2::integer IS NULL OR revision=$2::integer) LIMIT 1"));
 assert.ok(source.includes("WHERE status='sending' AND locked_until<now() AND ($3::uuid IS NULL OR draft_id=$3::uuid) AND ($4::integer IS NULL OR revision=$4::integer) RETURNING"));
 assert.ok(source.includes('[EMAIL_SUPPORTS_IDEMPOTENCY,JSON.stringify(recipients),options.draftId||null,options.revision??null]'));
 assert.ok(source.includes('deliveryRetryDecision(destination,EMAIL_SUPPORTS_IDEMPOTENCY,row.attempts,new Date(row.created_at))'));
});

test('submission and administrator delivery runs pass the saved revision',()=>{
 const submit=readFileSync('lib/p5/submitEndpoint.ts','utf8');
 assert.equal(submit.split('processOutbox({draftId:id,revision:draft.revision,limit:12})').length-1,2);
 assert.ok(!submit.includes('processOutbox({draftId:id,limit'));
 const admin=readFileSync('lib/p5/adminEndpoint.ts','utf8');
 assert.ok(admin.includes('A valid delivery revision is required.'));
 assert.ok(admin.includes('processOutbox({draftId:body.id?validId(body.id):undefined,revision:body.revision})'));
});

test('every public estimate response passes through the one customer boundary',()=>{
 for(const file of ['lib/p5/submitEndpoint.ts','lib/p5/draftEndpoint.ts']){
  const source=readFileSync(file,'utf8');
  assert.match(source,/customerPresentation\(/,file);
  assert.doesNotMatch(source,/result:(?:row|stored)\.customer_estimate\b/,file);
  assert.doesNotMatch(source,/result:priced\.customer\b/,file);
 }
});
