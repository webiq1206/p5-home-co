import {PricingPending,PricingStageTimeout} from '../lib/p5/pricingProgress.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {priceCompleteScope,marketResolution,planningResolution,catalogResolution,requestPricing,requestPricingWith,advisoryIssue,type PricingRequest,HANDOFF_ISSUE} from '../lib/p5/scopePricing.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
// The brand that records provider charges (P5 Home Co) keeps them in memory during tests; other brands ignore this.
process.env.P5_PRICING_LEDGER_TEST_MODE||='memory';
const date='2026-09-11T00:00:00.000Z',now=new Date(date);
const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','TEST-DOOR-M','TEST-DOOR-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic fixture',authorizedBy:'Test only',importedAt:date,rates:codes.map(code=>({code,description:code.includes('DOOR')?'Door':code.includes('03-16')?'Tile':'Synthetic work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':code.includes('DOOR')?'EA':code.includes('03-16')?'SF':'LF',amount:100,source:'Synthetic fixture',basis:'owner-average-cost'}))};
const config=createPlanningConfiguration(catalog);
const scope:ReviewedScope={text:'Supply ten feet of cabinetry and a specialty protective overlay.',answers:{service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise'},extraction:null,uploads:[],reviewedAt:date,corrections:[]};
const base=priceReviewedScope(scope,config,now);
const ids=(base.internal as any).lines.map((l:any)=>l.id);
const task={id:'cabinets',description:'Cabinet supply',evidence:'ten feet',existingLineIds:ids,additions:[],researchDescription:'',issues:[]};
const extra={id:'overlay',description:'Protective overlay',evidence:'ten feet',existingLineIds:[],additions:[],researchDescription:'Protective cabinet overlay',issues:[]};
const source=(url:string,low:number,high:number)=>({url,low,high,unit:'LF',costBasis:'material-purchase',sourceType:'regional-guide',dateBasis:'published',publishedAt:'2026-09-01',region:'Boise, Idaho',excerpt:`Material price ${low} to ${high} dollars per linear foot.`});
const urls=['https://supplier-a.example/pricing','https://supplier-b.example/pricing'];
// Synthetic published observations for tests only, never business price data.
const publishedFixture=(value:any)=>({...value,rates:value.rates.map(({low,high,confidence,rationale,...rate}:any)=>({...rate,sources:urls.map(url=>({...source(url,low,high),unit:rate.unit,costBasis:rate.basis,region:'Boise, Idaho',excerpt:'Synthetic test price observation only.'}))}))});
const adjustmentEvidence={url:urls[0],publishedAt:'',dateBasis:'retrieved' as const,region:'Synthetic test region',excerpt:'Synthetic fixture price includes tax and pickup with no additional freight charge.'};
const purchaseAdjustments={taxRate:0,freightPerUnit:0,taxOnFreight:false,taxEvidence:adjustmentEvidence,freightEvidence:adjustmentEvidence};
const researched={rates:[{taskId:'overlay',description:'Protective overlay',unit:'LF',quantity:10,quantityEvidence:'Ten feet requested',basis:'material-purchase',includes:'overlay material',excludes:'',landedCost:purchaseAdjustments,sources:[source(urls[0],10,20),source(urls[1],20,30)]}],issues:[]};
const replies=(values:unknown[]):PricingRequest=>{const first=values[0] as {tasks:typeof task[]};const queue=[{tasks:first.tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},...values];return async()=>({value:queue.shift(),sourceUrls:urls});};
test('an unmapped missing rate automatically enters evidenced research without a model opt-in',async()=>{
 const mapping={tasks:[task,{...extra,researchDescription:'',additions:[{code:'MISSING',quantity:10,quantityEvidence:'10 LF'}]}],issues:[]};
 const result=await priceCompleteScope(scope,config,replies([mapping,researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(result.customer.range);
 assert.ok((result.internal as any).costBookSnapshot.rules.some((rule:any)=>rule.id.startsWith('market-')&&rule.unitCost===20));
});
test('missing-rate routing preserves existing prices, exclusions and quantity validation',async()=>{
 const {routeUnpricedTasks}=await import('../lib/p5/scopePricing.ts');
 const missing={...extra,researchDescription:'',existingLineIds:[],additions:[]};
 const excluded={...missing,id:'excluded',description:'Protective overlay not included'};
 const mapped={...missing,id:'mapped',additions:[{code:'03-15-02-M',quantity:999,quantityEvidence:'999 LF'}]};
 const mapping={tasks:[missing,excluded,mapped,{...task}],notes:[],issues:[],replacements:[],removeExclusions:[]};
 routeUnpricedTasks(mapping,config,(base.internal as any).lines,true);
 assert.equal(missing.researchDescription,missing.description);assert.equal(excluded.researchDescription,'');assert.equal(mapped.researchDescription,'');assert.equal(mapping.tasks[3].researchDescription,'');
 assert.ok(catalogResolution(mapping as any,config,(base.internal as any).lines,now,scope).issues.some(issue=>issue.includes('mapped 999')));
});
test('a mixed task researches its unavailable components while retaining valid labor once',async()=>{
 const {routeUnpricedTasks,coveredWork}=await import('../lib/p5/scopePricing.ts');
 const mixed={...extra,description:'Install 9 LF owner-supplied cabinets including contractor screws and shims',researchDescription:'',additions:[{code:'03-15-02-L',quantity:9,quantityEvidence:'9 LF'},{code:'PB-12-19-02-M',quantity:9,quantityEvidence:'9 LF'}]};
 const mapping={tasks:[mixed],notes:[],issues:[],replacements:[],removeExclusions:[]};
 routeUnpricedTasks(mapping,config,[],false);
 assert.deepEqual(mixed.additions.map(addition=>addition.code),['03-15-02-L']);
 assert.match(mixed.researchDescription,/still-unpriced components/);
 assert.match(mixed.researchDescription,/without charging them again/);
 const labor={id:'scope-1',scopeTaskId:mixed.id,description:'9 LF installation labor',quantity:{fixed:9,factor:1},unit:'LF',unitCost:100};
 assert.deepEqual(coveredWork(mixed,[{...labor,quantity:9}], [labor as any]),[{description:labor.description,quantity:9,unit:'LF'}]);
});
test('Provider failure cannot publish the otherwise available partial range',async()=>{
 assert.ok(base.customer.range);
 const r=await priceCompleteScope(scope,config,async()=>{throw new Error('offline')},now);
 assert.equal(r.customer.range,null);assert.ok(r.internal.scopePricing.issues.length);
});
test('A mapped task plus an unsupported task cannot masquerade as complete',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:''}],issues:[]},{coveredTaskIds:['cabinets'],issues:['Overlay is unpriced']}]),now);
 assert.equal(r.customer.range,null);
});
test('an excluded permit needs no positive price or covered-task ID',async()=>{
 const excluded={...extra,id:'permit',description:'Permit for this work is not included due to minor repair/nature of scope.',evidence:'Permit not included for this defined scope.',researchDescription:''};
 let calls=0;const queued=replies([{tasks:[task,excluded],issues:[]},{coveredTaskIds:['cabinets'],issues:[]}]);
 const result=await priceCompleteScope(scope,config,async(...args)=>{calls++;return queued(...args);},now);
 assert.ok(result.customer.range,'nonbillable inventory commentary cannot hold a complete estimate');
 assert.equal(calls,3,'no futile repair request for a price on excluded work');
 assert.ok(!(result.internal as any).lines.some((line:any)=>line.scopeTaskId==='permit'),'the exclusion is never charged');
});
test('a separately priced vanity top cannot overlap its cabinet package and faucets use fixture labor',async()=>{
 const {normalizeConsumableMapping}=await import('../lib/p5/scopePricing.ts');
 const rates=[
  {code:'PB-12-41-02',description:'Double vanity 60-72 in, installed incl. top',type:'Subcontractor',unit:'EA',amount:3850},
  {code:'PB-12-36-02',description:'Quartz countertop',type:'Subcontractor',unit:'SF',amount:78.75},
  {code:'PB-22-41-08',description:'Bath faucet material',type:'Material',unit:'EA',amount:225},
  {code:'PB-22-01-09',description:'Vanity replacement labor',type:'Labor',unit:'EA',amount:400},
  {code:'PB-22-42-02',description:'Faucet install labor',type:'Labor',unit:'EA',amount:190},
 ].map(rate=>({...rate,source:'Synthetic approved fixture',basis:'owner-average-cost'}));
 const configuration=createPlanningConfiguration({...catalog,rates:[...catalog.rates,...rates as PlanningCatalog['rates']]});
 const addition=(code:string,quantity:number)=>({code,quantity,quantityEvidence:`${quantity} units expressly requested`});
 const tasks=[
  {...extra,id:'vanity',description:'Supply and install one mid-range 60-inch double-sink bathroom vanity cabinet',researchDescription:'',additions:[addition('PB-12-41-02',1)]},
  {...extra,id:'top',description:'Supply and install 8.33 SF quartz countertop',researchDescription:'',additions:[addition('PB-12-36-02',8.33)]},
  {...extra,id:'faucets',description:'Supply and install two standard lavatory faucets for the new double-sink vanity',researchDescription:'',additions:[addition('PB-22-41-08',2),addition('PB-22-01-09',1)]},
 ];
 const mapping={tasks,notes:[],issues:[],replacements:[],removeExclusions:[]};
 normalizeConsumableMapping(mapping,configuration,[],{...scope,answers:{service:'bathroom',location:'Boise'}});
 assert.deepEqual(tasks[0].additions,[]);
 assert.match(tasks[0].researchDescription,/Cabinet only/);
 assert.match(tasks[0].researchDescription,/Exclude countertop/);
 assert.equal(tasks[1].additions[0].code,'PB-12-36-02');
 assert.deepEqual(tasks[2].additions.map(a=>[a.code,a.quantity]),[['PB-22-41-08',2],['PB-22-42-02',2]]);
 // An unbundled installation task lacking a defensible count gets researched,
 // not a guessed count and not the cost of a second vanity.
 const laborOnly={...tasks[2],researchDescription:'',additions:[addition('PB-22-01-09',1)]};
 normalizeConsumableMapping({...mapping,tasks:[laborOnly]},configuration,[],scope);
 assert.deepEqual(laborOnly.additions,[]);
 assert.match(laborOnly.researchDescription,/Faucet installation labor only/);
});
test('a sixty-inch vanity cannot use a smaller cabinet assembly rate',async()=>{
 const vanityScope:ReviewedScope={...scope,text:'Install one 60-inch single-sink vanity.',answers:{service:'bathroom',location:'Boise'}};
 const vanityConfig=createPlanningConfiguration({...catalog,rates:[...catalog.rates,
  {code:'QA-SMALL-VANITY',description:'Vanity, single 24-36 in, installed incl. top.',type:'Subcontractor',unit:'EA',amount:1000,source:'Synthetic approved book',basis:'owner-average-cost'},
  {code:'QA-CORRECT-VANITY',description:'Vanity, single 60 in, installed incl. top.',type:'Subcontractor',unit:'EA',amount:1600,source:'Synthetic approved book',basis:'owner-average-cost'},
 ]});
 const vanity={...extra,id:'vanity',description:'Install new 60-inch mid-range, single-sink vanity (contractor-supplied)',evidence:vanityScope.text,researchDescription:'',additions:[{code:'QA-SMALL-VANITY',quantity:1,quantityEvidence:'One vanity'}]};
 const mapping={tasks:[vanity],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const wrong=catalogResolution(mapping,vanityConfig,[],now,vanityScope);
 assert.equal(wrong.rules.length,0);assert.match(wrong.issues.join(' '),/catalog vanity size does not match/);
 const correct=catalogResolution({...mapping,tasks:[{...vanity,additions:[{...vanity.additions[0],code:'QA-CORRECT-VANITY'}]}]},vanityConfig,[],now,vanityScope);
 assert.equal(correct.rules.length,1);assert.deepEqual(correct.issues,[]);
 const smallerExisting={id:'small-vanity',category:'subcontractors',description:'Vanity, single 24-36 in, installed incl. top.',unit:'EA',quantity:1,unitCost:1000};
 const reused=catalogResolution({...mapping,tasks:[{...vanity,additions:[],existingLineIds:[smallerExisting.id]}]},vanityConfig,[smallerExisting] as Parameters<typeof catalogResolution>[2],now,vanityScope);
 assert.match(reused.issues.join(' '),/catalog vanity size does not match/);
 const fixed={...mapping,tasks:[{...vanity,additions:[{...vanity.additions[0],code:'QA-CORRECT-VANITY'}]}]};
 const repaired=await priceCompleteScope(vanityScope,vanityConfig,replies([mapping,{coveredTaskIds:['vanity'],issues:[]},fixed,{coveredTaskIds:['vanity'],issues:[]}]),now);
 assert.ok(repaired.customer.range,'a compatible corrected size can release after the final audit');
 const held=await priceCompleteScope(vanityScope,vanityConfig,replies([mapping,{coveredTaskIds:['vanity'],issues:[]},mapping,{coveredTaskIds:['vanity'],issues:[]}]),now);
 assert.equal(held.customer.range,null,'model approval cannot override the size mismatch');

});
test('a repaired catalog reference can be replaced by a real positive addition',async()=>{
 const broken={...extra,researchDescription:'',existingLineIds:['03-15-02-M'],additions:[]};
 const fixed={...broken,existingLineIds:[],additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]};
 const result=await priceCompleteScope(scope,config,replies([{tasks:[task,broken],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]},{tasks:[task,fixed],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(result.customer.range,'a supported added line resolves the old bad reference');
 assert.ok(!(result.internal as any).scopePricing.issues.some((issue:string)=>issue.includes('invalid existing price reference')));
});
test('a repair may cover an unpriced task through a positive existing component',async()=>{
 const broken={...extra,researchDescription:'',existingLineIds:[],additions:[]};
 const fixed={...broken,existingLineIds:ids};
 const result=await priceCompleteScope(scope,config,replies([{tasks:[task,broken],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]},{tasks:[task,fixed],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(result.customer.range,'verified positive references resolve the placeholder');
});
test('Semantic mapping uses the existing cost amount without inventing a rate',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet fixture conversion'}]}],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(r.customer.range);assert.equal((r.internal as any).lines.find((l:any)=>l.id==='scope-1').unitCost,100);
 assert.notEqual(r.internal.revision,base.internal.revision);
});
test('smoke-alarm labor cannot use a video-doorbell rate, and a verified repair can release it',async()=>{
 const deviceConfig=createPlanningConfiguration({...catalog,rates:[...catalog.rates,
  {code:'QA-SMOKE',description:'Smoke detector replacement (labor only)',type:'Labor',unit:'EA',amount:65,source:'Synthetic approved book',basis:'owner-average-cost'},
  {code:'QA-BELL',description:'Video doorbell install (labor only)',type:'Labor',unit:'EA',amount:140,source:'Synthetic approved book',basis:'owner-average-cost'},
 ]});
 const alarmScope:ReviewedScope={...scope,text:'Install 2 owner-supplied battery-powered smoke alarms. Labor only.',answers:{service:'re10',location:'Boise'}};
 const wrong={...extra,id:'alarms',description:'Install 2 owner-supplied battery-powered smoke alarms.',evidence:'Install 2 battery-powered smoke alarms; owner supplies alarms.',researchDescription:'',additions:[{code:'QA-BELL',quantity:2,quantityEvidence:'Two alarms requested'}]};
 const correct={...wrong,additions:[{...wrong.additions[0],code:'QA-SMOKE'}]};
 const mapping=(t:typeof wrong)=>({tasks:[t],issues:[],notes:[],replacements:[],removeExclusions:[]});
 const rejected=catalogResolution(mapping(wrong),deviceConfig,[],now,alarmScope);
 assert.equal(rejected.rules.length,0);
 assert.match(rejected.issues.join(' '),/catalog device does not match/);
 const valid=catalogResolution(mapping(correct),deviceConfig,[],now,alarmScope);
 assert.equal(valid.rules[0].unitCost,65);
 const repaired=await priceCompleteScope(alarmScope,deviceConfig,replies([mapping(wrong),{coveredTaskIds:['alarms'],issues:[]},mapping(correct),{coveredTaskIds:['alarms'],issues:[]}]),now);
 assert.ok(repaired.customer.range,'a compatible accepted replacement clears this specific mismatch');
 assert.equal((repaired.internal as any).lines.filter((line:any)=>line.scopeTaskId==='alarms'&&line.quantity>0).length,1);
 assert.equal((repaired.internal as any).lines.find((line:any)=>line.scopeTaskId==='alarms').unitCost,65);
 const stillWrong=await priceCompleteScope(alarmScope,deviceConfig,replies([mapping(wrong),{coveredTaskIds:['alarms'],issues:[]},mapping(wrong),{coveredTaskIds:['alarms'],issues:[]}]),now);
 assert.equal(stillWrong.customer.range,null,'model audit approval cannot override the incompatible device guard');
 const bell={...wrong,description:'Install 2 owner-supplied video doorbells.',evidence:'Two video doorbells',additions:wrong.additions};
 assert.equal(catalogResolution(mapping(bell),deviceConfig,[],now,alarmScope).rules.length,1,'a doorbell task can still use its own rate');
});
test('A malformed mapping answer is asked again, then repaired, instead of handing the estimate off',async()=>{
 // Live on boisehandyman.co (Marcliffe RE-10): one addition came back without a code and the
 // parse error handed the whole estimate to a person.
 const good={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet fixture conversion'}]};
 const broken={...extra,researchDescription:'',additions:[{quantity:3,quantityEvidence:'no code given'},good.additions[0]]};
 const audit={coveredTaskIds:['cabinets','overlay'],issues:[]};
 const retried=await priceCompleteScope(scope,config,replies([{tasks:[task,broken],issues:[]},{tasks:[task,good],issues:[]},audit]),now);
 assert.ok(retried.customer.range,'the second, well-formed answer prices');
 const repaired=await priceCompleteScope(scope,config,replies([{tasks:[task,broken],issues:[]},{tasks:[task,broken],issues:[]},audit]),now);
 assert.ok(repaired.customer.range,'a repeat malformed answer keeps its well-formed additions');
 assert.equal((repaired.internal as any).lines.find((l:any)=>l.id==='scope-1').unitCost,100);
});
test('task-level mapping notes preserve the complete estimate and audit context',async()=>{
 const note='Standard protective overlay selection; confirm color before ordering.';
 const added={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}],notes:[{note}]};
 let calls=0;const queued=replies([{tasks:[task,added],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]);
 const result=await priceCompleteScope(scope,config,async(...args)=>{calls++;return queued(...args);},now);
 assert.ok(result.customer.range,'the exact production failure shape must price');
 assert.equal(calls,3,'explanatory task notes need no repair/provider retry');
 assert.ok(result.internal.assumptions.some((value:string)=>value.includes(note)),'notes are retained, not silently discarded');
});
test('A finding about a task already carried out of the total is disclosed, not a reason to withhold the range',async()=>{
 const {carriedOutRemark}=await import('../lib/p5/scopePricing.ts');
 const carried=[{id:'chimney-cap-repair',description:'Repair chimney cap'}],priced=[{id:'gfci',description:'GFCI receptacles'}];
 // Live Marcliffe RE-10 wording: the chimney had already been listed as excluded.
 assert.ok(carriedOutRemark('chimney-cap-repair is not covered: its proposed PB-04-01-04 patch-repair assembly was not carried into any positive priced line.',carried,priced));
 assert.ok(!carriedOutRemark('gfci is duplicated by scope-4',carried,priced),'a finding about a priced task is judged by the other rules');
 assert.ok(!carriedOutRemark('chimney-cap-repair duplicates gfci',carried,priced),'one that also names a priced task is not released here');
});
test('The one-visit rule says trip and setup are recovered in overhead, so the audit never looks for a trip line',async()=>{
 const source=(await import('node:fs')).readFileSync('lib/p5/scopePricing.ts','utf8');
 // Live Marcliffe RE-10: the prompt promised a trip line nothing carried, and a carried one was then refused as an unsupported extra charge.
 assert.match(source,/recovered by the company overhead/);
 assert.doesNotMatch(source,/jobTripRule/);
});
test('Scope facts use notes and earlier model issues require an explicit evidenced resolution',async()=>{
 // A model finding only withholds the price when it states a fact such as a quantity conflict
 // (findingBlocks, 2026-09-21); a benign remark is disclosed. The finding here is a real defect.
 const note='Cabinets: the mapped cabinet run disagrees with the stated quantity in the reviewed scope.';
 const mapping={tasks:[task],issues:[note],notes:['No additional cabinet runs requested.']};
 const verified={coveredTaskIds:[task.id],issues:[],resolvedIssues:[{issue:note,reason:'The supplied positive cabinet line covers the requested task; this statement records the scope boundary.',lineIds:[ids[0]]}]};
 const r=await priceCompleteScope(scope,config,replies([mapping,verified]),now);
 assert.ok(r.customer.range);assert.ok((r.internal as any).assumptions.includes(mapping.notes[0]));
 assert.ok((r.internal as any).assumptions.some((n:string)=>n.includes(note)));
 for(const lineIds of [['invented-line'],[]]){
  const invalid=await priceCompleteScope(scope,config,replies([mapping,{...verified,resolvedIssues:[{...verified.resolvedIssues[0],lineIds}]}]),now);
  assert.equal(invalid.customer.range,null,'A resolved issue must reference actual positive priced components');
 }
 const unaddressed=await priceCompleteScope(scope,config,replies([mapping,{coveredTaskIds:[task.id],issues:[]}]),now);
 assert.equal(unaddressed.customer.range,null,'A clean audit cannot silently discard an earlier unresolved issue');
});
test('Sourced averages add missing costs, retain sources, and preserve financial reconciliation',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,extra],issues:[]},researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(r.customer.range);assert.equal((r.internal as any).lines.find((l:any)=>l.id==='market-1').cost,200);
 assert.ok(Math.abs((r.internal as any).reconciliation)<1e-8);
 assert.ok((r.customer.range?.low||0)>(base.customer.range?.low||0));
 assert.ok(JSON.stringify(r.internal.scopePricing).includes(urls[0]));
 assert.ok(!JSON.stringify(r.customer).includes('unitCost'));
});
test('Complete-scope mapper and audit receive active scope without retained alternatives',async()=>{
 const history={version:'p5-retained-clarification-v1',clarifications:[],unselected:'Unselected quartz top'};
 const archived={...scope,extraction:{summary:'Selected cabinet scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarificationProvenance:history,sourceHistory:history}} as ReviewedScope;
 const seen:unknown[]=[];
 const queue:unknown[]=[
  {tasks:[{id:'cabinets',description:'Cabinet supply',evidence:'ten feet'}],issues:[]},
  {tasks:[task],issues:[]},
  {coveredTaskIds:['cabinets'],issues:[]},
 ];
 const request:PricingRequest=async(_instructions,input)=>{seen.push(input);return {value:queue.shift(),sourceUrls:urls};};
 const result=await priceCompleteScope(archived,config,request,now);
 assert.ok(result.customer.range);
 assert.ok(seen.length>=3);
 assert.ok(!JSON.stringify(seen).includes('Unselected quartz top'));
 assert.ok(seen.every(payload=>!JSON.stringify(payload).includes('clarificationProvenance')&&!JSON.stringify(payload).includes('sourceHistory')));
});
test('supplier research survives normalization with aligned source types and policies',async()=>{
 const {openAiPricingRequestEnvelope}=await import('../lib/p5/scopePricing.ts');
 let normalized=false;
 const supplier=structuredClone(researched);supplier.rates[0].sources.forEach(source=>source.sourceType='supplier-price');
 const queue=replies([{tasks:[task,extra],issues:[]},null,supplier,{coveredTaskIds:['cabinets','overlay'],issues:[]}]);
 const result=await priceCompleteScope(scope,config,async(instructions,input,search,remaining)=>{
  if(search){assert.ok(instructions.includes('current published supplier prices'));assert.ok(!instructions.includes('not supplier shopping'));}
  if((input as any).report!==undefined){
   normalized=true;
   const envelope=openAiPricingRequestEnvelope(instructions,input,false);
   const schema=(envelope.body as any).text.format.schema;
   assert.deepEqual(schema.properties.rates.items.properties.sources.items.properties.sourceType.enum,['regional-guide','national-guide','supplier-price','contractor-rate']);
   assert.ok(!instructions.includes('not supplier shopping'));
  }
  return queue(instructions,input,search,remaining);
 },now);
 assert.ok(normalized);assert.ok(result.customer.range);
});
test('unsupported research units are explained to the corrective search',async()=>{
 const invalid=structuredClone(researched);invalid.rates[0].unit='each-job (consumables bundle)';
 const queue=replies([{tasks:[task,extra],issues:[]},invalid,researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]);
 let corrected=false;
 const result=await priceCompleteScope(scope,config,async(instructions,input,search,remaining)=>{
  if(search){assert.match(instructions,/Allowed pricing units:/);assert.match(instructions,/packs of shims as separate rates/);}
  if((input as any).retryInstruction){corrected=true;assert.match(JSON.stringify((input as any).priorIssues),/unsupported pricing unit/);}
  return queue(instructions,input,search,remaining);
 },now);
 assert.ok(corrected);assert.ok(result.customer.range);
 const {unitKey,supportedUnit}=await import('../lib/p5/unitRates.ts');
 assert.equal(unitKey('lbs'),'pound');assert.equal(unitKey('boxes'),'box');assert.equal(unitKey('packs'),'pack');
 assert.ok(supportedUnit('LB')&&supportedUnit('pack')&&supportedUnit('box'));
 assert.notEqual(unitKey('pack'),unitKey('EA'));assert.notEqual(unitKey('LB'),unitKey('LS'));
});
test('live research keeps one request in flight and stops on provider backoff',async()=>{
 const {mapResearchTasks,openAiPricingRequestEnvelope}=await import('../lib/p5/scopePricing.ts');
 let active=0,peak=0;
 const result=await mapResearchTasks([1,2,3],async n=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return n*2;});
 assert.deepEqual(result,[2,4,6]);assert.equal(peak,1);
 const attempted:number[]=[];
 await assert.rejects(()=>mapResearchTasks([1,2,3],async n=>{attempted.push(n);throw new PricingPending('Rate limited',30000);}),PricingPending);
 assert.deepEqual(attempted,[1]);
 const envelope=openAiPricingRequestEnvelope('Synthetic research',{},true);
 assert.equal(envelope.body.max_output_tokens,6000);assert.equal(envelope.body.tool_choice,'required');
});
test('research requests cited prose and normalizes it before pricing',async()=>{
 const {openAiPricingRequestEnvelope}=await import('../lib/p5/scopePricing.ts');
 const queued=replies([{tasks:[task,extra],issues:[]},researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]);
 let searches=0,normalizations=0;
 const report='Synthetic cited research report for ten LF of protective overlay.';
 const result=await priceCompleteScope(scope,config,async(instructions,input,search,remaining)=>{
  if(search){
   searches++;
   const envelope=openAiPricingRequestEnvelope(instructions,input,true);
   assert.doesNotMatch(envelope.body.instructions,/Return JSON only/i);
   assert.doesNotMatch(envelope.body.input,/Return JSON only/i);
   assert.match(envelope.body.instructions,/inline web citations/i);
   assert.equal('text' in envelope.body,false);
   return {value:null,sourceUrls:urls,sourceReport:report};
  }
  if((input as any).report){
   normalizations++;
   assert.equal((input as any).report,report);
   assert.deepEqual((input as any).sourceUrls,urls);
   const envelope=openAiPricingRequestEnvelope(instructions,input,false);
   assert.match(envelope.body.input,/Return JSON only/);
   assert.equal(envelope.body.text?.format.type,'json_schema');
  }
  return queued(instructions,input,search,remaining);
 },now);
 assert.equal(searches,1);assert.equal(normalizations,1);assert.ok(result.customer.range);
 assert.ok((result.internal as any).costBookSnapshot.rules.some((rule:any)=>rule.id.startsWith('market-')&&rule.unitCost===20));
});
test('invalid normalized research quantities trigger corrective research instead of a schema crash',async()=>{
 const invalid=structuredClone(researched);invalid.rates[0].quantity=0;
 const queue=replies([{tasks:[task,extra],issues:[]},invalid,invalid,researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]);
 let corrected=false;
 const result=await priceCompleteScope(scope,config,async(instructions,input,search,remaining)=>{
  if((input as any).retryInstruction){corrected=true;assert.match(JSON.stringify((input as any).priorIssues),/rates.0.quantity/);}
  return queue(instructions,input,search,remaining);
 },now);
 assert.ok(corrected);assert.ok(result.customer.range);
});
test('three invalid research attempts end without replaying rejected evidence indefinitely',async()=>{
 const invalid=structuredClone(researched);invalid.rates[0].quantity=0;
 const queued=replies([{tasks:[task,extra],issues:[]},invalid,invalid,invalid,invalid,invalid,invalid]);
 const corrections:number[]=[];let searches=0;
 await assert.rejects(()=>priceCompleteScope(scope,config,async(...args)=>{
  if(args[2]){searches++;if((args[1] as any).correction)corrections.push((args[1] as any).correction);}
  return queued(...args);
 },now),error=>error instanceof PricingPending&&error.fatal&&error.retryAfterMs===0);
 assert.equal(searches,3);assert.deepEqual(corrections,[1,2]);
});
test('a normalizer cannot relabel screw evidence as shim pricing',async()=>{
 const {assertResearchReportProducts}=await import('../lib/p5/scopePricing.ts');
 const requested={...extra,researchDescription:'Research ONLY contractor-supplied shims for cabinet installation.'};
 const quote='Cabinet screws cost 10 USD per pound.';
 const bad={...researched,rates:[{...researched.rates[0],description:'Wood shims',sources:researched.rates[0].sources.map(source=>({...source,excerpt:quote}))}]};
 assert.throws(()=>assertResearchReportProducts(bad,quote,[requested]),/cannot be relabeled/);
 const invented={...bad,rates:[{...bad.rates[0],sources:bad.rates[0].sources.map(source=>({...source,excerpt:'Wood shims cost 10 USD per pound.'}))}]};
 assert.throws(()=>assertResearchReportProducts(invented,quote,[requested]),/cannot be relabeled/);
 const validQuote='Wood shims cost 10 USD per 12-piece pack.';
 const valid={...bad,rates:[{...bad.rates[0],sources:bad.rates[0].sources.map(source=>({...source,excerpt:validQuote}))}]};
 assert.doesNotThrow(()=>assertResearchReportProducts(valid,'Supplier report: '+validQuote,[requested]));
});
test('consumable research separates unlike products and retains parent coverage without duplicate fasteners',async()=>{
 const {researchTaskBatches}=await import('../lib/p5/scopePricing.ts');
 const local={...scope,text:'Install 9 LF base and 12 LF wall cabinets. Contractor supplies screws, fasteners and shims.',answers:{location:'Boise'}};
 const supplies={...extra,id:'supplies',description:'Supply mounting screws, fasteners and shims',evidence:local.text,researchDescription:'Material purchase only: mounting screws, fasteners and shims'};
 const batches=researchTaskBatches([supplies],local);
 assert.equal(batches.length,2);
 assert.ok(batches.every(batch=>batch[0].researchDescription.includes('Cabinet installation:')));
 assert.deepEqual(batches.map(batch=>batch[0].description),['Supply contractor installation screws','Supply contractor installation shims']);
 assert.ok(batches.every(batch=>batch.length===1&&batch[0].id==='supplies'&&batch[0].evidence.includes(local.text)&&batch[0].evidence.includes(supplies.description)));
 const rate={...researched.rates[0],taskId:'supplies',description:'Contractor screws and shims',unit:'LS',quantity:1,quantityEvidence:'ALLOWANCE: one installation supply package.',quantityRange:{low:1,high:1},sources:researched.rates[0].sources.map(source=>({...source,unit:'LS'}))};
 const rejected=marketResolution({rates:[rate],issues:[]},urls,batches[0],now,0,'Boise',local);
 assert.equal(rejected.rules.length,0);assert.match(rejected.issues.join(' '),/atomic material research/);
 assert.equal(supplies.description,'Supply mounting screws, fasteners and shims');
 assert.equal(researchTaskBatches([extra],local)[0][0],extra);
 const ownerOnly={...local,text:'Owner supplies all screws and shims.'};
 assert.equal(researchTaskBatches([supplies],ownerOnly).length,1);
});
test('consumables attached to cabinet installation tasks are researched as separate products',async()=>{
 const {researchTaskBatches}=await import('../lib/p5/scopePricing.ts');
 const local={...scope,text:'Install 9 LF base and 12 LF wall cabinets. Owner supplies fully assembled cabinets. Contractor supplies screws and shims.',answers:{service:'cabinet-install',cabinetBaseLf:'9',cabinetUpperLf:'12',location:'Boise'}};
 const parent={...extra,id:'install_base_cabinets',description:'Install 9 linear feet of owner-supplied, fully assembled base cabinets in the existing kitchen.',evidence:local.text,researchDescription:"Material purchase only: shims, screws needed for cabinet installation. Price only these contractor-supplied installation consumables for this task's stated quantity. Owner-supplied products and separately priced installation labor are excluded."};
 const batches=researchTaskBatches([parent],local);
 assert.equal(batches.length,2);
 assert.deepEqual(batches.map(batch=>batch[0].description),['Supply contractor installation screws','Supply contractor installation shims']);
 assert.ok(batches.every(batch=>batch[0].id===parent.id&&batch[0].researchDescription.startsWith('Research ONLY contractor-supplied')&&batch[0].researchDescription.includes('prefer EA')));
 const screwsOnly={...parent,researchDescription:'Material purchase only: screws needed for this installation. Shims are already priced.'};
 // An explicit remaining component list must not reopen already priced supplies.
 assert.deepEqual(researchTaskBatches([screwsOnly],local).map(batch=>batch[0].description),['Supply contractor installation screws']);
 const ordinary={...parent,researchDescription:'Research cabinet installation labor only; contractor supplies screws and shims separately.'};
 assert.equal(researchTaskBatches([ordinary],{...local,text:'Owner supplies cabinets, screws and shims.'})[0][0],ordinary);
});
test('source verification ignores tracking but preserves product and region identity',async()=>{
 const {verifiedResearchUrl}=await import('../lib/p5/scopePricing.ts');
 assert.ok(verifiedResearchUrl(urls[0],[urls[0]+'?utm_source=openai#price']));
 assert.ok(verifiedResearchUrl(urls[0]+'?sku=123',[urls[0]+'?sku=123&utm_source=openai']));
 assert.equal(verifiedResearchUrl(urls[0]+'?sku=124',[urls[0]+'?sku=123']),false);
 assert.equal(verifiedResearchUrl(urls[0]+'?region=Boise',[urls[0]+'?region=Seattle']),false);
 assert.equal(verifiedResearchUrl('https://invented.example/pricing',urls),false);
 assert.equal(verifiedResearchUrl('http://supplier-a.example/pricing',urls),false);
 assert.equal(marketResolution(researched,urls.map(url=>url+'?utm_source=openai'),[extra],now).rules[0].unitCost,20);
});
test('an unsupported market citation triggers corrected research without accepting the invented rate',async()=>{
 const unsupported=structuredClone(researched);
 unsupported.rates[0].sources[0].url='https://invented.example/pricing';
 let searches=0;
 const queue=replies([{tasks:[task,extra],issues:[]},unsupported,researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]);
 const result=await priceCompleteScope(scope,config,async(...args)=>{if(args[2])searches++;return queue(...args);},now);
 assert.equal(searches,2);
 assert.ok(result.customer.range);
 assert.ok((result.internal as any).costBookSnapshot.rules.some((rule:any)=>rule.id.startsWith('market-')&&rule.unitCost===20));
 assert.ok(!JSON.stringify(result).includes('https://invented.example'));
});
test('Regional unit-cost benchmarks reject incompatible units, responsibility and supplier offers',()=>{
 const priced=marketResolution(researched,urls,[extra],now).rules[0];assert.equal(priced.unitCost,20);assert.equal(priced.quantity.fixed,10);
 const aliases=structuredClone(researched);aliases.rates[0].sources[0].unit='per linear foot';aliases.rates[0].sources[1].unit='linear-ft';assert.equal(marketResolution(aliases,urls,[extra],now).rules[0].unitCost,20);
 for(const change of [{unit:'hour'},{costBasis:'subcontractor-installed'},{sourceType:'supplier'}]){
  const wrong=structuredClone(researched);Object.assign(wrong.rates[0].sources[0],change);assert.throws(()=>marketResolution(wrong,urls,[extra],now));
 }
 const noCheckout={...researched,rates:[{...researched.rates[0],landedCost:null}]};assert.equal(marketResolution(noCheckout,urls,[extra],now).rules[0].unitCost,20);
});
test('An incomplete scope price is not misreported as a missing quantity',()=>{
 const r=priceReviewedScope(scope,config,now,{replaceBase:true,rules:[],assumptions:[],issues:['Supplier research could not complete.']});
 assert.deepEqual(r.internal.pricingWarnings,['scope-pricing-incomplete']);assert.ok(!r.customer.message.includes('missing quantities'));assert.equal(r.customer.range,null);
});
test('Uncited, stale, duplicate-source, reversed and selling-price evidence is rejected',()=>{
 assert.throws(()=>marketResolution(researched,[],[extra],now));
 for(const change of [()=>{const r=structuredClone(researched);r.rates[0].sources[1].url=urls[0];return r},()=>{const r=structuredClone(researched);r.rates[0].sources[0].publishedAt='2020-01-01';return r},()=>{const r=structuredClone(researched);r.rates[0].sources[0].high=1;return r},()=>({...researched,rates:[{...researched.rates[0],basis:'customer-selling-price'}]})])assert.throws(()=>marketResolution(change(),urls,[extra],now));
});
test('Independent audit blocks missed original work or duplicate assembly charges',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:['cabinets'],issues:['Original overlay task omitted from inventory']}]),now);
 assert.equal(r.customer.range,null);
});
test('Incorrect assembly lines can be replaced without charging both, but cannot remain coverage references',async()=>{
 const old=ids[0];
 const corrected={...task,existingLineIds:ids.filter((id:string)=>id!==old),additions:[{code:'03-17-01-M',quantity:12,quantityEvidence:'Corrected synthetic twelve-foot takeoff'}]};
 const mapping={tasks:[corrected],issues:[],replacements:[{lineId:old,reason:'Incorrect synthetic takeoff'}],removeExclusions:[]};
 const r=await priceCompleteScope(scope,config,replies([mapping,{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.ok(r.customer.range);assert.ok(!(r.internal as any).lines.some((l:any)=>l.id===old));assert.equal((r.internal as any).lines.find((l:any)=>l.id==='scope-1').quantity,12);
 const invalid=await priceCompleteScope(scope,config,replies([{...mapping,tasks:[task]},{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.equal(invalid.customer.range,null);
});
test('Invalid catalog references and zero-quantity output never release a range',async()=>{
 for(const a of [{code:'missing',quantity:10,quantityEvidence:'ten feet'},{code:'03-15-02-M',quantity:0,quantityEvidence:'ten feet'}]){
  const run=()=>priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:'',additions:[a]}],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
  if(a.code==='missing')await assert.rejects(run,PricingPending);
  else assert.equal((await run()).customer.range,null);
 }
});
test('completed OpenAI search prose retains actual citations for strict normalization',async()=>{
 const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','P5_PRICING_PROVIDER'];
 const saved=names.map(n=>process.env[n]);const oldFetch=globalThis.fetch;
 try{
  for(const n of names)delete process.env[n];
  process.env.OPENAI_API_KEY='synthetic-test-key';
  const {ESTIMATOR_MODEL}=await import('../lib/p5/modelPolicy.ts');
  const report='Synthetic Boise supplier report with published product prices.';
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({status:'completed',model:ESTIMATOR_MODEL,output:[
   {type:'web_search_call',action:{sources:urls.map(url=>({url}))}},
   {type:'message',content:[{type:'output_text',text:report}]}
  ]});};
  const result=await requestPricingWith('openai','Synthetic prose recovery regression',{},true,5000);
  assert.equal(calls,1);assert.equal(result.value,null);
  assert.equal(result.sourceReport,report);assert.deepEqual(result.sourceUrls,urls);
 }finally{globalThis.fetch=oldFetch;names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i]});}
});
test('legacy provider parser retains historical source extraction support',async()=>{
 const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_PRICING_MODEL','P5_PRICING_RESEARCH_MODEL','P5_PRICING_PROVIDER'];
 const saved=names.map(n=>process.env[n]);const oldFetch=globalThis.fetch;
 try{
  for(const n of names)delete process.env[n];process.env.ANTHROPIC_API_KEY='synthetic-test-key';process.env.P5_PRICING_PROVIDER='anthropic';
  let search=false;
  globalThis.fetch=async(url,init)=>{
   assert.equal(url,'https://api.anthropic.com/v1/messages');
   const input=JSON.parse(String(init?.body));search=Boolean(input.tools);assert.equal(input.model,'claude-sonnet-5');
   return Response.json({stop_reason:'end_turn',content:search?[{type:'text',text:'Searching now.'},{type:'web_search_tool_result',content:urls.map(url=>({type:'web_search_result',url}))},{type:'text',text:JSON.stringify(researched)}]:[{type:'text',text:'{"coveredTaskIds":["cabinets"],"issues":[]}'}]});
  };
  assert.deepEqual((await requestPricingWith('anthropic','JSON',{},false,1000)).value,{coveredTaskIds:['cabinets'],issues:[]});
  process.env.OPENAI_API_KEY='synthetic-openai-key';
  assert.deepEqual((await requestPricingWith('anthropic','JSON',{},false,1000)).value,{coveredTaskIds:['cabinets'],issues:[]});
  const r=await requestPricingWith('anthropic','JSON',{},true,1000);assert.ok(search);assert.deepEqual(r.sourceUrls,urls);assert.deepEqual(r.value,researched);
  globalThis.fetch=async(_url,init)=>{
   const input=JSON.parse(String(init?.body));assert.ok(input.tools.some((t:any)=>t.name==='web_fetch'&&t.max_uses>0));
   return Response.json({stop_reason:'end_turn',content:[{type:'text',text:'Opening supplier evidence.'},{type:'web_fetch_tool_result',content:{type:'web_fetch_result',url:urls[0],content:{type:'document',source:{type:'text',data:'Synthetic product price.'}}}},{type:'text',text:JSON.stringify(researched)}]});
  };
  const fetched=await requestPricingWith('anthropic','JSON',{},true,1000);assert.deepEqual(fetched.sourceUrls,[urls[0]]);assert.deepEqual(fetched.value,researched);
  let pausedCalls=0;
  const pausedContent=[{type:'web_search_tool_result',content:urls.map(url=>({type:'web_search_result',url}))}];
  globalThis.fetch=async(_url,init)=>{
   pausedCalls++;const body=JSON.parse(String(init?.body));
   if(pausedCalls===1)return Response.json({stop_reason:'pause_turn',content:pausedContent});
   assert.deepEqual(body.messages[1],{role:'assistant',content:pausedContent});assert.ok(body.tools.some((t:any)=>t.name==='web_fetch'));
   return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(researched)}]});
  };
  const resumed=await requestPricingWith('anthropic','JSON',{},true,5000);assert.equal(pausedCalls,2);assert.deepEqual(resumed.sourceUrls,urls);assert.deepEqual(resumed.value,researched);
  pausedCalls=0;globalThis.fetch=async()=>{pausedCalls++;return Response.json({stop_reason:'pause_turn',content:pausedContent});};
  await assert.rejects(()=>requestPricingWith('anthropic','JSON',{},true,5000),/pricing-check-incomplete:pause_turn/);assert.equal(pausedCalls,3);
  globalThis.fetch=async()=>Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'{"rates":['}]});
  await assert.rejects(()=>requestPricingWith('anthropic','JSON',{},true,5000),/pricing-check-incomplete:max_tokens/);
  let calls=0;
  globalThis.fetch=async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));
   if(calls===1)return Response.json({stop_reason:'end_turn',content:[{type:'web_search_tool_result',content:urls.map(url=>({type:'web_search_result',url}))},{type:'text',text:'# Research\nSynthetic cited report.'}]});
   assert.ok(body.output_config.format.schema.properties.rates);assert.equal(body.tools,undefined);assert.ok(body.messages[0].content.includes(urls[0]));
   return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(researched)}]});
  };
  const normalized=await requestPricingWith('anthropic','JSON',{},true,5000);assert.equal(calls,2);assert.deepEqual(normalized.value,researched);assert.ok(normalized.sourceReport?.startsWith('# Research'));assert.deepEqual(normalized.sourceUrls,urls);
  globalThis.fetch=async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"rates":[],"issues":[]}'}]});
  await assert.rejects(()=>requestPricingWith('anthropic','JSON',{},true,1000),/search-unavailable/);
 }finally{globalThis.fetch=oldFetch;names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i]});}
});
test('Allowance notes release a range only after complete scope coverage passes the independent audit',async()=>{
 const withNotes={...scope,answers:{...scope.answers,allowances:'Cabinet selections are included in the material supply budget.'}};
 assert.equal(priceReviewedScope(withNotes,config,now).customer.range,null);
 const okay=await priceCompleteScope(withNotes,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.ok(okay.customer.range);
 const unclear=await priceCompleteScope(withNotes,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:[],issues:['Delivery and tax treatment is unresolved']}]),now);
 assert.equal(unclear.customer.range,null);
 assert.equal(unclear.customer.scopeTasks[0].description,'Cabinet supply');
});
test('A researched specialist takeoff resolves the generic small-job hold only after verification',async()=>{
 const specialist={...scope,text:'Concrete protective overlay, ten linear feet.',answers:{service:'handyman',laborHours:'2',location:'Boise'}};
 const initial=priceReviewedScope(specialist,config,now);
 assert.equal(initial.customer.range,null);
 const initialIds=(initial.internal as any).lines.map((l:any)=>l.id);
 const labor={...task,id:'prep',description:'Preparation labor',existingLineIds:initialIds};
 const priced=await priceCompleteScope(specialist,config,replies([{tasks:[labor,extra],issues:[]},researched,{coveredTaskIds:['prep','overlay'],issues:[]}]),now);
 assert.ok(priced.customer.range);
 const failed=await priceCompleteScope(specialist,config,replies([{tasks:[labor,extra],issues:[]},researched,{coveredTaskIds:['prep'],issues:['Concrete protective overlay: the mapped overlay length disagrees with the stated ten linear feet.']}]),now);
 assert.equal(failed.customer.range,null);
});

