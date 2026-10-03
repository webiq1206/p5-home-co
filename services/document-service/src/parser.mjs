import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ServiceError,hash} from './core.mjs';
import {SPAN_COORDINATES} from './page-geometry.mjs';
import {runPrimary,runPdfium} from './renderer-runtime.mjs';
const FULL={x:0,y:0,width:1,height:1};
const fallbackErrors=new Set(['parser-render-failed','parser-process-failed','parser-memory-limit','parser-attempt-timeout']);
function regionOf(crop){
 const r=crop?.region||FULL;
 if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||Math.min(r.x,r.y)<0||Math.min(r.width,r.height)<=0||r.x+r.width>1+1e-9||r.y+r.height>1+1e-9)throw new ServiceError('invalid-crop',422);
 return {x:r.x,y:r.y,width:r.width,height:r.height};
}
function validNative(native,page){
 return native?.page===page&&native.spanCoordinates===SPAN_COORDINATES&&typeof native.text==='string'&&native.text.length<=300000&&Array.isArray(native.spans)&&native.spans.length<=100000&&
  [native.width,native.height].every(n=>Number.isFinite(n)&&n>0)&&native.width*native.height<=40000000&&native.geometry?.view?.length===4&&native.geometry.view.every(Number.isFinite)&&[0,90,180,270].includes(native.geometry.rotation)&&native.geometry.userUnit===1;
}
async function readImage(filename,render){
 const info=await stat(filename);if(info.size>24*1024*1024)throw new ServiceError('render-output-capacity',503);
 const image=await readFile(filename);
 if(image.length<24||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||image.readUInt32BE(16)!==render.width||image.readUInt32BE(20)!==render.height||render.width*render.height>5000000||Math.min(render.width,render.height)<=0)throw new ServiceError('render-output-invalid',503);
 return image;
}
/** Factory is also the deterministic fault-injection seam; no production env bypass. */
export function createParser({primary=runPrimary,alternate=runPdfium}={}){
 return async function parse(bytes,{maxPages=250,timeoutMs=60000,signal,onManifest=()=>{},onPage=()=>{},crop,skipPages=[]}={}){
  bytes=Buffer.from(bytes);
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new ServiceError('not-a-pdf');
  if(bytes.length>250*1024*1024)throw new ServiceError('source-capacity',422);
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>250||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new ServiceError('invalid-parser-limits',422);
  const region=regionOf(crop),started=Date.now(),sourceSha256=hash(bytes);
  const remaining=()=>{if(signal?.aborted)throw new ServiceError('processing-cancelled',503);const left=timeoutMs-(Date.now()-started);if(left<=0)throw new ServiceError('parse-timeout',503);return left;};
  remaining();
  const prefix=path.join(tmpdir(),'p5-parser-'),directory=await mkdtemp(prefix),input=path.join(directory,'original.pdf');
  try{
   await writeFile(input,bytes,{flag:'wx',mode:0o600});
   const {count}=await primary({input,maxPages},{timeoutMs:Math.min(15000,remaining()),signal});
   if(!Number.isInteger(count)||count<1||count>maxPages)throw new ServiceError('parser-manifest-invalid',503);
   await onManifest(count);remaining();
   if(crop&&(!Number.isInteger(crop.page)||crop.page<1||crop.page>count))throw new ServiceError('invalid-crop-page',422);
   const indices=crop?[crop.page]:Array.from({length:count},(_,i)=>i+1).filter(n=>!skipPages.includes(n));
   for(const page of indices){
    let native,result;const pageStarted=Date.now(),output=path.join(directory,`primary-${page}.png`);
    try{
     const attempt=await primary({input,output,maxPages,page,region,crop:Boolean(crop)},{timeoutMs:Math.min(15000,remaining()),signal,onNative:value=>{native=value;}});
     if(attempt.count!==count||!attempt.value)throw new ServiceError('parser-protocol-failed',503);
     result=attempt.value;result.image=await readImage(output,result.render);
    }catch(error){
     if(!fallbackErrors.has(error.code)||!validNative(native,page))throw error;
     const alternateOutput=path.join(directory,`pdfium-${page}.png`),requestFile=path.join(directory,`request-${page}.json`);
     const scale=Math.min(3,(crop?2000:2200)/Math.max(native.width*region.width,native.height*region.height));
     await writeFile(requestFile,JSON.stringify({input,output:alternateOutput,sourceSha256,page,width:native.width,height:native.height,
      view:native.geometry.view,rotation:native.geometry.rotation,region,scale}),{flag:'wx',mode:0o600});
     const renderStarted=Date.now(),render=await alternate([requestFile],{timeoutMs:Math.min(25000,remaining()),signal});
     if(render.engine!=='pdfium'||render.binding!=='5.3.0'||render.version!=='145.0.7616.0'||render.sourceSha256!==sourceSha256||render.page!==page||JSON.stringify(render.region)!==JSON.stringify(region)||render.scale!==scale||render.rotation!==native.geometry.rotation||render.view.length!==4||render.view.some((v,i)=>Math.abs(v-native.geometry.view[i])>.01))throw new ServiceError('renderer-provenance-mismatch',503);
     result={...native,render:{...render,fallbackReason:error.code},image:await readImage(alternateOutput,render),renderMs:Date.now()-renderStarted,parseMs:Date.now()-pageStarted};
    }
    remaining();result.sourceSha256=sourceSha256;
    result.render={...result.render,sourceSha256,page,region,geometry:result.geometry};
    // Do not reject while an already-started durable transaction is settling.
    await onPage(result);
   }
   remaining();
  }finally{
   const resolved=path.resolve(directory);if(resolved.startsWith(path.resolve(prefix))&&path.dirname(resolved)===path.resolve(tmpdir()))await rm(resolved,{recursive:true,force:true});
  }
 };
}
/** Share parser capacity between document preparation AND verification crops. */
export function limitParser(parser,limit=1){
 let active=0;const waiting=[];
 const pump=()=>{while(active<limit&&waiting.length){const item=waiting.shift();item.signal?.removeEventListener('abort',item.abort);if(item.signal?.aborted){item.reject(new ServiceError('processing-cancelled',503));continue;}active++;Promise.resolve().then(()=>parser(item.bytes,item.options)).then(item.resolve,item.reject).finally(()=>{active--;pump();});}};
 return (bytes,options={})=>new Promise((resolve,reject)=>{const item={bytes,options,signal:options.signal,resolve,reject,abort:null};item.abort=()=>{const index=waiting.indexOf(item);if(index>=0){waiting.splice(index,1);reject(new ServiceError('processing-cancelled',503));}};if(item.signal?.aborted){reject(new ServiceError('processing-cancelled',503));return;}waiting.push(item);item.signal?.addEventListener('abort',item.abort,{once:true});pump();});
}
export const parsePdf=limitParser(createParser(),1);
