import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageFor,reconcileTakeoffs,type Takeoff} from '../lib/p5/documentLedger.ts';
import {analysisProgress,analysisConcurrency} from '../lib/p5/analysisProgress.ts';
import {emptyInstructions,mergeInstructions} from '../lib/p5/instructions.ts';
import {pricingSourceParts} from '../lib/p5/pricingSources.ts';

const page={source:'plan.pdf',page:1};
const read={...page,sheet:'A101',revision:'1',status:'read' as const,notes:[]};
const result={extraction:{documentCoverage:coverageFor([page],[read])}};
test('Progress counts original pages, not overlapping image tiles',()=>{
  const pending=analysisProgress([{pages:[page],result},{pages:[page]}],[page]);
  assert.equal(pending.totalPages,1);assert.equal(pending.readPages,0);assert.equal(pending.readSections,1);
  const complete=analysisProgress([{pages:[page],result},{pages:[page],result}],[page]);
  assert.equal(complete.readPages,1);assert.equal(complete.totalSections,2);
  assert.equal(analysisProgress([{pages:[page],result}],[page,{...page,page:2}]).readPages,1);
});
test('Missing or duplicate page reports never claim completion',()=>{
  assert.equal(coverageFor([page],[]).complete,false);
  assert.equal(coverageFor([page],[read,read]).complete,false);
  assert.equal(coverageFor([page],[{...read,status:'partial'}]).complete,false);
});
test('Parallelism is bounded without limiting total plan pages',()=>{
  assert.equal(analysisConcurrency('6'),6);assert.equal(analysisConcurrency('999'),8);
  assert.equal(analysisConcurrency('-1'),6);assert.equal(analysisConcurrency('invalid'),6);
});
const takeoff:Takeoff={id:'door-D1',description:'Door D1',building:'Main',floor:'1',component:'door',quantity:1,unit:'EA',basis:'stated',evidence:'Door schedule D1',sources:[{...page,sheet:'A101',revision:'1'}],supersedes:[],issues:[]};
test('Plans and schedules do not double count physical work; conflicts remain visible',()=>{
  const repeated={...takeoff,sources:[{...page,page:250,sheet:'A600',revision:'1'}]};
  const same=reconcileTakeoffs([takeoff,repeated]);assert.equal(same.items.length,1);assert.equal(same.items[0].quantity,1);assert.equal(same.items[0].sources.length,2);
  const conflict=reconcileTakeoffs([takeoff,{...repeated,quantity:2}]);assert.equal(conflict.items[0].quantity,null);assert.ok(conflict.issues.length);
  const revised={...takeoff,quantity:3,sources:[{...page,page:256,sheet:'A101',revision:'2'}],supersedes:['plan.pdf:A101:1']};
  for(const order of [[takeoff,revised],[revised,takeoff]])assert.equal(reconcileTakeoffs(order).items[0].quantity,3,'explicit supersession must work independently of upload order');
});
test('Lengthy instructions preserve clauses and expose conflicting responsibilities',()=>{
  const instructions=mergeInstructions([{...emptyInstructions(),inclusions:Array.from({length:500},(_,i)=>`Trim item ${i}`),laborOnly:true},{...emptyInstructions(),materialsOnly:true,exclusions:['Trim item 499']}]);
  assert.equal(instructions.inclusions.length,500);assert.equal(instructions.questions.length,2);
});
test('Long pricing sources retain the last item and full boundary instructions',()=>{
  const scope={text:'First included item. '+('Detailed specification. '.repeat(7000))+'FINAL INCLUDED ITEM.',answers:{estimatingInstructions:'Trim only; first floor; exclude plumbing.'},extraction:null,uploads:[],reviewedAt:'2026-09-12',corrections:[]};
  const parts=pricingSourceParts(scope);assert.ok(parts.length>1);
  assert.ok(JSON.stringify(parts.at(-1)).includes('FINAL INCLUDED ITEM'));
  assert.ok(parts.every(p=>JSON.stringify(p).includes(scope.answers.estimatingInstructions)));
});
