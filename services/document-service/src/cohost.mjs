import {createServer,request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setPriority} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readConfig} from './core.mjs';
export const PREFIX='/api/p5-documents';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const integer=(env,key,fallback,min,max)=>{const n=Number(env[key]||fallback);if(!Number.isInteger(n)||n<min||n>max)throw Error('invalid-'+key);return n;};
export function cohostConfig(env=process.env){
 const enabled=env.P5_DOCUMENT_HOST_ENABLED==='true';
 const port=integer(env,'PORT',3000,1,65535);
 if(!enabled)return {enabled,port};
 const webPort=integer(env,'P5_DOCUMENT_WEB_PORT',3081,1,65535),workerPort=integer(env,'P5_DOCUMENT_WORKER_PORT',3082,1,65535);
 if(new Set([port,webPort,workerPort]).size!==3)throw Error('cohost-ports-must-differ');
 const workerEnv={...env,PORT:String(workerPort),DOCUMENT_BIND_HOST:'127.0.0.1',DOCUMENT_DATABASE_URL:env.DOCUMENT_DATABASE_URL||env.DATABASE_URL,
  DOCUMENT_PARSER_SLOTS:String(integer(env,'DOCUMENT_PARSER_SLOTS',1,1,1)),
  DOCUMENT_PROVIDER_SLOTS:String(integer(env,'DOCUMENT_PROVIDER_SLOTS',2,1,4)),
  DOCUMENT_DATABASE_POOL_MAX:String(integer(env,'DOCUMENT_DATABASE_POOL_MAX',4,2,6)),
  DOCUMENT_UPLOAD_SLOTS:'1',DOCUMENT_REQUESTS_PER_MINUTE:env.DOCUMENT_REQUESTS_PER_MINUTE||'30',DOCUMENT_TOKENS_PER_MINUTE:env.DOCUMENT_TOKENS_PER_MINUTE||'120000',
  DOCUMENT_TENANT_MAX_QUEUED:env.DOCUMENT_TENANT_MAX_QUEUED||'5',DOCUMENT_TENANT_STORAGE_BYTES:env.DOCUMENT_TENANT_STORAGE_BYTES||'268435456',DOCUMENT_RETENTION_DAYS:env.DOCUMENT_RETENTION_DAYS||'7'};
 // An explicit document model is still required. Never silently choose a new
 // model, paid gateway, or larger provider budget for the existing website.
 const webEnv={...env};
 if(env.P5_DOCUMENT_SERVICE_MODE==='remote'){
  const localPublicUrl='https://p5homeco.com'+PREFIX;
  webEnv.P5_DOCUMENT_SERVICE_URL=env.P5_DOCUMENT_SERVICE_URL||localPublicUrl;
  // Reuse only P5's own server-side tenant key and only for its own host.
  // An explicit external URL must supply its own explicit service key.
  if(!env.P5_DOCUMENT_SERVICE_KEY&&webEnv.P5_DOCUMENT_SERVICE_URL.replace(/\/$/,'')===localPublicUrl){
   try{
    const key=JSON.parse(env.P5_DOCUMENT_TENANTS_JSON||'{}')['p5homeco.com'];
    if(typeof key==='string'&&key.length>=32)webEnv.P5_DOCUMENT_SERVICE_KEY=key;
   }catch{/* The worker and website report their existing configuration errors. */}
  }
 }
 return {enabled,port,webPort,workerPort,workerEnv,webEnv,rssLimitMb:integer(env,'P5_DOCUMENT_WORKER_RSS_MB',640,256,768)};
}
function unavailable(res){if(!res.headersSent){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store','retry-after':'5'});res.end('{"error":"document-host-unavailable","retryAfterMs":5000}');}else res.destroy();}
export function makeGateway({webPort,workerPort,workerAvailable=()=>true}){
 const server=createServer((req,res)=>{
  const documentRequest=req.url===PREFIX||req.url.startsWith(PREFIX+'/')||req.url.startsWith(PREFIX+'?');
  if(documentRequest&&!workerAvailable()){unavailable(res);return;}
  // Preserve raw bytes, query encoding, HMAC headers and streaming responses.
  // This gateway does not parse uploads, log URLs, authenticate customers, or
  // share source data. The worker checks every signed request itself.
  const headers={...req.headers};delete headers.connection;delete headers['proxy-connection'];delete headers['keep-alive'];delete headers.upgrade;
  const upstream=httpRequest({hostname:'127.0.0.1',port:documentRequest?workerPort:webPort,path:documentRequest?req.url.slice(PREFIX.length)||'/':req.url,method:req.method,headers},response=>{
   const responseHeaders={...response.headers};delete responseHeaders.connection;delete responseHeaders['keep-alive'];
   if(documentRequest){responseHeaders['cache-control']='no-store';responseHeaders['x-robots-tag']='noindex, nofollow';}
   res.writeHead(response.statusCode||502,responseHeaders);response.pipe(res);
   response.on('error',()=>res.destroy());
  });
  upstream.on('error',()=>unavailable(res));upstream.setTimeout(documentRequest?95000:300000,()=>upstream.destroy());
  req.on('aborted',()=>upstream.destroy());req.on('error',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
 });
 server.headersTimeout=15000;server.requestTimeout=95000;server.keepAliveTimeout=5000;
 return server;
}
export async function workerRssMb(pid){const status=await readFile(`/proc/${pid}/status`,'utf8');const match=status.match(/^VmRSS:\s+(\d+)\s+kB/m);if(!match)throw Error('rss-unavailable');return Number(match[1])/1024;}
export async function runHost(env=process.env,{spawnProcess=spawn,readRss=workerRssMb,log=event=>console.log(JSON.stringify(event)),monitorMs=2000,restartDelayMs=10000}={}){
 let config;try{config=cohostConfig(env);}catch{log({event:'document-host',code:'invalid-cohost-configuration-worker-disabled'});config=cohostConfig({...env,P5_DOCUMENT_HOST_ENABLED:'false'});}
 let closing=false,worker=null,workerOnline=false,restartTimer=null,watch=null,workerStarts=0,windowStart=Date.now();
 const web=spawnProcess(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start','-H',config.enabled?'127.0.0.1':'0.0.0.0','-p',String(config.enabled?config.webPort:config.port)],{cwd:root,env:config.webEnv||env,stdio:'inherit'});
 const children=new Set([web]);let gateway;
 const onExit=child=>new Promise(resolve=>child.exitCode!==null||child.signalCode!==null?resolve():child.once('close',resolve));
 async function close(){if(closing)return;closing=true;clearTimeout(restartTimer);clearInterval(watch);gateway?.close();const active=[...children];for(const child of active)child.kill('SIGTERM');const forced=setTimeout(()=>{for(const child of active)child.kill('SIGKILL');gateway?.closeAllConnections();},35000);forced.unref();await Promise.all(active.map(onExit));clearTimeout(forced);gateway?.closeAllConnections();}
 web.once('error',()=>{log({event:'cohost',code:'website-start-failed'});void close();process.exitCode=1;});
 web.once('exit',()=>{children.delete(web);if(!closing){process.exitCode=1;void close();}});
 if(config.enabled){
  gateway=makeGateway({...config,workerAvailable:()=>workerOnline});await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(config.port,'0.0.0.0',resolve);}).catch(async error=>{await close();throw error;});
  const startWorker=()=>{
   if(closing)return;
   try{readConfig(config.workerEnv);}catch(error){log({event:'document-host',code:error.code||'invalid-worker-configuration'});return;}
   if(Date.now()-windowStart>600000){workerStarts=0;windowStart=Date.now();}
   if(workerStarts>=3){log({event:'document-host',code:'restart-budget-exhausted'});return;}
   workerStarts++;
   const child=spawnProcess(process.execPath,['--max-old-space-size=256',fileURLToPath(new URL('./main.mjs',import.meta.url))],{cwd:root,env:config.workerEnv,stdio:'inherit'});worker=child;children.add(child);
   child.once('spawn',()=>{try{setPriority(child.pid,10);}catch{log({event:'document-host',code:'priority-unavailable'});}workerOnline=true;});
   child.once('error',()=>{workerOnline=false;log({event:'document-host',code:'worker-start-failed'});});
   child.once('close',()=>{children.delete(child);if(worker===child){worker=null;workerOnline=false;}if(!closing)restartTimer=setTimeout(startWorker,restartDelayMs);});
  };
  startWorker();let checking=false;
  watch=setInterval(async()=>{if(checking||!worker||!workerOnline)return;checking=true;const child=worker;try{if(await readRss(child.pid)>config.rssLimitMb){workerOnline=false;log({event:'document-host',code:'memory-limit-stop'});child.kill('SIGKILL');}}catch{if(worker===child&&workerOnline){workerOnline=false;log({event:'document-host',code:'memory-monitor-unavailable'});child.kill('SIGKILL');}}finally{checking=false;}},monitorMs);
 }
 const stop=()=>void close();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 log({event:'p5-host-start',documentsEnabled:config.enabled,port:config.port});
 return {config,web,gateway,close:async()=>{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runHost().catch(()=>{console.error(JSON.stringify({event:'p5-host',code:'startup-failed'}));process.exitCode=1;});
