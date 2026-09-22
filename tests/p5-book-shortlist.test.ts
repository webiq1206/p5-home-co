import test from 'node:test';
import assert from 'node:assert/strict';
import {bookIndex,parseShortlist,shortlistBook,SHORTLIST_PER_TASK} from '../lib/p5/bookShortlist.ts';
import {relevantCatalog} from '../lib/p5/catalogSelection.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';

// Owner request 2026-09-22: every task must map to the price book. A fast model reads the WHOLE book
// index and names the closest lines per task; those lines are always offered to the mapping stage.
const rates=priceBookRates({service:'new-construction',finish:'mid-range'} as any) as any[];
const tasks=[{id:'HOME-01',description:'Construct one new single-story residence with 2,400 SF of living area'},{id:'CAB-01',description:'Supply and install 20 LF of paint-grade Shaker base cabinets'}];
test('the index covers the whole book in one compact line per entry',()=>{
  const index=bookIndex(rates).split('\n');
  assert.equal(index.length,rates.length);
  assert.ok(index.some(line=>line.startsWith('PB-90-10-01|New home construction, complete')),'the whole-house assembly is visible to the search');
  assert.ok(index.every(line=>line.split('|').length===4));
});
test('only known tasks and book codes survive, capped per task',()=>{
  const raw={tasks:[{id:'HOME-01',codes:['PB-90-10-01','INVENTED-1','PB-90-10-01']},{id:'nobody',codes:['PB-12-32-01']},{id:'CAB-01',codes:rates.slice(0,20).map(r=>r.code)}]};
  const parsed=parseShortlist(raw,tasks,rates);
  assert.deepEqual(parsed.get('HOME-01'),['PB-90-10-01']);
  assert.equal(parsed.has('nobody'),false);
  assert.equal(parsed.get('CAB-01')!.length,SHORTLIST_PER_TASK);
});
test('shortlisted lines are always offered even when no word is shared',()=>{
  const plain=relevantCatalog(rates,[tasks[0]]);
  const forced=relevantCatalog(rates,[tasks[0]],undefined,new Set(['PB-90-10-01']));
  assert.ok(forced.some(r=>r.code==='PB-90-10-01'));
  assert.ok(forced.length>=plain.length);
});
test('a failed or unconfigured search falls back to word matching, never an error',async()=>{
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    for(const k of keys)delete process.env[k];
    assert.equal((await shortlistBook(tasks,rates)).size,0,'no connection configured');
    process.env.OPENAI_API_KEY='synthetic';
    assert.equal((await shortlistBook(tasks,rates,(async()=>new Response('busy',{status:429})) as any)).size,0,'a refusal');
    assert.equal((await shortlistBook(tasks,rates,(async()=>{throw new Error('timeout');}) as any)).size,0,'a timeout');
    const ok=await shortlistBook(tasks,rates,(async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({tasks:[{id:'HOME-01',codes:['PB-90-10-01']}]})}]}]})) as any);
    assert.deepEqual(ok.get('HOME-01'),['PB-90-10-01']);
  }finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]!;}}
});
