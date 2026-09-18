import {Worker} from 'node:worker_threads';
import {ServiceError} from './core.mjs';
export async function parsePdf(bytes,{maxPages=200,timeoutMs=60000,signal,onManifest=()=>{},onPage=()=>{},crop,skipPages=[]}={}){
 if(!Buffer.from(bytes).subarray(0,1024).includes(Buffer.from('%PDF-')))throw new ServiceError('not-a-pdf');
 return new Promise((resolve,reject)=>{
  let ended=false,callbacks=Promise.resolve();const worker=new Worker(new URL('./parser-worker.mjs',import.meta.url),{workerData:{bytes,maxPages,crop,skipPages},resourceLimits:{maxOldGenerationSizeMb:512}});
  const finish=(error)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve();};
  const abort=()=>finish(new ServiceError('processing-cancelled',503));const timer=setTimeout(()=>finish(new ServiceError('parse-timeout',503)),timeoutMs);
  if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
  worker.on('error',()=>finish(new ServiceError('parser-worker-failed',503)));
  worker.on('exit',code=>{void callbacks.then(()=>{if(!ended)finish(new ServiceError('parser-exited-'+code,503));});});
  // A slow manifest write must finish before the first page checkpoint. The
  // worker waits for each page acknowledgment, so this queue stays bounded.
  worker.on('message',m=>{
   callbacks=callbacks.then(async()=>{
    if(ended)return;
    if(m.type==='manifest')await onManifest(m.count);
    if(m.type==='page'){m.value.image=Buffer.from(m.value.image);await onPage(m.value);if(!ended)worker.postMessage('ack');}
    if(m.type==='done')finish();
    if(m.type==='error')finish(new ServiceError(m.code==='page-limit-exceeded'?m.code:'pdf-cannot-be-parsed',422));
   }).catch(finish);
  });
 });
}

/** Share parser capacity between document preparation AND verification crops. */
export function limitParser(parser,limit=1){
 let active=0;const waiting=[];
 const pump=()=>{while(active<limit&&waiting.length){const item=waiting.shift();item.signal?.removeEventListener('abort',item.abort);if(item.signal?.aborted){item.reject(new ServiceError('processing-cancelled',503));continue;}active++;Promise.resolve().then(()=>parser(item.bytes,item.options)).then(item.resolve,item.reject).finally(()=>{active--;pump();});}};
 return (bytes,options={})=>new Promise((resolve,reject)=>{const item={bytes,options,signal:options.signal,resolve,reject,abort:null};item.abort=()=>{const index=waiting.indexOf(item);if(index>=0){waiting.splice(index,1);reject(new ServiceError('processing-cancelled',503));}};if(item.signal?.aborted){reject(new ServiceError('processing-cancelled',503));return;}waiting.push(item);item.signal?.addEventListener('abort',item.abort,{once:true});pump();});
}
