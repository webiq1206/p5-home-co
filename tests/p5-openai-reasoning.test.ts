import test from 'node:test';
import assert from 'node:assert/strict';
import {reasoningFor,rejectsReasoning,isReasoningModel} from '../lib/p5/openaiReasoning.ts';

// Speed (owner request 2026-09-21): reasoning models read pages and map scope at a low effort; the
// accuracy check keeps medium; a non-reasoning model gets no setting; a refusal is retried without it.
test('reasoning effort is low for reads and mapping, medium for the audit, absent for non-reasoning models',()=>{
  const saved=process.env.P5_OPENAI_REASONING_EFFORT;delete process.env.P5_OPENAI_REASONING_EFFORT;
  try{
    assert.deepEqual(reasoningFor('gpt-5.6-sol','read'),{reasoning:{effort:'low'}});
    assert.deepEqual(reasoningFor('gpt-5.6-sol','map'),{reasoning:{effort:'low'}});
    assert.deepEqual(reasoningFor('gpt-5.6-sol','audit'),{reasoning:{effort:'medium'}});
    assert.deepEqual(reasoningFor('gpt-4.1','read'),{});assert.equal(isReasoningModel('o4-mini'),true);
    process.env.P5_OPENAI_REASONING_EFFORT='default';assert.deepEqual(reasoningFor('gpt-5.6-sol','read'),{});
    process.env.P5_OPENAI_REASONING_EFFORT='minimal';assert.deepEqual(reasoningFor('gpt-5.6-sol','audit'),{reasoning:{effort:'minimal'}});
  }finally{if(saved===undefined)delete process.env.P5_OPENAI_REASONING_EFFORT;else process.env.P5_OPENAI_REASONING_EFFORT=saved;}
  assert.equal(rejectsReasoning(400,'Unsupported parameter: reasoning.effort'),true);
  assert.equal(rejectsReasoning(400,'Invalid schema'),false);assert.equal(rejectsReasoning(429,'reasoning'),false);
});
