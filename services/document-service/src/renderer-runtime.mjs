import {spawn,fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ServiceError} from './core.mjs';
const helper=fileURLToPath(new URL('./pdfium-render.py',import.meta.url));
export const python=()=>process.env.DOCUMENT_PDFIUM_PYTHON||(process.platform==='win32'?'python':'python3');
export function engineEnv(){return Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));}
export function runPdfium(args,{timeoutMs=25000,signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new ServiceError('processing-cancelled',503));
  const child=spawn(python(),['-I','-B',helper,...args],{env:engineEnv(),windowsHide:true,stdio:['ignore','pipe','ignore']});
  let output='',failure;
  const stop=error=>{failure??=error;child.kill('SIGKILL');};
  const abort=()=>stop(new ServiceError('processing-cancelled',503));
  const timer=setTimeout(()=>stop(new ServiceError('renderer-timeout',503)),Math.max(1,timeoutMs));
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',data=>{output+=data;if(output.length>16384)stop(new ServiceError('renderer-output-capacity',503));});
  child.on('error',()=>{failure??=new ServiceError('renderer-runtime-unavailable',503);});
  child.on('close',code=>{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(failure)return reject(failure);
   try{const value=JSON.parse(output);if(['renderer-version-mismatch','renderer-notices-missing','source-integrity-failed','renderer-geometry-mismatch','unsafe-page-size','invalid-crop','source-capacity','render-pixel-capacity'].includes(value.error))return reject(new ServiceError(value.error,422));if(code!==0||value.error)throw Error();resolve(value);}
   catch{reject(new ServiceError('renderer-process-failed',503));}
  });
 });
}
export async function checkRendererRuntime(){
 const identity=await runPdfium(['--probe'],{timeoutMs:10000});
 if(identity.engine!=='pdfium'||identity.binding!=='5.3.0'||identity.version!=='145.0.7616.0')throw new ServiceError('renderer-version-mismatch',503);
 return identity;
}
/** No input is sent until the independent OS guard is installed. */
function primarySession(processFile=new URL('./parser-process.mjs',import.meta.url)){
  // Avoid V8's multi-GiB Wasm reservation conflicting with RLIMIT_AS. Wasm
  // keeps explicit bounds checks; this does not increase heap or render limits.
  const child=fork(processFile,[],{env:engineEnv(),execArgv:['--max-old-space-size=128','--disable-wasm-trap-handler'],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  let guard,failure,pending,boot=false,ready=false,closed=false,stopping=false,reap;
  let memory={};
  const reaped=new Promise(resolve=>reap=resolve);
  const stop=error=>{failure??=error;child.kill('SIGKILL');};
  const clean=()=>{if(pending){clearTimeout(pending.timer);pending.signal?.removeEventListener('abort',pending.abort);}};
  child.on('message',message=>{
   try{
    if(failure)return;
    if(message.type==='boot'){
     if(boot)throw Error();boot=true;
     guard=spawn(python(),['-I','-B',helper,'--guard',String(child.pid)],{env:engineEnv(),windowsHide:true,stdio:['pipe','pipe','ignore']});
     let buffer='';
     guard.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>65536)return stop(new ServiceError('parser-memory-guard-failed',503));
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
       try{const msg=JSON.parse(line);if(msg.ready&&!ready){ready=true;memory.limits=msg.limits;if(!failure&&pending)child.send(pending.request);}else if(msg.sample){for(const key of ['rssKiB','highWaterRssKiB','vmSizeKiB','vmPeakKiB'])if(Number.isFinite(msg.sample[key]))memory[key]=Math.max(memory[key]||0,msg.sample[key]);}else if(msg.limit)stop(new ServiceError('parser-memory-limit',503));else throw Error();}
       catch{stop(new ServiceError('parser-memory-guard-failed',503));}
      }
     });
     guard.on('error',()=>stop(new ServiceError('parser-memory-guard-failed',503)));
     guard.on('exit',code=>{if(!closed&&!stopping&&!failure)stop(new ServiceError(ready&&code===0?'parser-process-failed':'parser-memory-guard-failed',503));});
    }else if(!pending)throw Error();
    else if(message.type==='manifest')pending.count=message.count;
    else if(message.type==='native'){if(JSON.stringify(message.value).length>16*1024*1024)throw Error();pending.phase='render';pending.onNative(message.value);}
    else if(message.type==='page')pending.value=message.value;
    else if(message.type==='done'){clean();const completed=pending;pending=null;completed.resolve({count:completed.count,value:completed.value});}
    else if(message.type==='error')stop(new ServiceError(message.code,['page-limit-exceeded','unsafe-page-size','page-content-capacity','render-pixel-capacity','render-output-capacity','pdf-cannot-be-parsed'].includes(message.code)?422:503));
    else throw Error();
   }catch{stop(new ServiceError('parser-protocol-failed',503));}
  });
  child.on('error',()=>{failure??=new ServiceError('parser-process-failed',503);});
  child.on('close',async code=>{
   closed=true;
   clean();
   // Reap the limiter before releasing shared parser capacity.
   if(guard&&guard.exitCode===null&&guard.signalCode===null)await new Promise(r=>{guard.once('close',r);guard.kill('SIGKILL');});
   if(pending){const error=failure||new ServiceError('parser-process-failed',503);error.diagnostics={exitCode:code,signal:child.signalCode,phase:pending.phase,memory};pending.reject(error);pending=null;}
   reap();
  });
  return {
   get alive(){return !closed&&!failure&&!stopping;},
   run(request,{timeoutMs,signal,onNative=()=>{}}={}){
    return new Promise((resolve,reject)=>{
     if(signal?.aborted)return reject(new ServiceError('processing-cancelled',503));
     if(pending||closed||failure||stopping)return reject(failure||new ServiceError('parser-session-unavailable',503));
     const abort=()=>stop(new ServiceError('processing-cancelled',503));
     pending={request,signal,onNative,resolve,reject,abort,phase:'native',timer:setTimeout(()=>stop(new ServiceError('parser-attempt-timeout',503)),Math.max(1,timeoutMs))};
     signal?.addEventListener('abort',abort,{once:true});if(ready)child.send(request);
    });
   },
   async close(){stopping=true;if(!closed)child.kill('SIGKILL');await reaped;},
  };
}
export async function runPrimary(request,options={}){
 const session=primarySession(options.processFile);
 try{return await session.run(request,options);}finally{await session.close();}
}
/** Reuse only engine initialization, never PDF documents or page caches. */
export function createPrimaryPool({processFile}={}){
 let session,uses=0;
 return {
  async run(request,options){
   if(!session?.alive||uses>=8){await session?.close();session=primarySession(processFile);uses=0;}
   uses++;return session.run(request,options);
  },
  async close(){await session?.close();},
 };
}
