import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {analysisSegments} from '../lib/p5/analysisWork';
import {verifyUpload,prepareAnalysisFiles} from '../lib/p5/documents';
// Read-only fixture transport check. Private source PDFs are never added to Git.
const paths=process.argv.slice(2);assert.ok(paths.length,'Provide source PDF paths.');
for(const filePath of paths){
 const start=performance.now(),data=await readFile(filePath),name=path.basename(filePath);
 const pdf=await PDFDocument.load(data),expected=pdf.getPageCount();
 const prepared=await prepareAnalysisFiles([verifyUpload(name,data)]);assert.deepEqual(prepared.manualReview,[]);
 const seen=new Set<number>();let sections=0;
 for(const file of prepared.readable)for await(const section of analysisSegments(file)){
  assert.ok(section.data.length);assert.equal(section.preparationError,undefined);sections++;
  const sectionPdf=await PDFDocument.load(section.data);
  if(!section.detailViews)assert.equal(sectionPdf.getPageCount(),1,'Each normal source page has its own completion checkpoint');
  for(const page of section.pages||[]){assert.equal(page.source,name);seen.add(page.page);}
 }
 assert.deepEqual([...seen].sort((a,b)=>a-b),Array.from({length:expected},(_,i)=>i+1));
 console.log(JSON.stringify({file:name,pages:expected,preparedSections:sections,allOriginalPagesPresent:true,preparationMs:Math.round(performance.now()-start),aiCalls:0}));
}
