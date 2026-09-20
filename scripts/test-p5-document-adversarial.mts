import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-document-adapter-'));
const names=['DATABASE_URL','P5_DOCUMENT_SERVICE_MODE','P5_DOCUMENT_SERVICE_URL','P5_DOCUMENT_SERVICE_KEY','P5_DOCUMENT_SERVICE_TENANT'];
const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
let db:any;
try{
 delete process.env.DATABASE_URL;
 process.env.P5_DOCUMENT_SERVICE_MODE='remote';
 process.env.P5_DOCUMENT_SERVICE_URL='https://controlled-document-service.example/api/p5-documents';
 process.env.P5_DOCUMENT_SERVICE_KEY='controlled-test-secret-not-production'.repeat(2);
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 const mod=(n:string)=>import(pathToFileURL(path.join(dir,n+'.ts')).href);
 const store=await mod('store'),client=await mod('documentServiceClient'),brand=(await mod('brand')).ESTIMATOR_BRAND;
 process.env.P5_DOCUMENT_SERVICE_TENANT=brand.domain;
 db=await mod('database');
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 const draft=await store.saveDraft(id,key,brand.id,{text:'Controlled adapter fixture',answers:{service:'new-construction'},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const bytes=Buffer.from('%PDF-controlled-adapter-fixture'),digest=createHash('sha256').update(bytes).digest('hex'),fileId=randomUUID();
 await db.query('INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,$3,$4,$5,$6,$7)',[fileId,id,'scope.pdf','application/pdf',bytes.length,digest,bytes.toString('base64')]);
 draft.uploads=[{id:fileId,name:'scope.pdf',type:'application/pdf',size:bytes.length,sha256:digest,status:'stored'}];
 const documentId=client.remoteDocumentId(brand.domain,id,digest);
 let stored=false,uploads=0,reviewCalls=0,partial=false,wrongSource=false,retryStatus=202,failed=false;const scopeBodies:string[]=[];
 const fakeRequest=async(input:any,init:any)=>{
  const url=new URL(String(input)),route=url.pathname.replace(/^\/api\/p5-documents/,'')+url.search,method=init.method;
  assert.ok(url.pathname.startsWith('/api/p5-documents/v1/')||url.pathname==='/api/p5-documents/readyz');
  const headers=new Headers(init.headers),body=init.body?Buffer.from(init.body):Buffer.alloc(0);
  const signed=[method,route,brand.domain,headers.get('x-p5-time'),headers.get('x-p5-nonce'),createHash('sha256').update(body).digest('hex')].join('\n');
  assert.equal(headers.get('x-p5-signature'),createHmac('sha256',process.env.P5_DOCUMENT_SERVICE_KEY!).update(signed).digest('hex'));
  assert.equal(init.redirect,'error');
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  if(route==='/readyz')return reply({ready:true,providerConfigured:true,tenant:brand.domain,protocol:'v1',limits:{maxFileBytes:250*1024*1024,maxPages:250},capabilities:{pdf:true}});
  if(method==='GET'&&url.pathname.endsWith('/documents/'+documentId))return stored?reply({id:documentId,state:failed?'failed':'complete',progress:{checkedPages:1,totalPages:1},coverage:{complete:!partial,pages:[{page:1,status:partial?'partial':'read'}]}}):reply({error:'not-found'},404);
  if(method==='POST'&&url.pathname.endsWith('/retry'))return reply({error:'retry unavailable'},retryStatus);
  if(method==='POST'&&url.pathname.endsWith('/documents')){uploads++;stored=true;assert.deepEqual(body,bytes);return reply({id:documentId,state:'queued'},202);}
  if(method==='POST'&&url.pathname.endsWith('/reviews')){
   reviewCalls++;scopeBodies.push(body.toString());
   if(reviewCalls===1)return reply({id:'review-1',state:'queued'},202);
   return reply({id:'review-'+reviewCalls,state:'complete',result:{summary:'Controlled result',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],pages:[{source:wrongSource?'foreign.pdf':'scope.pdf',page:1,sheet:'A1',revision:'',status:'read',notes:[]}],takeoffs:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]}}},202);
  }
  throw new Error('Unexpected controlled service route: '+route);
 };
 const advance=(text:string,answers:any,work:string)=>client.advanceDocumentService(draft,text,answers,work,fakeRequest,false,Date.now()+30000);
 const one=await advance(draft.text,draft.answers,'remote-fixture-1');assert.equal(one.pending,true);
 assert.equal(reviewCalls,1,'reconciliation is queued during initial ingestion, before a later browser poll');
 const two=await advance(draft.text,draft.answers,'remote-fixture-1');assert.equal(two.pending,false);
 const three=await advance(draft.text,draft.answers,'remote-fixture-1');assert.equal(three.pending,false);assert.equal(three.analysis.extraction.documentCoverage.expectedPages,1);assert.equal(uploads,1);
 const changed=await advance('Only the garage',{...draft.answers,garageIncluded:'yes'},'remote-fixture-2');assert.equal(changed.pending,false);assert.equal(uploads,1,'a changed scope must reuse the saved source');assert.notEqual(scopeBodies[0],scopeBodies.at(-1));
 assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,0,'document processing must not email or create a CRM delivery');
 assert.equal((await db.query('SELECT * FROM p5_estimator_work WHERE lease_token IS NOT NULL')).length,0,'adapter leases released');
 partial=true;await assert.rejects(advance(draft.text,draft.answers,'partial'),/unchecked estimate/);partial=false;
 wrongSource=true;await assert.rejects(advance(draft.text,draft.answers,'foreign-coverage'),/verified uploaded pages/);wrongSource=false;
 failed=true;retryStatus=503;await assert.rejects(client.advanceDocumentService(draft,draft.text,draft.answers,'retry-failure',fakeRequest,true,Date.now()+30000),/retry could not start/);failed=false;
 draft.uploads.push({...draft.uploads[0],id:randomUUID(),name:'duplicate.pdf'});await advance(draft.text,draft.answers,'duplicate-source');assert.equal(JSON.parse(scopeBodies.at(-1)!).documents.length,1);draft.uploads.pop();
 
 const matrix:any[]=[];
 const variants=[
 ['wrong document receipt', 'document', (v:any)=>({...v,id:'foreign-document'})],
 ['missing document page', 'document', (v:any)=>({...v,coverage:{complete:true,pages:[]}})],
 ['duplicate document pages', 'document', (v:any)=>({...v,progress:{checkedPages:2,totalPages:2},coverage:{complete:true,pages:[{page:1,status:'read'},{page:1,status:'read'}]}})],
 ['out-of-order document page', 'document', (v:any)=>({...v,coverage:{complete:true,pages:[{page:2,status:'read'}]}})],
 ['unreadable document page marked complete', 'document', (v:any)=>({...v,coverage:{complete:true,pages:[{page:1,status:'unreadable'}]}})],
 ['missing review page', 'review', (v:any)=>({...v,result:{...v.result,pages:[]}})],
 ['duplicate review pages', 'review', (v:any)=>({...v,result:{...v.result,pages:[v.result.pages[0],v.result.pages[0]]}})],
 ['review page has partial evidence', 'review', (v:any)=>({...v,result:{...v.result,pages:[{...v.result.pages[0],status:'partial'}]}})],
 ['review page refers to another source', 'review', (v:any)=>({...v,result:{...v.result,pages:[{...v.result.pages[0],source:'different.pdf'}]}})],
 ['review page number is wrong', 'review', (v:any)=>({...v,result:{...v.result,pages:[{...v.result.pages[0],page:7}]}})],
 ['review result is absent', 'review', (v:any)=>({...v,result:null})],
 ['complete document page count is absent', 'document', (v:any)=>({...v,progress:{checkedPages:1}})],
 ['queued document over 250 pages', 'document', (v:any)=>({...v,state:'queued',progress:{checkedPages:0,totalPages:251}})],
 ['complete document over 250 pages', 'document', (v:any)=>({...v,progress:{checkedPages:251,totalPages:251}})],
 ] as const;
 for(const [name,target,change]of variants){
  const wrapper=async(input:any,init:any)=>{const response=await fakeRequest(input,init);const route=new URL(String(input)).pathname;if((target==='document'&&init.method==='GET'&&route.includes('/documents/'))||(target==='review'&&route.endsWith('/reviews'))){const value=await response.json();return Response.json(change(value));}return response;};
  let rejected=false,error='';try{await client.advanceDocumentService(draft,draft.text,draft.answers,'hostile-'+name,wrapper,false,Date.now()+30000);}catch(e:any){rejected=true;error=e.message;}
  matrix.push({name,passed:rejected,error});
 }
 for(const code of [401,429,503]){
  const wrapper=async(input:any,init:any)=>new URL(String(input)).pathname.endsWith('/readyz')?fakeRequest(input,init):Response.json({error:'synthetic-service-response',retryAfterMs:1000},{status:code});
  let result:any;try{result=await client.advanceDocumentService(draft,draft.text,draft.answers,'status-'+code,wrapper,false,Date.now()+30000);}catch(e:any){result={rejected:true};}
  matrix.push({name:'service status '+code,passed:code===401?result.rejected===true:result.pending===true});
 }
 await writeFile('node_modules/.cache/document-adversarial-results.json',JSON.stringify(matrix,null,2));
 console.log('ADVERSARIAL MATRIX '+JSON.stringify(matrix));assert.ok(matrix.every(r=>r.passed),'Every malformed document response must remain rejected');

 stored=false;await db.query('UPDATE p5_estimator_files SET data_base64=$2 WHERE id=$1',[fileId,Buffer.from('tampered').toString('base64')]);
 await assert.rejects(advance(draft.text,draft.answers,'integrity-check'),/integrity check/);
 process.env.P5_DOCUMENT_SERVICE_URL='http://insecure.example';await assert.rejects(advance(draft.text,draft.answers,'insecure-url'),/configuration needs attention/);
 console.log('PASS: real isolated SQL, saved uploads, HMAC/body integrity, pending-to-complete review, changed-scope source reuse, HTTPS enforcement and zero delivery side effects. Remote semantic responses are controlled test fixtures.');
}finally{
 if(db)await db.database.close();
 for(const n of names){if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}
 await rm(dir,{recursive:true,force:true});
}
