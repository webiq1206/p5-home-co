import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readSpecificationSource,specificationSource,unsupportedSpecifications} from '../lib/p5/sourceSpecificationGuard.ts';
import {analyzeBatch} from '../lib/p5/extraction.ts';
import {scopeQuestionsForBrand} from '../lib/p5/adaptive.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const empty:ScopeExtraction={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[]};
const visible='Exterior design uses T - or board-and-batten siding. Walls receive light texture; premium Level finishing is excluded. All numbered designations remain blank.';
test('redacted specifications cannot acquire familiar numbers from model knowledge',()=>{
 const source=specificationSource(visible);
 assert.deepEqual(source.gaps,['siding','drywall']);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'T1-11 siding and Level 5 finishing'},source),['T1-11','Level 5']);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'Board-and-batten siding; premium finishing excluded.'},source),[]);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'T1-11 siding'},specificationSource(visible+' The selected alternate is T1-11.')),[]);
});
test('a checked PDF gets one bounded correction instead of accepting invented specifications',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage(),font=await pdf.embedFont(StandardFonts.Helvetica);
 page.drawText(visible,{x:20,y:650,font,size:8});
 const file={name:'redacted.pdf',type:'application/pdf',data:Buffer.from(await pdf.save()),pages:[{source:'redacted.pdf',page:1}]};
 assert.deepEqual((await readSpecificationSource([file]))?.gaps,['siding','drywall']);
 const vars=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
 const before=Object.fromEntries(vars.map(k=>[k,process.env[k]]));for(const k of vars)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';
 try{
  let calls=0;
  const result=await analyzeBatch('',[file],{},async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));assert.match(body.instructions,/LOCAL SOURCE CHECK/);
   if(calls===2)assert.match(body.instructions,/preceding response incorrectly supplied/);
   return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...empty,summary:calls===1?'T1-11 siding; Level 5 finishing excluded.':'Board-and-batten siding is an option. Premium finishing is excluded; its numbered level is unspecified.',pages:[{source:'redacted.pdf',page:1,sheet:'',revision:'',status:'read',notes:[]}],takeoffs:[]})}]}]});
  });
  assert.equal(calls,2);assert.equal(result.extraction.documentCoverage?.complete,true);
  assert.doesNotMatch(result.extraction.summary,/T1-11|Level 5/);
 }finally{for(const k of vars){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('included cabinet locations do not become a single-room choice for whole-project services',()=>{
 const service=ESTIMATOR_BRAND.services.find(value=>!value.startsWith('cabinet-'));
 if(!service)return;
 const conflict={field:'cabinetRoom' as const,values:['kitchen','bathroom'],explanation:'Different included rooms'};
 const extraction={...empty,conflicts:[conflict]};
 const questions=scopeQuestionsForBrand({service},extraction,[conflict]);
 assert.ok(questions.every(q=>q.field!=='cabinetRoom'));assert.equal(extraction.conflicts.length,1);
});
