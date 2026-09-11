import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import sharp from 'sharp';
import type {AnalysisFile} from './extraction';
async function convertHeic(bytes:Buffer):Promise<Buffer[]>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const convert=require(workerData.modulePath);(async()=>{const images=await convert.all({buffer:Buffer.from(workerData.bytes),format:'JPEG',quality:.96});if(images.length>50)throw Error('This image collection contains more than 50 images.');const output=[];for(const image of images)output.push(await image.convert());parentPort.postMessage(output);})().catch(error=>{throw error;});`,{eval:true,workerData:{bytes,modulePath:join(process.cwd(),"node_modules/heic-convert")},resourceLimits:{maxOldGenerationSizeMb:384}});
    const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('This image took too long to decode. Export a JPEG copy.'));},60000);
    worker.once('message',data=>{clearTimeout(timeout);resolve(data.map((b:Uint8Array)=>Buffer.from(b)));void worker.terminate();});
    worker.once('error',error=>{clearTimeout(timeout);reject(error);});
    worker.once('exit',code=>{clearTimeout(timeout);if(code)reject(new Error('This image could not be decoded. Export a JPEG copy.'));});
  });
}
/** Preserve originals in storage; prepare oriented, bounded images for document vision. */
export async function prepareImages(file:AnalysisFile):Promise<AnalysisFile[]>{
  const sources=['image/heic','image/heif'].includes(file.type)?await convertHeic(file.data):[file.data];
  const output:AnalysisFile[]=[];
  for(const [index,data]of sources.entries()){
    const metadata=await sharp(data,{limitInputPixels:100000000}).metadata();
    const pages=metadata.pages||1;if(pages>100)throw new Error('This image document exceeds 100 pages. Export it as PDF.');
    // Animated photos are represented by their first frame; each TIFF page is a document page.
    const count=file.type==='image/tiff'?pages:1;
    for(let page=0;page<count;page++){
      const prepared=await sharp(data,{page,limitInputPixels:100000000}).rotate().resize({width:4000,height:4000,fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer();
      output.push({name:sources.length>1||count>1?`${file.name} (image ${index+1}, page ${page+1})`:file.name,type:'image/jpeg',data:prepared});
    }
  }
  return output;
}
