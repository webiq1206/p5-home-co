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
