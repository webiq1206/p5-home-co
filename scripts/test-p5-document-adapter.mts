import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-document-adapter-'));
const names=['DATABASE_URL','P5_DOCUMENT_SERVICE_MODE','P5_DOCUMENT_SERVICE_URL','P5_DOCUMENT_SERVICE_KEY'];
const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
let db:any;
try{
 delete process.env.DATABASE_URL;
 process.env.P5_DOCUMENT_SERVICE_MODE='remote';
 process.env.P5_DOCUMENT_SERVICE_URL='https://controlled-document-service.example';
 process.env.P5_DOCUMENT_SERVICE_KEY='controlled-test-secret-not-production'.repeat(2);
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 const mod=(n:string)=>import(pathToFileURL(path.join(dir,n+'.ts')).href);
 const store=await mod('store'),client=await mod('documentServiceClient'),brand=(await mod('brand')).ESTIMATOR_BRAND;
 db=await mod('database');
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 const draft=await store.saveDraft(id,key,brand.id,{text:'Controlled adapter fixture',answers:{service:'new-construction'},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const bytes=Buffer.from('%PDF-controlled-adapter-fixture'),digest=createHash('sha256').update(bytes).digest('hex'),fileId=randomUUID();
 await db.query('INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,$3,$4,$5,$6,$7)',[fileId,id,'scope.pdf','application/pdf',bytes.length,digest,bytes.toString('base64')]);
 draft.uploads=[{id:fileId,name:'scope.pdf',type:'application/pdf',size:bytes.length,sha256:digest,status:'stored'}];
 const documentId=client.remoteDocumentId(brand.domain,id,digest);
 let stored=false,uploads=0,reviewCalls=0;const scopeBodies:string[]=[];
 const fakeRequest=async(input:any,init:any)=>{
  const url=new URL(String(input)),route=url.pathname+url.search,method=init.method;
  const headers=new Headers(init.headers),body=init.body?Buffer.from(init.body):Buffer.alloc(0);
  const signed=[method,route,brand.domain,headers.get('x-p5-time'),headers.get('x-p5-nonce'),createHash('sha256').update(body).digest('hex')].join('\n');
  assert.equal(headers.get('x-p5-signature'),createHmac('sha256',process.env.P5_DOCUMENT_SERVICE_KEY!).update(signed).digest('hex'));
  assert.equal(init.redirect,'error');
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  if(method==='GET'&&url.pathname.endsWith('/documents/'+documentId))return stored?reply({id:documentId,state:'complete',progress:{checkedPages:1,totalPages:1}}):reply({error:'not-found'},404);
  if(method==='POST'&&url.pathname.endsWith('/documents')){uploads++;stored=true;assert.deepEqual(body,bytes);return reply({id:documentId,state:'queued'},202);}
  if(method==='POST'&&url.pathname.endsWith('/reviews')){
   reviewCalls++;scopeBodies.push(body.toString());
   if(reviewCalls===1)return reply({id:'review-1',state:'queued'},202);
   return reply({id:'review-'+reviewCalls,state:'complete',result:{summary:'Controlled result',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],pages:[{source:'scope.pdf',page:1,sheet:'A1',revision:'',status:'read',notes:[]}],takeoffs:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]}}},202);
  }
  throw new Error('Unexpected controlled service route: '+route);
 };
 const advance=(text:string,answers:any,work:string)=>client.advanceDocumentService(draft,text,answers,work,fakeRequest,false,Date.now()+30000);
 const one=await advance(draft.text,draft.answers,'remote-fixture-1');assert.equal(one.pending,true);
 const two=await advance(draft.text,draft.answers,'remote-fixture-1');assert.equal(two.pending,true);
 const three=await advance(draft.text,draft.answers,'remote-fixture-1');assert.equal(three.pending,false);assert.equal(three.analysis.extraction.documentCoverage.expectedPages,1);assert.equal(uploads,1);
 const changed=await advance('Only the garage',{...draft.answers,garageIncluded:'yes'},'remote-fixture-2');assert.equal(changed.pending,false);assert.equal(uploads,1,'a changed scope must reuse the saved source');assert.notEqual(scopeBodies[0],scopeBodies.at(-1));
 assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,0,'document processing must not email or create a CRM delivery');
 assert.equal((await db.query('SELECT * FROM p5_estimator_work WHERE lease_token IS NOT NULL')).length,0,'adapter leases released');
 stored=false;await db.query('UPDATE p5_estimator_files SET data_base64=$2 WHERE id=$1',[fileId,Buffer.from('tampered').toString('base64')]);
 await assert.rejects(advance(draft.text,draft.answers,'integrity-check'),/integrity check/);
 process.env.P5_DOCUMENT_SERVICE_URL='http://insecure.example';await assert.rejects(advance(draft.text,draft.answers,'insecure-url'),/configuration needs attention/);
 console.log('PASS: real isolated SQL, saved uploads, HMAC/body integrity, pending-to-complete review, changed-scope source reuse, HTTPS enforcement and zero delivery side effects. Remote semantic responses are controlled test fixtures.');
}finally{
 if(db)await db.database.close();
 for(const n of names){if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}
 await rm(dir,{recursive:true,force:true});
}