test('Large scope maps bounded batches and audits every original task together',async()=>{
 const tasks=Array.from({length:14},(_,i)=>({...task,id:`task-${i}`,description:`Assembly component ${i}`}));
 let calls=0;const seen=new Set<string>();
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  // Batches are independent now: they run concurrently and none is handed
  // another's additions. Each must be bounded, and together they must cover
  // every inventory task exactly once - the audit verifies the whole mapping.
  if(data.taskBatch){assert.ok(data.taskBatch.length<=4);assert.deepEqual(data.priorMappedTasks,[]);for(const t of data.taskBatch){assert.ok(!seen.has(t.id),`task ${t.id} mapped twice`);seen.add(t.id);}return {value:{tasks:data.taskBatch.map((t:any)=>({...task,...t})),issues:[]},sourceUrls:[]};}
  assert.equal(data.tasks.length,14);return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[]},sourceUrls:[]};
 };
 const result=await priceCompleteScope(scope,config,request,now);
 assert.equal(calls,1+Math.ceil(14/4)+1,'inventory, one mapping call per four-task batch, one audit');assert.ok(result.customer.range);assert.equal(result.customer.scopeTasks.length,14);
 assert.equal(seen.size,14,'every inventory task was mapped once');
});
test('A missing or substituted batch task never releases a partial total',async()=>{
 let calls=0;
 const result=await priceCompleteScope(scope,config,async()=>({value:++calls===1?{tasks:[{id:task.id,description:task.description,evidence:task.evidence}],issues:[]}:{tasks:[{...task,id:'substituted'}],issues:[]},sourceUrls:[]}),now);
 assert.equal(result.customer.range,null);assert.equal(calls,2);
});
test('Research batches retain unique rule IDs and all source evidence',async()=>{
 const tasks=Array.from({length:7},(_,i)=>({...extra,id:`gap-${i}`}));let calls=0;let searches=0;
 const result=await priceCompleteScope(scope,config,async(_instructions,input,search)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(data.taskBatch)return {value:{tasks:data.taskBatch.map((t:any)=>({...extra,...t})),issues:[]},sourceUrls:[]};
  if(search){searches++;assert.ok(data.tasks.length<=3);return {value:{rates:data.tasks.map((t:any)=>({...researched.rates[0],taskId:t.id})),issues:[]},sourceUrls:urls};}
  assert.equal(data.research.length,3);assert.equal(new Set(data.additionalRules.map((r:any)=>r.id)).size,7);
  return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[]},sourceUrls:[]};
 },now);
 assert.equal(searches,3);assert.ok(result.customer.range);
});

