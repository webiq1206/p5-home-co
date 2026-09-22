import test from 'node:test';
import assert from 'node:assert/strict';
import {openAiReadModel,isDrawingUnit,rateLimitWaitMs} from '../lib/p5/readerRouting.ts';

// Measured routing (live benchmark 2026-09-21): text and form pages on the fast model, drawing tiles on
// the configured stronger model; a 429 burst is waited out briefly.
const page={name:'notice.pdf (page 1 of 2)',type:'application/pdf',data:Buffer.alloc(1)} as any;
const tile={name:'plans.pdf (original page 4; detail regions 1 of 6; overlapping regions)',type:'image/png',data:Buffer.alloc(1),detailViews:true} as any;
test('text and form pages read on the fast model; drawing tiles on the configured model',()=>{
  const saved={fast:process.env.P5_READ_FAST_MODEL,drawing:process.env.P5_READ_DRAWING_MODEL};
  delete process.env.P5_READ_FAST_MODEL;delete process.env.P5_READ_DRAWING_MODEL;
  try{
    assert.equal(isDrawingUnit([tile]),true);assert.equal(isDrawingUnit([page]),false);
    assert.equal(openAiReadModel('gpt-5.6-sol',[page]),'gpt-4.1');
    assert.equal(openAiReadModel('gpt-5.6-sol',[tile]),'gpt-5.6-sol');
    assert.equal(openAiReadModel('gpt-5.6-sol',[]),'gpt-4.1','a typed scope is a text read');
    process.env.P5_READ_FAST_MODEL='off';assert.equal(openAiReadModel('gpt-5.6-sol',[page]),'gpt-5.6-sol');
    process.env.P5_READ_FAST_MODEL='gpt-4.1-mini';process.env.P5_READ_DRAWING_MODEL='gpt-5.6-sol';
    assert.equal(openAiReadModel('x',[page]),'gpt-4.1-mini');assert.equal(openAiReadModel('x',[tile]),'gpt-5.6-sol');
  }finally{
    if(saved.fast===undefined)delete process.env.P5_READ_FAST_MODEL;else process.env.P5_READ_FAST_MODEL=saved.fast;
    if(saved.drawing===undefined)delete process.env.P5_READ_DRAWING_MODEL;else process.env.P5_READ_DRAWING_MODEL=saved.drawing;
  }
});
test('rate-limit waits grow, honour retry-after and stay short',()=>{
  assert.ok(rateLimitWaitMs(0,null)>=1500&&rateLimitWaitMs(0,null)<2100);
  assert.ok(rateLimitWaitMs(2,null)>=6000);
  assert.ok(rateLimitWaitMs(0,'5')>=5000);
  assert.ok(rateLimitWaitMs(5,'60')<=8500,'never more than about 8 s');
});
test('an out-of-credit Anthropic account is recognised so reads stop asking it (live 2026-09-22)',async()=>{
  const {creditRefusal}=await import('../lib/p5/extraction.ts');
  assert.equal(creditRefusal('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing'),true);
  assert.equal(creditRefusal('messages.0.content: image exceeds 5 MB maximum'),false);
});
