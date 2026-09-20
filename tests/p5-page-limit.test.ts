import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {prepareAnalysisFiles} from '../lib/p5/documents.ts';
import {analysisSegments} from '../lib/p5/analysisSegments.ts';
import {drawingDetails} from '../lib/p5/planRendering.ts';
import {validateRemotePageCount} from '../lib/p5/documentServiceClient.ts';
import {SCOPE_MAX_PAGES,SCOPE_PAGE_LIMIT,SCOPE_PDF_PAGE_LIMIT,SCOPE_PLAN_PAGE_LIMIT,SCOPE_PLAN_PAGE_TARGET,SCOPE_UPLOAD_HELP} from '../lib/p5/scope.ts';
import {existsSync} from 'node:fs';
// The legacy plans uploader exists only in the Remodeling site; where it exists its limits must agree.
const legacyPlan=new URL('../shared/documents/uploadPlan.ts',import.meta.url);

async function fixture(count:number){
 const pdf=await PDFDocument.create();
 for(let i=0;i<count;i++)pdf.addPage([20,20]);
 return {name:`synthetic-${count}.pdf`,type:'application/pdf',data:Buffer.from(await pdf.save())};
}
const boundary=Promise.all([fixture(250),fixture(251)]);
test('browser/local/remote page ceiling is 250 without raising buffered part budgets',async()=>{
 const legacy=existsSync(legacyPlan)?await import(legacyPlan.href) as {MAX_PLAN_PAGES:number;PART_MAX_BYTES:number;PART_MAX_PAGES:number}:null;
 assert.equal(SCOPE_MAX_PAGES,250);if(legacy)assert.equal(legacy.MAX_PLAN_PAGES,250);
 // One canonical limit; every historical brand name is an alias that cannot drift.
 for(const alias of [SCOPE_PAGE_LIMIT,SCOPE_PDF_PAGE_LIMIT,SCOPE_PLAN_PAGE_LIMIT,SCOPE_PLAN_PAGE_TARGET])assert.equal(alias,SCOPE_MAX_PAGES);
 assert.match(SCOPE_UPLOAD_HELP,/250 MiB each and 1 GiB total/);assert.doesNotMatch(SCOPE_UPLOAD_HELP,/\d\s?[MG]B\b/);
 if(legacy){assert.equal(legacy.PART_MAX_BYTES,6*1024*1024);assert.equal(legacy.PART_MAX_PAGES,8);}
 assert.match(SCOPE_UPLOAD_HELP,/250 pages per PDF/);
 assert.doesNotThrow(()=>validateRemotePageCount(250));
 assert.throws(()=>validateRemotePageCount(251),/250 pages/);
 assert.throws(()=>validateRemotePageCount(-1),/page count/);
 assert.throws(()=>validateRemotePageCount(250.5),/page count/);
});
test('local PDF preparation accepts 250 pages and refuses 251 without losing other sources',async()=>{
 const [accepted,rejected]=await boundary;
 const photo={name:'note.txt',type:'text/plain',data:Buffer.from('Keep existing appliances.')};
 const result=await prepareAnalysisFiles([accepted,rejected,photo]);
 assert.deepEqual(result.readable.map(f=>f.name),[accepted.name,photo.name]);
 assert.equal(result.manualReview.length,1);
 assert.match(result.manualReview[0],/251.*1 to 250 pages/);
});
test('resumable local segmentation reads original page 250 but rejects a 251-page source',async()=>{
 const [accepted,rejected]=await boundary;
 const units=[];
 for await(const unit of analysisSegments(accepted,249))units.push(unit);
 assert.equal(units.length,1);assert.equal(units[0].pages?.[0].page,250);
 await assert.rejects(async()=>{for await(const _ of analysisSegments(rejected))assert.fail('Must not prepare any page');},/250 pages/);
});
test('detail-render preparation accepts page 250 and refuses 251-page sources before rendering',async()=>{
 const [accepted,rejected]=await boundary;
 const units=[];
 for await(const unit of drawingDetails(accepted,250))units.push(unit);
 assert.ok(units.length>0);assert.equal(units[0].pages?.[0].page,250);
 await assert.rejects(async()=>{for await(const _ of drawingDetails(rejected,1))assert.fail('Must not render any page');},/250 pages/);
});
const legacySplitter=new URL('../lib/planSplitter.ts',import.meta.url);
test('legacy browser splitter accepts all 250 pages and refuses 251 before creating upload parts',{skip:existsSync(legacySplitter)?false:'this site has no legacy plans uploader'},async()=>{
 const {splitForUpload}=await import(legacySplitter.href) as {splitForUpload:(files:File[])=>Promise<any>};
 const [accepted,rejected]=await boundary;
 const file=(f:typeof accepted)=>new File([new Uint8Array(f.data)],f.name,{type:f.type});
 const result=await splitForUpload([file(accepted)]);
 assert.equal(result.ok,true);assert.equal(result.totalPages,250);
 assert.equal(result.parts.reduce((sum,part)=>sum+part.pageCount,0),250);
 const refusal=await splitForUpload([file(rejected)]);
 assert.equal(refusal.ok,false);assert.equal(refusal.parts.length,0);assert.match(refusal.error||'',/up to 250/);
});