test('Valid JSON research with incompatible field types gets a saved constrained normalization stage',async()=>{
 let calls=0;let formatting=0;
 const inputs:unknown[]=[{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},{tasks:[task,extra],issues:[]},{...researched,rates:[{...researched.rates[0],includes:['overlay material'],excludes:[]}],issues:[{message:'Formatting fixture only'}]},researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}];
 const result=await priceCompleteScope(scope,config,async(instructions,input,search)=>{
  calls++;
  if(calls===4){formatting++;assert.equal(search,false);assert.ok(instructions.startsWith('Convert the supplied research report'));assert.deepEqual((input as any).sourceUrls,urls);assert.ok((input as any).report.includes('overlay material'));}
  return {value:inputs.shift(),sourceUrls:search?urls:[]};
 },now);
 assert.equal(formatting,1);assert.ok(result.customer.range);assert.ok(JSON.stringify(result.internal.scopePricing.research).includes(urls[0]));
});
test('Verification receives accepted research evidence without raw reports or unrelated search URLs',async()=>{
  let calls=0;let auditInput:any;
  const taxUrl='https://tax-evidence.example/rate',freightUrl='https://freight-evidence.example/charge';
  const taxEvidence={...adjustmentEvidence,url:taxUrl},freightEvidence={...adjustmentEvidence,url:freightUrl};
  const acceptedResearch={...researched,rates:researched.rates.map(rate=>({...rate,landedCost:{taxRate:.06,freightPerUnit:4,taxOnFreight:false,taxEvidence,freightEvidence}}))};
  const noisyUrls=[...urls,taxUrl,freightUrl,...Array.from({length:120},(_,i)=>`https://noise-${i}.example/unrelated`)];
  const request:PricingRequest=async(_instructions,input,search)=>{
    calls++;const data=input as any;
    if(calls===1)return {value:{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
    if(data.taskBatch)return {value:{tasks:[task,extra],issues:[]},sourceUrls:[]};
    if(search)return {value:acceptedResearch,sourceUrls:noisyUrls,sourceReport:'RAW SEARCH NARRATIVE MUST NOT REACH VERIFICATION'};
    auditInput=data;
    return {value:{coveredTaskIds:['cabinets','overlay'],issues:[]},sourceUrls:[]};
  };
  const result=await priceCompleteScope(scope,config,request,now);
  assert.ok(result.customer.range);
  const serialized=JSON.stringify(auditInput.research);
  assert.ok([urls[0],urls[1],taxUrl,freightUrl].every(url=>serialized.includes(url)),'accepted rate and landed-cost sources remain auditable');
  assert.ok(!serialized.includes('noise-')&&!serialized.includes('RAW SEARCH NARRATIVE'),'unused search material is not replayed');
});
test('Malformed researched evidence blocks instead of becoming an invented planning value',async()=>{
  let calls=0;let planningCalls=0;
  const request:PricingRequest=async(instructions,input,search)=>{
    calls++;const data=input as any;
    if(calls===1)return {value:{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
    if(data.taskBatch)return {value:{tasks:[task,extra],issues:[]},sourceUrls:[]};
    if(search)return {value:{...researched,rates:[{...researched.rates[0],includes:['overlay material']}]},sourceUrls:urls};
    if(instructions.startsWith('Convert the supplied research report'))return {value:{rates:[{taskId:'overlay'}],issues:[],notes:[]},sourceUrls:[]};
    planningCalls++;return {value:{rates:[],issues:[],notes:[]},sourceUrls:[]};
  };
  await assert.rejects(()=>priceCompleteScope(scope,config,request,now),PricingPending);
  assert.equal(planningCalls,0,'invalid evidence is not replaced by an unsupported model value');
});

test('An audit finding is repaired with a labeled quantity allowance, then audited again',async()=>{
 const unresolved={...extra,researchDescription:''};
 const allowed={...unresolved,additions:[{code:'03-15-02-M',quantity:10,quantityRange:{low:8,high:15},quantityEvidence:'ALLOWANCE: Budget ten feet based on the cabinet run; confirm eight to fifteen feet before ordering.'}]};
 const priced=await priceCompleteScope(scope,config,replies([
   {tasks:[task,unresolved],issues:[]},
   {coveredTaskIds:['cabinets'],issues:['Overlay quantity and cost missing']},
   {tasks:[task,allowed],issues:[]},
   {coveredTaskIds:['cabinets','overlay'],issues:[]},
 ]),now);
 assert.ok(priced.customer.range);const line=priced.customer.lineItems.find(l=>l.id==='repair-scope-1');
 assert.equal(line?.pricingStatus,'estimated-allowance');assert.deepEqual(line?.quantityRange,{low:8,high:15});
 assert.ok(Math.abs((priced.internal as any).reconciliation)<1e-8);assert.ok(priced.customer.verificationItems.some(i=>i.includes('ALLOWANCE:')));
});
test('Trim-only and labor-only instructions replace whole-project defaults and reject material charges',async()=>{
 const instructions={...emptyInstructions(),inclusions:['First-floor trim only'],exclusions:['All plumbing'],floors:['1'],laborOnly:true};
 const restricted={...scope,text:'Price only first-floor trim labor. Owner supplies all materials. Exclude plumbing.',answers:{...scope.answers,estimatingInstructions:'Price only first-floor trim labor. Exclude plumbing.'},extraction:{summary:'Trim labor',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions}};
 const trim={id:'trim',description:'First-floor trim installation labor',evidence:'Requested trim only',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:8,quantityEvidence:'ALLOWANCE: Eight installation hours based on the trim package, confirm six to twelve.',quantityRange:{low:6,high:12},floor:'1',building:'Main'}],researchDescription:'',issues:[]};
 const priced=await priceCompleteScope(restricted,config,replies([{tasks:[trim],issues:[]},{coveredTaskIds:['trim'],issues:[]}]),now);
 assert.ok(priced.customer.range);assert.equal((priced.internal as any).lines.length,1);assert.equal((priced.internal as any).lines[0].category,'field-labor');assert.equal(priced.customer.lineItems[0].floor,'1');
 const wrong={...trim,additions:[{...trim.additions[0],code:'03-15-02-M'}]};
 const refused=await priceCompleteScope(restricted,config,replies([{tasks:[wrong],issues:[]},{coveredTaskIds:['trim'],issues:[]}]),now);
 // The material charge is removed per the labor-only instruction rather than flagged; with nothing priceable left, the estimator asks for quantities instead of inventing a range.
 assert.equal(refused.customer.range,null);assert.ok((refused.internal as any).pricingWarnings.includes('quantities-missing'));assert.ok(refused.customer.assumptions.some((a:string)=>/labor-only instruction, 1 component was left out/.test(a)),'the removal is disclosed');
});
test('Separate building prices require every component to be assigned to a building',async()=>{
 const instructions={...emptyInstructions(),separateBuildings:true,buildings:['Main','ADU'],materialsOnly:true};
 const restricted={...scope,answers:{...scope.answers,estimatingInstructions:'Separate cabinet supply for Main and ADU'},extraction:{summary:'Separate cabinet supply',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions}};
 const tasks=['Main','ADU'].map((building,i)=>({id:building,description:building+' cabinet material',evidence:'Ten feet per building',existingLineIds:[],additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested',building}],researchDescription:'',issues:[]}));
 const priced=await priceCompleteScope(restricted,config,replies([{tasks,issues:[]},{coveredTaskIds:['Main','ADU'],issues:[]}]),now);
 assert.ok(priced.customer.range);assert.deepEqual(priced.customer.lineItems.map(l=>l.building),['Main','ADU']);
 assert.equal(priced.customer.lineItems.reduce((n,l)=>n+l.low,0),priced.customer.range.low);assert.equal(priced.customer.lineItems.reduce((n,l)=>n+l.high,0),priced.customer.range.high);
 const missing=tasks.map(t=>({...t,additions:t.additions.map(a=>({...a,building:undefined}))}));
 const held=await priceCompleteScope(restricted,config,replies([{tasks:missing,issues:[]},{coveredTaskIds:['Main','ADU'],issues:[]}]),now);assert.equal(held.customer.range,null,'separate totals require building assignments');assert.ok(held.customer.verificationItems?.some((a:string)=>/building/i.test(a)));assert.ok(held.internal.scopePricing.issues.some(i=>/building/i.test(i)));
});
test('Undated independent guide averages retain retrieval date and freshness limitations',()=>{
 const guides={...researched,rates:[{...researched.rates[0],sources:researched.rates[0].sources.map(s=>({...s,publishedAt:'',dateBasis:'retrieved',sourceType:'regional-guide',region:'Boise, Idaho'}))}]};
 const result=marketResolution(guides,urls,[extra],now,0,'Boise'),rate=result.rules[0];
 assert.equal(rate.evidence.provenance?.status,'estimated');assert.equal(rate.evidence.provenance?.location,'Boise');
 assert.equal(rate.evidence.provenance?.sources[0].date,'2026-09-11');assert.equal(rate.evidence.provenance?.sources[0].dateBasis,'retrieved');
 assert.match(rate.evidence.reference,/retrieved 2026-09-11/);assert.match(result.assumptions[0],/Boise, Idaho.*regional-guide/);assert.match(result.assumptions[0],/freshness requires verification/);
});

test('Preliminary regional benchmark verification notes persist without becoming unpriced work',async()=>{
 const note='Disclosed national benchmark; confirm the standard profile and current local cost before purchase.';
 const research={...researched,notes:[note]};
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,extra],issues:[]},research,{coveredTaskIds:['cabinets','overlay'],issues:[],notes:[note]}]),now);
 assert.ok(r.customer.range);assert.ok(r.customer.assumptions.includes(note));assert.equal(r.internal.scopePricing.issues.length,0);
});

test('Mapped labor cannot change a confirmed hour quantity',()=>{
 const mapping={tasks:[{id:'drywall',description:'Drywall repair labor',evidence:'The reviewed scope states 14 labor hours.',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:10,quantityEvidence:'Ten labor hours'}],researchDescription:'',issues:[]}],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping as any,config,[],now,scope);
 assert.equal(result.rules.length,0);assert.ok(result.issues.some(issue=>/does not match the explicit quantity/i.test(issue)));
});

