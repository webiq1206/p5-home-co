import {readFile,writeFile} from 'node:fs/promises';
import {createCanvas,DOMMatrix,Path2D,ImageData} from '@napi-rs/canvas';
import {createRequire} from 'node:module';
import path from 'node:path';
import {viewportSpan,SPAN_COORDINATES} from './page-geometry.mjs';
process.on('disconnect',()=>process.exit(0));
Object.assign(globalThis,{DOMMatrix,Path2D,ImageData});
const {getDocument,OPS,version}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const assets=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
process.send({type:'boot'});
// The controller installs the OS memory guard before untrusted input is opened.
while(true){
const request=await new Promise(resolve=>process.once('message',resolve));
let task,phase='native';
try{
 const bytes=await readFile(request.input);
 task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,disableFontFace:true,standardFontDataUrl:assets+'/standard_fonts/',cMapUrl:assets+'/cmaps/',cMapPacked:true,wasmUrl:assets+'/wasm/'});
 const doc=await task.promise;
 if(doc.numPages>request.maxPages)throw Error('page-limit-exceeded');
 process.send({type:'manifest',count:doc.numPages});
 if(request.page){
  const started=performance.now(),page=await doc.getPage(request.page),base=page.getViewport({scale:1});
  if(!Number.isFinite(base.width*base.height)||base.width*base.height>40000000||Math.min(base.width,base.height)<=0)throw Error('unsafe-page-size');
  const content=await page.getTextContent(),spans=[];let text='',lastY=null;
  for(const item of content.items){if(typeof item.str!=='string')continue;const [,y]=base.convertToViewportPoint(item.transform[4],item.transform[5]);
   if(lastY!==null&&Math.abs(y-lastY)>2)text+='\n';else if(text&&!text.endsWith('\n'))text+=' ';
   text+=item.str;if(item.hasEOL)text+='\n';lastY=y;spans.push(viewportSpan(item,base));
   if(text.length>300000||spans.length>100000)throw Error('page-content-capacity');
  }
  const bad=[...text].filter(c=>c==='\uFFFD'||(c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c))).length;
  const textQuality=text.length>80?Math.max(0,1-bad/Math.max(1,text.length)*10):0;
  const native={page:request.page,width:base.width,height:base.height,text,spans,spanCoordinates:SPAN_COORDINATES,textQuality,
   kind:'drawing',images:null,paths:null,geometry:{view:page.view,rotation:page.rotate,userUnit:page.userUnit},nativeEngine:{name:'pdfjs',version},nativeMs:Math.round(performance.now()-started)};
  // Capture source text/coordinates before operator decoding or native rendering.
  process.send({type:'native',value:native});phase='render';
  const operators=await page.getOperatorList();let images=0,paths=0;
  for(const op of operators.fnArray){if([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject].includes(op))images++;if([OPS.constructPath,OPS.stroke,OPS.fill,OPS.eoFill].includes(op))paths++;}
  Object.assign(native,{images,paths,kind:Math.max(base.width,base.height)>1200||paths>500?'drawing':textQuality<.9?'scan':'text'});
  process.send({type:'native',value:native});
  const region=request.region,maxEdge=request.crop?2000:native.kind==='text'?1400:2200;
  const scale=Math.min(3,maxEdge/Math.max(base.width*region.width,base.height*region.height));
  const viewport=page.getViewport({scale}),w=Math.ceil(viewport.width*region.width),h=Math.ceil(viewport.height*region.height);
  if(w*h>5000000)throw Error('render-pixel-capacity');
  const renderStarted=performance.now(),canvas=createCanvas(w,h);
  await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-region.x*viewport.width,-region.y*viewport.height],background:'white'}).promise;
  const image=canvas.toBuffer('image/png');canvas.width=1;
  if(image.length>24*1024*1024)throw Error('render-output-capacity');
  await writeFile(request.output,image,{flag:'wx',mode:0o600});
  process.send({type:'page',value:{...native,render:{width:w,height:h,scale,engine:'pdfjs',version,pixelTransform:{fullWidth:viewport.width,fullHeight:viewport.height,offsetX:region.x*viewport.width,offsetY:region.y*viewport.height}},renderMs:Math.round(performance.now()-renderStarted),parseMs:Math.round(performance.now()-started)}});
 }
}catch(error){
 const explicit=['page-limit-exceeded','unsafe-page-size','page-content-capacity','render-pixel-capacity','render-output-capacity'];
 process.send({type:'error',code:explicit.includes(error.message)?error.message:error.name==='InvalidPDFException'?'pdf-cannot-be-parsed':phase==='render'?'parser-render-failed':'parser-native-failed'});
}finally{await task?.destroy();}
process.send({type:'done'});
}
