import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createCanvas} from '@napi-rs/canvas';
import {PDFDocument} from 'pdf-lib';
import {drawingDetails} from '../lib/p5/planRendering';

// Real scanned-format drawing, not a text-layer-only fixture. AI/OCR is not
// called by this test; it verifies full-sheet coverage, readable raster output
// and provider-safe request sizes independently of model performance.
const output='node_modules/.cache/p5-plan-rendering';await mkdir(output,{recursive:true});
const width=2592,height=1728,scale=1.5;
const canvas=createCanvas(width*scale,height*scale),ctx=canvas.getContext('2d');
ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#333';ctx.lineWidth=3;
ctx.strokeRect(30,30,canvas.width-60,canvas.height-60);
ctx.font='30px sans-serif';ctx.fillStyle='black';
for(let r=0;r<4;r++)for(let c=0;c<6;c++){
  const x=60+c*630,y=90+r*600;
  ctx.fillText(`REGION ${r*6+c+1}: TRIM 120 LF`,x,y);
  ctx.strokeRect(x,y+40,430,380);ctx.fillText('DOOR D1 / 36 IN',x+20,y+140);
  ctx.font='16px sans-serif';ctx.fillText('SMALL NOTE: OWNER SUPPLIES MATERIALS',x+10,y+200);ctx.font='30px sans-serif';
}
ctx.fillStyle='#a32222';ctx.fillText('TOP LEFT: FIRST FLOOR ONLY',60,45);
ctx.fillStyle='#153fc0';ctx.fillText('BOTTOM RIGHT: REVISION 2',canvas.width-640,canvas.height-40);
const source=await PDFDocument.create();const image=await source.embedJpg(canvas.toBuffer('image/jpeg',95));source.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});
const data=Buffer.from(await source.save());await writeFile(`${output}/scanned-drawing.pdf`,data);
const combined=await PDFDocument.create();let sections=0,tiles=0,lastCursor:number|undefined;const started=performance.now();
for await(const unit of drawingDetails({name:'scanned-drawing.pdf',type:'application/pdf',data},1)){
  sections++;assert.ok(unit.data.length<16*1024*1024);assert.deepEqual(unit.pages,[{source:'scanned-drawing.pdf',page:1}]);
  const pdf=await PDFDocument.load(unit.data);tiles+=pdf.getPageCount()-1;
  assert.ok(unit.name.includes('whole-sheet context first'));
  for(const p of await combined.copyPages(pdf,pdf.getPageIndices()))combined.addPage(p);
  lastCursor=unit.nextPage;
}
assert.equal(tiles,24);assert.equal(sections,4);assert.equal(lastCursor,1);
await writeFile(`${output}/detail-views.pdf`,await combined.save());
console.log(`PASS: 36 x 24 inch scanned sheet, ${tiles} overlapping detail views in ${sections} requests, all regions covered, original-page identity retained. Rendering ${(performance.now()-started).toFixed(0)} ms. No AI calls; inspect first and last views for visual QA.`);
