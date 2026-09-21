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
test('A page review returned as one object or keyed by page is still read',async()=>{
 // Live on the Marcliffe RE-10 the reader returned "pages" as an object and a read page was lost.
 const {readPageRecords}=await import('../lib/p5/documentLedger.ts');
 assert.deepEqual(readPageRecords(read),[read]);
 assert.deepEqual(readPageRecords({'1':read,'2':{...read,page:2}}).map(p=>p.page),[1,2]);
 assert.throws(()=>readPageRecords({'1':{...read,status:'maybe'}}),/Invalid page review record/,'the records themselves are still validated');
 assert.throws(()=>readPageRecords('page one'),/Missing page-by-page review record/);
});
test('Parallelism is bounded without limiting total plan pages',()=>{
  assert.equal(analysisConcurrency('6'),6);assert.equal(analysisConcurrency('999'),24);
  assert.equal(analysisConcurrency('-1'),12);assert.equal(analysisConcurrency('invalid'),12);
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

test('a drawing page is supplied whole when detail rendering fails on the host',async()=>{
  const {analysisSegments}=await import('../lib/p5/analysisSegments.ts');
  const {PDFDocument}=await import('pdf-lib');
  const doc=await PDFDocument.create();doc.addPage([2592,1728]);doc.addPage([612,792]);
  const data=Buffer.from(await doc.save());
  const failing=async function*(){throw new TypeError('The "path" argument must be of type string. Received type number (15754)');};
  const units=[];for await(const unit of analysisSegments({name:'plans.pdf',type:'application/pdf',data},0,failing as any))units.push(unit);
  assert.equal(units.length,2);
  assert.ok(!units[0].preparationError,'the large sheet is not marked unreadable');
  assert.ok(units[0].data.length>0&&/supplied whole/.test(units[0].name));
  assert.deepEqual(units[0].pages,[{source:'plans.pdf',page:1}]);assert.equal(units[0].nextPage,1);
  assert.deepEqual(units[1].pages,[{source:'plans.pdf',page:2}]);
});
