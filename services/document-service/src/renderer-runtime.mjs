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
export function runPrimary(request,{timeoutMs,signal,onNative=()=>{},processFile=new URL('./parser-process.mjs',import.meta.url)}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new ServiceError('processing-cancelled',503));
  const child=fork(processFile,[],{env:engineEnv(),execArgv:['--max-old-space-size=128'],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  let guard,failure,done=false,value,count,boot=false,closed=false;
  const stop=error=>{failure??=error;child.kill('SIGKILL');};
  const abort=()=>stop(new ServiceError('processing-cancelled',503));
  const timer=setTimeout(()=>stop(new ServiceError('parser-attempt-timeout',503)),Math.max(1,timeoutMs));
  signal?.addEventListener('abort',abort,{once:true});
  child.on('message',message=>{
   try{
    if(failure)return;
    if(message.type==='boot'){
     if(boot)throw Error();boot=true;
     guard=spawn(python(),['-I','-B',helper,'--guard',String(child.pid)],{env:engineEnv(),windowsHide:true,stdio:['pipe','pipe','ignore']});
     let buffer='',ready=false;
     guard.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>1024)return stop(new ServiceError('parser-memory-guard-failed',503));
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
       try{const msg=JSON.parse(line);if(msg.ready&&!ready){ready=true;if(!failure)child.send(request);}else if(msg.limit)stop(new ServiceError('parser-memory-limit',503));else throw Error();}
       catch{stop(new ServiceError('parser-memory-guard-failed',503));}
      }
     });
     guard.on('error',()=>stop(new ServiceError('parser-memory-guard-failed',503)));
     guard.on('exit',code=>{if(!closed&&!done&&!failure)stop(new ServiceError(ready&&code===0?'parser-process-failed':'parser-memory-guard-failed',503));});
    }else if(message.type==='manifest')count=message.count;
    else if(message.type==='native'){if(JSON.stringify(message.value).length>16*1024*1024)throw Error();onNative(message.value);}
    else if(message.type==='page')value=message.value;
    else if(message.type==='done')done=true;
    else if(message.type==='error')stop(new ServiceError(message.code,['page-limit-exceeded','unsafe-page-size','page-content-capacity','render-pixel-capacity','render-output-capacity','pdf-cannot-be-parsed'].includes(message.code)?422:503));
    else throw Error();
   }catch{stop(new ServiceError('parser-protocol-failed',503));}
  });
  child.on('error',()=>{failure??=new ServiceError('parser-process-failed',503);});
  child.on('close',async code=>{
   closed=true;
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   // Reap the limiter before releasing shared parser capacity.
   if(guard&&guard.exitCode===null&&guard.signalCode===null)await new Promise(r=>{guard.once('close',r);guard.kill('SIGKILL');});
   if(failure)return reject(failure);
   if(code!==0||!done)return reject(new ServiceError('parser-process-failed',503));
   resolve({count,value});
  });
 });
}
