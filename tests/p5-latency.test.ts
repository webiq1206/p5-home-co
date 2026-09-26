import test from 'node:test';
import assert from 'node:assert/strict';
import {costQuestionReader} from '../lib/p5/questionPolicy.ts';
import {preferredReadProvider} from '../lib/p5/readerRouting.ts';

test('one request shares a policy read across concurrent question evaluations',async()=>{
  let reads=0;
  const read=costQuestionReader(async()=>{reads++;return [{payload:{costBooks:[
    {service:'kitchen',rules:[{quantity:{field:'cabinetBaseLf'}}]},
    {service:'bathroom',rules:[{quantity:{field:'tileSqft'}}]},
  ]}}];});
  assert.deepEqual(await Promise.all([read({service:'kitchen'}),read({service:'bathroom'}),read({service:'kitchen'})]),[['cabinetBaseLf'],['tileSqft'],['cabinetBaseLf']]);
  assert.equal(reads,1);
});
test('a later request observes a changed book rather than a process cache',async()=>{
  let field='cabinetBaseLf';
  const load=async()=>[{payload:{costBooks:[{service:'kitchen',rules:[{quantity:{field}}]}]}}];
  assert.deepEqual(await costQuestionReader(load)({service:'kitchen'}),['cabinetBaseLf']);
  field='tileSqft';
  assert.deepEqual(await costQuestionReader(load)({service:'kitchen'}),['tileSqft']);
});
test('failed policy reads fail closed and the next request can recover',async()=>{
  await assert.rejects(costQuestionReader(async()=>{throw new Error('offline');})({service:'kitchen'}),/offline/);
  assert.deepEqual(await costQuestionReader(async()=>[])({service:'kitchen'}),[]);
});
test('typed scope uses the fast reader while documents and explicit provider choices retain routing',()=>{
  const files=[{name:'plan.pdf',type:'application/pdf',data:Buffer.from('plan')}];
  assert.equal(preferredReadProvider([],''),'OpenAI');
  assert.equal(preferredReadProvider(files,''),'OpenAI');
  assert.equal(preferredReadProvider([],'anthropic'),'OpenAI');
  assert.equal(preferredReadProvider(files,'openai'),'OpenAI');
});
