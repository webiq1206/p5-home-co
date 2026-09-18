import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {cohostConfig,makeGateway,PREFIX} from '../src/cohost.mjs';
import {limitParser} from '../src/parser.mjs';
import {signedHeaders,verifyHeaders,hash} from '../src/core.mjs';
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const close=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
test('P5 opt-in reuses only its own key and host; legacy and external hosts are not auto-enabled',()=>{
 const p5Key='synthetic-p5-tenant-secret-123456789',otherKey='synthetic-other-tenant-secret-123456789';
 const env={P5_DOCUMENT_HOST_ENABLED:'true',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':p5Key,'boiseconstruction.co':otherKey})};
 const legacy=cohostConfig(env);assert.equal(legacy.webEnv.P5_DOCUMENT_SERVICE_MODE,undefined);assert.equal(legacy.webEnv.P5_DOCUMENT_SERVICE_KEY,undefined);
 const active=cohostConfig({...env,P5_DOCUMENT_SERVICE_MODE:'remote'});
 assert.equal(active.webEnv.P5_DOCUMENT_SERVICE_KEY,p5Key);
 assert.equal(active.webEnv.P5_DOCUMENT_SERVICE_URL,'https://p5homeco.com/api/p5-documents');
 assert.equal(env.P5_DOCUMENT_SERVICE_KEY,undefined,'the caller environment is not mutated');
 const external=cohostConfig({...env,P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_URL:'https://other.example/api/p5-documents'});
 assert.equal(external.webEnv.P5_DOCUMENT_SERVICE_KEY,undefined,'a tenant key cannot leak to an external URL');
 const explicit=cohostConfig({...env,P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_KEY:'explicit-key'});
 assert.equal(explicit.webEnv.P5_DOCUMENT_SERVICE_KEY,'explicit-key');
 const disabled=cohostConfig({...env,P5_DOCUMENT_HOST_ENABLED:'false',P5_DOCUMENT_SERVICE_MODE:'remote'});
 assert.equal(disabled.webEnv,undefined);
});
test('cohosting reuses the existing database with conservative limits and is opt-in',()=>{
 assert.equal(cohostConfig({DOCUMENT_PARSER_SLOTS:'99'}).enabled,false);
 const c=cohostConfig({P5_DOCUMENT_HOST_ENABLED:'true',DATABASE_URL:'postgres://existing'});
 assert.equal(c.workerEnv.DOCUMENT_DATABASE_URL,'postgres://existing');assert.equal(c.workerEnv.DOCUMENT_PARSER_SLOTS,'1');assert.equal(c.workerEnv.DOCUMENT_DATABASE_POOL_MAX,'4');assert.equal(c.workerEnv.DOCUMENT_BIND_HOST,'127.0.0.1');assert.equal(c.workerEnv.DOCUMENT_MODEL,undefined);
 assert.equal(c.workerEnv.DOCUMENT_UPLOAD_SLOTS,'1');assert.equal(c.rssLimitMb,640);
 assert.throws(()=>cohostConfig({P5_DOCUMENT_HOST_ENABLED:'true',DOCUMENT_PARSER_SLOTS:'2'}));
 assert.throws(()=>cohostConfig({P5_DOCUMENT_HOST_ENABLED:'true',PORT:'3081'}));
});
test('gateway preserves website cookies and signed upload bytes; failed worker leaves website available',async()=>{
 const key='synthetic-cohost-key-'.repeat(3),tenant='p5homeco.com',raw=Buffer.from('%PDF-1.7\nunchanged original bytes\x00\xff','latin1');let available=true;
 const web=createServer((req,res)=>{res.setHeader('set-cookie',['first=1; HttpOnly','second=2; HttpOnly']);res.end('website '+req.url);});
 const worker=createServer(async(req,res)=>{try{const auth=verifyHeaders({[tenant]:key},req.method,req.url,req.headers);const chunks=[];for await(const c of req)chunks.push(c);assert.equal(hash(Buffer.concat(chunks)),auth.digest);assert.deepEqual(Buffer.concat(chunks),raw);res.end('authenticated original');}catch{res.writeHead(401);res.end('unauthorized');}});
 const webPort=await listen(web),workerPort=await listen(worker),gateway=makeGateway({webPort,workerPort,workerAvailable:()=>available}),port=await listen(gateway),base=`http://127.0.0.1:${port}`;
 try{
  const website=await fetch(base+'/quote?service=remodel');assert.equal(await website.text(),'website /quote?service=remodel');assert.equal(website.headers.getSetCookie().length,2);
  const p='/v1/projects/qa/documents?name=QA%20plan.pdf';const response=await fetch(base+PREFIX+p,{method:'POST',headers:signedHeaders(key,'POST',p,tenant,raw),body:raw});assert.equal(response.status,200);assert.equal(await response.text(),'authenticated original');assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+PREFIX+p)).status,401);
  available=false;assert.equal((await fetch(base+PREFIX+'/readyz')).status,503);assert.equal((await fetch(base+'/')).status,200);
 }finally{await Promise.all([gateway,web,worker].map(close));}
});
test('native document and crop parsing share a single slot; cancelled queued work never starts',async()=>{
 let active=0,peak=0,calls=0;let release;const first=new Promise(r=>release=r);
 const parser=limitParser(async(_bytes,{hold})=>{calls++;active++;peak=Math.max(peak,active);if(hold)await first;active--;},1);
 const a=parser(Buffer.alloc(0),{hold:true});const controller=new AbortController();const b=parser(Buffer.alloc(0),{signal:controller.signal});const rejected=assert.rejects(b,/processing-cancelled/);controller.abort();const c=parser(Buffer.alloc(0),{});release();await Promise.all([a,rejected,c]);assert.equal(peak,1);assert.equal(calls,2);
});

test('supervisor bounds restarts and keeps website alive after worker memory failures',async()=>{
 const {EventEmitter}=await import('node:events');const {runHost}=await import('../src/cohost.mjs');
 const probe=createServer();const port=await listen(probe);await close(probe);
 const children=[],events=[];
 const spawnProcess=()=>{const child=new EventEmitter();child.pid=99999999;child.exitCode=null;child.signalCode=null;child.kill=signal=>{if(child.signalCode)return;child.signalCode=signal;queueMicrotask(()=>{child.emit('exit',null,signal);child.emit('close',null,signal);});};children.push(child);queueMicrotask(()=>child.emit('spawn'));return child;};
 const host=await runHost({P5_DOCUMENT_HOST_ENABLED:'true',PORT:String(port),DATABASE_URL:'postgres://test',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({test:'synthetic-key-for-test-only-123456789'}),DOCUMENT_MODEL:'no-provider-calls',ANTHROPIC_API_KEY:'synthetic'},{spawnProcess,readRss:async()=>999,log:e=>events.push(e),monitorMs:5,restartDelayMs:5});
 try{
  for(let i=0;i<100&&!events.some(e=>e.code==='restart-budget-exhausted');i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(children.length,4,'one website and at most three worker starts');assert.equal(children[0].signalCode,null,'website survives worker failure');
  assert.ok(events.some(e=>e.code==='restart-budget-exhausted'));
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/p5-documents/readyz`)).status,503);
 }finally{await host.close();}
 assert.equal(children[0].signalCode,'SIGTERM');
});
