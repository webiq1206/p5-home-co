import test from 'node:test';
import assert from 'node:assert/strict';
import {reusableUnitRate,unitKey} from '../lib/p5/unitRates.ts';
import {catalogResolution,planningResolution,priceCompleteScope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import type {CostRule} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const now=new Date('2026-09-18T00:00:00Z');
const task={id:'trim',description:'Supply MDF baseboard',evidence:'120 LF of baseboard',existingLineIds:[],additions:[],researchDescription:'MDF baseboard material',issues:[]};
const raw={rates:[{taskId:'trim',description:'Standard square MDF baseboard material',unit:'LF',quantity:132,quantityEvidence:'ALLOWANCE: 120 LF installed plus 10% cutting waste = 132 LF purchased',quantityRange:{low:126,high:138},building:'Previous house',floor:'Previous floor',basis:'material-purchase',includes:'Standard square MDF baseboard material',excludes:'Installation and field painting',low:2,high:4,confidence:'medium',rationale:'Synthetic unit-cost fixture, not a real price.'}],issues:[]};
const rule=()=>planningResolution(raw,[task],now,0,'Boise').rules[0];
const config=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'Synthetic fixture',authorizedBy:'Tests',importedAt:now.toISOString(),rates:['03-17-01-M','03-17-01-L','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'].map(code=>({code,description:'Synthetic approved fixture',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:10,source:'Synthetic fixture',basis:'owner-average-cost'}))});
const scope:ReviewedScope={text:'Supply 50 LF of standard square MDF baseboard material only. Exclude installation and field painting.',answers:{service:'handyman',location:'Boise',trimLf:'50'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]};
const mapping=(rate:CostRule)=>({tasks:[{...task,evidence:'50 LF of baseboard',researchDescription:'',additions:[{code:rate.id,quantity:50,quantityEvidence:'50 LF requested'}]}],issues:[],notes:[],replacements:[],removeExclusions:[]});

