import test from 'node:test';
import assert from 'node:assert/strict';
import {sha,canonical} from './lib/recoveryEpoch.mjs';
import {exactPricingReplay,pricingReplayRequestHash} from './lib/exactPricingReplay.mjs';
const reply={value:{tasks:[]},sourceUrls:[]};
const transcript={version:1,model:'synthetic-only',shortlists:[],stages:[{requestSha256:pricingReplayRequestHash('instructions',{scope:'original'},false),replySha256:sha(canonical(reply)),reply}]};
const args={transcript,expectedSha256:sha(canonical(transcript)),expectedModel:'synthetic-only'};
test('exact replay consumes each receipt once and rejects fallback',async()=>{
 const replay=exactPricingReplay(args);
 assert.throws(()=>replay.assertComplete(),/unused/);
 await assert.rejects(replay.request('instructions',{scope:'changed'},false),/stage-mismatch/);
 assert.deepEqual(await replay.request('instructions',{scope:'original'},false),reply);
 assert.deepEqual(replay.assertComplete(),{replayedStages:1,replayedShortlists:0,providerNetworkCalls:0});
 await assert.rejects(replay.selectBook([],[]),/shortlist-mismatch/);
 await assert.rejects(replay.request('instructions',{scope:'original'},false),/stage-mismatch/);
});
test('model, receipt identity and transcript tampering fail closed',()=>{
 assert.throws(()=>exactPricingReplay({...args,expectedModel:'different'}),/identity/);
 assert.throws(()=>exactPricingReplay({...args,expectedSha256:sha('changed')}),/identity/);
 const altered=structuredClone(transcript);altered.stages[0].reply.value.tasks.push('invented');
 assert.throws(()=>exactPricingReplay({...args,transcript:altered,expectedSha256:sha(canonical(altered))}),/receipt-invalid/);
});
