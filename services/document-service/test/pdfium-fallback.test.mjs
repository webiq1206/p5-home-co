import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,degrees,rgb,PDFName} from 'pdf-lib';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createParser} from '../src/parser.mjs';
import {runPrimary,checkRendererRuntime} from '../src/renderer-runtime.mjs';
import {ServiceError,hash} from '../src/core.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {runPdfium} from '../src/renderer-runtime.mjs';

async function fixture(rotation=0,negative=false,annotation=false){
 const pdf=await PDFDocument.create(),page=pdf.addPage([600,400]);
 if(negative){page.setMediaBox(-300,-200,600,400);page.setCropBox(-200,-100,300,200);}else page.setCropBox(100,100,300,200);
 page.setRotation(degrees(rotation));const left=negative?-200:100,bottom=negative?-100:100;
 page.drawRectangle({x:left+30,y:bottom+40,width:60,height:30,color:rgb(0,0,1)});
 page.drawText('SOURCE-ANCHOR',{x:left+35,y:bottom+48,size:5});
 if(annotation){
  const appearance=pdf.context.register(pdf.context.flateStream('0 1 0 rg 0 0 40 40 re f',{Type:'XObject',Subtype:'Form',BBox:[0,0,40,40],Resources:{}}));
  const annot=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Square',Rect:[left+180,bottom+100,left+220,bottom+140],F:4,AP:{N:appearance}}));
  page.node.set(PDFName.of('Annots'),pdf.context.obj([annot]));
 }
 return Buffer.from(await pdf.save());
}
function forcedFallback(reason='parser-process-failed'){
 return createParser({primary:async(request,options)=>{const result=await runPrimary(request,options);if(request.page)throw new ServiceError(reason,503);return result;}});
}
async function colorPoints(png,color){
 const img=await loadImage(png),canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
 const data=ctx.getImageData(0,0,img.width,img.height).data;let n=0,x=0,y=0;
 for(let i=0;i<data.length;i+=4){if(data[i+color]>200&&data[i+(color+1)%3]<50&&data[i+(color+2)%3]<50){n++;x+=(i/4)%img.width;y+=Math.floor(i/4/img.width);}}
 return {n,x:x/n/img.width,y:y/n/img.height};
}
test('pinned PDFium runtime renders under its OS memory boundary',async()=>{
 const runtime=await checkRendererRuntime();assert.equal(runtime.engine,'pdfium');assert.equal(runtime.binding,'5.3.0');assert.equal(runtime.version,'145.0.7616.0');assert.match(runtime.licenseBundleSha256,/^[a-f0-9]{64}$/);
});
for(const rotation of [0,90,180,270])test('PDFium fallback preserves shifted crop box, native spans and grounded crop at rotation '+rotation,async()=>{
 const bytes=await fixture(rotation),before=hash(bytes);let primary,fallback,crop;
 await createParser()(bytes,{onPage:p=>primary=p});
 await forcedFallback()(bytes,{onPage:p=>fallback=p});
 assert.equal(hash(bytes),before);assert.equal(fallback.sourceSha256,before);
 assert.deepEqual(fallback.spans,primary.spans);assert.equal(fallback.text,primary.text);
 assert.equal(fallback.render.engine,'pdfium');assert.equal(fallback.render.fallbackReason,'parser-process-failed');
 assert.deepEqual(fallback.geometry,primary.geometry);
 const a=await colorPoints(primary.image,2),b=await colorPoints(fallback.image,2);
 assert.ok(a.n>100&&b.n>100);assert.ok(Math.abs(a.x-b.x)<.005&&Math.abs(a.y-b.y)<.005);
 const region={x:Math.max(0,b.x-.15),y:Math.max(0,b.y-.15),width:.3,height:.3};
 await forcedFallback()(bytes,{crop:{page:1,region},onPage:p=>crop=p});
 const c=await colorPoints(crop.image,2);assert.ok(c.n>100);assert.ok(Math.abs(c.x-.5)<.03&&Math.abs(c.y-.5)<.03);
 assert.deepEqual(crop.render.region,region);assert.deepEqual(crop.spans,primary.spans);
});
test('PDFium preserves negative origins and live annotation appearances',async()=>{
 let page;const bytes=await fixture(0,true,true);await forcedFallback()(bytes,{onPage:p=>page=p});
 assert.deepEqual(page.geometry.view,[-200,-100,100,100]);
 assert.ok((await colorPoints(page.image,2)).n>100);assert.ok((await colorPoints(page.image,1)).n>100);
 assert.ok(page.spans.some(s=>s.text==='SOURCE-ANCHOR'));
});
test('missing native evidence, unsafe input and cancellation never invoke alternate renderer',async()=>{
 for(const code of ['parser-native-failed','unsafe-page-size','processing-cancelled','parser-process-failed']){
  let fallback=0;const parser=createParser({primary:async r=>{if(!r.page)return {count:1};throw new ServiceError(code,503);},alternate:async()=>fallback++});
  await assert.rejects(parser(await fixture()),error=>error.code===code);assert.equal(fallback,0);
 }
});
test('alternate engine failure is bounded to one attempt and publishes no partial page',async()=>{
 let attempts=0,pages=0;const parser=createParser({primary:async(r,o)=>{const value=await runPrimary(r,o);if(r.page)throw new ServiceError('parser-render-failed',503);return value;},alternate:async()=>{attempts++;throw new ServiceError('renderer-process-failed',503);}});
 await assert.rejects(parser(await fixture(),{onPage:()=>pages++}),/renderer-process-failed/);assert.equal(attempts,1);assert.equal(pages,0);
});
for(const tamper of ['bytes','geometry'])test('PDFium rejects changed '+tamper+' without publishing or concealing the integrity error',async()=>{
 let pages=0;
 const parser=createParser({primary:async(r,o)=>{const value=await runPrimary(r,o);if(r.page)throw new ServiceError('parser-render-failed',503);return value;},alternate:async(args,options)=>{
  const request=JSON.parse(await readFile(args[0],'utf8'));
  if(tamper==='bytes')await writeFile(request.input,Buffer.from('%PDF-different-source'));
  else{request.width++;await writeFile(args[0],JSON.stringify(request));}
  return runPdfium(args,options);
 }});
 await assert.rejects(parser(await fixture(),{onPage:()=>pages++}),error=>error.code===(tamper==='bytes'?'source-integrity-failed':'renderer-geometry-mismatch'));
 assert.equal(pages,0);
});
