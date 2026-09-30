import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {withFormControlViews,formControlRegions} from '../lib/p5/formControlViews.ts';
import {renderedPageImage,renderedPagePdf} from '../lib/p5/pdfAccess.ts';
import {analysisSegments} from '../lib/p5/analysisSegments.ts';
import {visualFallbackFiles} from '../lib/p5/extraction.ts';

test('symbol-font candidates only request visual evidence, without asserting selection or interpreting words',()=>{
 const item={transform:[12,0,0,12,30,600],width:10,height:12};
 for(const str of ['☐','☑','☒','□','■','¨','®'])assert.equal(formControlRegions([{...item,str}]).length,1);
 for(const str of ['TERMINATION PROVISION','8','radon','normal text',''])assert.equal(formControlRegions([{...item,str}]).length,0);
 assert.equal(formControlRegions([{...item,str:'☐',width:200}]).length,0);
 assert.equal(formControlRegions([{...item,str:'☐',transform:[12,0,0,12,NaN,600]}]).length,0);
 assert.equal(formControlRegions([{...item,str:'☐',transform:[0,12,-12,0,30,600]}]).length,0);
});

test('native form controls retain their actual checked and unchecked appearance beside labels, with one source identity',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([612,792]),form=doc.getForm();
 page.drawText('Optional work A',{x:66,y:698,size:11});page.drawText('Optional work B',{x:66,y:648,size:11});
 const a=form.createCheckBox('a');a.addToPage(page,{x:40,y:696,width:14,height:14});a.check();
 form.createCheckBox('b').addToPage(page,{x:40,y:646,width:14,height:14});
 const data=Buffer.from(await doc.save()),prepared=await withFormControlViews(data);
 assert.equal(prepared.formViews,2);assert.equal((await PDFDocument.load(prepared.data)).getPageCount(),2);
 assert.deepEqual((await renderedPageImage(prepared.data,1)).data,(await renderedPageImage(data,1)).data,'The original page appearance must not change.');
 const units=[];for await(const unit of analysisSegments({name:'generic-form.pdf',type:'application/pdf',data}))units.push(unit);
 assert.equal(units.length,1);assert.equal(units[0].formViews,2);assert.deepEqual(units[0].pages,[{source:'generic-form.pdf',page:1}]);
 const fallback=await visualFallbackFiles(units);
 assert.equal(fallback.length,2);for(const view of fallback){assert.deepEqual(view.pages,units[0].pages);assert.equal(view.formViews,2);assert.equal(view.type,'image/png');}
});

test('a page without a form control keeps its original bytes',async()=>{
 const doc=await PDFDocument.create();doc.addPage().drawText('Replace three handles.');
 const data=Buffer.from(await doc.save());assert.deepEqual(await withFormControlViews(data),{data});
});

const original=process.env.P5_RE10_CONTROLS_FIXTURE;
test('the original flattened repair form supplies all control close-ups including the unchecked second-page alternative',{skip:original?false:'private original not configured'},async()=>{
 const data=readFileSync(original!),units=[];
 for await(const unit of analysisSegments({name:'original-repair-form.pdf',type:'application/pdf',data}))units.push(unit);
 assert.deepEqual(units.map(unit=>unit.formViews),[15,1]);
 assert.deepEqual(units.map(unit=>unit.pages),[[{source:'original-repair-form.pdf',page:1}],[{source:'original-repair-form.pdf',page:2}]]);
 const unchanged=await renderedPagePdf(data,2);
 assert.deepEqual((await renderedPageImage(units[1].data,1)).data,(await renderedPageImage(unchanged,1)).data);
 assert.match(units[1].text||'',/TERMINATION PROVISION/,'The clause remains in the source; magnification does not delete or reinterpret it.');
 assert.ok(units.every(unit=>unit.data.length<16*1024*1024));
});