test('Distinct trade labor remains additive while partial-hour unknowns stay unpriced',()=>{
 const mapping={tasks:[
  {id:'excavation',description:'Driveway excavation labor',evidence:'16 labor hours',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:16,quantityEvidence:'16 labor hours'}],researchDescription:'',issues:[]},
  {id:'concrete',description:'Driveway concrete labor',evidence:'24 labor hours',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:24,quantityEvidence:'24 labor hours'}],researchDescription:'',issues:[]},
  {id:'unknown',description:'Concrete finishing labor',evidence:'Partial labor hours remain unknown',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:10,quantityEvidence:'10 labor hours'}],researchDescription:'',issues:[]},
 ],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping as any,config,[],now,scope);
 assert.deepEqual(result.rules.map(rule=>rule.quantity.fixed),[16,24]);
 assert.equal(result.rules.reduce((sum,rule)=>sum+(rule.quantity.fixed||0),0),40);
 assert.ok(result.issues.some(issue=>/remains unmeasured/i.test(issue)));
});

test('Unselected alternatives never become billable mapping rules',()=>{
 const mapping={tasks:[{id:'optional',description:'Optional alternate island package',evidence:'Alternative not selected by owner; 10 LF',existingLineIds:[],additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'10 LF'}],researchDescription:'',issues:[]}],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping as any,config,[],now,scope);
  assert.equal(result.rules.length,0);assert.ok(result.assumptions.some(issue=>/not billable/i.test(issue)));
});
test('Mutually exclusive alternates bill only the explicitly selected scope',()=>{
  const selected={...extra,id:'tub',description:'Alcove tub alternate',evidence:'Tub alternate selected; walk-in shower alternate not selected.',researchDescription:'',additions:[{code:'03-15-02-M',quantity:1,quantityEvidence:'One selected tub alternate'}]};
  const unselected={...extra,id:'shower',description:'Walk-in shower alternate',evidence:'Tub alternate selected; walk-in shower alternate not selected.',researchDescription:'',additions:[{code:'03-15-02-M',quantity:1,quantityEvidence:'One shower alternate'}]};
  const result=catalogResolution({tasks:[selected,unselected],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
  assert.deepEqual(result.rules.map(rule=>rule.scopeTaskId),['tub']);
  assert.ok(result.assumptions.some(issue=>/Walk-in shower.*not billable/i.test(issue)));
});
test('Owner-supplied material permits installation labor but rejects material cost',()=>{
  const supplied={...extra,id:'tile',description:'Install owner-supplied bathroom tile',evidence:'Homeowner supplies 99 SF of porcelain tile; contractor installs 99 SF.',researchDescription:'',additions:[
    {code:'03-16-01-M',quantity:99,quantityEvidence:'99 SF owner-supplied tile'},
    {code:'03-16-01-L',quantity:99,quantityEvidence:'99 SF tile installation'},
  ]};
  const result=catalogResolution({tasks:[supplied],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
  assert.deepEqual(result.rules.map(rule=>rule.scopeTaskId),['tile']);
  assert.equal(result.rules[0].category,'field-labor');
  assert.ok(result.issues.some(issue=>/owner-supplied material cannot be charged/i.test(issue)));
  const sibling={...extra,id:'mixed-components',description:'Door and window materials',evidence:'Owner supplies one door; contractor supplies one window.',researchDescription:'',additions:[{code:'TEST-DOOR-M',quantity:1,quantityEvidence:'One door.'}]};
  const componentScoped=catalogResolution({tasks:[sibling],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
  assert.equal(componentScoped.rules.length,0,'a contractor-supplied sibling with the same EA quantity cannot authorize the owner-supplied door');
  assert.ok(componentScoped.issues.some(issue=>/owner-supplied material cannot be charged/i.test(issue)));
});
test('Complete pricing bills one contractor-supplied door and installation of all four',async()=>{
  const doorScope:ReviewedScope={...scope,text:'Supply one and install four doors. Owner supplies three of the four doors; contractor supplies one door and installs all four.',answers:{service:'handyman',location:'Boise'}};
  const doors={...extra,id:'doors',description:'Door supply and installation',evidence:doorScope.text,researchDescription:'',additions:[
    {code:'TEST-DOOR-M',quantity:1,quantityEvidence:'Contractor supplies one door.'},
    {code:'TEST-DOOR-L',quantity:4,quantityEvidence:'Contractor installs all four doors.'},
  ]};
  const priced=await priceCompleteScope(doorScope,config,replies([{tasks:[doors],issues:[]},{coveredTaskIds:['doors'],issues:[]}]),now);
  assert.ok(priced.customer.range,'the mixed-responsibility scope is complete');
  const lines=(priced.internal as any).lines.filter((line:any)=>line.id.startsWith('scope-'));
  assert.deepEqual(lines.map((line:any)=>[line.category,line.quantity,line.unit]),[['materials',1,'EA'],['field-labor',4,'EA']]);

  const overcharged={...doors,additions:[{...doors.additions[0],quantity:4,quantityEvidence:'Charge all four supplied doors.'},doors.additions[1]]};
  const blocked=await priceCompleteScope(doorScope,config,replies([{tasks:[overcharged],issues:[]},{coveredTaskIds:['doors'],issues:[]},{tasks:[overcharged],issues:[]},{coveredTaskIds:['doors'],issues:[]}]),now);
  assert.equal(blocked.customer.range,null,'the three owner-supplied doors cannot be charged');
  assert.ok(blocked.internal.scopePricing.issues.some(issue=>/owner-supplied material|does not match the explicit quantity/i.test(issue)));
});
test('Complete pricing retains an unselected alternate for audit without charging it',async()=>{
  const alternateScope:ReviewedScope={...scope,text:'Tile tub alternate selected; Tile shower alternate not selected. Selected tile area is 80 SF.',answers:{service:'handyman',location:'Boise'}};
  const evidence=alternateScope.text;
  const tub={...extra,id:'tile-tub',description:'Tile tub alternate',evidence,researchDescription:'',additions:[{code:'03-16-01-M',quantity:80,quantityEvidence:'Selected tub tile area is 80 SF.'}]};
  const shower={...extra,id:'tile-shower',description:'Tile shower alternate',evidence,researchDescription:'',additions:[{code:'03-16-01-M',quantity:80,quantityEvidence:'Shared tile match is 80 SF.'}]};
  const priced=await priceCompleteScope(alternateScope,config,replies([{tasks:[tub,shower],issues:[]},{coveredTaskIds:['tile-tub','tile-shower'],issues:[]}]),now);
  assert.ok(priced.customer.range,'an explicitly excluded sibling does not poison complete pricing');
  const lines=(priced.internal as any).lines.filter((line:any)=>line.id.startsWith('scope-'));
  assert.equal(lines.length,1);assert.equal(lines[0].scopeTaskId,'tile-tub');assert.equal(lines[0].quantity,80);

  const conflict={...tub,evidence:'Tile tub alternate selected; Tile tub alternate not selected. Selected tile area is 80 SF.'};
  const held=await priceCompleteScope(alternateScope,config,replies([{tasks:[conflict,shower],issues:[]},{coveredTaskIds:['tile-tub','tile-shower'],issues:[]},{tasks:[conflict,shower],issues:[]},{coveredTaskIds:['tile-tub','tile-shower'],issues:[]}]),now);
  assert.equal(held.customer.range,null,'conflicting selection evidence must block');
  assert.ok(held.internal.scopePricing.issues.some(issue=>/selection is ambiguous or conflicting/i.test(issue)));
});
test('Complete pricing permits fully owner-supplied doors with installation only',async()=>{
  const suppliedScope:ReviewedScope={...scope,text:'Owner supplies four doors; contractor installs four doors.',answers:{service:'handyman',location:'Boise'}};
  const doors={...extra,id:'owner-doors',description:'Install owner-supplied doors',evidence:suppliedScope.text,researchDescription:'',additions:[
    {code:'TEST-DOOR-L',quantity:4,quantityEvidence:'Contractor installs four doors.'},
  ]};
  const priced=await priceCompleteScope(suppliedScope,config,replies([{tasks:[doors],issues:[]},{coveredTaskIds:['owner-doors'],issues:[]}]),now);
  assert.ok(priced.customer.range);
  assert.deepEqual((priced.internal as any).lines.map((line:any)=>[line.category,line.quantity,line.unit]),[['field-labor',4,'EA']]);
  const overcharged={...doors,additions:[...doors.additions,{code:'TEST-DOOR-M',quantity:4,quantityEvidence:'Four doors.'}]};
  const blocked=await priceCompleteScope(suppliedScope,config,replies([{tasks:[overcharged],issues:[]},{coveredTaskIds:['owner-doors'],issues:[]},{tasks:[overcharged],issues:[]},{coveredTaskIds:['owner-doors'],issues:[]}]),now);
  assert.equal(blocked.customer.range,null);
  assert.ok(blocked.internal.scopePricing.issues.some(issue=>/owner-supplied material/i.test(issue)));
});
test('Owner-provided and homeowner-furnished variants reject installed packages',()=>{
  for(const evidence of ['Tile is owner-provided.','Tile is provided by owner.','Tile is furnished by the homeowner.']){
    const supplied={...extra,id:'tile',description:'Bathroom tile',evidence,researchDescription:'',additions:[{code:'03-16-01-M',quantity:99,quantityEvidence:'99 SF tile'}]};
    const result=catalogResolution({tasks:[supplied],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
    assert.equal(result.rules.length,0,evidence);assert.ok(result.issues.some(issue=>/owner-supplied material cannot be charged/i.test(issue)),evidence);
    const installed=marketResolution({...researched,rates:[{...researched.rates[0],taskId:'tile',basis:'subcontractor-installed',sources:researched.rates[0].sources.map(source=>({...source,costBasis:'subcontractor-installed'}))}]},urls,[{...supplied,researchDescription:'Install tile'}],now);
    assert.equal(installed.rules.length,0,evidence);assert.ok(installed.issues.some(issue=>/labor-only rate/i.test(issue)),evidence);
  }
});
test('A bare unresolved alternate remains a blocking nonbillable finding',()=>{
  const unresolved={...extra,id:'alternate',description:'Optional shower alternate',evidence:'Alternate pricing requested; no selection is recorded.',researchDescription:'',additions:[{code:'03-16-01-M',quantity:80,quantityEvidence:'80 SF'}]};
  const result=catalogResolution({tasks:[unresolved],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
  assert.equal(result.rules.length,0);assert.ok(result.issues.some(issue=>/selection is ambiguous/i.test(issue)));
  assert.equal(advisoryIssue(result.issues[0]),false);
});
test('Ambiguous package units cannot become confirmed area without a labeled allowance',()=>{
  const ambiguous={...extra,id:'tile',description:'Owner-supplied bathroom tile installation',evidence:'Homeowner supplies 10 boxes; coverage per box is unknown.',researchDescription:'',additions:[{code:'03-16-01-L',quantity:120,quantityEvidence:'120 SF assumed installation area'}]};
  const result=catalogResolution({tasks:[ambiguous],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
  assert.equal(result.rules.length,0);
  assert.ok(result.issues.some(issue=>/quantity remains unmeasured/i.test(issue)));
});

test('Component-scoped exclusion does not reject included painting',()=>{
 const mapping={tasks:[{id:'paint',description:'Interior painting',evidence:'Painting is included. Appliances are excluded.',existingLineIds:[],additions:[{code:'03-14-01-M',quantity:100,quantityEvidence:'100 LF for painting'}],researchDescription:'',issues:[]}],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping as any,config,[],now,scope);
 assert.equal(result.rules.length,1);assert.equal(result.issues.length,0);
});

test('Known component keeps a positive line while unknown sibling remains incomplete',()=>{
 const mapping={tasks:[{id:'mixed',description:'Painting and cabinet labor',evidence:'Painting labor is 14 hours; cabinet labor hours are unknown.',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:14,quantityEvidence:'14 labor hours for painting'}],researchDescription:'',issues:[]}],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping as any,config,[],now,scope);
 assert.equal(result.rules.length,1);assert.ok(result.issues.some(issue=>/quantity remains unmeasured/i.test(issue)));
});

test('Repair does not erase a non-price blocker when it adds a positive rule',async()=>{
 const bad={id:'labor',description:'Drywall labor',evidence:'14 labor hours',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:10,quantityEvidence:'10 labor hours'}],researchDescription:'',issues:[]};
 const good={...bad,additions:[{code:'REF-GENERAL-HOUR',quantity:14,quantityEvidence:'Corrected 14 labor hours'}]};
 const queue:unknown[]=[
  {tasks:[{id:'labor',description:bad.description,evidence:bad.evidence}],issues:[]},
  {tasks:[bad],issues:[]},
  {coveredTaskIds:['labor'],issues:[]},
  {tasks:[good],issues:[]},
  {coveredTaskIds:['labor'],issues:[]},
 ];
 const request:PricingRequest=async()=>({value:queue.shift(),sourceUrls:urls});
 const result=await priceCompleteScope({...scope,answers:{...scope.answers,service:'handyman'}},config,request,now);
 assert.equal(result.customer.range,null,'an unresolved deterministic quantity conflict still blocks release');assert.ok(result.customer.verificationItems?.some((a:string)=>/does not match the explicit quantity/i.test(a)));
 assert.ok(result.internal.scopePricing.issues.some(issue=>/does not match the explicit quantity/i.test(issue)));
});

test('research sees only actual positive priced work, never rejected additions or removed lines',async()=>{
  const {coveredWork}=await import('../lib/p5/scopePricing.ts');
  const mixed={...extra,existingLineIds:['line-1','scope-1','removed-line'],additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'10 LF'},{code:'03-15-02-M',quantity:132,quantityEvidence:'Unexplained 132 LF'},{code:'unknown-code',quantity:1,quantityEvidence:'1 each'}]};
  const accepted=catalogResolution({tasks:[mixed],issues:[],notes:[],replacements:[],removeExclusions:[]} as Parameters<typeof catalogResolution>[0],config,[],now,scope);
  assert.equal(accepted.rules.length,1,'mismatched and unknown additions are rejected');
  const priced=[{id:'line-1',description:'Plumbing - Labor',quantity:6,unit:'HR',unitCost:40},{id:'scope-1',description:'Overlay material',quantity:10,unit:'LF',unitCost:100},{id:'line-2',description:'Other',quantity:1,unit:'EA',unitCost:100}];
  assert.deepEqual(coveredWork(mixed,priced,accepted.rules),[{description:'Plumbing - Labor',quantity:6,unit:'HR'},{description:'Overlay material',quantity:10,unit:'LF'}],'accepted additions appear once and rejected proposals never imply coverage');
  assert.deepEqual(coveredWork(mixed,priced.map(line=>({...line,unitCost:0})),accepted.rules),[],'zero-cost components cannot imply coverage');
});

test('Explicit cutting-waste allowances increase purchased material without increasing installed labor',()=>{
 const trim={...extra,id:'baseboard',description:'Baseboard',evidence:'Install 120 linear feet of baseboard.',researchDescription:''};
 const waste={code:'03-15-02-M',quantity:132,quantityEvidence:'ALLOWANCE: 120 LF installed plus 10% cutting waste = 132 LF purchased.',quantityRange:{low:120,high:132}};
 const resolve=(additions:Parameters<typeof catalogResolution>[0]['tasks'][number]['additions'])=>catalogResolution({tasks:[{...trim,additions}],issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);
 const valid=resolve([waste,{code:'03-15-02-L',quantity:120,quantityEvidence:'120 LF installed'}]);
 assert.deepEqual(valid.rules.map(rule=>rule.quantity.fixed),[132,120]);assert.deepEqual(valid.issues,[]);
 assert.equal(valid.rules[0].allowance,true);assert.deepEqual(valid.rules[0].quantityRange,{low:120,high:132});
 for(const changed of [
  {code:'03-15-02-L'},            // installed labor may never carry waste
  {quantity:144},                 // 20% is past ordinary cutting waste
  {quantityRange:null},           // an overage needs a range that contains it
  {quantityRange:{low:133,high:140}}, // and the range must actually contain it
 ]){const rejected=resolve([{...waste,...changed}]);assert.equal(rejected.rules.length,0,JSON.stringify(changed));assert.ok(rejected.issues.some(issue=>/does not match/.test(issue)));}
 // Changed on purpose 2026-09-20: a PURCHASE up to 15% over one stated quantity, inside a range
 // that contains it, is ordinary cutting waste and is allowed even when the evidence does not
 // spell the arithmetic out. Demanding that exact wording rejected 990 SF of vapor barrier
 // against 900 SF installed on live repair lists and withheld the entire estimate each time.
 for(const changed of [
  {quantityEvidence:'ALLOWANCE: 132 LF including waste.'},
  {quantityEvidence:'ALLOWANCE: 100 LF installed plus 10% cutting waste = 132 LF purchased.'},
 ]){const allowed=resolve([{...waste,...changed}]);assert.equal(allowed.rules.length,1,JSON.stringify(changed));assert.equal(allowed.rules[0].quantity.fixed,132);assert.deepEqual(allowed.issues,[]);}
});

test('A mapping batch that times out is halved and both halves are priced',async()=>{
 const tasks=Array.from({length:12},(_,i)=>({...task,id:`task-${i}`,description:`Assembly component ${i}`}));
 const sizes:number[]=[];let calls=0;
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(data.taskBatch){sizes.push(data.taskBatch.length);if(data.taskBatch.length>3)throw new PricingStageTimeout('pricing-stage-timeout');return {value:{tasks:data.taskBatch.map((t:any)=>({...task,...t})),issues:[]},sourceUrls:[]};}
  return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[]},sourceUrls:[]};
 };
 const result=await priceCompleteScope(scope,config,request,now);
 assert.deepEqual(sizes,[4,4,4,2,2,2,2,2,2],'each oversized batch was split once into two halves');
 assert.ok(result.customer.range,'the same model and prompt price the halves and the range is released');
 assert.equal(result.customer.scopeTasks.length,12);
});
test('Planning-average and allowance caveats are advisory even when they say not verified',()=>{
 const live=[
  'Published cost research was not used for Contractor to supply and apply ceiling texture. (published cost research did not finish within its time allowance). A regional planning average allowance is included instead; it is not verified local pricing.',
  'Rates are preliminary Boise / Treasure Valley regional planning allowances in USD and represent direct costs only, not verified local quotes, published benchmarks, contractor overhead, profit, tax, permits, or general-contractor markup.',
  'Ceiling-texture materials for repaired drywall: regional planning average allowance for 30 SF (low confidence; not verified local pricing). Confirm current local rates before a firm proposal.',
 ];
 for(const text of live)assert.equal(advisoryIssue(text),true,text.slice(0,60));
 assert.equal(advisoryIssue('Overlay is unpriced'),false);assert.equal(advisoryIssue('Door count is missing from the plans'),false);assert.equal(advisoryIssue('Two lines double count the same tile'),false);
});
test('An owner planning catalog older than its 92-day evidence window discloses its date under the preliminary model instead of withholding the range',()=>{
 const stale:PlanningCatalog={...catalog,importedAt:new Date(now.getTime()-120*86400000).toISOString()};
 const result=priceReviewedScope(scope,createPlanningConfiguration(stale),now);
 assert.ok(result.customer.range,'the preliminary range is released');
 const expired=(result.internal as any).warnings.filter((w:any)=>w.code==='cost-evidence-expired');
 assert.ok(expired.length,'the aging evidence is still recorded');
 assert.ok(expired.every((w:any)=>w.severity==='review'&&/rates last confirmed \d{4}-\d{2}-\d{2}/.test(w.message)),'as a dated review note, not a block');
 const warnings=(result.internal as any).warnings;assert.ok(!warnings.some((w:any)=>w.code==='planning-catalog-incomplete'),'a due quarterly review is not a missing rate');
 assert.ok(warnings.some((w:any)=>w.code==='planning-catalog-review-due'&&w.severity==='review'&&/imported \d{4}-\d{2}-\d{2}/.test(w.message)),'the due review is disclosed with its date');
 assert.ok(!(result.internal as any).warnings.some((w:any)=>w.severity==='block'),JSON.stringify(warnings.filter((w:any)=>w.severity==='block')));
});
test('A repair round keeps first-pass research and never prices the same gap twice',async()=>{
 const tasks=[{...task,id:'drywall',description:'Patch drywall',researchDescription:''},{...extra,id:'texture',description:'Ceiling texture',researchDescription:'Matching ceiling texture over 30 sf'},{...extra,id:'caulk',description:'Re-caulk tub surround',researchDescription:'Re-caulk one bathtub surround'}];
 const planned=(ids:string[])=>({rates:ids.map(id=>({taskId:id,description:`${id} allowance`,unit:'EA',quantity:1,quantityEvidence:'one',basis:'trade-labor',includes:'labor',excludes:'',low:100,high:200,confidence:'low',rationale:'Synthetic.'})),issues:[],notes:[]});
 for(const flagged of [false,true]){
  let calls=0,audits=0;const researchedFor:string[][]=[];
  const request:PricingRequest=async(_i,input,search)=>{const d=input as any;calls++;
   if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
   if(d.taskBatch)return {value:{tasks:d.taskBatch.map((t:any)=>({...tasks.find(x=>x.id===t.id)!,...t})),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
   if(search){researchedFor.push(d.tasks.map((t:any)=>t.id));return {value:publishedFixture(planned(d.tasks.map((t:any)=>t.id))),sourceUrls:urls};}
   if('priorPricingIssues' in d){audits++;return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:audits===1?[flagged?'Ceiling texture: the allowance area disagrees with the stated 30 sf.':'Patch drywall: the patch count disagrees with the description.']:[],notes:[],resolvedIssues:[]},sourceUrls:[]};}
   if(d.tasks&&d.region){researchedFor.push(d.tasks.map((t:any)=>t.id));return {value:planned(d.tasks.map((t:any)=>t.id)),sourceUrls:[]};}
   throw new Error('unexpected request');
  };
  const r=await priceCompleteScope(scope,config,request,now);
  const rules=(r.internal as any).scopePricing?.rules||(r.internal as any).lines;
  const lines=(r.internal as any).lines.filter((l:any)=>l.id.startsWith('market-'));
  assert.equal(lines.filter((l:any)=>l.description.startsWith('caulk')).length,1,'the caulk allowance is priced once');
  assert.equal(lines.filter((l:any)=>l.description.startsWith('texture')).length,1,'the texture allowance is priced once');
  assert.deepEqual(researchedFor[0].sort(),['caulk','texture'],'first pass researches both gaps');
  if(flagged)assert.deepEqual(researchedFor.slice(1),[['texture']],'only the task the audit named is researched again');
  else assert.equal(researchedFor.length,1,'a repair that names no researched task researches nothing again');
  assert.ok(r.customer.range,'the range is released');
 }
});
test('two research timeouts preserve progress without substituting an uncited planning price',async()=>{
 const live='T01 remains only partially defensibly priced. planning-100001 prices required selective demolition using uncited general estimating knowledge, with no published estimating-guide or cost-database observations. The approximately 30 SF demolition quantity also lacks the required positive quantityRange and an ALLOWANCE-prefixed quantity explanation.';
 assert.equal(advisoryIssue(live),true,'the audit note about the planning basis is disclosed');
 assert.equal(advisoryIssue('planning-2 duplicates the drywall labor already carried on scope-1 (double count).'),false,'a duplicate on a planning line still blocks');
 const tasks=[{...task,id:'drywall',description:'Patch drywall',researchDescription:''},{...extra,id:'texture',description:'Ceiling texture',researchDescription:'Matching ceiling texture over 30 sf'}];
 const planned={rates:[{taskId:'texture',description:'Ceiling texture allowance',unit:'SF',quantity:30,quantityEvidence:'30 sf',basis:'trade-labor',includes:'labor',excludes:'',low:3,high:6,confidence:'low',rationale:'Regional planning average.'}],issues:[],notes:[]};
 let calls=0;
 const request:PricingRequest=async(_i,input,search)=>{const d=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(d.taskBatch)return {value:{tasks:d.taskBatch.map((t:any)=>({...tasks.find(x=>x.id===t.id)!,...t})),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  if(search)throw new PricingStageTimeout('pricing-stage-timeout');
  if('priorPricingIssues' in d)return {value:{coveredTaskIds:['drywall'],issues:[live],notes:[],resolvedIssues:[]},sourceUrls:[]};
  if(d.tasks&&d.region)return {value:planned,sourceUrls:[]};
  throw new Error('unexpected request');
 };
 await assert.rejects(()=>priceCompleteScope(scope,config,request,now),PricingPending);
 assert.equal(calls,4,'inventory, mapping and two bounded research attempts; no uncited average is requested');
});
test('Unresolved duplicate pricing blocks release, and missing measurements remain questions',async()=>{
 const tasks=[{...task,id:'drywall',description:'Patch drywall',researchDescription:''}];
 const run=async(auditIssue:string)=>{let calls=0;const request:PricingRequest=async(_i,input)=>{const d=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(d.taskBatch)return {value:{tasks:d.taskBatch.map((t:any)=>({...tasks.find(x=>x.id===t.id)!,...t})),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  if('priorPricingIssues' in d)return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[auditIssue],notes:[],resolvedIssues:[]},sourceUrls:[]};
  throw new Error('unexpected request');};
  return priceCompleteScope(scope,config,request,now);};
 const judged=await run('Patch drywall: the labor line appears to double count the mobilization already carried.');
 assert.equal(judged.customer.range,null,'unresolved duplicate costs cannot ship as a complete estimate');
 assert.ok(judged.customer.verificationItems.some((a:string)=>/double count/.test(a)),'the unresolved finding remains visible');
 assert.ok(judged.internal.scopePricing.issues.some(i=>/double count/.test(i)),'and stays in the audit trail');
 const askable=await run('Missing quantity: sqft');
 assert.equal(askable.customer.range,null,'a missing measurement is asked for, not guessed around');
 assert.ok(askable.internal.missingInformation.some((m:string)=>/^Missing quantity: sqft/.test(m)),'it reaches the customer as a question');
});
test('Exhausting the repair budget preserves the scope hold instead of authorizing an unchecked total',async()=>{
 const tasks=[{...task,id:'drywall',description:'Patch drywall',researchDescription:''}];
 const run=async(startedAt:Date)=>{let mappings=0,audits=0;const request:PricingRequest=async(_i,input)=>{const d=input as any;
  if(d.taskBatch){mappings++;return {value:{tasks:d.taskBatch.map((t:any)=>({...tasks.find(x=>x.id===t.id)!,...t})),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};}
  if('priorPricingIssues' in d){audits++;return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:audits===1?['Patch drywall: the patch count disagrees with the description.']:[],notes:[],resolvedIssues:[]},sourceUrls:[]};}
  return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};};
  const r=await priceCompleteScope(scope,config,request,startedAt,undefined,undefined,0,async()=>({startedAt:startedAt.getTime(),busyWaitMs:0}));return {r,mappings,audits};};
 const fresh=await run(new Date(Date.now()-1000));
 assert.equal(fresh.mappings,2,'a fresh job repairs the finding');assert.equal(fresh.audits,2);
 const late=await run(new Date(Date.now()-6*60*1000));
 assert.equal(late.mappings,1,'past the budget no repair mapping runs');assert.equal(late.audits,1);
 assert.equal(late.r.customer.range,null,'elapsed time cannot authorize a conflicting quantity');
 assert.ok(late.r.customer.verificationItems.some((a:string)=>/patch count/.test(a)),'the unresolved finding remains visible');
 assert.ok(late.r.internal.scopePricing.issues.some(i=>/Repair round skipped/.test(i)),'the skip is recorded for staff');
});
test('A partial finishing allowance cannot release a total that omits baseboard material',async()=>{
 const omission='BASE-001 is not fully priced: no positive priced line carries baseboard material. planning-1 covers caulk, filler, paint and finishing labor; the proposed material addition was not converted into a priced line.';
 assert.equal(advisoryIssue(omission),false,'a planning line cannot hide a material omission');
 assert.equal(advisoryIssue('Regional planning average has missing material and unpriced fasteners.'),false);
 const trim={...extra,id:'BASE-001',description:'Baseboard installation',evidence:'Install 120 linear feet of painted baseboard.',researchDescription:'Baseboard finishing',additions:[{code:'03-15-02-L',quantity:120,quantityEvidence:'120 LF installed'}]};
 let audits=0;
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as {taskBatch?:unknown;tasks?:unknown;region?:unknown};
  if(data.taskBatch)return {value:{tasks:[trim],issues:[]},sourceUrls:[]};
  if('priorPricingIssues' in data){audits++;return {value:{coveredTaskIds:[],issues:[omission]},sourceUrls:[]};}
  if(data.tasks&&data.region)return {value:publishedFixture({rates:[{taskId:trim.id,description:'Baseboard finishing allowance',unit:'LF',quantity:120,quantityEvidence:'120 LF',basis:'trade-labor',includes:'caulk, filler, paint and finishing labor only',excludes:'baseboard material',low:3,high:6,confidence:'low',rationale:'Synthetic fixture only.'}],issues:[]}),sourceUrls:urls};
  return {value:{tasks:[{id:trim.id,description:trim.description,evidence:trim.evidence}],issues:[]},sourceUrls:[]};
 };
 const expiredRepairAt=Date.now()-6*60*1000;
 const result=await priceCompleteScope(scope,config,request,new Date(expiredRepairAt),undefined,undefined,0,async()=>({startedAt:expiredRepairAt,busyWaitMs:0}));
 assert.equal(audits,1,'expired repair budget does not initiate more provider work');
 assert.equal(result.customer.range,null,'the partial allowance never becomes a full-scope range');
 assert.ok(result.customer.verificationItems.some(item=>item.includes('no positive priced line carries baseboard material')),'the omission reaches the customer, without internal line ids');
 assert.ok(!result.customer.assumptions.some(item=>item.includes(omission)),'missing work cannot become a routine assumption');
 assert.ok(result.internal.scopePricing.issues.some(item=>/full pricing coverage/.test(item)));
});
test('late pricing stages still research instead of substituting an uncited average',async()=>{
 const tasks=[{...task,id:'drywall',description:'Patch drywall',researchDescription:''},{...extra,id:'texture',description:'Ceiling texture',researchDescription:'Matching ceiling texture over 30 sf'}];
 const planned={rates:[{taskId:'texture',description:'Ceiling texture allowance',unit:'SF',quantity:30,quantityEvidence:'30 sf',basis:'trade-labor',includes:'labor',excludes:'',low:3,high:6,confidence:'low',rationale:'Regional planning average.'}],issues:[],notes:[]};
 const run=async(startedAt:Date)=>{let searches=0;const request:PricingRequest=async(_i,input,search)=>{const d=input as any;
  if(search){searches++;return {value:publishedFixture(planned),sourceUrls:urls};}
  if(d.taskBatch)return {value:{tasks:d.taskBatch.map((t:any)=>({...tasks.find(x=>x.id===t.id)!,...t})),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  if('priorPricingIssues' in d)return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  if(d.tasks&&d.region)return {value:planned,sourceUrls:[]};
  return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};};
  const r=await priceCompleteScope(scope,config,request,startedAt);return {r,searches};};
 const fresh=await run(new Date(Date.now()-1000));assert.equal(fresh.searches,1,'a fresh job attempts published research');assert.ok(fresh.r.customer.range);
 const late=await run(new Date(Date.now()-4*60*1000));assert.equal(late.searches,1,'a late stage still researches its missing item');assert.ok(late.r.customer.range);
 assert.ok((late.r.internal as any).costBookSnapshot.rules.some((rule:any)=>rule.estimatingBasis==='sourced-market-average'));
 assert.ok(!(late.r.internal as any).costBookSnapshot.rules.some((rule:any)=>rule.estimatingBasis==='regional-planning-average'));
});
test('Advisory-only issues release the range without a repair round',async()=>{
 const tasks=Array.from({length:12},(_,i)=>({...task,id:`task-${i}`,description:`Assembly component ${i}`}));
 let calls=0,mappings=0,audits=0;
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(data.taskBatch){mappings++;return {value:{tasks:data.taskBatch.map((t:any)=>({...task,...t})),issues:['Interior paint allowance: confirm the colour selection with the owner.']},sourceUrls:[]};}
  if('priorPricingIssues' in data){audits++;return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[]},sourceUrls:[]};}
  throw new Error('unexpected pricing request');
 };
 const result=await priceCompleteScope(scope,config,request,now);
 assert.equal(mappings,Math.ceil(tasks.length/4),'initial mapping batches only: no repair mapping when the only issues are advisory');
 assert.equal(audits,1,'no second audit when the only issues are advisory');
 assert.ok(result.customer.range,'the range is released');
 assert.ok(result.customer.assumptions.some((a:string)=>/confirm the colour selection/.test(a)),'the advisory note travels with the estimate as an item to confirm');
});
test('A batch that cannot shrink further pauses the job instead of ending it',async()=>{
 const tasks=Array.from({length:3},(_,i)=>({...task,id:`task-${i}`,description:`Assembly component ${i}`}));
 let calls=0;
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(data.taskBatch)throw new PricingStageTimeout('pricing-stage-timeout');
  throw new Error('audit must not run');
 };
 await assert.rejects(()=>priceCompleteScope(scope,config,request,now),(e:any)=>e.name==='PricingPending'&&e.retryAfterMs>0&&!e.fatal,'a pause with a retry, never a verdict');
});
test('A stage that has timed out three times is an honest handoff, and still never a partial total',async()=>{
 let calls=0;
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:[{id:task.id,description:task.description,evidence:task.evidence}],issues:[]},sourceUrls:[]};
  if(data.taskBatch)throw new PricingStageTimeout('pricing-stage-exhausted');
  throw new Error('audit must not run');
 };
 const result=await priceCompleteScope(scope,config,request,now);
 assert.equal(result.customer.range,null,'the no-partial-total guarantee is unchanged');
 assert.ok(result.customer.verificationItems.includes(HANDOFF_ISSUE),'the visitor is told a person will finish it');
 assert.ok(!JSON.stringify(result.customer).includes('An estimator must resolve'),'no staff instruction reaches the customer');
 assert.ok(result.internal.scopePricing.issues.some((i:string)=>i.includes('pricing-stage-exhausted')),'the precise cause is kept internally');
});
test('A provider failure reads as a handoff to the customer and a cause to staff',async()=>{
 const r=await priceCompleteScope(scope,config,async()=>{throw new Error('offline')},now);
 assert.equal(r.customer.range,null);
 assert.deepEqual(r.customer.verificationItems,[HANDOFF_ISSUE]);
 assert.ok(r.internal.scopePricing.issues.some((i:string)=>i.includes('offline')));
});

