import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,materializePlanningBook,planningQuestionFields,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {priceReviewedScope,blockingReviewNote} from '../lib/p5/costBook.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
const date='2026-09-11T00:00:00.000Z';
const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR','REF-TOILET'];
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic test catalog. Not business cost data.',importedAt:date,authorizedBy:'Test fixture',rates:codes.map(code=>({code,description:code.includes('17-01')?'Cabinets':code.includes('19-02')?'Decorative cabinet hardware':'Synthetic work',type:code.endsWith('-M')||code==='REF-TOILET'?'Material':code.endsWith('-L')||code.includes('HOUR')?'Labor':'Subcontractor',unit:code.includes('HOUR')?'HR':code==='REF-TOILET'?'EA':'LF',amount:code==='03-17-01-M'?100:code==='03-17-01-L'?40:10,source:'Synthetic unit-cost fixture',basis:'owner-average-cost'}))};
const scope=(answers:ReviewedScope['answers'],text=''):ReviewedScope=>({text,answers,extraction:null,uploads:[],reviewedAt:date,corrections:[]});
const now=new Date(date);
test('Whole-build cabinet allowance avoids a late measurement blocker and preserves supplied tall runs',()=>{
 const book=createPlanningConfiguration(catalog).costBooks.find(b=>b.service==='new-construction')!;
 const answers={service:'new-construction',sqft:'3500',garageIncluded:'yes',garageSqft:'1000',finish:'high-end'};
 const modeled=materializePlanningBook(book,catalog,scope(answers),now);
 assert.ok(!modeled.missing.includes('Missing quantity: cabinetTallLf'));
 assert.ok(modeled.book.assumptions.some(note=>/Tall cabinet run.*modeled allowance of 4/.test(note)));
 const cabinetQuantity=(result:typeof modeled)=>result.book.rules.find(rule=>rule.id.startsWith('03-17-01-M'))!.quantity.fixed!;
 const zero=materializePlanningBook(book,catalog,scope({...answers,cabinetTallLf:'0'}),now);
 const measured=materializePlanningBook(book,catalog,scope({...answers,cabinetTallLf:'7'}),now);
 assert.equal(cabinetQuantity(modeled)-cabinetQuantity(zero),8);
 assert.equal(cabinetQuantity(measured)-cabinetQuantity(zero),14);
 assert.ok(!zero.book.assumptions.some(note=>/Tall cabinet run.*modeled allowance/.test(note)));
});
test('Every service has an explicit owner-planning book; rates remain in private configuration',()=>{const config=createPlanningConfiguration(catalog);assert.equal(config.costBooks.length,12);assert.equal(new Set(config.costBooks.map(b=>b.service)).size,12);assert.ok(config.costBooks.every(b=>b.mode==='owner-planning'));});
test('Cabinet supply and installation use distinct scope and preserve the overhead/profit reconciliation',()=>{
 const config=createPlanningConfiguration(catalog);
 const answers={cabinetBaseLf:'10',cabinetUpperLf:'5',cabinetTallLf:'0',cabinetRoom:'kitchen',location:'Boise'};
 const supply=priceReviewedScope(scope({...answers,service:'cabinet-product'}),config,now);const installed=priceReviewedScope(scope({...answers,service:'cabinet-install'}),config,now);
 assert.equal(supply.customer.status,'planning-range');assert.equal(installed.customer.status,'planning-range');
 const s=supply.internal as any,i=installed.internal as any;assert.equal(s.currentCostsConfirmed,false);assert.equal(s.estimatePurpose,'preliminary');assert.equal(s.lines.filter((l:any)=>l.category==='field-labor').length,0);
 assert.equal(i.lines.find((l:any)=>l.id.startsWith('03-17-01-L')).cost,600);assert.ok(Math.abs(i.reconciliation)<1e-8);assert.ok(i.contractPrice>s.contractPrice);
 assert.equal(i.allocations.overhead,.2);assert.equal(i.targetOperatingProfit,.2);
 const publicData=JSON.stringify(installed.customer);assert.ok(!publicData.includes('Synthetic unit-cost fixture'));assert.ok(!publicData.includes('unitCost'));assert.ok(!publicData.includes('overheadRecovery'));
});
test('Missing cabinet measurements are blocked; a real zero stays zero',()=>{const config=createPlanningConfiguration(catalog);const missing=priceReviewedScope(scope({service:'cabinet-product',cabinetBaseLf:'10'}),config,now);assert.equal(missing.customer.range,null);const missingTall=priceReviewedScope(scope({service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0'}),config,now);assert.equal(missingTall.customer.range,null);const zero=priceReviewedScope(scope({service:'cabinet-product',cabinetBaseLf:'0',cabinetUpperLf:'10',cabinetTallLf:'0'}),config,now);assert.ok(zero.customer.range);});
test('Small-job cabinet scope does not silently treat an unanswered tall run as zero',()=>{
 const config=createPlanningConfiguration(catalog);
 const result=priceReviewedScope(scope({service:'handyman',taskList:'Replace cabinets',cabinetBaseLf:'10',cabinetUpperLf:'0'}),config,now);
 assert.equal(result.customer.range,null);
});
test('Supplied fixtures are not purchased twice and explicit task counts determine hours',()=>{
 const config=createPlanningConfiguration(catalog);const review=scope({service:'handyman',taskList:'Replace two toilets',ownerSupplied:'TOILETS supplied by owner',location:'Boise'});
 const result=priceReviewedScope(review,config,now);const internal=result.internal as any;assert.ok(result.customer.range);assert.equal(internal.lines.find((r:any)=>r.id.startsWith('REF-PLUMBING-HOUR')).quantity,4);assert.ok(!internal.lines.some((r:any)=>r.id.startsWith('REF-TOILET')));
});
test('Unknown specialist work cannot produce a misleading partial range; an expired planning catalog is disclosed, not withheld',()=>{
 const config=createPlanningConfiguration(catalog);const review=scope({service:'handyman',taskList:'Replace one toilet and repair structural foundation',location:'Boise'});assert.equal(priceReviewedScope(review,config,now).customer.range,null);
 // The customer-facing planning model releases the range past the catalog's quarterly review and says so with the import date; a firm proposal still needs refreshed evidence.
 const cabinet=scope({service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0'});const aged=priceReviewedScope(cabinet,config,new Date('2027-01-01'));
 assert.ok(aged.customer.range,'range released');const warnings=(aged.internal as any).warnings;
 assert.ok(warnings.some((w:any)=>w.code==='planning-catalog-review-due'&&w.severity==='review'));assert.ok(!warnings.some((w:any)=>w.severity==='block'),JSON.stringify(warnings.filter((w:any)=>w.severity==='block')));
});
test('Question policy requests all relevant quantities in a combined task list',()=>{const fields=planningQuestionFields({service:'handyman',taskList:'Paint walls, install flooring and tile, replace baseboards'});for(const field of ['sqft','flooringSqft','tileSqft','trimLf'])assert.ok(fields.includes(field as any));});
test('The catalog rejects duplicate contingency, owner-management salary and zero-price placeholders',()=>{for(const code of ['03-23-04','L-03-00','03-24-99'])assert.throws(()=>createPlanningConfiguration({...catalog,rates:[...catalog.rates,{...catalog.rates[0],code}]}));});

test('Supplied countertops keep installation costs; retained countertops omit both',()=>{
 const extra=['03-17-02-M','03-17-02-L'].map(code=>({...catalog.rates[0],code,type:(code.endsWith('-M')?'Material':'Labor') as 'Material'|'Labor'}));
 const c={...catalog,rates:[...catalog.rates,...extra]};const book=createPlanningConfiguration(c).costBooks.find(b=>b.service==='kitchen')!;
 const answers={service:'kitchen',taskList:'Install countertops',sqft:'100',countertopSqft:'50',ownerSupplied:'COUNTERTOPS provided'};
 const supplied=materializePlanningBook(book,c,scope(answers),now);assert.ok(supplied.book.rules.some(r=>r.id.startsWith('03-17-02-L')));assert.ok(!supplied.book.rules.some(r=>r.id.startsWith('03-17-02-M')));
 const retained=materializePlanningBook(book,c,scope({...answers,ownerSupplied:'',exclusions:'COUNTERTOPS'}),now);assert.ok(!retained.book.rules.some(r=>r.id.startsWith('03-17-02')));
});

test('A document review note travels with the range; an unread document still blocks it',()=>{
 const config=createPlanningConfiguration(catalog);
 const answers={service:'cabinet-product' as const,cabinetBaseLf:'10',cabinetUpperLf:'5',cabinetTallLf:'0',cabinetRoom:'kitchen',location:'Boise'};
 const extraction=(reviewNotes:string[])=>({summary:'Cabinet proposal',facts:[],conflicts:[],reviewNotes,missingInformation:[],instructions:emptyInstructions()});
 const noted=priceReviewedScope({...scope(answers),uploads:[{name:'proposal.pdf',type:'application/pdf',size:10}] as any,extraction:extraction(['1 quantity or page record from this section lacked a usable page reference and were not used. Confirm quantities against the document before pricing.']) as any},config,now);
 assert.equal(noted.customer.status,'planning-range');assert.ok(noted.customer.range,'a dropped takeoff record does not withhold the preliminary range');
 assert.ok(noted.customer.assumptions.some(a=>/lacked a usable page reference/.test(a)),'the note is disclosed with the range');
 const unread=priceReviewedScope({...scope(answers),uploads:[{name:'proposal.pdf',type:'application/pdf',size:10}] as any,extraction:extraction(['proposal.pdf: unread section requires review before pricing.']) as any},config,now);
 assert.equal(unread.customer.range,null,'an unread document still blocks the range');
 assert.ok(blockingReviewNote('proposal.pdf, page 3: unreadable. This page was not processed. Review or retry it before relying on the takeoff.'));
 assert.ok(!blockingReviewNote('Unconfirmed photo observation - Tile area in square feet: 80. Confirm from written scope before pricing.'));
});

test('A typed whole-building budget is priced by the planning model directly, with no provider calls',async()=>{
 const {priceCompleteScope,wholeBuildingPlanningBudget}=await import('../lib/p5/scopePricing.ts');
 const answers={service:'new-construction',location:'Boise',sqft:'3500',stories:'2',garageIncluded:'yes',garageSqft:'1000',finish:'high-end'};
 const reviewed=scope(answers,'New two-story home, 3,500 SF plus a 1,000 SF garage, premium finishes.');
 // The shared synthetic catalog covers small jobs; add a synthetic rate for every code a whole build asks for.
 const needed=(((priceReviewedScope(reviewed,createPlanningConfiguration(catalog),now).internal as any).missingInformation||[]) as string[]).flatMap(note=>note.match(/^Missing cost rate: (\S+)/)?.[1]||[]);
 const template=catalog.rates[0];
 const extra=[...new Set(needed)].filter(code=>!catalog.rates.some(rate=>rate.code===code));
 // Synthetic amounts only need to land inside the estimator's broad sanity limits for a home this size.
 const configurations=[2,4,6,9,14,22,35].map(amount=>createPlanningConfiguration({...catalog,rates:[...catalog.rates,...extra.map(code=>({...template,code,description:`Synthetic ${code}`,amount}))]}));
 const configuration=configurations.find(candidate=>priceReviewedScope(reviewed,candidate,now).customer.range)||configurations[0];
 const direct=priceReviewedScope(reviewed,configuration,now);
 assert.ok(direct.customer.range,'the planning model prices a whole build from size, stories, garage and finish');
 let calls=0;const refuse=async()=>{calls++;throw new Error('no provider call is expected');};
 const priced=await priceCompleteScope(reviewed,configuration,refuse as any,now,Date.now()+60000);
 assert.equal(calls,0);assert.deepEqual(priced.customer.range,direct.customer.range);
 assert.match(priced.customer.assumptions[0],/home size, stories, garage and finish level/);
 assert.equal((priced.internal as any).scopePricing.version,'planning-model-direct-v1');
 // Anything that changes what is priced keeps the full item-by-item pipeline.
 assert.equal(wholeBuildingPlanningBudget({...reviewed,answers:{...answers,exclusions:'Exclude landscaping'}},null,false),false);
 assert.equal(wholeBuildingPlanningBudget({...reviewed,uploads:[{id:'u'} as any]},null,false),false);
 assert.equal(wholeBuildingPlanningBudget(reviewed,null,true),false);
 assert.equal(wholeBuildingPlanningBudget({...reviewed,answers:{...answers,service:'bathroom'}},null,false),false);
 assert.equal(wholeBuildingPlanningBudget(reviewed,null,false),true);
});
