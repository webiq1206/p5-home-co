import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

test('the configured document logo embeds in the customer and internal PDF image pipeline', async()=>{
  const bytes=await readFile(new URL(`../public${ESTIMATOR_BRAND.logo}`,import.meta.url));
  const pdf=await PDFDocument.create();
  const logo=/\.jpe?g$/i.test(ESTIMATOR_BRAND.logo)
    ? await pdf.embedJpg(bytes)
    : await pdf.embedPng(bytes);
  assert.ok(logo.width>0 && logo.height>0);
  const page=pdf.addPage();
  page.drawImage(logo,{x:54,y:650,width:180,height:180*logo.height/logo.width});
  assert.equal((await PDFDocument.load(await pdf.save())).getPageCount(),1);
});
