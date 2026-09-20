import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {inspectPdf,openablePdf,renderedPagePdf,PdfAccessError} from '../lib/p5/pdfAccess.ts';
import {analysisSegments} from '../lib/p5/analysisSegments.ts';
import {verifyPdfPageLimit} from '../lib/p5/documents.ts';
import {blockingReviewNote} from '../lib/p5/scope.ts';

// Real customer documents never enter Git. Point P5_PRIVATE_FIXTURES at a
// folder holding them; the default is the owner's Downloads folder.
const privateDir=process.env.P5_PRIVATE_FIXTURES||path.join(process.env.USERPROFILE||process.env.HOME||'','Downloads');
const marcliffe=existsSync(privateDir)?readdirSync(privateDir).find(name=>/Marcliffe.*RE-10.*\.pdf$/i.test(name)):undefined;

async function plainPdf(pages=2){const doc=await PDFDocument.create();for(let i=0;i<pages;i++)doc.addPage([612,792]).drawText(`Page ${i+1}: replace 20 LF of baseboard`,{x:72,y:700,size:14});return Buffer.from(await doc.save());}

test('an ordinary PDF keeps the native path',async()=>{
  const info=await inspectPdf(await plainPdf(3));
  assert.equal(info.access,'native');assert.equal(info.pages,3);assert.equal(info.sizes.length,3);
  assert.equal(await verifyPdfPageLimit('plain.pdf',await plainPdf(1)),1);
});

test('damaged, truncated and empty files are refused as damaged, with a note that blocks pricing',async()=>{
  const good=await plainPdf(1);
  for(const data of [Buffer.alloc(0),Buffer.from('%PDF-1.7 not really'),good.subarray(0,Math.floor(good.length/3))]){
    assert.equal((await inspectPdf(data)).access,'damaged');
    await assert.rejects(openablePdf('broken.pdf',data),(error:unknown)=>error instanceof PdfAccessError&&error.code==='pdf-damaged'&&blockingReviewNote(error.message)&&!/password/i.test(error.message));
  }
});

test('the password note blocks pricing and asks for the right thing',()=>{
  const error=new PdfAccessError('locked.pdf','password-required');
  assert.equal(error.code,'pdf-password-required');assert.ok(blockingReviewNote(error.message));assert.match(error.message,/password/);
});

test('the permission-restricted Marcliffe RE-10 is read page by page',{skip:marcliffe?false:'private fixture not present'},async()=>{
  const data=readFileSync(path.join(privateDir,marcliffe!));
  assert.equal(data.length,275564);
  await assert.rejects(PDFDocument.load(data),/encrypted/i,'pdf-lib still refuses the original, so the rendered path is what reads it');
  const info=await openablePdf('RE10 - Marcliffe.pdf',data);
  assert.equal(info.access,'rendered');assert.equal(info.pages,2);assert.equal(info.encrypted,true);
  assert.equal(await verifyPdfPageLimit('RE10 - Marcliffe.pdf',data),2);
  const units=[];for await(const unit of analysisSegments({name:'RE10 - Marcliffe.pdf',type:'application/pdf',data}))units.push(unit);
  assert.equal(units.length,2);
  assert.deepEqual(units.map(unit=>unit.pages),[[{source:'RE10 - Marcliffe.pdf',page:1}],[{source:'RE10 - Marcliffe.pdf',page:2}]]);
  assert.match(units[0].text||'',/Repair severe cracking on chimney cap/i);
  assert.match(units[0].text||'',/Install vapor barrier/i);
  for(const unit of units){assert.equal(unit.preparationError,undefined);const page=await PDFDocument.load(unit.data);assert.equal(page.getPageCount(),1);assert.ok(unit.data.length>100_000,'the unit carries the rendered page image');}
  assert.ok((await renderedPagePdf(data,2)).length>50_000);
});
