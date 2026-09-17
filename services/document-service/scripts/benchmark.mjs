/** Opt-in REAL service benchmark. No mocked responses and no baked-in success. */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {signedHeaders} from '../src/core.mjs';
const {DOCUMENT_BENCHMARK_URL:base,DOCUMENT_BENCHMARK_KEY:key,DOCUMENT_BENCHMARK_TENANT:tenant,DOCUMENT_BENCHMARK_PDF:file,DOCUMENT_BENCHMARK_TRUTH:truthFile}=process.env;
if(!base||!key||!tenant||!file)throw Error('Set DOCUMENT_BENCHMARK_URL, KEY, TENANT and PDF. Optional TRUTH is independently reviewed expected facts.');
if(!base.startsWith('https://'))throw Error('Benchmark target must use HTTPS.');
const bytes=await readFile(file),project='benchmark-'+randomUUID();
const request=async(method,path,body=Buffer.alloc(0),type='application/json')=>{const r=await fetch(new URL(path,base),{method,headers:{...signedHeaders(key,method,path,tenant,body),'content-type':type},...(method==='POST'?{body}:{}),signal:AbortSignal.timeout(90000),redirect:'error'});const data=await r.json();if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const started=performance.now();let report={benchmark:'real-service',project,sourceBytes:bytes.length,accuracyMeasured:false};
try{
 const path=`/v1/projects/${project}`,name='benchmark.pdf';
 const uploaded=await request('POST',path+'/documents?name='+encodeURIComponent(name),bytes,'application/pdf');report.uploadMs=Math.round(performance.now()-started);
 let doc;const until=Date.now()+600000;
 do{await sleep(500);doc=await request('GET',path+'/documents/'+uploaded.id);if(doc.state==='failed')throw Error(doc.error);if(Date.now()>until)throw Error('Benchmark timed out without complete source reading');}while(doc.state!=='complete');
 report.documentMs=Math.round(performance.now()-started)-report.uploadMs;report.pages=doc.progress.totalPages;report.coverage=doc.coverage;report.within60Seconds=report.documentMs<=60000;
 const review=await request('POST',path+'/reviews',Buffer.from(JSON.stringify({documents:[{id:uploaded.id,source:name}],text:process.env.DOCUMENT_BENCHMARK_SCOPE||'Extract the complete included construction scope. Preserve exclusions and absent values.',answers:{}})));
 let result;do{await sleep(500);result=await request('GET',path+'/reviews/'+review.id);if(result.state==='failed')throw Error(result.error);if(Date.now()>until)throw Error('Benchmark timed out in scope reconciliation');}while(result.state!=='complete');
 report.customerElapsedMs=Math.round(performance.now()-started);report.processingThroughReviewMs=report.customerElapsedMs-report.uploadMs;report.result=result.result;
 if(truthFile){
  const truth=JSON.parse(await readFile(truthFile,'utf8'));if(!Array.isArray(truth.facts)||!truth.facts.length)throw Error('Truth fixture must contain a nonempty facts array.');
  const key=f=>JSON.stringify([f.field,String(f.value),f.source||name]);const wanted=new Set(truth.facts.map(key)),actual=new Set(result.result.facts.map(key));const tp=[...wanted].filter(k=>actual.has(k)).length;
  report.factMetrics={truePositives:tp,expected:wanted.size,returned:actual.size,precision:actual.size?tp/actual.size:0,recall:tp/wanted.size,missing:[...wanted].filter(k=>!actual.has(k)),unexpected:[...actual].filter(k=>!wanted.has(k))};report.accuracyMeasured=true;
 }
 report.note='A single run is not a p95/p99 or 99.9% quality certification. Fact metrics do not measure final construction cost accuracy.';
}catch(e){report.error=e.message;process.exitCode=1;}
finally{await writeFile('benchmark-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pages:report.pages,documentMs:report.documentMs,processingThroughReviewMs:report.processingThroughReviewMs,accuracyMeasured:report.accuracyMeasured,error:report.error}));}
