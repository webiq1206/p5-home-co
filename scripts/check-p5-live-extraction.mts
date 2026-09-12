import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {analyzeBatch,AnalysisBusyError,type AnalysisFile} from '../lib/p5/extraction';
import {analysisSegments} from '../lib/p5/analysisWork';
import {combineScopeExtractions} from '../lib/p5/scope';
import {analysisConcurrency} from '../lib/p5/analysisProgress';
import {combineCoverage} from '../lib/p5/documentLedger';

// Explicitly opt-in paid provider test. Synthetic plans only. This calls the
// configured extraction service but never creates drafts, rates, leads or mail.
if(process.env.P5_RUN_LIVE_EXTRACTION!=='true')throw new Error('Set P5_RUN_LIVE_EXTRACTION=true only for an authorized real-provider verification.');
const count=Number(process.env.P5_LIVE_TEST_PAGES||256);
assert.ok(Number.isInteger(count)&&count>=8&&count<=256);
const instructions='Price only first-floor trim installation labor for Building Alpha. Exclude all plumbing and second-floor work. The owner supplies every material. Retain each unique trim mark and its printed linear feet. Treat repeated marks as the same physical item.';
const pdf=await PDFDocument.create();
for(let i=0;i<count;i++){
 const p=pdf.addPage([612,792]);
 const lines=[`SYNTHETIC VALIDATION PLAN / A${String(i+1).padStart(3,'0')} / REV 1`,`BUILDING ALPHA / FIRST FLOOR`,`TRIM MARK T-${i+1}: ${120+i} LF, INSTALLATION LABOR ONLY`,`DO NOT COUNT THIS MARK MORE THAN ONCE.`,`PLUMBING P-${i+1}: 1 FAUCET (EXCLUDED FROM REQUESTED TRIM SCOPE)`,`SECOND FLOOR S-${i+1}: 500 LF TRIM (EXCLUDED)`,`OWNER SUPPLIES ALL MATERIALS.`,`Sheet ${i+1} of ${count}`];
 lines.forEach((line,j)=>p.drawText(line,{x:36,y:744-j*36,size:11}));
}
const data=Buffer.from(await pdf.save());const units:AnalysisFile[]=[];
for await(const unit of analysisSegments({name:'synthetic-validation-plans.pdf',type:'application/pdf',data}))units.push(unit);
let position=0,cooldownUntil=0;const results:any[]=[],timings:any[]=[],errors:string[]=[],providerErrors:any[]=[];const started=performance.now();
const diagnosticFetch:typeof fetch=async(url,init)=>{
 const response=await fetch(url,init);
 if(!response.ok){let body:any;try{body=await response.clone().json();}catch{}
  providerErrors.push({status:response.status,provider:String(url).includes('anthropic')?'Anthropic':'OpenAI',retryAfter:response.headers.get('retry-after'),errorType:body?.error?.type,code:body?.error?.code,message:String(body?.error?.message||'').replace(/(?:sk|key|token)[-_][A-Za-z0-9_-]+/gi,'[redacted]').slice(0,600)});
 }
 return response;
};
await Promise.all(Array.from({length:analysisConcurrency()},async()=>{
 while(position<units.length){const index=position++,unit=units[index],start=performance.now();
  for(let attempt=0;attempt<8;attempt++){
   while(cooldownUntil>Date.now())await new Promise(r=>setTimeout(r,Math.min(1000,cooldownUntil-Date.now())));
   try{const result=await analyzeBatch(instructions,[unit],{estimatingInstructions:instructions,service:'handyman'},diagnosticFetch,120000);results[index]=result.extraction;timings.push({pages:unit.pages?.map(p=>p.page),milliseconds:Math.round(performance.now()-start),provider:result.provider,model:result.model,attempts:attempt+1});break;}
   catch(error){if(error instanceof AnalysisBusyError&&attempt<7){cooldownUntil=Math.max(cooldownUntil,Date.now()+error.retryAfterMs);continue;}if(attempt<1)continue;errors.push(`${unit.name}: ${error instanceof Error?error.message:'failed'}`);break;}
  }
 }
}));
const extraction=combineScopeExtractions(results.filter(Boolean));
extraction.documentCoverage=combineCoverage(results.filter(Boolean).flatMap(r=>r.documentCoverage?[r.documentCoverage]:[]),units.flatMap(u=>u.pages||[]));
const takeoffs=extraction.takeoffs||[];
const quantityCoverage=Array.from({length:count},(_,i)=>({page:i+1,quantity:120+i,present:takeoffs.some(t=>t.quantity===120+i&&t.sources.some(s=>s.page===i+1))}));
const unexpectedTakeoffs=takeoffs.filter(t=>/plumb|faucet|second floor/i.test(t.description+' '+t.component+' '+t.floor));
const report={synthetic:true,externalWrites:'Only authorized provider inference; no business database writes or deliveries.',pages:count,elapsedMs:Math.round(performance.now()-started),timings,errors,providerErrors,pageCoverage:extraction.documentCoverage,quantityCoverage,unexpectedTakeoffs,instructions:extraction.instructions,reviewNotes:extraction.reviewNotes,takeoffs};
await mkdir('p5-verification',{recursive:true});await writeFile('p5-verification/live-extraction-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({pages:count,read:extraction.documentCoverage?.pages.filter(p=>p.status==='read').length,quantitiesFound:quantityCoverage.filter(p=>p.present).length,unexpectedTakeoffs:unexpectedTakeoffs.length,errors:errors.length,elapsedMs:report.elapsedMs,report:'p5-verification/live-extraction-report.json'}));
assert.equal(errors.length,0);assert.equal(extraction.documentCoverage?.expectedPages,count);assert.equal(extraction.documentCoverage?.complete,true);
assert.equal(quantityCoverage.filter(p=>p.present).length,count,'Every unique printed trim quantity must be retained, including the final sheet');
assert.equal(unexpectedTakeoffs.length,0,'Excluded plumbing and second-floor work must not become included takeoffs');
assert.equal(extraction.instructions?.laborOnly,true);assert.ok(extraction.instructions?.exclusions.length);