test('empty research does not invent a price or silently drop the requested item',async()=>{
 const tasks=[task,extra];let planned=0,audited=0;
 const request:PricingRequest=async(_i,input,search)=>{const d=input as any;
  if(search)return {value:{rates:[],issues:['No matching published rate found'],notes:[]},sourceUrls:[]};
  if(d.taskBatch)return {value:{tasks:d.taskBatch.map((t:any)=>({...tasks.find(x=>x.id===t.id)!,...t})),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  if('priorPricingIssues' in d){audited++;return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};}
  if(d.tasks&&d.region){planned++;return {value:{rates:[{taskId:'overlay',description:'Protective overlay',unit:'LF',quantity:10,quantityEvidence:'ten feet',basis:'material-purchase',includes:'overlay material',excludes:'installation',low:3,high:6,confidence:'low',rationale:'Synthetic planning allowance.'}],issues:[],notes:[]},sourceUrls:[]};}
  return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};};
 await assert.rejects(()=>priceCompleteScope(scope,config,request,now),PricingPending);
 assert.equal(planned,0);assert.equal(audited,0);
});
test('national averages alone cannot be presented as Boise researched pricing',()=>{
 const national=structuredClone(researched);
 national.rates[0].sources.forEach(source=>source.region='United States national average');
 assert.throws(()=>marketResolution(national,urls,[extra],now,0,'Boise'),/do not establish Boise/);
 const local=marketResolution(researched,urls,[extra],now,0,'Boise');
 assert.equal(local.rules.length,1);
 assert.equal(local.rules[0].unitCost,20);
});
test('Unsupported market and planning output units remain visibly unpriced',()=>{
  const market=structuredClone(researched);market.rates[0].unit='project';market.rates[0].sources.forEach(s=>s.unit='project');
  const rejectedMarket=marketResolution(market,urls,[extra],now);
  assert.equal(rejectedMarket.rules.length,0);assert.match(rejectedMarket.issues.join(' '),/unsupported pricing unit "project"/);
  const planning={rates:[{taskId:'overlay',description:'Protective overlay allowance',unit:'bundle',quantity:1,quantityEvidence:'One requested scope package',basis:'material-purchase' as const,includes:'Overlay material',excludes:'Installation',low:100,high:200,confidence:'low' as const,rationale:'Synthetic unsupported-unit fixture.'}],issues:[]};
  const rejectedPlanning=planningResolution(planning,[extra],now);
  assert.equal(rejectedPlanning.rules.length,0);assert.match(rejectedPlanning.issues.join(' '),/unsupported pricing unit "bundle"/);
});
test('Production pricing does not require QA-only spending allowance variables',async()=>{
 const names=['P5_LIVE_PRICING_ALLOWANCE_ID','P5_LIVE_PRICING_ALLOWANCE_USD','P5_LIVE_PRICING_RESERVE_USD'] as const;
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 for(const name of names)delete process.env[name];
 try{
  const result=await priceCompleteScope(scope,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:[task.id],issues:[]}]),now);
  assert.ok(result.customer.range);
 }finally{for(const name of names){const value=saved[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
test('Every customer projection leaving the cost book and scope pricing redacts private cost arithmetic',async()=>{
 const leaking='$2.00/LF ($200.00 direct cost)';
 const exclusions=`Painting excluded; ${leaking}`;
 // The early review-required result quotes scope notes without passing through customerEstimate.
 const unmeasured=priceReviewedScope({...scope,answers:{service:'cabinet-product',location:'Boise',exclusions}},config,now);
 assert.equal(unmeasured.customer.range,null);
 assert.ok(!JSON.stringify(unmeasured.customer).includes('direct cost'));
 assert.ok(unmeasured.customer.exclusions.includes('Painting excluded'));
 assert.equal(unmeasured.internal.scope.answers.exclusions,exclusions,'the internal record keeps the original note');
 const leaky={...scope,answers:{...scope.answers,exclusions}};
 const r=await priceCompleteScope(leaky,config,async()=>{throw new Error('offline');},now);
 assert.ok(r.internal.scopePricing.issues.length);
 assert.ok(!JSON.stringify(r.customer).includes('direct cost'));
 assert.ok(!JSON.stringify(r.customer).includes('$2.00'));
 assert.ok(r.customer.exclusions.includes('Painting excluded'));
 const complete=await priceCompleteScope(scope,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:[task.id],issues:[]}]),now);
 assert.ok(complete.customer.range);
 assert.deepEqual(complete.customer.range,(complete.internal as any).planningRange,'the customer boundary never changes the selling range');
});

