import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageFor,combineCoverage,reconcileTakeoffs,type Takeoff} from '../lib/p5/documentLedger.ts';
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
test('Missing or conflicting page reports never claim completion',()=>{
  assert.equal(coverageFor([page],[]).complete,false);
  // Repeated records for one page combine to the worst status: agreeing reads are a read page,
  // a partial record counts only when no note says content could not be read; unreadable never counts.
  assert.equal(coverageFor([page],[read,read]).complete,true);
  assert.equal(coverageFor([page],[read,{...read,status:'partial',notes:['Section C is unreadable.']}]).complete,false);
  assert.equal(coverageFor([page],[{...read,status:'unreadable'}]).complete,false);
  assert.equal(coverageFor([page],[{...read,status:'read',notes:['The repair notes could not be read.']}]).complete,false);
});
test('an unreadable detail stays unreadable regardless of note wording or merge order',()=>{
  for(const notes of [[],['Detail text is too blurry to identify.'],['Drawing needs a clearer image.']]){
    const failed={...read,status:'unreadable' as const,notes};
    for(const rows of [[read,failed],[failed,read]]){
      const reported=coverageFor([page],rows);
      assert.equal(reported.complete,false);
      assert.equal(reported.pages[0].status,'unreadable');
      const tiles=combineCoverage(rows.map(row=>({pages:[row],expectedPages:1,complete:row.status==='read'})),[page]);
      assert.equal(tiles.complete,false);
      assert.equal(tiles.pages[0].status,'unreadable');
      assert.deepEqual(tiles.pages[0].notes,notes);
    }
  }
});
test('unknown page records cannot be assigned to an arbitrary file with the same page number',()=>{
  const wanted=[{source:'existing.pdf',page:1},{source:'proposed.pdf',page:1}];
  const unknown={...read,source:'unidentified drawing'};
  const result=coverageFor(wanted,[unknown]);
  assert.equal(result.complete,false);
  assert.deepEqual(result.pages.map(page=>page.status),['unreadable','unreadable']);
  const oneKnown=coverageFor(wanted,[{...read,source:'existing.pdf'},unknown]);
  assert.deepEqual(oneKnown.pages.map(page=>page.status),['read','unreadable']);
  const identified=coverageFor(wanted,[{...read,source:'existing.pdf'},{...read,source:'proposed.pdf'}]);
  assert.equal(identified.complete,true);
});
test('A read page labelled differently by the reader is bound to the page that was sent (live permit set, 2026-09-21)',()=>{
  const sent={source:'Permit Plans - Gambardella.pdf',page:8};
  // A one-page unit owns the record it returns, whatever file name or section number it used.
  assert.equal(coverageFor([sent],[{...read,source:'Permit Plans - Gambardella.pdf (page 8)',page:1}]).complete,true);
  const bound=coverageFor([sent],[{...read,page:1}]).pages[0];assert.equal(bound.page,8);assert.equal(bound.source,sent.source);
  // Several pages: the same page number under another spelling of the file name.
  const two=[{source:'set.pdf',page:8},{source:'set.pdf',page:9}];
  assert.equal(coverageFor(two,[{...read,source:'SET.PDF',page:8},{...read,source:'SET.PDF',page:9}]).complete,true);
  // Several pages numbered within the section (1, 2) map by position when nothing matched exactly.
  assert.deepEqual(coverageFor(two,[{...read,source:'set.pdf',page:1},{...read,source:'set.pdf',page:2}]).pages.map(p=>[p.page,p.status]),[[8,'read'],[9,'read']]);
  // A page with no record at all still blocks: nothing is invented for a page that was not read.
  const missing=coverageFor(two,[{...read,source:'set.pdf',page:8}]);
  assert.equal(missing.complete,false);assert.equal(missing.pages[1].status,'unreadable');
});
test('A page review returned as one object or keyed by page is still read',async()=>{
 // Live on the Marcliffe RE-10 the reader returned "pages" as an object and a read page was lost.
 const {readPageRecords}=await import('../lib/p5/documentLedger.ts');
 assert.deepEqual(readPageRecords(read),[read]);
 assert.deepEqual(readPageRecords({'1':read,'2':{...read,page:2}}).map(p=>p.page),[1,2]);
 assert.deepEqual(readPageRecords({records:[read,{...read,page:2}],count:2}).map(p=>p.page),[1,2],'a wrapped list is found');
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
test('A readable page marked partial for blank or redacted values counts as read (live Construction budget, 2026-09-21)',async()=>{
  const {pageCovered,blockingReviewNote}=await import('../lib/p5/documentLedger.ts');
  const partial={...read,status:'partial' as const,notes:['Dollar amounts are blank on this page; all line descriptions are legible.']};
  assert.equal(pageCovered(partial),true);
  assert.equal(coverageFor([page],[partial]).complete,true);
  // A partial page that says part of it could not be read still blocks.
  assert.equal(pageCovered({...partial,notes:['The lower half of the sheet is unreadable.']}),false);
  assert.equal(coverageFor([page],[{...partial,notes:['The lower half of the sheet is unreadable.']}]).complete,false);
  assert.equal(blockingReviewNote('Revision table is blank, not unreadable.'),false);
});
test('Text from a PDF is made well formed before it is sent to a reader (live Construction budget, 2026-09-21)',async()=>{
  const {wellFormed}=await import('../lib/p5/extraction.ts');
  const broken=`Budget ${String.fromCharCode(0xD83D)} line${String.fromCharCode(0)}${String.fromCharCode(7)} kept\nnext`;
  const out=wellFormed(broken);
  assert.equal(out.isWellFormed(),true);assert.match(out,/Budget .* line kept\nnext/);
  assert.equal([...out].some(c=>c.charCodeAt(0)<9),false,'control bytes are removed');
});

test('a customer revision retains its own citation instead of becoming a claim about an old PDF',async()=>{
 const {bindTypedTakeoffSources,readTakeoffs}=await import('../lib/p5/documentLedger.ts');
 const text='Change the garage to 24 by 24 feet, 576 SF, superseding the PDF garage size.';
 const garage={...takeoff,id:'garage',component:'garage',description:'Attached garage',quantity:576,unit:'SF',evidence:text,sources:[{source:'typed scope',page:1,sheet:'',revision:''}]};
 bindTypedTakeoffSources([garage],text);assert.equal(garage.quantity,576);assert.deepEqual(garage.sources,[{source:'typed scope',page:0,sheet:'',revision:''}]);assert.doesNotThrow(()=>readTakeoffs([garage]));
 const drywall={...garage,id:'patch',component:'drywall',quantity:2.25,evidence:'user: Change to 18x18 in; (18/12)x(18/12)=2.25 SF',sources:[{source:'user revision',page:1,sheet:'',revision:''}]};
 bindTypedTakeoffSources([drywall],'Change the drywall hole to 18 by 18 inches, superseding the PDF 12 by 12 inches.');
 assert.equal(drywall.quantity,2.25);assert.equal(drywall.sources[0].page,0);
 const invented={...drywall,quantity:144,evidence:'user: Change to 18x18 in; area 144 SF'};
 bindTypedTakeoffSources([invented],'Change the drywall hole to 18 by 18 inches.');assert.equal(invented.quantity,null);assert.equal(invented.basis,'uncertain');
 assert.throws(()=>readTakeoffs([{...garage,sources:[{source:'drawing.pdf',page:0,sheet:'',revision:''}]}]),/page reference/);
});
