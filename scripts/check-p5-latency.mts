/** Isolated provider acceptance. No draft, submission, outbox, email or CRM writes.
 * Supply an already-authorized local PDF or use the synthetic typed fixture. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {analyzeScope} from '../lib/p5/extraction.ts';
import {reconcileScope,scopeQuestionsForBrand as scopeQuestions} from '../lib/p5/adaptive.ts';
import {applyCabinetIntent} from '../lib/p5/projectIntent.ts';
import {SCOPE_FIELDS} from '../lib/p5/scope.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
const index=process.argv.indexOf('--file');
const filename=index>=0?process.argv[index+1]:'';
const files=filename?[{name:'Acceptance scope.pdf',type:'application/pdf',data:await readFile(filename)}]:[];
const hasCabinet=(ESTIMATOR_BRAND.services as readonly string[]).includes('cabinet-install');
const text=files.length?'':hasCabinet?'Supply and install two cabinets with 9 knobs. Assembly is 2 hours and cabinet installation is 8 hours. Choose one bench top: butcher block 5 hours, painted MDF/wood 4 hours, laminate 2 hours, quartz 5 hours. Cabinet lengths have not been measured. Exclude plumbing and electrical.':'Build a 20 by 30 foot single-story addition, 600 square feet of living space. No garage. Standard finishes. Include framing, insulation and drywall. Exclude appliance supply and landscaping.';
const providerDiagnostics:unknown[]=[];
const observedFetch:typeof fetch=async(input,init)=>{
 const response=await fetch(input,init);
 try{
  const body=await response.clone().json();
  const tool=body.content?.find((part:any)=>part.type==='tool_use'&&part.name==='record_scope_analysis');
  const text=body.output?.flatMap((part:any)=>part.content||[]).find((part:any)=>part.type==='output_text')?.text;
  let record=tool?.input||(text?JSON.parse(text):null);if(record?.parameters)record=record.parameters;
  providerDiagnostics.push({model:body.model,status:response.status,facts:(record?.facts||[]).map((fact:any)=>({field:Object.hasOwn(SCOPE_FIELDS,fact.field)?fact.field:'unknown',valueType:fact.value===null?'null':Array.isArray(fact.value)?'array':typeof fact.value,blank:fact.value==null||typeof fact.value==='string'&&!fact.value.trim(),confidenceType:typeof fact.confidence,sourcePresent:typeof fact.source==='string'&&!!fact.source.trim(),evidencePresent:typeof fact.evidence==='string'&&!!fact.evidence.trim()}))});
 }catch{}
 return response;
};
const start=performance.now();
let result;
const visitorAnswers=applyCabinetIntent(text,ESTIMATOR_BRAND.services,{}).answers;
try{result=await analyzeScope(text,files,visitorAnswers,observedFetch);}catch(error){
 console.log(JSON.stringify({brand:ESTIMATOR_BRAND.id,elapsedMs:Math.round(performance.now()-start),complete:false,providerDiagnostics,error:error instanceof Error?error.message:'analysis-failed'},null,2));
 process.exit(1);
}
const elapsedMs=Math.round(performance.now()-start);
// Provider validation has already produced the normalized coverage ledger.
const extraction=applyCabinetIntent(text,ESTIMATOR_BRAND.services,visitorAnswers,result.extraction).extraction!;
const merged=reconcileScope(visitorAnswers,extraction);
const questions=scopeQuestions(merged.answers,extraction,merged.conflicts);
const expectedPages=files.length?(await PDFDocument.load(files[0].data)).getPageCount():0;
const report={brand:ESTIMATOR_BRAND.id,elapsedMs,under60Seconds:elapsedMs<60000,provider:result.provider,model:result.model,input:files.length?{bytes:files[0].data.length,sha256:createHash('sha256').update(files[0].data).digest('hex'),expectedPages}:{typedFixture:true},readPages:extraction.documentCoverage?.pages.filter(p=>p.status==='read').length||0,complete:files.length?Boolean(extraction.documentCoverage?.complete)&&extraction.documentCoverage?.expectedPages===expectedPages:true,takeoffCount:extraction.takeoffs?.length||0,unresolvedNotes:extraction.reviewNotes,answers:Object.fromEntries(Object.entries(merged.answers).filter(([key])=>!['address','location'].includes(key))),firstQuestion:questions[0]||null,questionCount:questions.length};
console.log(JSON.stringify(report,null,2));
if(!report.under60Seconds||!report.complete)process.exitCode=1;
