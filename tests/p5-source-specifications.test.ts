import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readSpecificationSource,specificationSource,unsupportedSpecifications,retainUnspecifiedRatings} from '../lib/p5/sourceSpecificationGuard.ts';
import {analyzeBatch} from '../lib/p5/extraction.ts';
import {scopeQuestionsForBrand} from '../lib/p5/adaptive.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {combineScopeExtractions,type ScopeExtraction} from '../lib/p5/scope.ts';
import {pricingSourceParts} from '../lib/p5/pricingSources.ts';
const empty:ScopeExtraction={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[]};
const visible='Exterior design uses T - or board-and-batten siding. Walls receive light texture; premium Level finishing is excluded. All numbered designations remain blank.';
test('redacted specifications cannot acquire familiar numbers from model knowledge',()=>{
 const source=specificationSource(visible);
 assert.deepEqual(source.gaps,['siding','drywall']);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'T1-11 siding and Level 5 finishing'},source),['T1-11','Level 5']);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'Board-and-batten siding; premium finishing excluded.'},source),[]);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'T1-11 siding'},specificationSource(visible+' The selected alternate is T1-11.')),[]);
});
test('a checked PDF retains unspecified ratings without waiting for another provider',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage(),font=await pdf.embedFont(StandardFonts.Helvetica);
 page.drawText(visible,{x:20,y:650,font,size:8});
 const file={name:'redacted.pdf',type:'application/pdf',data:Buffer.from(await pdf.save()),pages:[{source:'redacted.pdf',page:1}]};
 assert.deepEqual((await readSpecificationSource([file]))?.gaps,['siding','drywall']);
 const vars=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
 const before=Object.fromEntries(vars.map(k=>[k,process.env[k]]));for(const k of vars)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';process.env.ANTHROPIC_API_KEY='fixture-fallback';
 try{
  let calls=0;
  const result=await analyzeBatch('',[file],{},async(_url,init)=>{
   calls++;assert.match(String(_url),/responses$/);const body=JSON.parse(String(init?.body));assert.match(body.instructions,/LOCAL SOURCE CHECK/);assert.match(body.instructions,/nativePdfText/);
   if(calls===2)assert.match(body.instructions,/preceding response incorrectly supplied/);
   return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...empty,summary:calls===1?'T1-11 siding; Level 5 finishing excluded.':'Board-and-batten siding is an option. Premium finishing is excluded; its numbered level is unspecified.',pages:[{source:'redacted.pdf',page:1,sheet:'',revision:'',status:'read',notes:[]}],takeoffs:[]})}]}]});
  });
  assert.equal(calls,1);assert.equal(result.extraction.documentCoverage?.complete,true);assert.match(result.extraction.sourceText||'',/board-and-batten/);
  assert.doesNotMatch(result.extraction.summary,/T1-11|Level 5/);
 }finally{for(const k of vars){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('blank roof, insulation and electrical ratings cannot become assumed code defaults',()=>{
 const source=specificationSource('Roofing includes -year architectural shingles. Insulation targets R- blown attic, R- exterior walls and R- crawl floor. Provide -amp-class service with two -amp garage panels.');
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'30-year roofing; R-49 attic, R-21 walls and R-19 crawl; 400-amp service and two 200-amp panels.'},source),['30-year','R-49','R-21','R-19','400-amp','200-amp']);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'Architectural shingles; attic, wall and crawl insulation; two garage panels. Ratings are unspecified.'},source),[]);
 assert.deepEqual(unsupportedSpecifications({...empty,summary:'R-49 attic'}, {...source,text:source.text+' Visitor confirmed R-49 attic.'}),[]);
});
test('included cabinet locations do not become a single-room choice for whole-project services',()=>{
 const service=ESTIMATOR_BRAND.services.find(value=>!value.startsWith('cabinet-'));
 if(!service)return;
 const conflict={field:'cabinetRoom' as const,values:['kitchen','bathroom'],explanation:'Different included rooms'};
 const extraction={...empty,conflicts:[conflict]};
 const questions=scopeQuestionsForBrand({service},extraction,[conflict]);
 assert.ok(questions.every(q=>q.field!=='cabinetRoom'));assert.equal(extraction.conflicts.length,1);
});

test('native source qualifications survive compressed summaries and reach the pricing audit',()=>{
 const first={...empty,summary:'Cabinets',sourceText:'Main/MIL kitchens, breakfast nook, entry benches and Viking appliance panels.'};
 const second={...empty,summary:'Appliances',sourceText:'Product-only: exclude shipping, tax, delivery, installation and hookups. Ancillary costs are separate.'};
 const merged=combineScopeExtractions([first,second]);
 const priced=pricingSourceParts({text:'',answers:{},extraction:merged,uploads:[],reviewedAt:'2026-09-13',corrections:[]})[0] as {extraction?:ScopeExtraction};
 assert.equal(priced.extraction?.sourceText,first.sourceText+'\n\n'+second.sourceText);
});
test('site clearing is not evidence of new-construction demolition',()=>{
 const source=specificationSource('Site Work & Excavation: Mobilization, light clearing, excavation, backfill. General conditions include dumpsters and haul-off.');
 const extraction={...empty,facts:[{field:'service' as const,value:'new-construction',confidence:1,source:'scope.pdf',evidence:'New house',basis:'stated' as const},{field:'demolition' as const,value:'Light clearing, haul-off and demolition included.',confidence:1,source:'scope.pdf',evidence:'Site work and dumpsters.',basis:'stated' as const}]};
 assert.deepEqual(unsupportedSpecifications(extraction,source),['demolition work']);
 assert.deepEqual(unsupportedSpecifications(extraction,{...source,text:source.text+' Demo the existing shed.'}),[]);
 assert.deepEqual(unsupportedSpecifications({...extraction,facts:[extraction.facts[0],{...extraction.facts[1],value:'Demolition is not separately listed. Site clearing and haul-off are included.'}]},source),[]);
 assert.deepEqual(unsupportedSpecifications({...extraction,facts:[extraction.facts[0],{...extraction.facts[1],value:'Demolition is included, no salvage.'}]},source),['demolition work']);
});
test('partial siding numbers are removed while valid references and negation remain',()=>{
 const source=specificationSource(visible+' Roofing is -year shingles; specified alternate 40-year shingles.');
 const record={...empty,summary:'T1- or board-and-batten; Level 5 finishing excluded; 30-year or 40-year shingles.',documentCoverage:{expectedPages:1,complete:true,pages:[{source:'T1-plans.pdf',page:1,sheet:'T1',revision:'1',status:'read' as const,notes:[]}]}};
 const safe=retainUnspecifiedRatings(record,source);
 assert.doesNotMatch(safe.summary,/T1|Level 5|30-year/);assert.match(safe.summary,/40-year/);assert.match(safe.summary,/excluded/);
 assert.equal(safe.documentCoverage,record.documentCoverage);assert.match(record.summary,/T1-/);
 assert.deepEqual(unsupportedSpecifications(safe,source),[]);
});
