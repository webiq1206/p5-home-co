import test from 'node:test';
import {validateExtraction} from '../lib/p5/scope.ts';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readSpecificationSource,specificationSource,unsupportedSpecifications,retainUnspecifiedRatings} from '../lib/p5/sourceSpecificationGuard.ts';
import {analyzeBatch,EXTRACTION_JSON_SCHEMA} from '../lib/p5/extraction.ts';
import {scopeQuestionsForBrand} from '../lib/p5/adaptive.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {combineScopeExtractions,type ScopeExtraction} from '../lib/p5/scope.ts';
import {pricingSourceParts} from '../lib/p5/pricingSources.ts';
import {scopeForRevision,scopeFingerprint} from '../lib/p5/scopeReplacement.ts';
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
 const vars=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_SCOPE_PROVIDER'];
 const before=Object.fromEntries(vars.map(k=>[k,process.env[k]]));for(const k of vars)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';process.env.ANTHROPIC_API_KEY='fixture-fallback';process.env.P5_SCOPE_PROVIDER='openai';
 try{
  let calls=0;
  const result=await analyzeBatch('',[file],{},async(_url,init)=>{
   calls++;assert.match(String(_url),/responses$/);const body=JSON.parse(String(init?.body));assert.match(body.instructions,/LOCAL SOURCE CHECK/);assert.match(body.instructions,/nativePdfText/);
   if(calls===2)assert.match(body.instructions,/preceding response incorrectly supplied/);
   return Response.json({status:'completed', model:'gpt-4.1-2025-04-14',output:[{content:[{type:'output_text',text:JSON.stringify({...empty,summary:calls===1?'T1-11 siding; Level 5 finishing excluded.':'Board-and-batten siding is an option. Premium finishing is excluded; its numbered level is unspecified.',pages:[{source:'redacted.pdf',page:1,sheet:'',revision:'',status:'read',notes:[]}],takeoffs:[]})}]}]});
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
test('mocked flooring text, image and PDF reader boundaries preserve 300 installed, 330 purchased and exclusions; edits invalidate saved analysis',async()=>{
 const brief='Owner removed old floor. Install 300 SF mid-range LVP over sound level concrete slab; purchase 330 SF including 10% waste. Contractor supplies ordinary installation consumables and minor cleanup. Exclude demolition, floor prep, grinding, leveling, baseboard, transitions, painting, plumbing, electrical and cabinetry.';
 const exclusions=['Demolition','Floor prep','Grinding','Leveling','Baseboard','Transitions','Painting','Plumbing','Electrical','Cabinetry'];
 const record={...empty,summary:brief,instructions:{inclusions:['Supply 330 SF LVP','Install 300 SF LVP','Ordinary installation consumables','Minor cleanup'],exclusions,responsibilities:['Owner removed old flooring','Contractor supplies 330 SF LVP and ordinary installation consumables'],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},facts:[
  {field:'flooringSqft',value:'300',confidence:1,source:'flooring',evidence:'300 SF installed',basis:'stated'},
 ],sourceText:brief};
 const pdf=await PDFDocument.create(),page=pdf.addPage(),font=await pdf.embedFont(StandardFonts.Helvetica);
 page.drawText(brief,{x:20,y:650,font,size:7});
 const inputs=[
  {kind:'text',text:brief,files:[]},
  {kind:'image',text:'',files:[{name:'flooring.png',type:'image/png',data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8HicAAAAASUVORK5CYII=','base64'),pages:[{source:'flooring.png',page:1}]}]},
  {kind:'pdf',text:'',files:[{name:'flooring.pdf',type:'application/pdf',data:Buffer.from(await pdf.save()),pages:[{source:'flooring.pdf',page:1}]}]},
 ];
 const vars=['OPENAI_API_KEY','ANTHROPIC_API_KEY','P5_SCOPE_PROVIDER','P5_TEXT_RACE'];
 const original=Object.fromEntries(vars.map(key=>[key,process.env[key]]));
 for(const key of vars)delete process.env[key];
 process.env.OPENAI_API_KEY='offline-test-only';process.env.P5_SCOPE_PROVIDER='openai';
 try{
  const normalized=[];
  for(const input of inputs){
   let calls=0;
   const result=await analyzeBatch(input.text,input.files,{},async(_url,init)=>{
    calls++;
    assert.match(String(_url),/responses$/);
    const body=JSON.parse(String(init?.body));
    const content=body.input?.[0]?.content||[];
    if(input.kind==='image')assert.ok(content.some((item:any)=>item.type==='input_image'));
    if(input.kind==='pdf')assert.ok(content.some((item:any)=>item.type==='input_file'));
    if(input.kind==='text')assert.ok(content.some((item:any)=>item.type==='input_text'&&String(item.text).includes('330 SF')));
    return Response.json({status:'completed',model:'gpt-4.1-2025-04-14',output:[{content:[{type:'output_text',text:JSON.stringify({...record,pages:input.files.map(file=>({source:file.name,page:1,sheet:'',revision:'',status:'read',notes:[]})),takeoffs:[]})}]}]});
   });
   assert.equal(calls,1,`${input.kind} should use only mocked transport`);
   normalized.push({summary:result.extraction.summary,inclusions:result.extraction.instructions?.inclusions,exclusions:result.extraction.instructions?.exclusions,responsibilities:result.extraction.instructions?.responsibilities,facts:result.extraction.facts.map(f=>[f.field,f.value])});
  }
  assert.deepEqual(normalized[1],normalized[0]);assert.deepEqual(normalized[2],normalized[0]);
  const saved=JSON.parse(JSON.stringify(normalized[0]));
  assert.deepEqual(saved.inclusions,record.instructions.inclusions);
  assert.deepEqual(saved.exclusions,exclusions);
  const old={text:brief,answers:{service:'remodel',flooringSqft:'300'},extraction:record,wizard:{skipped:[],resolutions:{},instructionAnswers:[]},reviewed:{range:{low:1,high:2}},analyzedFingerprint:scopeFingerprint(brief)};
  const revised='Install 320 SF LVP, purchase 352 SF including 10% waste. '+brief.slice(brief.indexOf('Contractor supplies'));
  const edited=scopeForRevision(old as any,revised,'Change installed area to 320 SF and keep exclusions.');
  assert.notEqual(scopeFingerprint(revised),old.analyzedFingerprint);
  assert.equal(edited.analyzedFingerprint,undefined);
  assert.equal(edited.extraction,null);
  assert.equal(edited.reviewed,null);
  assert.equal(edited.answers.flooringSqft,undefined,'old measured area cannot persist into new pricing');
  assert.match(revised,/352 SF/);
  assert.deepEqual(exclusions,saved.exclusions,'the prior saved result remains unchanged and recoverable');
  const updatedRecord={...record,summary:revised,sourceText:revised,instructions:{...record.instructions,inclusions:['Supply 352 SF LVP','Install 320 SF LVP','Ordinary installation consumables','Minor cleanup']},facts:[{...record.facts[0],value:'320',evidence:'320 SF installed'}]};
  const reread=await analyzeBatch(revised,[],edited.answers,async(_url,init)=>{
   const content=JSON.stringify(JSON.parse(String(init?.body)).input);
   assert.match(content,/352 SF/);
   assert.doesNotMatch(content,/300 SF installed/);
   return Response.json({status:'completed',model:'gpt-4.1-2025-04-14',output:[{content:[{type:'output_text',text:JSON.stringify({...updatedRecord,pages:[],takeoffs:[]})}]}]});
  });
  assert.deepEqual(reread.extraction.instructions?.inclusions.slice(0,2),['Supply 352 SF LVP','Install 320 SF LVP']);
  assert.deepEqual(reread.extraction.instructions?.exclusions,exclusions);
  assert.deepEqual(saved.inclusions.slice(0,2),['Supply 330 SF LVP','Install 300 SF LVP'],'the earlier result is not overwritten by the edited reread');
 }finally{for(const key of vars){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
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

test('image source transcription survives review validation even when its interpreted summary omits procurement',()=>{
 const raw={...empty,summary:'Install 300 SF LVP.',sourceText:'Install 300 SF LVP. Purchase 330 SF including 10% material waste. Exclude floor preparation.'};
 const restored=validateExtraction(JSON.parse(JSON.stringify(raw)));
 assert.equal(restored.sourceText,raw.sourceText);
 const active=pricingSourceParts({text:'',answers:{flooringSqft:'300'},extraction:restored,uploads:[],reviewedAt:'2026-09-29',corrections:[]})[0] as {extraction?:ScopeExtraction};
 assert.equal(active.extraction?.sourceText,raw.sourceText);
 assert.ok(EXTRACTION_JSON_SCHEMA.required.includes('sourceText'),'the image reader must return retained source details, not only interpreted fields');
});