test('unit costs persist without old quantities, quantity ranges, buildings or evidence',()=>{
 const saved=reusableUnitRate(rule(),' Boise ',now)!;
 assert.equal(saved.unit,'lf');assert.equal(saved.unitCost,3);assert.deepEqual(saved.unitCostRange,{low:2,high:4});
 assert.deepEqual(saved.quantity,{fixed:1,factor:1});assert.equal(saved.quantityRange,undefined);assert.equal(saved.building,undefined);assert.equal(saved.floor,undefined);assert.equal(saved.scopeTaskId,undefined);
 assert.doesNotMatch(JSON.stringify(saved),/120 LF|132 LF|Previous house|Previous floor/);
 assert.match(saved.evidence.reference,/Provisional planning allowance/);assert.match(saved.evidence.reference,/Installation and field painting/);
 assert.equal(saved.estimatingBasis,'regional-planning-average');
 const reused=catalogResolution(mapping(saved),{...config,regionalRates:[saved]},[],now,scope);
 assert.deepEqual(reused.issues,[]);assert.equal(reused.rules[0].quantity.fixed,50);assert.equal(reused.rules[0].quantityRange,undefined);
 assert.equal(reused.rules[0].description,saved.description);assert.match(reused.assumptions.join(' '),/provisional planning/);assert.match(reused.assumptions.join(' '),/field painting/);
 assert.equal(reusableUnitRate(reused.rules[0],'Boise',now)?.id,saved.id);
});
test('unit aliases share identity; specifications and labor responsibilities do not',()=>{
 const original=rule(),a=reusableUnitRate(original,'Boise',now)!;
 assert.equal(reusableUnitRate({...original,unit:'linear feet'},'Boise',now)!.id,a.id);
 assert.notEqual(reusableUnitRate({...original,description:'Stained oak baseboard material'},'Boise',now)!.id,a.id);
 assert.notEqual(reusableUnitRate({...original,category:'field-labor',unitRateContext:{...original.unitRateContext!,basis:'trade-labor',includes:'Installation only'}},'Boise',now)!.id,a.id);
 assert.equal(unitKey('sq. ft'),'sf');assert.equal(unitKey('HRS'),'hour');assert.equal(unitKey('EA'),'each');
});
test('stale, wrong-location, package, selling-price, unsupported and nonpositive rates cannot enter reuse',()=>{
 const original=rule();
 assert.equal(reusableUnitRate(original,'Seattle',now),null);
 assert.equal(reusableUnitRate(original,'Boise',new Date('2026-11-01')),null);
 for(const patch of [{unit:'project'},{priceBasis:'customer-price'},{unitCost:0},{unitCost:NaN},{estimatingBasis:'owner-average-cost'},{estimatingBasis:'sourced-market-average'},{unitRateContext:undefined},{evidence:{...original.evidence,validUntil:'invalid'}}])assert.equal(reusableUnitRate({...original,...patch} as CostRule,'Boise',now),null);
 const reused=reusableUnitRate(original,'Boise',new Date('2026-09-25'))!;
 assert.equal(reused.evidence.validUntil,original.evidence.validUntil,'reusing a rate must not refresh its evidence date');
});
test('current project quantities and exclusions still govern a saved allowance',()=>{
 const saved=reusableUnitRate(rule(),'Boise',now)!,mapped=mapping(saved);
 mapped.tasks[0].additions[0].quantity=120;
 assert.equal(catalogResolution(mapped,{...config,regionalRates:[saved]},[],now,scope).rules.length,0);
 mapped.tasks[0].description='Excluded MDF baseboard';mapped.tasks[0].additions[0].quantity=50;
 assert.equal(catalogResolution(mapped,{...config,regionalRates:[saved]},[],now,scope).rules.length,0);
});
test('complete pricing reuses the unit allowance without another market search',async()=>{
 const saved=reusableUnitRate(rule(),'Boise',now)!,calls:string[]=[];
 const request:PricingRequest=async(instructions,input,search)=>{
  assert.equal(search,false,'matching saved rate must avoid paid research');calls.push(instructions);
  if(instructions.startsWith('Inventory'))return {value:{tasks:[{id:task.id,description:task.description,evidence:'50 LF of baseboard'}],issues:[],notes:[]},sourceUrls:[]};
  if(instructions.startsWith('You are a construction estimator'))return {value:mapping(saved),sourceUrls:[]};
  return {value:{coveredTaskIds:['trim'],issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
 };
 const result=await priceCompleteScope(scope,{...config,regionalRates:[saved]},request,now);
 assert.ok(result.customer.range);assert.match(result.customer.assumptions.join(' '),/Budget allowance; final selection to be confirmed/);assert.match(JSON.stringify(result.internal),/provisional planning/,'the staff record keeps the rate basis');
 assert.equal(calls.length,3);
});

test('repair-list units are recognised by dimension and unfamiliar units are refused, never forced',async()=>{
 const {unitKey,supportedUnit,reusableUnit,UNIT_REGISTRY}=await import('../lib/p5/unitRates.ts');
 // The exact units production rejected on the Marcliffe RE-10.
 for(const unit of ['each termination','assembly','device location','each vent','per fixture','EA'])assert.equal(unitKey(unit),'each',unit);
 for(const unit of ['allowance','lump sum','LS','job'])assert.equal(unitKey(unit),'ls',unit);
 assert.equal(unitKey('pickup-load'),'load');
 for(const unit of ['each termination','assembly','allowance','pickup-load','device location','day','roofing square','gallon','sheet'])assert.ok(supportedUnit(unit),unit);
 // Dimensions never blur: a roofing square is not a square foot, square feet are not linear feet.
 assert.notEqual(unitKey('square'),unitKey('square feet'));assert.notEqual(unitKey('SF'),unitKey('LF'));
 assert.equal(UNIT_REGISTRY[unitKey('square')].dimension,'area');assert.equal(UNIT_REGISTRY[unitKey('load')].dimension,'count');
 // Unknown units stay unsupported instead of becoming EA or LS.
 for(const unit of ['furlong','bucketful','conditioned SF','per smile'])assert.equal(supportedUnit(unit),false,unit);
 // Only portable unit costs are saved for reuse on other projects.
 for(const unit of ['SF','LF','each vent','hour','CY'])assert.ok(reusableUnit(unit),unit);
 for(const unit of ['allowance','pickup-load','day','gallon'])assert.equal(reusableUnit(unit),false,unit);
});

test('the Boise rate card is loadable into an owner planning catalog',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {validatePlanningCatalog,PLANNING_MODEL_VERSION}=await import('../lib/p5/planningBooks.ts');
  const {supportedUnit}=await import('../lib/p5/unitRates.ts');
  const card=JSON.parse(await readFile(new URL('../scripts/p5-boise-rate-card.json',import.meta.url),'utf8'));
  const rates=card.rates.map((r:any)=>({...r,source:r.source||card.source,basis:r.basis||card.basis}));
  assert.ok(rates.length>=200,'the card covers the long tail of repair work');
  assert.equal(new Set(rates.map((r:any)=>r.code)).size,rates.length,'codes are unique');
  for(const rate of rates)assert.ok(supportedUnit(rate.unit),`${rate.code} uses a priceable unit`);
  // Direct costs only: the estimator adds overhead, profit and contingency after them.
  for(const rate of rates)assert.ok(!/\b(?:overhead|profit|margin|markup|retail price)\b/i.test(rate.description),`${rate.code} states a direct cost`);
  // Loads beside the existing owner schedule without exceeding the catalog ceiling.
  const required=['03-17-01-M','03-17-01-L','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR']
    .map(code=>({code,description:'Existing owner rate',type:'Labor',unit:'HR',amount:80,source:'Owner schedule',basis:'owner-average-cost'}));
  const merged=validatePlanningCatalog({version:PLANNING_MODEL_VERSION,source:'Owner schedule plus Boise rate card',authorizedBy:'Owner',importedAt:new Date().toISOString(),rates:[...required,...rates]} as never);
  assert.equal(merged.rates.length,required.length+rates.length);
});

test('the shipped rate card fills gaps in a saved catalog without touching the owner\'s own rates',async()=>{
  const {shippedRateCard,withRateCard,missingRates}=await import('../lib/p5/rateCard.ts');
  const card=await shippedRateCard();
  assert.ok(card&&card.length>=200,'the card loads from the repository');
  const owner={code:'RC-LAB-GENERAL',description:'Owner general labor',type:'Labor',unit:'HR',amount:99,source:'Owner schedule',basis:'owner-average-cost'};
  const saved={finance:{},costBooks:[],planningCatalog:{version:'owner-schedule-2026-09-11',source:'Owner',authorizedBy:'Owner',importedAt:new Date().toISOString(),rates:[owner]}} as never;
  const merged=withRateCard(saved,card!);
  const general=merged.planningCatalog!.rates.filter(r=>r.code==='RC-LAB-GENERAL');
  assert.equal(general.length,1);assert.equal(general[0].amount,99,"the owner's own rate wins");
  assert.equal(merged.planningCatalog!.rates.length,card!.length,'every other card rate is added once');
  assert.equal(missingRates(merged,card!).length,0,'a second pass adds nothing');
  assert.equal(withRateCard(merged,card!),merged,'and returns the same configuration');
  // The catalog ceiling still holds.
  const full={...saved,planningCatalog:{...saved.planningCatalog!,rates:Array.from({length:2000},(_,i)=>({...owner,code:`OWN-${i}`}))}} as never;
  assert.equal(withRateCard(full,card!).planningCatalog!.rates.length,2000);
});

test('the generated rate card module matches the JSON source of truth',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {RATE_CARD}=await import('../lib/p5/rateCardData.ts');
  const card=JSON.parse(await readFile(new URL('../scripts/p5-boise-rate-card.json',import.meta.url),'utf8'));
  const expected=card.rates.map((r:any)=>({code:r.code,description:r.description,type:r.type,unit:r.unit,amount:r.amount,source:r.source||card.source,basis:r.basis||card.basis||'owner-average-cost'}));
  assert.deepEqual(RATE_CARD,expected,'run node scripts/p5-build-rate-card.mjs after editing the rate card');
});

