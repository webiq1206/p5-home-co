/** Opt-in live-provider benchmark. Fixtures/results stay private and off CI. */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {signedHeaders,hash} from '../src/core.mjs';
import {measureQuality,percentiles,summarizeStages} from '../src/benchmark-metrics.mjs';
const env=process.env;
const {DOCUMENT_BENCHMARK_URL:base,DOCUMENT_BENCHMARK_KEY:key,DOCUMENT_BENCHMARK_TENANT:tenant,DOCUMENT_BENCHMARK_PDF:file,DOCUMENT_BENCHMARK_TRUTH:truthFile}=env;
if(!base||!key||!tenant||!file)throw Error('Set DOCUMENT_BENCHMARK_URL, KEY, TENANT and PDF.');
const origin=new URL(base);
if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Use a plain HTTPS service origin.');
const concurrency=(env.DOCUMENT_BENCHMARK_CONCURRENCY||'1').split(',').map(Number),repeats=Number(env.DOCUMENT_BENCHMARK_REPEATS||1);
if(concurrency.some(n=>![1,5,10].includes(n))||!Number.isInteger(repeats)||repeats<1||repeats>100)throw Error('Use concurrency 1, 5, 10 and repeats 1..100. Existing provider budgets remain enforced.');
const bytes=await readFile(file),truth=truthFile?JSON.parse(await readFile(truthFile,'utf8')):null;
if(truth&&truth.sourceSha256!==hash(bytes))throw Error('Ground truth must identify the exact benchmark file digest.');
const request=async(method,path,body=Buffer.alloc(0),type='application/json')=>{
 const r=await fetch(new URL(path,origin),{method,headers:{...signedHeaders(key,method,path,tenant,body),'content-type':type},...(method==='POST'?{body}:{}),signal:AbortSignal.timeout(90000),redirect:'error'});
 const data=await r.json();if(!r.ok)throw Error('Service '+r.status+': '+(data.error||'request-failed'));return data;
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(level,repeat,index){
 const project='benchmark-'+randomUUID(),path=`/v1/projects/${project}`,started=performance.now();
 const report={project,concurrency:level,repeat,index,sourceBytes:bytes.length,sourceSha256:hash(bytes),accuracyMeasured:false,success:false};
 let documentId,reviewId;
 try{
  const uploaded=await request('POST',path+'/documents?name=benchmark.pdf',bytes,'application/pdf');documentId=uploaded.id;
  report.uploadMs=Math.round(performance.now()-started);
  const review=await request('POST',path+'/reviews',Buffer.from(JSON.stringify({documents:[{id:documentId,source:'benchmark.pdf'}],text:env.DOCUMENT_BENCHMARK_SCOPE||'Extract the complete included construction scope. Preserve exclusions and absent values.',answers:{}})));reviewId=review.id;
  let doc,result;const until=Date.now()+600000;
  do{
   [doc,result]=await Promise.all([request('GET',path+'/documents/'+documentId),request('GET',path+'/reviews/'+reviewId)]);
   if(doc.state==='failed'||result.state==='failed')throw Error(doc.error||result.error);
   if(doc.state==='complete'&&report.documentMs===undefined)report.documentMs=Math.round(performance.now()-started)-report.uploadMs;
   if(doc.state==='complete'&&result.state==='complete')break;
   if(Date.now()>until)throw Error('Benchmark timed out before all processing completed');
   await sleep(250);
  }while(true);
  report.customerElapsedMs=Math.round(performance.now()-started);report.processingThroughReviewMs=report.customerElapsedMs-report.uploadMs;
  report.pages=doc.progress.totalPages;report.coverage=doc.coverage;
  if(!doc.coverage?.complete||result.result.pages?.some(p=>p.status!=='read')||result.result.pages?.length!==report.pages)throw Error('Unverified source pages remain. This is a failed reading qualification.');
  report.result=result.result;
  if(truth){report.quality=measureQuality(truth,result.result);report.accuracyMeasured=true;}
  report.success=true;
 }catch(error){report.error=error.message;process.exitCode=1;}
 finally{
  report.customerElapsedMs??=Math.round(performance.now()-started);
  const events=[];
  for(const [kind,id] of [['documents',documentId],['reviews',reviewId]])if(id){try{events.push(...(await request('GET',`${path}/${kind}/${id}/metrics`)).events);}catch{report.metricsIncomplete=true;}}
  report.stageWork=summarizeStages(events);
 }
 return report;
}
const report={benchmark:'live-service',createdAt:new Date().toISOString(),runs:[],groups:[],notes:[
 'Upload measures benchmark runner to worker ingress, not browser to website plus website to worker.',
 'Processing includes queue, parsing, all required AI verification and reconciliation.',
 'A sample p95 is not a production SLA. Small sample sizes are explicitly unqualified.',
 'Review metadata is an attestation supplied by the reviewer, not independently verified by this command.',
 'Private result files contain source facts. Never publish as public CI artifacts.'
]};
for(const level of concurrency){
 const runs=[];
 for(let repeat=0;repeat<repeats;repeat++)runs.push(...await Promise.all(Array.from({length:level},(_,i)=>run(level,repeat,i))));
 report.runs.push(...runs);
 const passed=runs.filter(r=>r.success),latency=percentiles(passed.map(r=>r.processingThroughReviewMs));
 report.groups.push({concurrency:level,attempted:runs.length,completed:passed.length,failed:runs.length-passed.length,processingMs:latency,customerElapsedMs:percentiles(runs.map(r=>r.customerElapsedMs)),sampleSufficient:passed.length>=20,p95Within60Seconds:passed.length===runs.length&&passed.length>=20&&latency.p95<=60000,qualityMeasured:passed.every(r=>r.accuracyMeasured)&&passed.length>0});
 await writeFile('benchmark-result.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report.groups.at(-1)));
}
