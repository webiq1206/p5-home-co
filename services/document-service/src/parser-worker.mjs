import {parentPort,workerData} from 'node:worker_threads';
import {createCanvas,DOMMatrix,Path2D,ImageData} from '@napi-rs/canvas';
import {createRequire} from 'node:module';
import path from 'node:path';
import {viewportSpan,SPAN_COORDINATES} from './page-geometry.mjs';
// Rasterization is isolated from the HTTP server in a bounded worker thread.
Object.assign(globalThis,{DOMMatrix,Path2D,ImageData});
const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const assets=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const task=getDocument({data:new Uint8Array(workerData.bytes),isEvalSupported:false,useSystemFonts:true,disableFontFace:true,standardFontDataUrl:assets+'/standard_fonts/',cMapUrl:assets+'/cmaps/',cMapPacked:true,wasmUrl:assets+'/wasm/'});
try{
 const doc=await task.promise;if(doc.numPages>workerData.maxPages)throw Error('page-limit-exceeded');
 parentPort.postMessage({type:'manifest',count:doc.numPages});
 const indices=workerData.crop?[workerData.crop.page]:Array.from({length:doc.numPages},(_,i)=>i+1);
 for(const number of indices){
  if(!workerData.crop&&workerData.skipPages?.includes(number))continue;
  const started=performance.now(),page=await doc.getPage(number),base=page.getViewport({scale:1});
  if(base.width*base.height>40000000||Math.min(base.width,base.height)<=0)throw Error('unsafe-page-size');
  const content=await page.getTextContent();const spans=[];let lastY=null,text='';
  for(const item of content.items){if(typeof item.str!=='string')continue;const m=item.transform;const [,y]=base.convertToViewportPoint(m[4],m[5]);
   if(lastY!==null&&Math.abs(y-lastY)>2)text+='\n';else if(text&&!text.endsWith('\n'))text+=' ';
   text+=item.str;if(item.hasEOL)text+='\n';lastY=y;
   spans.push(viewportSpan(item,base));
  }
  if(text.length>300000||spans.length>100000)throw Error('page-content-capacity');
  const bad=[...text].filter(c=>c==='\uFFFD'||(c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c))).length;
  const textQuality=text.length>80?Math.max(0,1-bad/Math.max(1,text.length)*10):0;
  const operators=await page.getOperatorList();let images=0,paths=0;
  for(const op of operators.fnArray){if([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject].includes(op))images++;if([OPS.constructPath,OPS.stroke,OPS.fill,OPS.eoFill].includes(op))paths++;}
  const kind=Math.max(base.width,base.height)>1200||paths>500?'drawing':textQuality<.9?'scan':'text';
  const crop=workerData.crop;const region=crop?crop.region:{x:0,y:0,width:1,height:1};
  const maxEdge=crop?2000:kind==='text'?1400:2200;
  const scale=Math.min(3,maxEdge/Math.max(base.width*region.width,base.height*region.height));
  const nativeMs=Math.round(performance.now()-started),renderStarted=performance.now();
  const viewport=page.getViewport({scale});const w=Math.ceil(viewport.width*region.width),h=Math.ceil(viewport.height*region.height);
  const canvas=createCanvas(w,h);
  await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-region.x*viewport.width,-region.y*viewport.height],background:'white'}).promise;
  const image=canvas.toBuffer('image/png');canvas.width=1;
  parentPort.postMessage({type:'page',value:{page:number,width:base.width,height:base.height,text,spans,spanCoordinates:SPAN_COORDINATES,textQuality,kind,images,paths,render:{width:w,height:h,scale},image,nativeMs,renderMs:Math.round(performance.now()-renderStarted),parseMs:Math.round(performance.now()-started)}});
  // Backpressure avoids buffering a 100-page set in memory while storage is slow.
  await new Promise(resolve=>parentPort.once('message',resolve));page.cleanup();
 }
 parentPort.postMessage({type:'done'});
}catch(error){parentPort.postMessage({type:'error',code:String(error.message||'parse-failed')});}
finally{await task.destroy();}
