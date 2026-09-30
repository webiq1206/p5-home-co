import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadLocalProjectPages} from '../lib/p5/projectLocalPages.ts';
import {pageTextFromItems} from '../lib/p5/pdfText.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
function fixture(){
 const bytes=Buffer.from('Controlled immutable source bytes'),sha256=createHash('sha256').update(bytes).digest('hex');
 const draft={id:'controlled',brand:ESTIMATOR_BRAND.id,uploads:[{id:'file',name:'plan.pdf',type:'application/pdf',size:bytes.length,sha256,status:'stored' as const}]};
 const unit=()=>({uploadId:'file',pages:[{page:1,source:'plan.pdf'}],result:{extraction:{documentCoverage:{pages:[{page:1,status:'read',notes:[]}]},takeoffs:[{quantity:26}]}}});
 const rows=[{payload:{units:[unit(),unit(),unit(),unit()]}}];
 const native={text:'MAIN FLOOR ADDITION 26 SQFT\nUPPER FLOOR ADDITION 471 SQFT',kind:'digital-text',textQuality:1,width:100,height:100,spanCoordinates:'PDF page points',spans:[]};
 let reads=0;
 const dependencies={query:async(_sql:string,params?:unknown[])=>{assert.deepEqual(params,[draft.id,'file']);return rows;},readSavedSource:async()=>{reads++;return {bytes,file:{}};},nativePages:async()=>[native]};
 return {draft,rows,native,dependencies,get reads(){return reads;}};
}
test('local native evidence preserves one page and keeps four overlapping interpretations separate',async()=>{
 const f=fixture();f.draft.uploads.push({...f.draft.uploads[0],id:'duplicate'});
 const value=await loadLocalProjectPages(f.draft,f.dependencies);
 assert.equal(f.reads,1);assert.equal(value.documents.length,1);assert.equal(value.documents[0].pages.length,1);
 const page=value.documents[0].pages[0];assert.equal(page.native.text,f.native.text);assert.equal(page.status,'read');
 assert.equal((page.readerObservation as any).sections.length,4);assert.match((page.readerObservation as any).warning,/not separate physical instances/);
});
test('saved partial sections and missing page interpretations are never certified by native text',async()=>{
 const f=fixture();f.rows[0].payload.units[0].result.extraction.documentCoverage.pages[0].status='unreadable';
 f.dependencies.nativePages=async()=>[f.native,f.native];
 const value=await loadLocalProjectPages(f.draft,f.dependencies);
 assert.deepEqual(value.documents[0].pages.map(page=>page.status),['partial','partial']);
});
test('local bridge verifies the original digest and refuses another brand',async()=>{
 const f=fixture();f.draft.uploads[0].sha256='0'.repeat(64);
 await assert.rejects(loadLocalProjectPages(f.draft,f.dependencies),/checksum/);
 await assert.rejects(loadLocalProjectPages({...f.draft,brand:'another-brand'},f.dependencies),/restricted/);
});
test('native source text is not subject to the legacy 60000-character context cap',()=>{
 const original='Original page label. '.repeat(4000);
 assert.equal(pageTextFromItems([{str:original}],Infinity),original.trim());
 assert.equal(pageTextFromItems([{str:original}]).length,60000);
});
