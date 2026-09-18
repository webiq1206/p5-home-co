import {randomBytes} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {makeServer} from '../src/server.mjs';
import {parsePdf} from '../src/parser.mjs';
import {signedHeaders,jobId,ServiceError,hash,VERSION} from '../src/core.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const available=Boolean(process.env.DOCUMENT_TEST_DATABASE_URL);
const tenant='boiseconstruction.co',other='boiseremodeling.co',secret='test-only-not-a-production-secret-'.repeat(2);
const config={tenants:{[tenant]:secret,[other]:secret},slots:2,parserSlots:1,rpm:100,tpm:1000000,callMs:10000,parseMs:60000,jobMs:120000,maxPages:200,maxBytes:10*1024*1024,maxTenantBytes:100*1024*1024,maxQueue:30,retentionDays:1};
let pool,store,server,url,stop;let parseRuns=0,readCalls=0,reviewCalls=0;
function fakePage(page){return {page:page.page,sheet:'A'+page.page,revision:'',status:'read',notes:[],facts:[{field:'sqft',value:String(100+page.page),evidence:`Room ${100+page.page} SF`,basis:'stated'}],items:[],inclusions:[],exclusions:[],responsibilities:[],regions:[]};}
const fakeReader={call:async(job,system,input)=>{
 if(job.kind==='review'){reviewCalls++;return {summary:'Controlled test scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:[],takeoffs:[]};}
 readCalls++;return {pages:input.pages.map(fakePage)};
}};
async function fixture(count,large=false){const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);for(let i=1;i<=count;i++){const p=doc.addPage(large?[1728,2592]:[612,792]);p.drawText(`SHEET A${i} - UNIQUE FIXTURE ${i}\nRoom ${100+i} SF\nGarage ${40+i} SF\nAppliance purchases excluded.\nUnselected products use disclosed allowances.`,{x:40,y:(large?2500:740),font,size:12,lineHeight:18});}return Buffer.from(await doc.save());}
async function request(method,path,body=Buffer.alloc(0),who=tenant,headers={}){return fetch(url+path,{method,headers:{...signedHeaders(secret,method,path,who,body),...headers},...(method==='POST'?{body}: {})});}
async function until(fn,limit=30000){const until=Date.now()+limit;while(Date.now()<until){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Test did not reach terminal state');}
before(async()=>{if(!available)return;pool=new pg.Pool({connectionString:process.env.DOCUMENT_TEST_DATABASE_URL,max:8});store=new Store(pool,config);await store.init();await pool.query('TRUNCATE p5ds_documents,p5ds_jobs,p5ds_pages,p5ds_nonces,p5ds_metrics,p5ds_provider_leases,p5ds_capacity RESTART IDENTITY CASCADE');const parser=async(...args)=>{parseRuns++;return parsePdf(...args);};const pipeline=new Pipeline(store,fakeReader,config,parser);stop=pipeline.start();server=makeServer(store,pipeline,config);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{if(!available)return;await new Promise(r=>server.close(r));await stop();await pool.end();});
test('live database + HTTP + real PDF parser reaches complete source and review without browser polling driving work',{skip:!available},async()=>{
 const bytes=await fixture(4);const path='/v1/projects/api-qa/documents?name=scope.pdf';const response=await request('POST',path,bytes,tenant,{'content-type':'application/pdf'});assert.equal(response.status,202);const receipt=await response.json();
 const review=await (await request('POST','/v1/projects/api-qa/reviews',Buffer.from(JSON.stringify({documents:[{id:receipt.id,source:'scope.pdf'}],text:'Estimate this project',answers:{service:'new-construction'}})))).json();
 // The worker, not the GET, advances the document. Direct DB waits only observe.
 await until(async()=>{const d=await store.document(tenant,'api-qa',receipt.id);return d.state==='complete';});
 const data=await (await request('GET','/v1/projects/api-qa/documents/'+receipt.id)).json();assert.equal(data.coverage.complete,true);assert.equal(data.coverage.pages.length,4);assert.equal(readCalls,1);
 await until(async()=>{const j=await store.job(tenant,'api-qa',review.id);return j.state==='complete';});assert.equal(reviewCalls,1);
 const result=await (await request('GET','/v1/projects/api-qa/reviews/'+review.id)).json();assert.equal(result.result.pages.length,4);assert.equal(result.result.pages[0].source,'scope.pdf');
 const parsed=parseRuns,reads=readCalls;
 const duplicate=await (await request('POST',path,bytes,tenant,{'content-type':'application/pdf'})).json();assert.equal(duplicate.cached,true);assert.equal(duplicate.id,receipt.id);
 const changed=await (await request('POST','/v1/projects/api-qa/reviews',Buffer.from(JSON.stringify({documents:[{id:receipt.id,source:'scope.pdf'}],text:'Only the garage',answers:{service:'new-construction',garageIncluded:'yes'}})))).json();
 await until(async()=> (await store.job(tenant,'api-qa',changed.id)).state==='complete');assert.equal(parseRuns,parsed);assert.equal(readCalls,reads);assert.notEqual(changed.id,review.id);
 const crossTenant=await request('GET','/v1/projects/api-qa/documents/'+receipt.id,Buffer.alloc(0),other);assert.equal(crossTenant.status,404);
 const crossProject=await request('GET','/v1/projects/other-project/documents/'+receipt.id);assert.equal(crossProject.status,404);
 const metrics=await (await request('GET','/v1/projects/api-qa/documents/'+receipt.id+'/metrics')).json();assert.ok(metrics.events.some(e=>e.stage==='page-parse'));assert.ok(metrics.events.some(e=>e.stage==='queue'));
 assert.equal((await request('GET','/v1/projects/other-project/documents/'+receipt.id+'/metrics')).status,404);
 const duplicateSources=await request('POST','/v1/projects/api-qa/reviews',Buffer.from(JSON.stringify({documents:[{id:receipt.id,source:'one.pdf'},{id:receipt.id,source:'two.pdf'}],text:'scope',answers:{}})));assert.equal(duplicateSources.status,400);
});
test('replayed signed requests rejected by persistent nonce table',{skip:!available},async()=>{
 const path='/readyz',headers=signedHeaders(secret,'GET',path,tenant);assert.equal((await fetch(url+path,{headers})).status,200);assert.equal((await fetch(url+path,{headers})).status,401);
});
test('modified body rejected before document ingestion',{skip:!available},async()=>{
 const path='/v1/projects/integrity/documents?name=x.pdf',original=await fixture(1);const headers={...signedHeaders(secret,'POST',path,tenant,original),'content-type':'application/pdf'};
 const r=await fetch(url+path,{method:'POST',headers,body:Buffer.from('%PDF-tampered')});assert.equal(r.status,401);
});
test('input size and MIME contract enforced',{skip:!available},async()=>{const bytes=Buffer.from('not a pdf');const r=await request('POST','/v1/projects/invalid/documents?name=x.pdf',bytes,tenant,{'content-type':'text/plain'});assert.equal(r.status,415);});
test('atomic leases cannot be claimed by two workers and stale commits are fenced',{skip:!available},async()=>{
 const id=jobId(tenant,'lease-test','test',{});await store.enqueue(pool,{id,tenant,project:'lease-test',kind:'test',payload:{}});
 const leases=await Promise.all([store.claim(['test']),store.claim(['test'])]);assert.equal(leases.filter(Boolean).length,1);const first=leases.find(Boolean);
 await pool.query("UPDATE p5ds_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);const second=await store.claim(['test']);assert.ok(second);assert.notEqual(first.lease_token,second.lease_token);
 await assert.rejects(store.complete(first,{}),/lease-lost/);await store.complete(second,{verified:true});
 await assert.rejects(store.manifest(first,9),/lease-lost/);
});
test('global provider slots apply across store instances',{skip:!available},async()=>{
 const a=await store.reserve(100),b=await store.reserve(100);assert.ok(a&&b);const duplicateStore=new Store(pool,config);assert.equal(await duplicateStore.reserve(100),null);await store.release(a);const c=await duplicateStore.reserve(100);assert.ok(c);await store.release(b);await store.release(c);
});
test('retries preserve successful page evidence',{skip:!available},async()=>{
 const bytes=await fixture(1),{document}=await store.putDocument(tenant,'retry-qa','one.pdf',bytes);await until(async()=> (await store.document(tenant,'retry-qa',document.id)).state==='complete');
 const before=await store.pages(document.id);await pool.query("UPDATE p5ds_documents SET state='failed',error_code='temporary' WHERE id=$1",[document.id]);await store.retry(tenant,'retry-qa',document.id,'documents');assert.deepEqual((await store.pages(document.id))[0].evidence,before[0].evidence);assert.equal((await store.document(tenant,'retry-qa',document.id)).state,'complete');
});
test('unique 100-sheet native blueprint fixture keeps every page, exact quantity and page identity',{timeout:120000},async()=>{
 const bytes=await fixture(100,true),pages=[],started=performance.now();await parsePdf(bytes,{maxPages:200,timeoutMs:90000,onPage:p=>{assert.ok(p.text.includes(`Room ${100+p.page} SF`));assert.equal(p.kind,'drawing');assert.ok(p.image.length);pages.push({page:p.page,text:p.text,render:p.render,parseMs:p.parseMs});}});
 const elapsed=Math.round(performance.now()-started);assert.equal(pages.length,100);assert.equal(new Set(pages.map(p=>p.page)).size,100);
 await mkdir('verification',{recursive:true});await writeFile('verification/native-100-pages.json',JSON.stringify({fixture:'100 unique generated 24x36-inch sheets, not a real customer plan set',scope:'Native text/layout extraction and overview rendering ONLY. No live model, semantic or accuracy certification.',pages:pages.length,elapsedMs:elapsed,within60Seconds:elapsed<=60000,sourceBytes:bytes.length,missingPages:0},null,2));
 console.log(`Native-only synthetic 100-sheet benchmark: ${elapsed}ms. NOT a live AI benchmark.`);
});
test('corrupt PDF fails rather than returning an empty successful record',async()=>{await assert.rejects(parsePdf(Buffer.from('%PDF-1.7 invalid data'),{timeoutMs:5000}),/parsed/);});

test('a parser checkpoint cannot erase a terminal reader failure',{skip:!available},async()=>{
 const id=hash('failure-preservation'),bytes=Buffer.from('%PDF-test-only');
 await pool.query("INSERT INTO p5ds_documents(id,tenant,project,digest,name,bytes,size_bytes,state,error_code) VALUES($1,$2,'failure-preservation',$3,'test.pdf',$4,$5,'failed','reader-failed')",[id,tenant,hash(bytes),bytes,bytes.length]);
 await store.enqueue(pool,{id:jobId(tenant,'failure-preservation','test',{}),tenant,project:'failure-preservation',documentId:id,kind:'fault-test',payload:{}});
 const lease=await store.claim(['fault-test']);
 await store.putPage(lease,{page:1,text:'Room 101 SF',image:Buffer.from('test-image')});
 assert.equal((await store.document(tenant,'failure-preservation',id)).state,'failed');
 await store.complete(lease,{});
});
test('a recovered reader never sends completed pages to the provider again',async()=>{
 const native=n=>({page:n,text:'Room '+(100+n)+' SF',textQuality:1,kind:'text'});
 const sent=[],queries=[];let completed=false;
 const fakeStore={checkpoint:async(job,result)=>{job.result=result;},checkStorage:async()=>{},finalize:async()=>{},pages:async()=>[{page:1,native:native(1),image:Buffer.alloc(0),evidence:fakePage(native(1))},{page:2,native:native(2),image:Buffer.alloc(0),evidence:null}],pool:{query:async(q)=>{queries.push(q);return {rows:[]};}},complete:async(job,result,extra)=>{completed=true;if(extra)await extra(fakeStore.pool);}};
 const reader={call:async(job,system,input)=>{sent.push(...input.pages.map(p=>p.page));return {pages:input.pages.map(fakePage)};}};
 const pipeline=new Pipeline(fakeStore,reader,config);
 await pipeline.read({document_id:'d',payload:{pages:[1,2]}},new AbortController().signal);
 assert.deepEqual(sent,[2]);assert.ok(completed);assert.ok(queries.some(q=>q.includes('AND evidence IS NULL')));
});


test('rendered pages and evidence count toward storage quota and roll back on overflow',{skip:!available},async()=>{
 const id=hash('storage-accounting'),bytes=Buffer.from('%PDF-test-only');
 await pool.query("INSERT INTO p5ds_documents(id,tenant,project,digest,name,bytes,size_bytes) VALUES($1,'quota-test','quota-test',$2,'test.pdf',$3,$4)",[id,hash(bytes),bytes,bytes.length]);
 const capped=new Store(pool,{...config,maxTenantBytes:1000});
 await capped.enqueue(pool,{id:jobId('quota-test','quota-test','quota-test',{}),tenant:'quota-test',project:'quota-test',documentId:id,kind:'quota-test',payload:{}});
 const lease=await capped.claim(['quota-test']);
 await assert.rejects(capped.putPage(lease,{page:1,text:'small native text',image:Buffer.alloc(2000)}),/document-storage-quota/);
 assert.equal((await capped.pages(id)).length,0);
 await capped.putPage(lease,{page:1,text:'small',image:Buffer.alloc(10)});
 await assert.rejects(capped.transaction(async c=>{await c.query('UPDATE p5ds_pages SET evidence=$2::jsonb WHERE document_id=$1',[id,JSON.stringify({notes:randomBytes(2000).toString('hex')})]);await capped.checkStorage(c,'quota-test');}),/document-storage-quota/);
 assert.equal((await capped.pages(id))[0].evidence,null);await capped.complete(lease,{});
});