test('a mapping batch is shown the part of the catalog it can use, plus the rates any task needs',async()=>{
  const {relevantCatalog,FOUNDATION_CODES,meaningfulWords}=await import('../lib/p5/catalogSelection.ts');
  const {RATE_CARD}=await import('../lib/p5/rateCardData.ts');
  const owner=FOUNDATION_CODES.map(code=>({code,description:'Owner schedule rate',type:'Labor',unit:'HR',amount:80,source:'Owner',basis:'owner-average-cost'}));
  const catalog=[...owner,...RATE_CARD];
  const plumbing=[{description:'Reconfigure the under-sink trap assemblies',evidence:'All sink locations'},{description:'Install vacuum breakers on exterior hose bibs',evidence:''}];
  const slice=relevantCatalog(catalog,plumbing,60);
  assert.ok(slice.length<=60&&slice.length<catalog.length,'the batch sees a slice, not the whole book');
  const codes=new Set(slice.map(r=>r.code));
  assert.ok(codes.has('RC-PLUM-PTRAP-L'),'the trap rate is offered');
  assert.ok(codes.has('RC-PLUM-VACBREAK-M'),'so is the vacuum breaker');
  for(const code of FOUNDATION_CODES)assert.ok(codes.has(code),`${code} is always offered`);
  assert.ok(codes.has('RC-LAB-PLUMBING'),'trade labor is always offered');
  assert.ok(!codes.has('RC-ROOF-SHINGLE-M'),'an unrelated roofing rate is not');
  // Deterministic: the same batch always sees the same book, in the owner's own order.
  assert.deepEqual(relevantCatalog(catalog,plumbing,60).map(r=>r.code),slice.map(r=>r.code));
  const order=slice.map(r=>catalog.findIndex(c=>c.code===r.code));
  assert.deepEqual(order,[...order].sort((a,b)=>a-b));
  // A small catalog is passed through untouched, and stemming matches singular to plural.
  assert.equal(relevantCatalog(owner,plumbing,60).length,owner.length);
  assert.ok(meaningfulWords('vacuum breakers').has('vacuum'));
});