test('A materials line may carry ordinary cutting waste over the stated area; labor and larger gaps may not',()=>{
 const task=(existing:string)=>({tasks:[{id:'tile',description:'Supply porcelain floor tile and setting materials for 40 square feet',evidence:'40 SF bathroom floor, floor only',existingLineIds:[existing],additions:[],researchDescription:'',issues:[]}],issues:[],notes:[],replacements:[],removeExclusions:[]});
 const line=(id:string,category:string,quantity:number)=>({id,category,description:'Porcelain floor tile',quantity,unit:'SF',unitCost:6}) as any;
 const waste=catalogResolution(task('m') as any,config,[line('m','materials',44)],now,scope);
 assert.deepEqual(waste.issues,[]);assert.ok(waste.assumptions.some(note=>/44 SF purchased for 40 SF installed.*10% for cuts and waste/.test(note)));
 const labor=catalogResolution(task('l') as any,config,[line('l','field-labor',44)],now,scope);
 assert.ok(labor.issues.some(issue=>/does not match the explicit quantity/.test(issue)),'installed work must match the stated area');
 const excessive=catalogResolution(task('x') as any,config,[line('x','materials',60)],now,scope);
 assert.ok(excessive.issues.some(issue=>/does not match the explicit quantity/.test(issue)),'a 50% difference is not cutting waste');
});
test('A repair round cannot delete a priced component without replacing it in kind',async()=>{
 const priced0={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]};
 // The repair names the first-pass line as wrong and supplies nothing for that task.
 const emptied={...extra,researchDescription:'',additions:[]};
 const priced=await priceCompleteScope(scope,config,replies([
   {tasks:[task,priced0],issues:[]},
   {coveredTaskIds:['cabinets'],issues:['Overlay coverage should be confirmed as missing labor']},
   {tasks:[task,emptied],issues:[],replacements:[{lineId:'scope-1',reason:'replace with a better rate'}]},
   {coveredTaskIds:['cabinets','overlay'],issues:[]},
 ]),now);
 assert.ok((priced.internal as any).lines.some((l:any)=>l.id==='scope-1'),'the original component is kept');
 assert.ok(priced.customer.range,JSON.stringify((priced.internal as any).scopePricing.issues));
});
test('A finding that only disputes how the owner derived an approved rate never withholds the range',async()=>{
 const {advisoryIssue}=await import('../lib/p5/scopePricing.ts');
 assert.equal(advisoryIssue('garage-lights is not fully supported: labor line scope-8 uses an unsupported selling-price-to-direct-cost conversion. Planning line planning-302 covers only minor repair materials, not defensible electrician labor.'),true);
 assert.equal(advisoryIssue('sink-traps is not fully supported: labor line scope-3 derives a purported direct cost from historical customer selling rates using assumed 20% overhead, 20% profit, and a 1.10 divisor.'),true);
 assert.equal(advisoryIssue('scope-3 duplicates scope-4 and was reverse-engineered'),false);
 assert.equal(advisoryIssue('Electrician labor for the outlet is unpriced.'),false);
 const priced0={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]};
 const priced=await priceCompleteScope(scope,config,replies([
   {tasks:[task,priced0],issues:[]},
   {coveredTaskIds:['cabinets'],issues:['overlay is not fully supported: line scope-1 uses an unsupported selling-price-to-direct-cost conversion.']},
 ]),now);
 assert.ok(priced.customer.range,JSON.stringify((priced.internal as any).scopePricing.issues));
});
test('A remark about a task that is priced becomes a confirmation note, not a withheld range',async()=>{
 const {pricedTaskRemark}=await import('../lib/p5/scopePricing.ts');
 const priced=[{id:'crawl-debris',description:'Remove crawl space debris'}];
 assert.equal(pricedTaskRemark('crawl-debris is not fully covered by scope-3 and scope-4; the dumpster line does not affirmatively include hauling or landfill charges.',priced),true);
 assert.equal(pricedTaskRemark('crawl-debris duplicates scope-9',priced),false);
 assert.equal(pricedTaskRemark('sprinkler-pump has no positive priced component or allowance was produced.',priced),false);
 assert.equal(pricedTaskRemark('Remove crawl space debris: quantity remains unmeasured; do not publish a confirmed quantity.',priced),false);
 const priced0={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]};
 const result=await priceCompleteScope(scope,config,replies([
   {tasks:[task,priced0],issues:[]},
   {coveredTaskIds:['cabinets'],issues:['Protective overlay is not fully covered by scope-1: the line does not affirmatively include edge sealing.']},
 ]),now);
 assert.ok(result.customer.range,JSON.stringify((result.internal as any).scopePricing.issues));
 assert.ok(result.customer.verificationItems?.some((v:string)=>/edge sealing/i.test(v)),'the remark is disclosed');
});
test('an unmapped repair receives a disclosed fallback allowance instead of being excluded',async()=>{
 const priced0={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]};
 const missing={id:'chimney',description:'Repair the cracked chimney cap',evidence:'severe cracking',existingLineIds:[],additions:[],researchDescription:'',issues:[]};
 const result=await priceCompleteScope(scope,config,replies([
   {tasks:[task,priced0,missing],issues:[]},
   {coveredTaskIds:['cabinets','overlay','chimney'],issues:[]},
   {tasks:[task,priced0,missing],issues:[]},
   {rates:[],issues:[],notes:[]},
   publishedFixture({rates:[{taskId:'chimney',description:'Typical masonry chimney cap repair',unit:'LS',quantity:1,quantityEvidence:'ALLOWANCE: One typical repair, verify condition',quantityRange:{low:1,high:1},basis:'subcontractor-installed',includes:'Incremental repair labor and common materials',excludes:'Company overhead and profit',low:100,high:200,confidence:'low',rationale:'Synthetic test allowance, not a real price'}],issues:[],notes:[]}),
   {coveredTaskIds:['cabinets','overlay','chimney'],issues:[]},
 ]),now);
 assert.ok(result.customer.range,JSON.stringify((result.internal as any).scopePricing.issues));
 assert.ok(!result.customer.exclusions.some((e:string)=>/cracked chimney cap/i.test(e)));
 assert.ok((result.internal as any).costBookSnapshot.rules.some((rule:any)=>rule.scopeTaskId==='chimney'&&rule.estimatingBasis==='sourced-market-average'));
});
test('The same document answered the same way prices to the same number, without asking the provider again',async()=>{
 const {pricingScopeFingerprint,reusableResolution}=await import('../lib/p5/pricingCache.ts');
 const store=new Map<string,any>();
 const cache={async load(k:any){return store.get(k.fingerprint)||store.get(k.document)||null;},async save(k:any,e:any){store.set(k.fingerprint,e);store.set(k.document,e);}};
 const priced0={...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]};
 const answered=scope;
 const uploaded={...scope,uploads:[{id:'u1',name:'re10.pdf',type:'application/pdf',size:1024,sha256:'a'.repeat(64),status:'stored' as const}]};
 const first=await priceCompleteScope(answered,config,replies([
   {tasks:[task,priced0],issues:[]},
   {coveredTaskIds:['cabinets','overlay'],issues:[]},
 ]),now,undefined,cache as never);
 assert.ok(first.customer.range,JSON.stringify({w:(first.internal as any).pricingWarnings,i:(first.internal as any).scopePricing.issues,n:(first.internal as any).lines?.length}));
 assert.equal(store.size,2,'a priced estimate is saved under both its conversation and its project identity');
 // A second submission of the same document and answers must not reach the provider at all.
 const never=async()=>{throw new Error('the provider must not be called when a saved price applies');};
 const second=await priceCompleteScope(answered,config,never as never,new Date(now.getTime()+86400000),undefined,cache as never);
 assert.deepEqual(second.customer.range,first.customer.range,'same input, same price');
 assert.deepEqual(second.customer.lineItems.map((l:any)=>[l.id,l.low,l.high]),first.customer.lineItems.map((l:any)=>[l.id,l.low,l.high]));
 // Anything that would change the price changes the identity, so a stale number is never served.
 const base=pricingScopeFingerprint(answered,config);
 assert.notEqual(pricingScopeFingerprint(uploaded,config),base,'an attached document is part of the project');
 assert.notEqual(pricingScopeFingerprint({...uploaded,uploads:[{...uploaded.uploads[0],sha256:'b'.repeat(64)}]},config),pricingScopeFingerprint(uploaded,config),'a different document');
 assert.notEqual(pricingScopeFingerprint({...answered,answers:{...answered.answers,cabinetBaseLf:'20'}},config),base,'a different answer');
 assert.notEqual(pricingScopeFingerprint({...answered,text:answered.text+' and a new pantry'},config),base,'different typed scope');
 assert.equal(pricingScopeFingerprint({...answered,text:'  '+answered.text.toUpperCase()+' '},config),base,'spacing and case are not a different project');
 const repriced={...config,planningCatalog:{...config.planningCatalog!,rates:config.planningCatalog!.rates.map((r,i)=>i?r:{...r,amount:r.amount+5})}};
 assert.notEqual(pricingScopeFingerprint(answered,repriced),base,'an owner rate change');
 assert.notEqual(pricingScopeFingerprint(answered,{...config,finance:{...config.finance,targetMargin:0.44}}),base,'a margin change');
 // A scope that could not be priced is never saved, so it is tried again rather than refused forever.
 assert.equal(reusableResolution({rules:[],assumptions:[],issues:[]}),false);
 assert.equal(reusableResolution({rules:[{unitCost:5,quantity:{fixed:1,factor:1}} as never],assumptions:[],issues:['Something is unresolved']}),false);
});
test('A new customer clarification invalidates a cached document price',async()=>{
 const {documentScopeFingerprint,compatibleAnswers,answerEntries,pricingScopeFingerprint}=await import('../lib/p5/pricingCache.ts');
 const asked={...scope,answers:{...scope.answers,otherDetails:'Question: Which overlay finish?\nAnswer: the standard one'}};
 assert.equal(documentScopeFingerprint(scope,config),documentScopeFingerprint(asked,config),'document lookup can find the same source');
 assert.notEqual(pricingScopeFingerprint(scope,config),pricingScopeFingerprint(asked,config),'the effective pricing identity changes');
 assert.equal(compatibleAnswers(answerEntries(scope),answerEntries(asked)),false,'a new answer must be evaluated');
 assert.equal(compatibleAnswers(answerEntries(asked),answerEntries(scope)),false,'removing a decision also needs evaluation');
});
test("The reader's own summary of a document does not make it a different project",async()=>{
 const {documentScopeFingerprint,pricingScopeFingerprint,compatibleAnswers,answerEntries}=await import('../lib/p5/pricingCache.ts');
 // Both sides are the SAME RE-10, read twice on boisehandyman.co. Every difference below is the
 // reader describing one document in its own words; the customer stated nothing different.
 const rawRead1={...scope,uploads:[{id:'u1',name:'re10.pdf',type:'application/pdf',size:2048,sha256:'c'.repeat(64),status:'stored' as const}],
  answers:{...scope.answers,plumbing:'Reconfigure under sink trap assemblies; install vacuum breakers on all exterior hose bibs',
   taskList:'Fireplace: install ignition components, ensure operational; remove damper',
   otherDetails:'Prior page items: chimney cap repair/cleaning, exterior venting boots'}};
 const rawRead2={...rawRead1,answers:{...scope.answers,plumbing:'Reconfigure under sink trap assemblies; install vacuum breakers on exterior hose bibs',
   taskList:'Chimney cap: repair severe cracking; clean chimney bottom flashing buildup',
   otherDetails:'About 900 square feet'}};
 const withEvidence=(v:typeof rawRead1)=>({...v,extraction:{summary:'Source review',facts:Object.entries(v.answers).filter(([field])=>['plumbing','taskList','otherDetails'].includes(field)).map(([field,value])=>({field:field as 'otherDetails',value,confidence:1,basis:'stated' as const,source:'re10.pdf',evidence:value})),conflicts:[],missingInformation:[],reviewNotes:[]}});
 const read1=withEvidence(rawRead1),read2=withEvidence(rawRead2);
 assert.equal(documentScopeFingerprint(read1,config),documentScopeFingerprint(read2,config),'one document, one project');
 assert.equal(pricingScopeFingerprint(read1,config),pricingScopeFingerprint(read2,config),'and one priced identity');
 assert.equal(compatibleAnswers(answerEntries(read1),answerEntries(read2)),true,'so the saved price still applies');
 // What the customer states still governs: a measurement they change prices again.
 const measured={...read2,answers:{...read2.answers,sqft:'1200'}};
 const before={...read1,answers:{...read1.answers,sqft:'900'}};
 assert.equal(compatibleAnswers(answerEntries(before),answerEntries(measured)),false);
 assert.notEqual(pricingScopeFingerprint(before,config),pricingScopeFingerprint(measured,config));
});
test('A task mapped to a master price book line carries the book\'s direct cost into the estimate',async()=>{
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const {withRateCard}=await import('../lib/p5/rateCard.ts');
 const booked=withRateCard(config,priceBookRates({service:'kitchen',finish:'mid-range'}));
 const cabinets={id:'cabinets',description:'Kitchen cabinets, 12 linear feet',evidence:'12 LF of cabinets',existingLineIds:[],researchDescription:'',issues:[],
  additions:[{code:'PB-12-31-01',quantity:12,quantityEvidence:'12 LF of cabinets'}]};
 const resolved=catalogResolution({tasks:[cabinets],issues:[],notes:[],replacements:[],removeExclusions:[]},booked,[],now,scope);
 assert.deepEqual(resolved.issues,[]);
 const rule=resolved.rules[0];
 assert.equal(rule.unitCost,550,'Mid-Range $500/LF plus the 10% existing-home premium');
 assert.equal(rule.quantity.fixed,12);
 assert.equal(rule.category,'subcontractors','an installed price, never split into extra labor or material');
 assert.equal(rule.priceBasis,'direct-cost','overhead and profit are applied once, after this');
 assert.match(rule.evidence.reference,/PB-12-31-01/);
});
test('a contract-timing question never withholds a price',async()=>{
 const {advisoryIssue}=await import('../lib/p5/scopePricing.ts');
 // Live Marcliffe RE-10 wording.
 assert.ok(advisoryIssue('Schedule conflict: the extracted notice states completion within 8 business days, while another document note says the field is blank and defaults to 10 business days. Which deadline governs the estimate? Price and scope are otherwise unaffected.'));
 assert.ok(!advisoryIssue('The 8 business day completion requires overtime labor that is unpriced.'),'timing that names unpriced cost still blocks');
});
test('an audit resolution that cites no line is dropped instead of failing the estimate (live bathroom, 2026-09-21)',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:['cabinets'],issues:[],resolvedIssues:[{issue:'Hardware labor',reason:'covered',lineIds:[]}]}]),now);
 assert.ok(r.customer.range,'the priced estimate is released');
 assert.doesNotMatch(JSON.stringify(r.internal.scopePricing.issues),/ZodError/);
});
test('a source with nothing separately priceable is priced from the reviewed answers, never handed off (live budget, 2026-09-21)',async()=>{
 const empty:PricingRequest=async()=>({value:{tasks:[],issues:[],notes:[]},sourceUrls:[]});
 const r=await priceCompleteScope(scope,config,empty,now);
 assert.deepEqual(r.customer.range,base.customer.range);
 assert.ok(r.internal.scopePricing.issues.some((i:string)=>/No separately priceable tasks/.test(i)));
 assert.doesNotMatch(JSON.stringify(r.internal.scopePricing.issues),/ZodError/);
});
test('a line equal to one of several stated quantities in the same unit agrees with the scope (live kitchen 2026-09-22)',async()=>{
 const kitchen:ReviewedScope={...scope,text:'Supply and install 22 LF base cabinets and 18 LF upper cabinets.',answers:{service:'handyman',location:'Boise'}};
 const cabinets={...extra,id:'cabinets',description:'Kitchen cabinets',evidence:'22 LF base cabinets and 18 LF upper cabinets.',researchDescription:'',additions:[
  {code:'03-17-01-M',quantity:22,quantityEvidence:'22 LF base cabinets.'},
  {code:'03-15-02-M',quantity:18,quantityEvidence:'18 LF upper cabinets.'},
 ]};
 const priced=await priceCompleteScope(kitchen,config,replies([{tasks:[cabinets],issues:[]},{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.ok(priced.customer.range,'22 LF and 18 LF are both stated; neither contradicts the scope');
 const wrong={...cabinets,additions:[{code:'03-17-01-M',quantity:30,quantityEvidence:'30 LF base cabinets.'}]};
 const held=await priceCompleteScope(kitchen,config,replies([{tasks:[wrong],issues:[]},{coveredTaskIds:['cabinets'],issues:[]},{tasks:[wrong],issues:[]},{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.equal(held.customer.range,null,'a quantity stated nowhere still holds the price');
});
test('a task whose description excludes a PART of it is still priced (live Moonglow RE-10 2026-09-22)',async()=>{
 const re10:ReviewedScope={...scope,text:'Replace six smoke detectors. Patch the garage firewall.',answers:{service:'handyman',location:'Boise'}};
 const detectors={...extra,id:'smoke',description:'Furnish and replace up to six standard smoke detectors; specialty devices and wiring changes are excluded unless separately approved.',evidence:'Replace six smoke detectors.',researchDescription:'',additions:[{code:'TEST-DOOR-M',quantity:6,quantityEvidence:'six smoke detectors'}]};
 const priced=await priceCompleteScope(re10,config,replies([{tasks:[detectors],issues:[]},{coveredTaskIds:['smoke'],issues:[]}]),now);
 assert.ok(priced.customer.range,'the detectors are requested work; only the specialty extras are excluded');
 const unselected={...detectors,description:'Alternate: smoke detectors not selected.'};
 const skipped=await priceCompleteScope(re10,config,replies([{tasks:[unselected],issues:[]},{coveredTaskIds:['smoke'],issues:[]}]),now);
 assert.ok(!(skipped.internal as any).lines?.some((l:any)=>l.scopeTaskId==='smoke'&&l.quantity>0),'a task that is itself not selected is still not charged');
});
test('owner supply elsewhere in a document does not block a contractor-supplied item (live P5 kitchen 2026-09-22)',async()=>{
 const kitchen:ReviewedScope={...scope,text:'Owner supplies the appliances. Supply and install one undermount sink.',answers:{service:'handyman',location:'Boise'}};
 const sink={...extra,id:'sink',description:'Supply and install one undermount kitchen sink',evidence:'Owner supplies the appliances. Supply and install one undermount sink.',researchDescription:'',additions:[{code:'TEST-DOOR-M',quantity:1,quantityEvidence:'one undermount sink'}]};
 const priced=await priceCompleteScope(kitchen,config,replies([{tasks:[sink],issues:[]},{coveredTaskIds:['sink'],issues:[]}]),now);
 assert.ok(priced.customer.range,'the sink is contractor-supplied; only the appliances are the owner\'s');
 const owned={...sink,description:'Install the owner-supplied undermount sink',evidence:'Owner supplies the sink; contractor installs it.'};
 const held=await priceCompleteScope(kitchen,config,replies([{tasks:[owned],issues:[]},{coveredTaskIds:['sink'],issues:[]},{tasks:[owned],issues:[]},{coveredTaskIds:['sink'],issues:[]}]),now);
 assert.equal(held.customer.range,null,'an owner-supplied sink is still never charged as contractor material');
});
test('a thousands comma is part of the number (live new home 2026-09-22: "2,400 SF" read as 400)',async()=>{
 const home:ReviewedScope={...scope,text:'Construct one new residence with 2,400 SF of living area.',answers:{service:'handyman',location:'Boise'}};
 const house={...extra,id:'house',description:'Construct one new residence with 2,400 SF of living area',evidence:'2,400 SF of living area',researchDescription:'',additions:[{code:'03-16-01-M',quantity:2400,quantityEvidence:'2,400 SF living area'}]};
 const priced=await priceCompleteScope(home,config,replies([{tasks:[house],issues:[]},{coveredTaskIds:['house'],issues:[]}]),now);
 assert.ok(priced.customer.range,'2400 SF agrees with the stated 2,400 SF');
 assert.ok(!(priced.internal as any).scopePricing.issues.some((i:string)=>/does not match the explicit quantity/.test(i)));
});
test('work needed to complete the job is priced and marked; excluded but needed work is named, not priced (owner rule 2026-09-22)',async()=>{
 const {buildEstimateDocument,ADDED_MARK}=await import('../lib/p5/estimateDocument.ts');
 const {ESTIMATOR_BRAND}=await import('../lib/p5/brand.ts');
 const shower:ReviewedScope={...scope,text:'Replace the shower with a tiled shower. Exclude plumbing.',answers:{service:'handyman',location:'Boise'}};
 const inv={tasks:[
  {id:'SHW-01',description:'Install a new tiled shower',evidence:'Replace the shower with a tiled shower.',origin:'requested',basis:''},
  {id:'SHW-02',description:'Remove and dispose of the existing shower',evidence:'Replace the shower.',origin:'required',basis:'Removing the old shower is required to install the new one.'},
 ],issues:[],notes:[],dependencies:['Drain and valve connections are needed to complete the shower but are excluded; not priced.','Owner-supplied shower doors','Owner-supplied accessories; not priced']};
 const map=(id:string,code:string)=>({...extra,id,description:inv.tasks.find(t=>t.id===id)!.description,evidence:inv.tasks.find(t=>t.id===id)!.evidence,researchDescription:'',additions:[{code,quantity:1,quantityEvidence:'one shower'}]});
 let calls=0;
 const request:PricingRequest=async(_i,input)=>{const d=input as any;calls++;
  if(calls===1)return {value:inv,sourceUrls:[]};
  if(d.taskBatch){assert.ok(d.taskBatch.every((t:any)=>!('origin' in t)),'the mapping stage gets plain tasks');return {value:{tasks:d.taskBatch.map((t:any)=>map(t.id,t.id==='SHW-01'?'TEST-DOOR-M':'TEST-DOOR-L')),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};}
  if('priorPricingIssues' in d)return {value:{coveredTaskIds:['SHW-01','SHW-02'],issues:[]},sourceUrls:[]};
  throw new Error('unexpected request');};
 const r=await priceCompleteScope(shower,config,request,now);
 assert.ok(r.customer.range,'requested and required work are both priced');
 for(const dependency of ['Drain and valve connections are needed to complete the shower but are excluded','Owner-supplied shower doors','Owner-supplied accessories'])assert.ok(r.customer.exclusions.includes(`Needed to complete the work but excluded as you asked: ${dependency}`),`the excluded dependency is preserved: ${dependency}`);
 assert.ok(!(r.internal as any).lines.some((l:any)=>/drain|valve/i.test(l.description)),'and never priced');
 const doc=buildEstimateDocument({id:'0f1e2d3c-4b5a-4000-8000-00000000abcd',result:r.customer as any,brand:ESTIMATOR_BRAND as any,issue:{brandId:ESTIMATOR_BRAND.id} as any,submittedAt:new Date().toISOString()} as any);
 const text=JSON.stringify(doc);
 assert.ok(text.includes(`Remove and dispose of the existing shower`)&&text.includes(ADDED_MARK),'the added work is marked on the estimate');
 assert.match(text,/Included to complete the work/);assert.match(text,/Removing the old shower is required/);
});
// Live 2026-09-23: a shower replacement spent 332 s of a 366 s estimate on 16 mapping calls, because
// the repair round re-priced every task a second time to resolve a finding against one of them.
test('the repair round re-prices only the tasks the check questioned',async()=>{
 const priceable=(id:string)=>({id,description:`Synthetic work item ${id}`,evidence:'ten feet',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:2,quantityEvidence:'Two hours'}],researchDescription:'',issues:[]});
 const many=Array.from({length:9},(_,i)=>priceable(`t${i}`));
 // t4 comes back from the first mapping with nothing priced, so the first check cannot cover it and
 // a repair round is required. The repair supplies its hours.
 const unpriced={...priceable('t4'),additions:[]};
 let mappingCalls=0,audits=0;
 const staged:PricingRequest=async(_instructions,input)=>{
  const body=input as {taskBatch?:{id:string}[];tasks?:unknown;existingLines?:unknown};
  if(body.taskBatch){
   mappingCalls++;
   const answer=many.filter(t=>body.taskBatch!.some(b=>b.id===t.id)).map(t=>t.id==='t4'&&audits===0?unpriced:t);
   return {value:{tasks:answer,issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:urls};
  }
  if(body.tasks!==undefined&&body.existingLines!==undefined){
   audits++;
   return {value:{coveredTaskIds:many.map(t=>t.id).filter(id=>audits>1||id!=='t4'),issues:[],notes:[],resolvedIssues:[]},sourceUrls:urls};
  }
  return {value:{tasks:many.map(({id,description,evidence})=>({id,description,evidence})),issues:[],notes:[],dependencies:[]},sourceUrls:urls};
 };
 const priced=await priceCompleteScope(scope,config,staged,now);
 assert.equal(audits,2,`a repair round ran (mapping ${mappingCalls})`);
 assert.ok(priced.customer.range,'the estimate still completes');
 // 9 tasks at MAP_BATCH 4 is 3 batches. The first round maps all three; the repair round must send
 // only the batch holding t4, not all three again.
 assert.ok(mappingCalls>=3,`the first round still maps every batch (mapping calls: ${mappingCalls})`);
 assert.ok(mappingCalls<=4,`a repair round must not re-price every batch (mapping calls: ${mappingCalls})`);
});
test('a long first pass still gets its first corrective pass',async()=>{
 let audits=0,repairs=0,clockStarts=0;
 const staged:PricingRequest=async(_instructions,input)=>{
  const body=input as {taskBatch?:{id:string}[];repairInstruction?:string;tasks?:unknown;existingLines?:unknown};
  if(body.taskBatch){
   if(body.repairInstruction)repairs++;
   const overlay={...extra,researchDescription:'',additions:body.repairInstruction?[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested'}]:[]};
   return {value:{tasks:[task,overlay].filter(t=>body.taskBatch!.some(b=>b.id===t.id)),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  }
  if(body.tasks!==undefined&&body.existingLines!==undefined){
   audits++;
   return {value:{coveredTaskIds:audits>1?['cabinets','overlay']:['cabinets'],issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  }
  return {value:{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[],notes:[],dependencies:[]},sourceUrls:[]};
 };
 const result=await priceCompleteScope(scope,config,staged,new Date(Date.now()-10*60000),Date.now()+60000,undefined,0,async()=>{clockStarts++;return {startedAt:Date.now(),busyWaitMs:0};});
 assert.equal(clockStarts,1);
 assert.equal(repairs,1);
 assert.ok(result.customer.range,'the completed repair releases the range');
});
// Live 2026-09-23, revision of Handyman estimate P5-EB029A8F: the check returned its findings as
// objects rather than sentences, and the whole eight-minute pricing job was discarded on that one
// field - "Expected string, received object" at issues[0]. Remarks are prose we read, log and show;
// their packaging must not be able to throw away a finished estimate.
test('a finding wrapped in an object is read, not thrown away with the estimate',async()=>{
 const wrapped=[{issue:'scope-1 and scope-2 overlap.',severity:'high'},'a plain sentence',{message:'wrapped under message'}];
 const priced=await priceCompleteScope(scope,config,replies([
   {tasks:[task],issues:[]},
   {coveredTaskIds:['cabinets'],issues:wrapped,notes:[{note:'a wrapped note'}],resolvedIssues:[]},
   {tasks:[task],issues:[]},
   {coveredTaskIds:['cabinets'],issues:[],resolvedIssues:[]},
 ]),now);
 const recorded=JSON.stringify(priced.internal.scopePricing);
 assert.doesNotMatch(recorded,/ZodError/,'the reply parses instead of discarding the job');
 assert.match(recorded,/scope-1 and scope-2 overlap/,'the wrapped finding survives as its own words');
 assert.match(recorded,/a plain sentence/,'a plain one is untouched');
 assert.match(recorded,/wrapped under message/,'other wrappers are unwrapped too');
 assert.doesNotMatch(recorded,/\[object Object\]/,'never stringified into nothing');
});
test('ids stay strict, so a malformed one is never guessed at',async()=>{
 // A task id arriving as an object is not a packaging quirk; acting on it would price the wrong work.
 const broken=await priceCompleteScope(scope,config,replies([
   {tasks:[{...task,id:{value:'cabinets'}}],issues:[]},
   {coveredTaskIds:['cabinets'],issues:[]},
 ]),now);
 assert.equal(broken.customer.range,null,'a malformed identifier still withholds the price');
});

// Live 2026-09-23: "remodel the primary bedroom and closet" was typed as a whole-home project, drew
// in the whole-home planning book, and spent 27 mapping calls and 495 s of a 645 s estimate pricing
// five items of work. Batch size alone bounds nothing, because the call count grows with the scope.
test('large mapping batches bound each response without dropping tasks',async()=>{
 const {mappingBatchSize}=await import('../lib/p5/scopePricing.ts');
 // Small scopes keep the configured batch size.
 assert.equal(mappingBatchSize(8,4,8),4,'two calls, nothing to do');
 assert.equal(mappingBatchSize(32,4,8),4,'exactly at the ceiling');
 // Past it, the batch grows so the call count cannot.
 for(const tasks of [33,60,108,500]){
  const size=mappingBatchSize(tasks,4,8);
  assert.ok(size<=32,`${tasks} tasks use response-safe batches (batch ${size})`);
  if(tasks<=256)assert.ok(Math.ceil(tasks/size)<=8,`${tasks} tasks still fit in eight calls`);
  const items=Array.from({length:tasks},(_,i)=>i);
  const batches=Array.from({length:Math.ceil(tasks/size)},(_,i)=>items.slice(i*size,(i+1)*size));
  assert.deepEqual(batches.flat(),items,'every task travels exactly once');
  assert.ok(size>=4,`${tasks} tasks never shrink the batch below the configured size`);
 }
 // Every task is still carried: growing the batch must not drop work.
 const tasks=108,size=mappingBatchSize(tasks,4,8);
 assert.ok(Math.ceil(tasks/size)*size>=tasks,'the batches cover every task');
 assert.equal(mappingBatchSize(0,4,8),4,'an empty scope is harmless');
});

// Live 2026-09-23: "remodel the primary suite" listed five items of work and became about ninety
// tasks, because COMPLETE THE SCOPE added demolition, disposal, protection, cleanup and a permit for
// EACH requested item. Those are things a crew does once for the whole job.
test('shared supporting work is instructed once for the project, not once per item',async()=>{
 const {INVENTORY_INSTRUCTIONS}=await import('../lib/p5/scopePricing.ts');
 const text=INVENTORY_INSTRUCTIONS.toLowerCase();
 assert.match(text,/one task per kind of supporting work/,'the rule is stated');
 assert.match(text,/never one per item and never one per room/,'and stated as a prohibition');
 assert.match(text,/single project-level task/,'the shared work is project level');
 // The exceptions must survive: work that genuinely differs per item stays its own task.
 assert.match(text,/waterproofing system for one wet area/,'per-item exceptions are preserved');
 // And the completion rule itself must not have been weakened away.
 assert.match(text,/complete the scope/,'supporting work is still added');
 assert.match(text,/debris haul-off and disposal/,'the kinds of supporting work are still named');
});

// Live 2026-09-23: "replace the kitchen faucet and repair a leaking under-sink shutoff valve" handed
// off. The new scope-consolidation rule added a shared disconnect/reconnect task that duplicated the
// installation line, and a shared protection task that only matched a whole-room dust-protection
// catalog price - a two-hundred-dollar repair reaching for a thousand-dollar line.
test('a small single-component swap does not draw its own protection or disconnect task',async()=>{
 const {INVENTORY_INSTRUCTIONS}=await import('../lib/p5/scopePricing.ts');
 const text=INVENTORY_INSTRUCTIONS.toLowerCase();
 assert.match(text,/scale supporting work to the job/,'the rule is stated');
 assert.match(text,/one fixture, one valve, one outlet, one switch/,'named for the small-repair case');
 assert.match(text,/does not get its own protection, cleanup, permit, or disconnect\/reconnect task/);
 assert.match(text,/already inside its own labor/,'the reason is stated, not just the prohibition');
 // The larger-job exception must survive: room-scale and multi-item work still gets these tasks.
 assert.match(text,/room-scale demolition, multi-item work/,'the exception for substantial work is preserved');
});

test('omitted contractor consumables become one researched task instead of free labor inclusions',async()=>{
 const {normalizeConsumableMapping}=await import('../lib/p5/scopePricing.ts');
 const restricted={...scope,text:'Install 9 LF owner-supplied base cabinets and 12 LF owner-supplied wall cabinets. Contractor supplies screws and shims.',answers:{service:'cabinet-install'}};
 const rate={code:'QA-LABOR',description:'Cabinet installation labor. Excludes all installation consumables, screws and shims.',type:'Labor',unit:'LF',amount:70,source:'Synthetic fixture',basis:'owner-average-cost'};
 const configuration=createPlanningConfiguration({...catalog,rates:[...catalog.rates,rate as PlanningCatalog['rates'][number]]});
 const install={...task,description:'Install 9 LF owner-supplied base cabinets',evidence:'9 LF base cabinets',existingLineIds:[],additions:[{code:'QA-LABOR',quantity:9,quantityEvidence:'9 LF'}]};
 const mapping={tasks:[install],notes:[],issues:[],replacements:[],removeExclusions:[]};
 normalizeConsumableMapping(mapping,configuration,[],restricted);
 normalizeConsumableMapping(mapping,configuration,[],restricted);
 assert.equal(mapping.tasks.length,2,'one shared recovered task, even after repair');
 const recovered=mapping.tasks.find(t=>t.id==='required-contractor-consumables')!;
 assert.match(recovered.description,/screws, shims/);
 assert.match(recovered.researchDescription,/Material purchase only/);
 assert.deepEqual(mapping.tasks[0].additions,install.additions,'existing labor remains priced once');
 const ownerOnly={...restricted,text:'Install owner-supplied cabinets. Owner supplies screws and shims.'};
 const excluded={...mapping,tasks:[structuredClone(install)]};
 normalizeConsumableMapping(excluded,configuration,[],ownerOnly);
 assert.equal(excluded.tasks.length,1);
 const assembled=createPlanningConfiguration({...catalog,rates:[...catalog.rates,{...rate,type:'Subcontractor',description:'Cabinet installation including all screws and shims.'} as PlanningCatalog['rates'][number]]});
 const included={...mapping,tasks:[structuredClone(install)]};
 normalizeConsumableMapping(included,assembled,[],restricted);
 assert.equal(included.tasks.length,1,'installed assembly inclusions are not duplicated');
 const gap={rates:[{taskId:'required-contractor-consumables',description:'Contractor screws and shims',unit:'LS',quantity:1,quantityEvidence:'ALLOWANCE: One job package for the stated cabinet runs; verify actual usage.',quantityRange:{low:1,high:1},basis:'material-purchase',includes:'screws and shims',excludes:'cabinet products and labor',landedCost:null,sources:urls.map(url=>({...source(url,30,50),unit:'LS'}))}],issues:[]};
 const queue=replies([{tasks:[install],issues:[]},{coveredTaskIds:[install.id,'required-contractor-consumables'],issues:[]}]);
 const products:string[]=[];
 const priced=await priceCompleteScope(restricted,configuration,async(instructions,input,search,remaining)=>{
  if(search){
   const product=(input as any).tasks[0].description.includes('ONLY contractor-supplied screws')?'screws':'shims';
   products.push(product);
   return {value:{...gap,rates:[{...gap.rates[0],description:'Contractor '+product,includes:product}]},sourceUrls:urls};
  }
  return queue(instructions,input,search,remaining);
 },now);
 assert.ok(priced.customer.range,JSON.stringify(priced.internal.scopePricing));
 assert.deepEqual(products.sort(),['screws','shims']);
 assert.equal((priced.internal as any).lines.filter((line:any)=>line.category==='materials'&&line.unitCost===40).length,2);
});
test('labor-only pricing retains requested contractor consumables through final release',async()=>{
 const restricted={...scope,text:'Install owner-supplied baseboard. Labor only. Contractor supplies nails and caulk.',answers:{service:'handyman',ownerSupplied:'Owner supplies baseboard'},extraction:{summary:'Trim installation',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{...emptyInstructions(),laborOnly:true}}};
 const configuration=createPlanningConfiguration({...catalog,rates:[...catalog.rates,{code:'QA-CONSUMABLE-M',description:'Nails, interior trim caulk, and nail-hole filler for 100 LF of owner-supplied primed MDF baseboard',type:'Material',unit:'LS',amount:25,source:'Synthetic fixture',basis:'owner-average-cost'}]});
 const trim={id:'trim',description:'Install owner-supplied baseboard',evidence:'Labor only',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:4,quantityEvidence:'ALLOWANCE: Four installation hours, verify two to six.',quantityRange:{low:2,high:6}}],researchDescription:'',issues:[]};
 const consumables={id:'consumables',description:'Supply nails and caulk',evidence:restricted.text,existingLineIds:[],additions:[{code:'QA-CONSUMABLE-M',quantity:1,quantityEvidence:'ALLOWANCE: One material package; confirm usage.',quantityRange:{low:1,high:1}}],researchDescription:'',issues:[]};
 const result=await priceCompleteScope(restricted,configuration,replies([{tasks:[trim,consumables],issues:[]},{coveredTaskIds:['trim','consumables'],issues:[]}]),now);
 assert.ok(result.customer.range);assert.ok('lines' in result.internal);
 assert.deepEqual(result.internal.lines.map(l=>l.category).sort(),['field-labor','materials']);
 assert.equal(result.internal.lines.find(l=>l.category==='materials')?.unitCost,25);
});

test('one shared consumables line reconciles base and upper runs without repeating its total',()=>{
 const description='Supply normal cabinet mounting screws, shims, fasteners and other standard installation consumables for fastening and leveling.: Cabinet + Vanity Hardware - Materials';
 const pricedLine={...base.internal.lines[0],id:'shared-consumables',description,category:'materials' as const,quantity:20,unit:'LF',unitCost:8};
 const cabinetScope={...scope,text:'Install 10 LF owner-supplied base cabinets and 10 LF owner-supplied uppers. Contractor supplies all mounting consumables.',answers:{service:'cabinet-install'}};
 const item=(id:string,description:string,evidence:string)=>({id,description,evidence,existingLineIds:[pricedLine.id],additions:[],researchDescription:'',issues:[]});
 const tasks=[item('base','Install 10 LF owner-supplied base cabinets','Base run is 10 LF.'),item('upper','Install 10 LF owner-supplied upper cabinets','Upper run is 10 LF.'),item('supplies','Supply mounting consumables','10 LF base + 10 LF upper = 20 LF total.')];
 const result=catalogResolution({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]},config,[pricedLine],now,cabinetScope);
 assert.deepEqual(result.issues,[]);assert.equal(result.rules.length,0,'shared references never add another charge');
 const wrong=catalogResolution({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]},config,[{...pricedLine,quantity:30}],now,cabinetScope);
 assert.match(wrong.issues.join(' '),/does not match the explicit quantity/);
 const labor=catalogResolution({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]},config,[{...pricedLine,category:'field-labor'}],now,cabinetScope);
 assert.match(labor.issues.join(' '),/does not match the explicit quantity/,'a shared material allowance cannot excuse mismatched installation labor');
});

test('a clean model audit cannot cover requested consumable material with labor alone',async()=>{
 const restricted={...scope,text:'Install owner-supplied baseboard. Labor only. Contractor supplies nails and caulk.',answers:{service:'handyman'},extraction:{summary:'Trim installation',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{...emptyInstructions(),laborOnly:true}}};
 const labor={id:'trim',description:'Install owner-supplied baseboard',evidence:'Installation work',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:4,quantityEvidence:'ALLOWANCE: Four installation hours.',quantityRange:{low:2,high:6}}],researchDescription:'',issues:[]};
 const consumables={...labor,id:'supplies',description:'Supply nails and caulk',evidence:restricted.text,additions:[{code:'REF-GENERAL-HOUR',quantity:1,quantityEvidence:'ALLOWANCE: One hour.',quantityRange:{low:1,high:1}}]};
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;
  if(data.taskBatch)return {value:{tasks:[labor,consumables],issues:[]},sourceUrls:[]};
  if('priorPricingIssues' in data)return {value:{coveredTaskIds:['trim','supplies'],issues:[]},sourceUrls:[]};
  if(data.tasks&&data.region)return {value:{rates:[],issues:[]},sourceUrls:[]};
  return {value:{tasks:[labor,consumables].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
 };
 await assert.rejects(()=>priceCompleteScope(restricted,config,request,now),PricingPending);
});

test('research excerpts may join exact heading and price fragments within one source paragraph',async()=>{
 const {assertResearchReportProducts}=await import('../lib/p5/scopePricing.ts');
 const requested={...extra,researchDescription:'Research ONLY contractor-supplied screws for cabinet installation.'};
 const report='GRK cabinet screws (100-Pack)\nUnit: BOX (100 screws)\nPrice: $16.98 per box\nSpecification: cabinet mounting.\n\nWood shims\nPrice: $4.99 per pack.';
 const make=(excerpt:string)=>({...researched,rates:[{...researched.rates[0],sources:researched.rates[0].sources.map(source=>({...source,excerpt}))}]});
 assert.doesNotThrow(()=>assertResearchReportProducts(make('GRK cabinet screws (100-Pack). Price: $16.98 per box.'),report,[requested]));
 assert.throws(()=>assertResearchReportProducts(make('GRK cabinet screws (100-Pack). Price: $4.99 per pack.'),report,[requested]),/cannot be relabeled/);
 assert.throws(()=>assertResearchReportProducts(make('GRK cabinet screws (100-Pack). Price: $19.99 per box.'),report,[requested]),/cannot be relabeled/);
});

test('a requested drywall patch survives a parenthetical paint exclusion',async()=>{
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const configured={...config,planningCatalog:{...catalog,rates:priceBookRates({service:'re10'})}};
 const patch={id:'patch-drywall',description:'Patch one 12x12 inch hole in garage wall with 5/8 inch Type X drywall, tape, finish and spot-prime (paint excluded).',evidence:'Patch one 12x12 garage wall hole with 5/8 inch Type X, tape, finish, spot-prime. Paint excluded. Applies only to specified patch area.',existingLineIds:[],additions:[{code:'PB-09-01-08',quantity:1,quantityEvidence:'One patch, 1 square foot'}],researchDescription:'',issues:[]};
 const mapping={tasks:[patch],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping,configured,[],now,{...scope,answers:{service:'re10',location:'Boise',area:'1'},text:patch.evidence});
 assert.equal(result.rules.length,1);assert.equal(result.rules[0].unitCost,300);
 assert.ok(!result.assumptions.some(a=>a.includes('not billable')));
 const excluded={...patch,description:'Drywall patch excluded',evidence:'Drywall patch excluded.'};
 assert.equal(catalogResolution({...mapping,tasks:[excluded]},configured,[],now).rules.length,0);
});

test('exact unique catalog references resolve to retained lines across tasks',async()=>{
 const {resolvePricedLineId}=await import('../lib/p5/scopePricing.ts');
 const lines=[{id:'scope-1',evidence:{reference:'Owner source; QA-CODE; 300 SF'}}];
 assert.equal(resolvePricedLineId('QA-CODE',lines),'scope-1');
 assert.equal(resolvePricedLineId('scope-1',lines),'scope-1');
 assert.equal(resolvePricedLineId('QA-CODE',[...lines,{id:'scope-2',evidence:lines[0].evidence}]),'QA-CODE');
 assert.equal(resolvePricedLineId('QA-COD',lines),'QA-COD');
 const priced={...extra,id:'priced',description:'Protective overlay material',researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'10 LF'}]};
 const covered={...extra,id:'covered',description:'Protective overlay material already included',researchDescription:'',existingLineIds:['03-15-02-M']};
 const mapping={tasks:[covered,priced],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping,config,[],now,scope);
 assert.deepEqual(covered.existingLineIds,['scope-1']);
 assert.ok(!result.issues.some(issue=>issue.includes('invalid existing')));
 assert.equal(result.rules.length,1);
});

test('a fastener research task accepts exact screw product evidence',async()=>{
 const {assertResearchReportProducts}=await import('../lib/p5/scopePricing.ts');
 const requested={...extra,researchDescription:'Research ONLY contractor-supplied fasteners for cabinet installation.'};
 const quote='GRK cabinet screws (100-Pack), price $16.98 per box.';
 const valid={...researched,rates:[{...researched.rates[0],sources:researched.rates[0].sources.map(source=>({...source,excerpt:quote}))}]};
 assert.doesNotThrow(()=>assertResearchReportProducts(valid,quote,[requested]));
});

test('an invalid evidence excerpt is repaired from the saved report without another search',async()=>{
 const {reconcileResearchReply}=await import('../lib/p5/scopePricing.ts');
 const quote='GRK cabinet screws cost $16.98 per box of 100 screws.';
 const make=(excerpt:string)=>({...researched,rates:[{...researched.rates[0],sources:researched.rates[0].sources.map(source=>({...source,excerpt}))}]});
 const requested={...extra,researchDescription:'Research ONLY contractor-supplied screws for cabinet installation.'};
 let calls=0;
 const request:PricingRequest=async(_instructions,input,search)=>{calls++;assert.equal(search,false);assert.match((input as any).validationFailure,/excerpt/);return {value:make(quote),sourceUrls:urls};};
 const result=await reconcileResearchReply({value:make('GRK cabinet screws cost $19.99 per box.'),sourceUrls:urls,sourceReport:quote},[requested],request,()=>60000);
 assert.equal(calls,1);assert.equal((result.value as any).rates[0].sources[0].excerpt,quote);
});

test('explicitly excluded work is not displayed under included customer categories',async()=>{
 const {finishScopePricing}=await import('../lib/p5/scopePricing.ts');
 const omitted={...extra,id:'exclusions',description:'Explicitly excluded work: no demolition, rock excavation, retaining walls, landscaping, fencing, garage, appliances, permit/utility connection fees.',evidence:'These items are excluded.'};
 const priced=finishScopePricing(scope,config,now,{rules:[],assumptions:[],issues:[]},{tasks:[task,omitted]},null);
 assert.ok(priced.customer.scopeTasks.some(t=>t.description===task.description));
 assert.ok(!priced.customer.scopeTasks.some(t=>t.description===omitted.description));
 assert.deepEqual(priced.internal.scopePricing.tasks,[task,omitted]);
});

test('a one-square-foot repair uses the approved patch service instead of bulk wall pricing',async()=>{
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const configured={...config,planningCatalog:{...catalog,rates:priceBookRates({service:'re10'})}};
 const repair={id:'patch',description:'Patch one 12x12 inch hole in the garage wall with 5/8 inch Type X drywall, tape, finish, and spot-prime.',evidence:'One patch requested',existingLineIds:[],additions:[{code:'PB-09-29-05',quantity:1,quantityEvidence:'1 SF patch'},{code:'PB-09-91-12',quantity:1,quantityEvidence:'1 SF spot prime'}],researchDescription:'',issues:[]};
 const mapping={tasks:[repair],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const result=catalogResolution(mapping,configured,[],now);
 assert.equal(result.rules.length,2);
 assert.ok(result.rules.some(rule=>rule.evidence.reference.includes('PB-09-01-08')&&rule.unitCost===300&&rule.quantity.fixed===1));
 assert.ok(!result.rules.some(rule=>rule.evidence.reference.includes('PB-09-29-05')));
 assert.ok(result.rules.some(rule=>rule.evidence.reference.includes('PB-09-91-12')));
 const wall={...repair,id:'wall',description:'Install garage drywall over a 12 by 12 foot new wall.',additions:[{code:'PB-09-29-05',quantity:144,quantityEvidence:'144 SF'}]};
 const unchanged=catalogResolution({...mapping,tasks:[wall]},configured,[],now);
 assert.ok(unchanged.rules.some(rule=>rule.evidence.reference.includes('PB-09-29-05')));
});

test('research recovery reports evidence formatting and supplier independence together',async()=>{
 const {reconcileResearchReply}=await import('../lib/p5/scopePricing.ts');
 const report='Everbilt cabinet screws, 60-pack, $8.44.\nHome Depot alternate cabinet screws, 60-pack, $12.98.';
 const requested={...extra,researchDescription:'Research ONLY contractor-supplied screws for cabinet installation.'};
 const duplicate={...researched,rates:[{...researched.rates[0],description:'Cabinet screws',sources:researched.rates[0].sources.map((source,i)=>({...source,url:urls[0],excerpt:'Everbilt cabinet screws with rewritten unsupported price $99.'}))}]};
 let corrections=0;
 await assert.rejects(()=>reconcileResearchReply({value:duplicate,sourceUrls:urls,sourceReport:report},[requested],async(_instructions,input)=>{
   corrections++;assert.match((input as any).validationFailure,/Source excerpt/);assert.match((input as any).validationFailure,/Independent market sources/);
   return {value:duplicate,sourceUrls:urls};
 },()=>60000,value=>{marketResolution(value,urls,[requested],now,0,'Boise');}),/Source excerpt.*Independent market sources/s);
 assert.equal(corrections,1);
});

test('corrective research retains paid findings and requests the exact missing evidence',async()=>{
 const report='Supplier observations for protective overlay: one retailer only; second independent supplier still needed.';
 const invalid=structuredClone(researched);invalid.rates[0].sources.forEach(s=>s.url=urls[0]);
 let searches=0,phase=0;
 const result=await priceCompleteScope(scope,config,async(instructions,input,search)=>{
   if(search){
     searches++;
     if(searches===1)return {value:invalid,sourceUrls:urls,sourceReport:report};
     assert.equal((input as any).previousResearch.report,report);
     assert.deepEqual((input as any).previousResearch.sourceUrls,urls);
     assert.match(JSON.stringify((input as any).priorIssues),/Independent market sources/);
     assert.match((input as any).evidenceRequirements,/different supplier/);
     return {value:researched,sourceUrls:urls};
   }
   if((input as any).report)return {value:invalid,sourceUrls:urls};
   phase++;
   if(phase===1)return {value:{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
   if(phase===2)return {value:{tasks:[task,extra],issues:[]},sourceUrls:[]};
   return {value:{coveredTaskIds:['cabinets','overlay'],issues:[]},sourceUrls:[]};
 },now);
 assert.equal(searches,2);assert.ok(result.customer.range);
});

test('likely Boise availability is not accepted as verified regional evidence',()=>{
 const invalid=structuredClone(researched);invalid.rates[0].sources[0].region='Boise-area stock likely';
 assert.throws(()=>marketResolution(invalid,urls,[extra],now,0,'Boise'),/do not establish Boise/);
});

test('a removed overlapping vanity package is remapped to approved components before research',async()=>{
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const configuration={...config,planningCatalog:{...catalog,rates:priceBookRates({service:'bathroom'})}};
 const vanityScope={...scope,text:'Supply and install one 60-inch vanity cabinet and a separate 8.33 SF quartz countertop. No other work.',answers:{service:'remodel',cabinetBaseLf:'5',countertopSqft:'8.33',location:'Boise',exclusions:'All other work'}};
 const vanity={...extra,id:'vanity',description:'Supply and install one 60-inch vanity cabinet',evidence:'One 60-inch cabinet, 5 LF',researchDescription:'',additions:[{code:'PB-12-41-02',quantity:1,quantityEvidence:'One vanity'}]};
 const top={...extra,id:'top',description:'Supply and install quartz countertop',evidence:'8.33 SF',researchDescription:'',additions:[{code:'PB-12-36-02',quantity:8.33,quantityEvidence:'8.33 SF stated'}]};
 const repaired={...vanity,additions:[{code:'PB-12-32-01',quantity:5,quantityEvidence:'Confirmed 5 LF of cabinet'}]};
 let calls=0;
 const result=await priceCompleteScope(vanityScope,configuration,async(_instructions,input,search)=>{
   calls++;assert.equal(search,false,'available approved component rates require no web research');
   if(calls===1)return {value:{tasks:[vanity,top].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
   if(calls===2)return {value:{tasks:[vanity,top],issues:[]},sourceUrls:[]};
   if(calls===3){
     assert.match((input as any).repairInstruction,/complete approved catalog/);
     assert.deepEqual((input as any).remainingComponents[0].rejectedCodes,['PB-12-41-02']);
     assert.ok((input as any).catalog.some((rate:any)=>rate.code==='PB-12-32-01'));
     return {value:{tasks:[repaired],issues:[]},sourceUrls:[]};
   }
   return {value:{coveredTaskIds:['vanity','top'],issues:[]},sourceUrls:[]};
 },now);
 assert.equal(calls,4);assert.ok(result.customer.range);
 const rules=(result.internal as any).costBookSnapshot.rules;
 assert.ok(rules.some((rule:any)=>rule.evidence.reference.includes('PB-12-32-01')&&rule.quantity.fixed===5));
 assert.ok(!rules.some((rule:any)=>rule.evidence.reference.includes('PB-12-41-02')));
});

test('invalid flooring references recover approved supplies and cleanup instead of searching zero quantities',async()=>{
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const configuration={...config,planningCatalog:{...catalog,rates:priceBookRates({service:'remodel'})}};
 const floorScope={...scope,text:'Supply and install 300 SF LVP, purchase 330 SF including 10% waste. Include ordinary installation supplies and minor job cleanup. All other work excluded.',answers:{service:'remodel',flooringSqft:'300',location:'Boise',exclusions:'All other work'}};
 const make=(id:string,description:string,additions:any[],existingLineIds:string[]=[])=>({...extra,id,description,evidence:floorScope.text,researchDescription:'',additions,existingLineIds});
 const add=(code:string,quantity:number)=>({code,quantity,quantityEvidence:'Confirmed '+quantity+' SF'});
 const floor=make('floor','LVP flooring supply and install',[add('PB-09-60-01',330),add('PB-09-61-01',300)]);
 const supplies=make('supplies','Provide ordinary installation supplies',[],['PB-09-65-01']);
 const cleanup=make('cleanup','Minor job cleanup',[],['PB-09-65-01']);
 const fixedSupplies=make('supplies',supplies.description,[{...add('PB-09-60-06',300),quantityEvidence:'ALLOWANCE: pad for 300 SF of installed flooring, if required',quantityRange:{low:300,high:300}}]);
 const fixedCleanup=make('cleanup',cleanup.description,[add('PB-01-74-05',300)]);
 let calls=0;
 const result=await priceCompleteScope(floorScope,configuration,async(_instructions,input,search)=>{
  calls++;assert.equal(search,false);
  if(calls===1)return {value:{tasks:[floor,supplies,cleanup].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(calls===2)return {value:{tasks:[floor,supplies,cleanup],issues:[]},sourceUrls:[]};
  if(calls===3){assert.match((input as any).repairInstruction,/coverage reference/);return {value:{tasks:[fixedSupplies,fixedCleanup],issues:[]},sourceUrls:[]};}
  return {value:{coveredTaskIds:['floor','supplies','cleanup'],issues:[]},sourceUrls:[]};
 },now);
 assert.equal(calls,4);assert.ok(result.customer.range);
 const rules=(result.internal as any).costBookSnapshot.rules;
 for(const code of ['PB-09-60-01','PB-09-61-01','PB-09-60-06','PB-01-74-05'])assert.equal(rules.filter((r:any)=>r.evidence.reference.includes(code)).length,1);
 const explicit={...fixedSupplies,evidence:'Purchase 330 SF underlayment for this floor.',additions:[add('PB-09-60-06',300)]};
 const wrong=catalogResolution({tasks:[explicit],issues:[],notes:[],replacements:[],removeExclusions:[]},configuration,[],now,floorScope);
 assert.ok(wrong.issues.some(issue=>/does not match the explicit quantity/.test(issue)),'a stated underlayment quantity still controls that material');

});

test('explicit source package weights are converted once before averaging',()=>{
 const input=structuredClone(researched),rate=input.rates[0];
 rate.unit='lb';rate.quantity=1;rate.quantityEvidence='ALLOWANCE: one pound, verify consumption';rate.quantityRange={low:0.5,high:2};
 rate.sources[0]={...rate.sources[0],unit:'lb',low:7.37,high:7.37};
 rate.sources[1]={...rate.sources[1],unit:'5 lb',low:18.52,high:18.52,excerpt:'Synthetic nails price: 5 lb box for $18.52.'};
 const result=marketResolution(input,urls,[extra],now);
 assert.equal(result.rules[0].unitCost,5.537);
 assert.match(result.assumptions.join(' '),/18.52.*5 lb.*divided by 5.*3.704/);
 assert.equal(input.rates[0].sources[1].low,18.52,'source input is retained unchanged');
 rate.sources[1].low=3.704;rate.sources[1].high=3.704;
 assert.throws(()=>marketResolution(input,urls,[extra],now),/Incompatible benchmark unit/,'a price already converted must not be divided again under a stale package label');
 rate.sources[1].low=18.52;rate.sources[1].high=18.52;
 rate.sources[1].unit='5 SF';
 assert.throws(()=>marketResolution(input,urls,[extra],now),/Incompatible benchmark unit/);
 rate.sources[1].unit='5 lb';rate.sources[1].url=rate.sources[0].url;
 assert.throws(()=>marketResolution(input,urls,[extra],now),/Independent market sources/);
});
test('corrective research keeps prior observed evidence and excludes only a repeated supplier',async()=>{
 const {combineResearchEvidence,repeatedResearchSupplier,openAiPricingRequestEnvelope,reconcileResearchReply}=await import('../lib/p5/scopePricing.ts');
 const firstValue=structuredClone(researched);firstValue.rates[0].sources=[firstValue.rates[0].sources[0]];
 const nextValue=structuredClone(researched);nextValue.rates[0].sources=[nextValue.rates[0].sources[1]];
 const first={value:firstValue,sourceUrls:[urls[0]],sourceReport:'First saved supplier report'};
 const next={value:nextValue,sourceUrls:[urls[1]],sourceReport:'Second independent supplier report'};
 const combined=combineResearchEvidence(first,next);
 assert.deepEqual(combined.sourceUrls,urls);assert.match(combined.sourceReport!,/First saved.*Second independent/s);
 assert.deepEqual(repeatedResearchSupplier(first),[new URL(urls[0]).hostname]);
 assert.deepEqual(repeatedResearchSupplier({value:researched,sourceUrls:urls}),[]);
 const envelope=openAiPricingRequestEnvelope('Research',{region:'Boise, Idaho',searchControl:{blockedDomains:repeatedResearchSupplier(first)}},true);
 const searchTool=(envelope.body as any).tools[0];
 assert.equal(searchTool.user_location.city,'Boise');
 assert.deepEqual(searchTool.filters.blocked_domains,[new URL(urls[0]).hostname]);
 let fixes=0;
 const accepted=await reconcileResearchReply(combined,[extra],async(_instructions,input)=>{
  fixes++;assert.match((input as any).report,/First saved.*Second independent/s);assert.deepEqual((input as any).sourceUrls,urls);
  return {value:researched,sourceUrls:[]};
 },()=>60000,value=>{marketResolution(value,combined.sourceUrls,[extra],now,0,'Boise');});
 assert.equal(fixes,1);assert.equal(marketResolution(accepted.value,accepted.sourceUrls,[extra],now).rules[0].unitCost,20);
});
