import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentServiceEligible,documentServiceHeaders,documentServiceUploads,documentServiceLimits,documentServiceConfiguration,checkDocumentServiceReadiness,validateDocumentServiceReadiness,validateRemotePageCount,remoteDocumentId,partitionDocumentServiceUploads,documentServiceReadiness,advanceMixedDocumentAnalysis,advanceDocumentService,assertCompleteSourceCoverage,assertProjectSourceCoverage,assertAnalysisMigrationSafe,readSavedSource,sourceIdentity,SOURCE_COVERAGE_REQUIRED,type DocumentAnalysisStep} from '../lib/p5/documentServiceClient.ts';
import {analysisWorkKey,analysisProgressWorkKeys,partitionDocumentUploads} from '../lib/p5/analysisWork.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
const pdf:any={id:'file',name:'scope.pdf',type:'application/pdf',size:1000,sha256:'a'.repeat(64),status:'stored'};
const tenant=ESTIMATOR_BRAND.domain;
// Isolated fixtures only. Never read a live secret or call a network.
const readiness={ready:true,providerConfigured:true,tenant,protocol:'v1',limits:{maxFileBytes:250*1024*1024,maxPages:250},capabilities:{pdf:true}};
const MIB50=String(50*1024*1024);
test('shared service is off by default and selects eligible PDFs within mixed inputs',()=>{
 assert.equal(documentServiceEligible([pdf],{}),false);
 assert.equal(documentServiceEligible([pdf],{P5_DOCUMENT_SERVICE_MODE:'remote'}),true);
 assert.equal(documentServiceEligible([pdf,{...pdf,id:'photo',sha256:'b'.repeat(64),type:'image/png'}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),true);
 assert.equal(documentServiceEligible([{...pdf,size:250*1024*1024}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),true);
 assert.equal(documentServiceEligible([{...pdf,size:250*1024*1024+1}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),false);
 assert.equal(documentServiceEligible([{...pdf,size:60*1024*1024}],{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:MIB50}),false);
 assert.equal(documentServiceEligible([{...pdf,size:0}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),false);
 assert.equal(documentServiceEligible([{...pdf,status:'pending'}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),false);
 assert.throws(()=>documentServiceEligible([pdf],{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_PAGES:'251'}),/configuration/);
 assert.throws(()=>documentServiceEligible([pdf],{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:'invalid'}),/configuration/);
});
test('routing conserves every physical source and honors the configured host byte limit',()=>{
 const inputs=[pdf,{...pdf,id:'photo',sha256:'b'.repeat(64),type:'image/png'},{...pdf,id:'sheet',sha256:'c'.repeat(64),type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},{...pdf,id:'large',sha256:'d'.repeat(64),size:250*1024*1024}];
 const routes=partitionDocumentServiceUploads(inputs,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:MIB50});
 assert.deepEqual(routes.remote.map(u=>u.id),['file']);
 assert.deepEqual(routes.local.map(u=>u.id),['photo','sheet','large']);
 assert.equal(partitionDocumentServiceUploads(inputs,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:String(250*1024*1024)}).remote.length,2);
 assert.equal(partitionDocumentServiceUploads(inputs,{P5_DOCUMENT_SERVICE_MODE:'remote'}).remote.length,2);
 // Handyman and Cabinet call-site names resolve to the same partition.
 assert.deepEqual(documentServiceUploads(inputs,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:MIB50}),routes.remote);
 assert.deepEqual(documentServiceUploads([pdf,{...inputs[1],name:'photo.png'}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),[pdf]);
 assert.deepEqual(documentServiceUploads([pdf],{}),[]);
 assert.deepEqual(partitionDocumentUploads(inputs,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:MIB50}),routes);
 assert.throws(()=>partitionDocumentServiceUploads(inputs,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:String(251*1024*1024)}),/configuration/);
});
test('readiness is redacted, strict about URL shape, and cannot assert host readiness',()=>{
 const env={P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_URL:'https://reader.example/api/p5-documents',P5_DOCUMENT_SERVICE_KEY:'test-only-not-a-real-key-'.repeat(2),P5_DOCUMENT_SERVICE_TENANT:tenant};
 const ready=documentServiceReadiness(env);
 assert.equal(ready.configurationReady,true);assert.equal(ready.hostVerified,false);
 assert.equal(ready.maxBytes,250*1024*1024);assert.equal(ready.uploadMaxBytes,250*1024*1024);
 assert.equal(documentServiceReadiness({...env,P5_DOCUMENT_SERVICE_MAX_BYTES:MIB50}).maxBytes,50*1024*1024);
 // Explicit brand binding: a missing or sibling tenant is never configuration-ready.
 assert.equal(documentServiceReadiness({...env,P5_DOCUMENT_SERVICE_TENANT:undefined}).configurationReady,false);
 assert.equal(documentServiceReadiness({...env,P5_DOCUMENT_SERVICE_TENANT:'other.example'}).configurationReady,false);
 assert.ok(!JSON.stringify(ready).includes(env.P5_DOCUMENT_SERVICE_KEY));
 for(const url of ['http://reader.example','https://user:password@reader.example','https://reader.example/unknown','https://reader.example?key=value','https://reader.example/#fragment'])assert.equal(documentServiceReadiness({...env,P5_DOCUMENT_SERVICE_URL:url}).configurationReady,false);
 assert.equal(documentServiceReadiness({...env,P5_DOCUMENT_SERVICE_KEY:'short'}).configurationReady,false);
 assert.deepEqual(documentServiceReadiness({P5_DOCUMENT_SERVICE_MODE:'local',P5_DOCUMENT_SERVICE_MAX_BYTES:'broken'}).issues,[]);
 assert.equal(documentServiceReadiness({}).state,'off');
 assert.equal(documentServiceReadiness({P5_DOCUMENT_SERVICE_MODE:'remote'}).state,'invalid');
});
const result=(summary:string,complete=true,source=summary):DocumentAnalysisStep=>({pending:false,version:summary,analysis:{provider:'fixture',model:'fixture',analyzedAt:'2026-01-01',extraction:{summary,facts:[],conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{pages:[{source,page:1,sheet:'',revision:'',status:complete?'read':'unreadable',notes:[]}],expectedPages:1,complete}}}});
const results=(summary:string,sources:string[]):DocumentAnalysisStep=>({pending:false,version:summary,analysis:{provider:'fixture',model:'fixture',analyzedAt:'2026-01-01',extraction:{summary,facts:[],conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{pages:sources.map(source=>({source,page:1,sheet:'',revision:'',status:'read' as const,notes:[]})),expectedPages:sources.length,complete:true}}}});
const onePage=async()=>1;
function memoryWork(){
 const saved=new Map<string,any>();
 return {
  saved,
  claimWork:async(_id:string,key:string,initial:unknown)=>({token:'00000000-0000-0000-0000-000000000000' as const,payload:structuredClone(saved.get(key)||initial)}),
  writeWork:async(_id:string,key:string,_token:string,payload:unknown)=>{saved.set(key,structuredClone(payload));},
  releaseWork:async()=>{},
 };
}
test('mixed checkpoints resume across reload and never complete while either reader is pending',async()=>{
 const previous=process.env.P5_DOCUMENT_SERVICE_MODE;process.env.P5_DOCUMENT_SERVICE_MODE='remote';
 try{
  const memory=memoryWork(),calls:{branch:string;ids:string[];names:string[];retry:boolean}[]=[];
   const draft:any={id:'fixture',uploads:[pdf,{...pdf,id:'photo123456',sha256:'b'.repeat(64),type:'image/png'},{...pdf,id:'sheet123456',sha256:'c'.repeat(64),name:'sheet.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]};
  const answers:any={estimatingInstructions:'Owner supplies fixtures; exclude historic prices.'};
  const neverFetch:typeof fetch=async()=>{throw new Error('Network forbidden');};
  let localPass=0;
  const local=async(d:any,text:string,a:any,key:string,_fetch:typeof fetch,retry:boolean)=>{
   assert.equal(text,'one project');assert.deepEqual(a,answers);assert.match(key,/:local$/);
   calls.push({branch:'local',ids:d.uploads.map((u:any)=>u.id),names:d.uploads.map((u:any)=>u.name),retry});
    return ++localPass===1?{pending:true as const,progress:'still reading',retryAfterMs:1000,processing:{phase:'reading' as const,message:'still reading',updatedAt:'fixture',readSections:1,totalSections:3,currentItems:['sheet.xlsx']}}:results('photo and spreadsheet',['scope.pdf [photo123]','sheet.xlsx']);
  };
  const remote=async(d:any,_text:string,_a:any,_key:string,_fetch:typeof fetch,retry:boolean)=>{
   calls.push({branch:'remote',ids:d.uploads.map((u:any)=>u.id),names:d.uploads.map((u:any)=>u.name),retry});return result('pdf',true,'scope.pdf [file]');
  };
  const first=await advanceMixedDocumentAnalysis(draft,'one project',answers,'mixed',neverFetch,false,Date.now()+10000,local,{...memory,remoteReader:remote,inventorySource:onePage});
  assert.equal(first.pending,true);assert.ok(memory.saved.get('mixed').remote);
  assert.equal(memory.saved.get('mixed').processing.readSections,1);assert.equal(memory.saved.get('mixed').processing.totalSections,3);
  assert.equal(memory.saved.get('mixed').branchProcessing.local.currentItems[0],'sheet.xlsx');
  assert.equal(memory.saved.get('mixed').processing.branches.local.totalSections,3);
  const second=await advanceMixedDocumentAnalysis(structuredClone(draft),'one project',answers,'mixed',neverFetch,true,Date.now()+10000,local,{...memory,remoteReader:remote,inventorySource:onePage});
  assert.equal(second.pending,false);
  if(!second.pending){assert.match(second.analysis.extraction.summary,/pdf/);assert.match(second.analysis.extraction.summary,/spreadsheet/);assert.equal(second.analysis.extraction.documentCoverage?.expectedPages,3);}
  assert.deepEqual(calls.map(c=>c.branch),['local','remote','local']);
  assert.deepEqual(calls[0].ids,['photo123456','sheet123456']);assert.deepEqual(calls[1].ids,['file']);
  assert.equal(calls[2].retry,true);
  assert.equal(calls[0].names[0],'scope.pdf [photo123]');assert.equal(calls[1].names[0],'scope.pdf [file]');
 }finally{if(previous===undefined)delete process.env.P5_DOCUMENT_SERVICE_MODE;else process.env.P5_DOCUMENT_SERVICE_MODE=previous;}
});
test('an incomplete branch is never cached as a completed mixed project',async()=>{
 const previous=process.env.P5_DOCUMENT_SERVICE_MODE;process.env.P5_DOCUMENT_SERVICE_MODE='remote';
 try{
  const memory=memoryWork();
  await assert.rejects(()=>advanceMixedDocumentAnalysis({id:'fixture',uploads:[pdf,{...pdf,id:'photo',sha256:'b'.repeat(64),type:'image/png'}]} as any,'',{},'mixed',async()=>{throw new Error('Network forbidden');},false,Date.now()+10000,async()=>result('photo',false),{...memory,remoteReader:async()=>result('pdf'),inventorySource:onePage}),/still unread/);
  assert.equal(memory.saved.get('mixed')?.local,undefined);
 }finally{if(previous===undefined)delete process.env.P5_DOCUMENT_SERVICE_MODE;else process.env.P5_DOCUMENT_SERVICE_MODE=previous;}
});
test('remote protocol mocks accept all 250 verified pages and reject missing, partial or zero-page receipts',async()=>{
 const keys=['P5_DOCUMENT_SERVICE_MODE','P5_DOCUMENT_SERVICE_URL','P5_DOCUMENT_SERVICE_KEY','P5_DOCUMENT_SERVICE_MAX_BYTES','P5_DOCUMENT_SERVICE_TENANT'];
 const previous=keys.map(key=>process.env[key]);
 Object.assign(process.env,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_URL:'https://reader.example',P5_DOCUMENT_SERVICE_KEY:'fixture-signing-key-not-a-secret-12345',P5_DOCUMENT_SERVICE_MAX_BYTES:String(50*1024*1024),P5_DOCUMENT_SERVICE_TENANT:tenant});
 try{
  const draft:any={id:'fixture',brand:ESTIMATOR_BRAND.id,uploads:[pdf]};
  const pages=Array.from({length:250},(_,i)=>({source:pdf.name,page:i+1,sheet:'',revision:'',status:'read',notes:[]}));
  for(const mode of ['complete','missing','partial','zero','unknown-source','duplicate-page','document-source']){
   const memory=memoryWork();
   const request:typeof fetch=async(url,init)=>{
    assert.equal(init?.redirect,'error');
    if(String(url).endsWith('/readyz'))return Response.json(readiness);
    const document={id:remoteDocumentId(ESTIMATOR_BRAND.domain,draft.id,pdf.sha256),state:'complete',progress:{checkedPages:250,totalPages:mode==='zero'?0:250},coverage:{complete:true,pages:mode==='zero'?[]:mode==='document-source'?pages.map(p=>({...p,source:'unknown.pdf'})):pages}};
    const returned=mode==='missing'?pages.slice(1):mode==='partial'?pages.map((p,i)=>i? p:{...p,status:'partial'}):mode==='unknown-source'?pages.map(p=>({...p,source:'other.pdf'})):mode==='duplicate-page'?pages.map((p,i)=>i===1?pages[0]:p):pages;
    const review={id:'review-fixture',state:'complete',result:{summary:'250 page fixture',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{complete:true,expectedPages:250,pages:returned}}};
    return new Response(JSON.stringify(String(url).endsWith('/reviews')?review:document),{status:200});
   };
   const run=()=>advanceDocumentService(draft,'',{},'remote',request,false,Date.now()+10000,{...memory,query:async()=>{throw new Error('DB forbidden');},readStoredBytes:async()=>{throw new Error('Storage forbidden');}});
   if(mode==='complete'){const step=await run();assert.equal(step.pending,false);if(!step.pending)assert.equal(step.analysis.extraction.documentCoverage?.pages.length,250);}
    else await assert.rejects(run,/coverage|verification|progress/);
  }
 }finally{keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});
test('route snapshot and checkpoint identity survive a changed byte limit',async()=>{
 const previousMode=process.env.P5_DOCUMENT_SERVICE_MODE,previousLimit=process.env.P5_DOCUMENT_SERVICE_MAX_BYTES;
 process.env.P5_DOCUMENT_SERVICE_MODE='remote';process.env.P5_DOCUMENT_SERVICE_MAX_BYTES=String(50*1024*1024);
 try{
  const memory=memoryWork(),draft:any={id:'fixture',uploads:[pdf,{...pdf,id:'large',name:'large.pdf',sha256:'b'.repeat(64),size:60*1024*1024}]};
  const key=analysisWorkKey(draft,'',{}),calls:string[][]=[];
  const local=async(d:any)=>{calls.push(d.uploads.map((u:any)=>u.id));return {pending:true as const,progress:'reading'};};
  const remote=async()=>result('pdf',true,pdf.name);
  const noFetch:typeof fetch=async()=>{throw new Error('Network forbidden');};
  await advanceMixedDocumentAnalysis(draft,'',{},key,noFetch,false,Date.now()+10000,local,{...memory,remoteReader:remote,inventorySource:onePage});
  process.env.P5_DOCUMENT_SERVICE_MAX_BYTES=String(250*1024*1024);
  assert.equal(analysisWorkKey(draft,'',{}),key);
  await advanceMixedDocumentAnalysis(draft,'',{},key,noFetch,false,Date.now()+10000,local,{...memory,remoteReader:remote,inventorySource:onePage});
  assert.deepEqual(calls,[['large'],['large']]);
  assert.deepEqual(memory.saved.get(key).routes.remote.map((u:any)=>u.id),['file']);
  assert.ok(memory.saved.get(key).remote);
 }finally{
  if(previousMode===undefined)delete process.env.P5_DOCUMENT_SERVICE_MODE;else process.env.P5_DOCUMENT_SERVICE_MODE=previousMode;
  if(previousLimit===undefined)delete process.env.P5_DOCUMENT_SERVICE_MAX_BYTES;else process.env.P5_DOCUMENT_SERVICE_MAX_BYTES=previousLimit;
 }
});
test('unknown legacy checkpoints block migration rather than resetting attempts',async()=>{
 const draft:any={id:'fixture',uploads:[pdf]};
 for(const work_key of ['analysis:v8:fingerprint','analysis:document-service-v1:fingerprint','analysis:document-service-v2-52428800:fingerprint']){
  await assert.rejects(()=>assertAnalysisMigrationSafe(draft,'',{},'new',async()=>[{work_key}]),/prior attempt budgets.*no automatic rereading/i);
 }
 await assert.doesNotReject(()=>assertAnalysisMigrationSafe(draft,'',{},'current',async()=>[{work_key:'current'}]));
 await assert.rejects(()=>assertAnalysisMigrationSafe(draft,'',{},'current',async()=>{throw new Error('private database detail');}),/files are preserved/);
});
test('saved-source database and object failures are stable redacted errors',async()=>{
 const fail=async()=>{throw new Error('private backend details');};
 for(const deps of [{query:fail,readStoredBytes:fail},{query:async()=>[],readStoredBytes:fail},{query:async()=>[{name:pdf.name}],readStoredBytes:fail}]){
  await assert.rejects(()=>readSavedSource(pdf,'fixture',deps),error=>error instanceof Error&&error.name==='Error'&&/files are preserved/.test(error.message)&&!error.message.includes('private backend'));
 }
});
test('strict coverage rejects false-complete records without blocking unpaged typed evidence',()=>{
 const base:any={summary:'fixture',facts:[],conflicts:[],missingInformation:[],reviewNotes:[]};
 const page={source:'local.pdf',page:1,sheet:'',revision:'',status:'read',notes:[]};
 assert.doesNotThrow(()=>assertCompleteSourceCoverage(base,[]));
 assert.throws(()=>assertCompleteSourceCoverage(base,['local.pdf'],undefined,true),/coverage/);
 for(const coverage of [
  {complete:true,expectedPages:2,pages:[page]},
  {complete:true,expectedPages:2,pages:[page,page]},
  {complete:true,expectedPages:1,pages:[{...page,source:'unknown.pdf'}]},
  {complete:true,expectedPages:1,pages:[{...page,status:'partial',notes:['Part of the sheet is unreadable.']}]},
  {complete:true,expectedPages:1,pages:[{...page,status:'unreadable'}]},
  {complete:true,expectedPages:1,pages:[{...page,page:0}]},
  {complete:true,expectedPages:0,pages:[]},
 ]){
  assert.throws(()=>assertCompleteSourceCoverage({...base,documentCoverage:coverage},['local.pdf'],[{source:'local.pdf',page:1}],true),/coverage/);
 }
 assert.doesNotThrow(()=>assertCompleteSourceCoverage({...base,documentCoverage:{complete:true,expectedPages:1,pages:[page]}},['local.pdf'],[{source:'local.pdf',page:1}],true));
 // A read page marked partial only because values are blank (a budget with its numbers removed) is covered.
 assert.doesNotThrow(()=>assertCompleteSourceCoverage({...base,documentCoverage:{complete:true,expectedPages:1,pages:[{...page,status:'partial',notes:['Dollar amounts are blank; descriptions are legible.']}]}},['local.pdf'],[{source:'local.pdf',page:1}],true));
 assert.doesNotThrow(()=>assertProjectSourceCoverage([],null));
 assert.throws(()=>assertProjectSourceCoverage([pdf],null),/verification is missing/);
  assert.throws(()=>assertProjectSourceCoverage([pdf,{...pdf,id:'photo',sha256:'b'.repeat(64),name:'site.jpg',type:'image/jpeg'}],{...base,documentCoverage:{complete:true,expectedPages:1,pages:[page]}}),/coverage/);
});
test('partial project coverage is rejected by the shared guard; only Construction applies it to local reads and pricing',()=>{
 const partial=result('fixture',false,pdf.name);
 assert.equal(partial.pending,false);
 if(partial.pending)return;
 assert.throws(()=>assertProjectSourceCoverage([pdf],partial.analysis.extraction),/still unread/);
 assert.equal(SOURCE_COVERAGE_REQUIRED,ESTIMATOR_BRAND.id==='construction');
});
test('duplicate PDF bytes make one host request and one progress/coverage contribution',async()=>{
 const keys=['P5_DOCUMENT_SERVICE_MODE','P5_DOCUMENT_SERVICE_URL','P5_DOCUMENT_SERVICE_KEY','P5_DOCUMENT_SERVICE_TENANT'];
 const previous=keys.map(key=>process.env[key]);
 Object.assign(process.env,{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_URL:'https://reader.example',P5_DOCUMENT_SERVICE_KEY:'fixture-signing-key-not-a-secret-12345',P5_DOCUMENT_SERVICE_TENANT:tenant});
 try{
  const memory=memoryWork(),draft:any={id:'fixture',brand:ESTIMATOR_BRAND.id,uploads:[pdf,{...pdf,id:'duplicate',name:'copy.pdf'}]};
  let gets=0,complete=false;
  const pages=Array.from({length:5},(_,i)=>({source:pdf.name,page:i+1,sheet:'',revision:'',status:'read',notes:[]}));
  const request:typeof fetch=async(url,init)=>{
   if(String(url).endsWith('/readyz'))return Response.json(readiness);
   if(String(url).endsWith('/reviews')){
    assert.equal(JSON.parse(Buffer.from(init!.body as any).toString()).documents.length,1);
    return new Response(JSON.stringify({id:'review',state:complete?'complete':'reading',result:complete?{summary:'five pages',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{complete:true,expectedPages:5,pages}}:undefined}));
   }
   gets++;
   return new Response(JSON.stringify({id:remoteDocumentId(ESTIMATOR_BRAND.domain,draft.id,pdf.sha256),state:complete?'complete':'reading',progress:{checkedPages:complete?5:2,totalPages:5},coverage:complete?{complete:true,pages}:undefined}));
  };
  const step=await advanceDocumentService(draft,'',{},'remote',request,false,Date.now()+10000,{...memory,query:async()=>{throw new Error('DB forbidden');},readStoredBytes:async()=>{throw new Error('Storage forbidden');}});
  assert.equal(step.pending,true);assert.equal(gets,1);assert.equal(step.processing?.readPages,2);assert.equal(step.processing?.totalPages,5);
  complete=true;
  const finished=await advanceDocumentService(draft,'',{},'remote',request,false,Date.now()+10000,{...memory,query:async()=>{throw new Error('DB forbidden');},readStoredBytes:async()=>{throw new Error('Storage forbidden');}});
  assert.equal(finished.pending,false);assert.equal(gets,2);
  if(!finished.pending)assert.equal(finished.analysis.extraction.documentCoverage?.expectedPages,5);
 }finally{keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});
test('physical source identity deduplicates equal bytes and disambiguates only distinct same-name evidence',()=>{
 const photo={...pdf,id:'photo123456',sha256:'b'.repeat(64),type:'image/png'};
 const copy={...photo,id:'copy123456'};
 const sheet={...pdf,id:'sheet123456',sha256:'c'.repeat(64),type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 const routes=partitionDocumentServiceUploads([pdf,photo,copy,sheet],{P5_DOCUMENT_SERVICE_MODE:'remote'});
 assert.deepEqual(routes.remote.map(u=>u.id),['file']);
 assert.deepEqual(routes.local.map(u=>u.id),['photo123456','sheet123456']);
 assert.equal(routes.local[0].name,'scope.pdf [photo123]');
 assert.equal(sourceIdentity(copy,[photo,copy]),'scope.pdf','an identical copy is the same physical source');
});
test('full-project inventory rejects 200 PDF pages plus 51 photos before either reader spends a call',async()=>{
 const previous=process.env.P5_DOCUMENT_SERVICE_MODE;process.env.P5_DOCUMENT_SERVICE_MODE='remote';
 try{
  const memory=memoryWork(),photos=Array.from({length:51},(_,index)=>({...pdf,id:`photo-${index}`,name:`photo-${index}.jpg`,type:'image/jpeg',sha256:(index+1).toString(16).padStart(64,'0')}));
  const draft:any={id:'fixture',uploads:[pdf,...photos]};
  let localCalls=0,remoteCalls=0;
  await assert.rejects(()=>advanceMixedDocumentAnalysis(draft,'',{},'mixed-limit',async()=>{throw new Error('Network forbidden');},false,Date.now()+10000,async()=>{localCalls++;return result('local');},{...memory,remoteReader:async()=>{remoteCalls++;return result('remote');},inventorySource:async upload=>upload.type==='application/pdf'?200:1}),/250 pages/);
  assert.equal(localCalls,0);assert.equal(remoteCalls,0);
  assert.ok(memory.saved.get('mixed-limit').routes,'route snapshot is durable before inventory rejection');
  assert.equal(memory.saved.get('mixed-limit').expected,undefined,'an invalid partial inventory is never checkpointed as complete');
 }finally{if(previous===undefined)delete process.env.P5_DOCUMENT_SERVICE_MODE;else process.env.P5_DOCUMENT_SERVICE_MODE=previous;}
});
const env={P5_DOCUMENT_SERVICE_URL:'https://reader.example/api/p5-documents',P5_DOCUMENT_SERVICE_KEY:'isolated-fixture-not-a-real-secret-123',P5_DOCUMENT_SERVICE_TENANT:tenant};
test('cross-site and cross-project source identities cannot collide',()=>{
 assert.notEqual(remoteDocumentId(tenant,'one',pdf.sha256),remoteDocumentId('other.example','one',pdf.sha256));
 assert.notEqual(remoteDocumentId(tenant,'one',pdf.sha256),remoteDocumentId(tenant,'two',pdf.sha256));
});
test('signed requests bind tenant, body, method, path, timestamp and nonce',()=>{
 const args=['POST','/v1/projects/one/documents',tenant,env.P5_DOCUMENT_SERVICE_KEY,Buffer.from('pdf'),1700000000000,'test-nonce'] as const;
 const a=documentServiceHeaders(...args);
 for(const [index,value] of [[0,'GET'],[1,'/v1/projects/two/documents'],[2,'other.example'],[4,Buffer.from('different')],[5,1700000000001],[6,'other-nonce']] as const){
  const changed:any[]=[...args];changed[index]=value;
  assert.notEqual(a['x-p5-signature'],documentServiceHeaders(...changed as unknown as Parameters<typeof documentServiceHeaders>)['x-p5-signature']);
 }
 assert.equal(a['x-p5-body-sha256'].length,64);
});
test('activation configuration rejects missing or sibling tenant and unsafe origins',()=>{
 assert.equal(documentServiceConfiguration(env).tenant,tenant);
 for(const patch of [{P5_DOCUMENT_SERVICE_TENANT:undefined},{P5_DOCUMENT_SERVICE_TENANT:'other.example'},{P5_DOCUMENT_SERVICE_KEY:''},{P5_DOCUMENT_SERVICE_URL:'http://reader.example'},{P5_DOCUMENT_SERVICE_URL:'https://user:pass@reader.example'},{P5_DOCUMENT_SERVICE_URL:'https://reader.example/?key=bad'},{P5_DOCUMENT_SERVICE_MAX_PAGES:'251'}]){
  assert.throws(()=>documentServiceConfiguration({...env,...patch}));
 }
});
test('readiness rejects generic health, wrong tenant, reduced capacity and missing capability',()=>{
 assert.equal(validateDocumentServiceReadiness(readiness),true);
 assert.equal(validateDocumentServiceReadiness({...readiness,ready:undefined,ok:true,providerConfigured:true}),true);
 assert.equal(validateDocumentServiceReadiness({...readiness,limits:{maxFileBytes:500*1024*1024,maxPages:500}}),true);
 for(const providerConfigured of [undefined,false])for(const ready of [{ready:true},{ready:undefined,ok:true}]){
  assert.throws(()=>validateDocumentServiceReadiness({...readiness,...ready,providerConfigured}),/configured provider/);
 }
 for(const value of [null,{ok:true,version:'v1',providerConfigured:true},{...readiness,tenant:'other.example'},{...readiness,protocol:'v2'},{...readiness,limits:{maxFileBytes:50*1024*1024,maxPages:200}},{...readiness,limits:{maxFileBytes:250*1024*1024,maxPages:249}},{...readiness,capabilities:{}},{...readiness,ready:false}]){
  assert.throws(()=>validateDocumentServiceReadiness(value),/readiness/);
 }
});
test('foreign drafts are rejected before storage, network or work claims',async()=>{
 let calls=0;
 await assert.rejects(advanceDocumentService({brand:'another-brand',uploads:[pdf]} as any,'',{},'fixture',async()=>{calls++;throw new Error('Must not send');},false,Date.now()+1000),/does not belong/);
 assert.equal(calls,0);
});
test('no-charge preflight sends only a signed GET to readyz',async()=>{
 let count=0;
 const request:typeof fetch=async(input,init)=>{
  count++;assert.equal(String(input),'https://reader.example/api/p5-documents/readyz');
  assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(init?.redirect,'error');
  assert.equal(new Headers(init?.headers).get('x-p5-tenant'),tenant);
  return Response.json(readiness);
 };
 await checkDocumentServiceReadiness(request,env);
 assert.equal(count,1);
 await assert.rejects(checkDocumentServiceReadiness(request,{...env,P5_DOCUMENT_SERVICE_TENANT:'other.example'}),/credential/);
 assert.equal(count,1);
});
test('preflight fails closed for denied, unavailable, invalid and wrong-tenant responses',async()=>{
 for(const response of [new Response('{}',{status:401}),new Response('{}',{status:503}),new Response('not json'),Response.json({...readiness,tenant:'other.example'})]){
  await assert.rejects(checkDocumentServiceReadiness(async()=>response,env));
 }
});
test('flat readiness shape from the P5 Home host is accepted with the same guarantees',()=>{
 const value={ok:true,protocol:'v1',tenant,pdf:true,maxBytes:250*1024*1024,maxPages:250,provider:{configured:true,ready:true,health:'configured'},service:{healthy:true,database:'ok'}};
 assert.equal(validateDocumentServiceReadiness(value),true);
 // The live host reports both shapes at once.
 assert.equal(validateDocumentServiceReadiness({...value,providerConfigured:true,capabilities:{pdf:true},limits:{maxFileBytes:value.maxBytes,maxPages:value.maxPages}}),true);
 for(const broken of [{...value,maxPages:249},{...value,maxBytes:50*1024*1024},{...value,tenant:'other.example'},{...value,pdf:false},{...value,provider:{...value.provider,ready:false}},{...value,provider:{...value.provider,health:'degraded'}},{...value,service:{healthy:true,database:'down'}},{...value,service:{healthy:false,database:'ok'}}]){
  assert.throws(()=>validateDocumentServiceReadiness(broken),/readiness/);
 }
 // A smaller configured limit is satisfied by a smaller host.
 assert.equal(validateDocumentServiceReadiness({...value,maxBytes:50*1024*1024},documentServiceLimits({P5_DOCUMENT_SERVICE_MAX_BYTES:MIB50})),true);
});
test('oversized remote page metadata is rejected immediately',()=>{
 validateRemotePageCount(undefined);validateRemotePageCount(0);validateRemotePageCount(250);
 for(const value of [251,-1,1.5,'250',null])assert.throws(()=>validateRemotePageCount(value),/page count/);
 assert.throws(()=>validateRemotePageCount(201,200),/200 pages/);
});
test('remote reader refuses non-PDF, unstored and disabled sources before any network call',async()=>{
 const previous=process.env.P5_DOCUMENT_SERVICE_MODE;
 const never:typeof fetch=async()=>{throw new Error('Must not send');};
 const owned=(uploads:any[])=>({id:'fixture',brand:ESTIMATOR_BRAND.id,uploads}) as any;
 try{
  process.env.P5_DOCUMENT_SERVICE_MODE='remote';
  await assert.rejects(advanceDocumentService(owned([pdf,{...pdf,id:'photo',type:'image/png'}]),'',{},'fixture',never,false,Date.now()+1000),/mixed-source routing/);
  await assert.rejects(advanceDocumentService(owned([{...pdf,status:'pending'}]),'',{},'fixture',never,false,Date.now()+1000),/not fully stored/);
  delete process.env.P5_DOCUMENT_SERVICE_MODE;
  await assert.rejects(advanceDocumentService(owned([pdf]),'',{},'fixture',never,false,Date.now()+1000),/not enabled/);
 }finally{if(previous===undefined)delete process.env.P5_DOCUMENT_SERVICE_MODE;else process.env.P5_DOCUMENT_SERVICE_MODE=previous;}
});
test('text-only scopes stay local and mixed progress follows the project key and both branch keys',()=>{
 const draft:any={id:'draft',uploads:[]};
 assert.match(analysisProgressWorkKeys(draft,'typed scope',{}, {P5_DOCUMENT_SERVICE_MODE:'remote'})[0],/^analysis:v8:/);
 const photo={...pdf,id:'photo',name:'elevation.png',type:'image/png',sha256:'b'.repeat(64)};
 draft.uploads=[pdf,photo];
 assert.deepEqual(analysisProgressWorkKeys(draft,'typed scope',{},{}),[analysisWorkKey(draft,'typed scope',{},'local')]);
 const keys=analysisProgressWorkKeys(draft,'typed scope',{}, {P5_DOCUMENT_SERVICE_MODE:'remote'});
 assert.equal(keys.length,3);assert.match(keys[0],/^analysis:document-service-v2:[0-9a-f]{64}$/);
 assert.equal(keys[1],keys[0]+':local');assert.equal(keys[2],keys[0]+':remote');
 const onlyPdf={...draft,uploads:[pdf]},pdfKey=analysisWorkKey(onlyPdf,'typed scope',{},'remote');
 assert.deepEqual(analysisProgressWorkKeys(onlyPdf,'typed scope',{}, {P5_DOCUMENT_SERVICE_MODE:'remote'}),[pdfKey,pdfKey+':remote']);
 assert.match(analysisWorkKey(draft,'typed scope',{},'local'),/^analysis:v8:/);
});
