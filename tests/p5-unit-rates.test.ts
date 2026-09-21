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

test('the master price book prices each line at the chosen finish, with the remodel premium only in an existing home',async()=>{
  const {priceBookRates,priceBookSummary,finishTier,serviceContext}=await import('../lib/p5/priceBook.ts');
  const rate=(answers:{service:string;finish?:string},code:string)=>priceBookRates(answers).find(r=>r.code===`PB-${code}`);
  // Kitchen cabinets, installed, per LF: Builder 250 / Mid 500 / High 850 / Luxury 1400, remodel premium 10%.
  assert.equal(rate({service:'kitchen',finish:'mid-range'},'12-31-01')?.amount,550,'a kitchen remodel adds the 10% existing-home premium');
  assert.equal(rate({service:'kitchen',finish:'luxury'},'12-31-01')?.amount,1540);
  assert.equal(rate({service:'new-construction',finish:'refresh'},'12-31-01')?.amount,250,'new construction is base cost at Builder Grade');
  assert.equal(rate({service:'cabinet-install',finish:'high-end'},'12-31-01')?.amount,850,'cabinet work is base cost, as its tab in the book is');
  assert.equal(rate({service:'handyman'},'12-31-01')?.amount,500,'a line filed under other work is still offered, at base cost');
  // No finish chosen: the book's own default, Mid-Range.
  assert.equal(finishTier(undefined),'mid');
  assert.equal(rate({service:'kitchen'},'12-31-01')?.amount,550);
  // An installed line is typed so the engine never adds labor or material on top of it.
  const cabinets=rate({service:'kitchen'},'12-31-01')!;
  assert.equal(cabinets.type,'Subcontractor');
  assert.match(cabinets.description,/installed price, labor and material together/);
  assert.match(cabinets.description,/Mid-Range finish/);
  assert.match(cabinets.description,/remodel premium 10% included/);
  assert.equal(cabinets.unit,'LF');
  // A labor-only line is typed Labor and says materials are priced separately.
  const gfci=rate({service:'handyman'},'26-01-05')!;
  assert.equal(gfci.type,'Labor');assert.equal(gfci.amount,130);
  assert.match(gfci.description,/labor only; price materials separately/);
  assert.equal(rate({service:'re10'},'26-01-05')?.amount,130,'no premium is added where the book carries none');
  // A percentage is not a dollar price and is never offered as a unit rate.
  assert.equal(rate({service:'new-construction'},'00-10-03'),undefined);
  const summary=priceBookSummary();
  assert.equal(summary.lines,1484);assert.equal(summary.rateable+summary.percentage,summary.lines);
  // Codes are namespaced, so the book can never replace a saved schedule code such as 03-01-01.
  assert.ok(priceBookRates({service:'kitchen'}).every(r=>r.code.startsWith('PB-')));
  assert.equal(serviceContext('re10').remodel,true);
  assert.equal(serviceContext('new-construction').remodel,false);
  // The owner performs every line however it is labelled: every service sees the whole book. The
  // book's RE-10 flag carries no light fixture, irrigation or mobilization line, which left a live
  // RE-10 pricing those from uncited guesses.
  for(const service of ['re10','handyman','kitchen','new-construction','cabinet-install','change-order'])assert.equal(priceBookRates({service}).length,summary.rateable,service);
  for(const code of ['26-50-02','32-84-03','01-54-11','26-01-14'])assert.ok(rate({service:'re10'},code),`RE-10 offers ${code}`);
  // Lines filed under the job's own kind of work come first, so they win an equal match.
  const re10=priceBookRates({service:'re10'}).map(r=>r.code);
  assert.ok(re10.indexOf('PB-26-01-14')<re10.indexOf('PB-26-50-02'),'an RE-10 line precedes a remodel line');
});
test('a scope in plain words finds the book line whatever the book files it under',async()=>{
  const {priceBookRates}=await import('../lib/p5/priceBook.ts');
  const {relevantCatalog}=await import('../lib/p5/catalogSelection.ts');
  const catalog=priceBookRates({service:'re10'});
  const offered=(text:string)=>relevantCatalog(catalog,[{description:text}]).map(r=>r.code);
  assert.ok(offered('Repair garage lights so they are operational').includes('PB-26-50-02'));
  assert.ok(offered('Install a smart irrigation controller for the sprinkler system').includes('PB-32-84-03'));
});

test('every priced line is a positive direct cost in a unit the catalog accepts, within the catalog ceiling',async()=>{
  const {priceBookRates}=await import('../lib/p5/priceBook.ts');
  const {supportedUnit}=await import('../lib/p5/unitRates.ts');
  const {validatePlanningCatalog,PLANNING_MODEL_VERSION,MAX_PLANNING_RATES}=await import('../lib/p5/planningBooks.ts');
  const {FOUNDATION_CODES}=await import('../lib/p5/catalogSelection.ts');
  const owner=FOUNDATION_CODES.map(code=>({code,description:'Owner schedule rate',type:'Labor' as const,unit:'HR',amount:80,source:'Owner',basis:'owner-average-cost' as const}));
  for(const service of ['handyman','re10','cabinet-install','kitchen','bathroom','whole-home','addition','adu','new-construction','change-order']){
    for(const finish of ['refresh','mid-range','high-end','luxury']){
      const rates=priceBookRates({service,finish});
      assert.ok(rates.length>0,`${service} has lines`);
      for(const r of rates){assert.ok(supportedUnit(r.unit),`${r.code} unit ${r.unit}`);assert.ok(r.amount>=0&&Number.isFinite(r.amount),`${r.code} amount`);}
      assert.ok(owner.length+rates.length<=MAX_PLANNING_RATES,`${service} fits the ceiling`);
    }
  }
  // The largest merge, a change order, still validates as a planning catalog.
  const rates=priceBookRates({service:'change-order',finish:'luxury'});
  validatePlanningCatalog({version:PLANNING_MODEL_VERSION,source:'Owner schedule and master price book',authorizedBy:'Owner',importedAt:new Date().toISOString(),rates:[...owner,...rates]} as never);
});

test('a mapping batch is shown the lines it can use, even when the scope does not use the book\'s words',async()=>{
  const {relevantCatalog,FOUNDATION_CODES}=await import('../lib/p5/catalogSelection.ts');
  const {priceBookRates}=await import('../lib/p5/priceBook.ts');
  const owner=FOUNDATION_CODES.map(code=>({code,description:'Owner schedule rate',type:'Labor',unit:'HR',amount:80,source:'Owner',basis:'owner-average-cost'}));
  const catalog=[...owner,...priceBookRates({service:'re10'})];
  const codes=(tasks:{description:string;evidence?:string}[])=>new Set(relevantCatalog(catalog,tasks).map(r=>r.code));
  // Wording taken from real RE-10s, none of it the book's own.
  const shown=codes([
    {description:'Replace the inoperable receptacles in the garage with GFCI protection'},
    {description:'Install vacuum breakers on all exterior sillcocks'},
    {description:'Reconfigure the under-sink traps so water is not siphoned'},
    {description:'Replace the rubber boots on the plumbing vents on the roof'},
    {description:'Install a moisture barrier in the crawlspace'},
  ]);
  assert.ok(shown.has('PB-26-01-05'),'receptacle finds the GFCI outlet line');
  assert.ok(shown.has('PB-22-01-32'),'sillcock finds the hose bib vacuum breaker');
  assert.ok(shown.has('PB-22-01-29'),'under-sink trap finds the P-trap line');
  assert.ok(shown.has('PB-07-72-07'),'rubber boot finds the plumbing vent pipe boot');
  assert.ok(shown.has('PB-03-95-01'),'moisture barrier finds the crawlspace vapor barrier');
  for(const code of FOUNDATION_CODES)assert.ok(shown.has(code),`${code} is always offered`);
  assert.ok(shown.has('PB-22-01-01'),'the trade\'s hourly rate is always offered');
  // Deterministic: the same batch always sees the same lines, in catalog order.
  const again=relevantCatalog(catalog,[{description:'Replace the inoperable receptacles in the garage with GFCI protection'}]);
  assert.deepEqual(again.map(r=>r.code),relevantCatalog(catalog,[{description:'Replace the inoperable receptacles in the garage with GFCI protection'}]).map(r=>r.code));
  const order=again.map(r=>catalog.findIndex(c=>c.code===r.code));
  assert.deepEqual(order,[...order].sort((a,b)=>a-b));
  // A small catalog is passed through untouched.
  assert.equal(relevantCatalog(owner,[{description:'anything'}]).length,owner.length);
});

test('trade vocabulary a customer or inspector uses still reaches the right line in a large catalog',async()=>{
  const {relevantCatalog}=await import('../lib/p5/catalogSelection.ts');
  const {priceBookRates}=await import('../lib/p5/priceBook.ts');
  const catalog=priceBookRates({service:'change-order'});
  assert.ok(catalog.length>1000,'a change order draws on most of the book');
  const finds=(description:string,code:string)=>assert.ok(relevantCatalog(catalog,[{description}]).some(r=>r.code===code),`"${description}" should reach ${code}`);
  // Each phrasing shares no word with the book's own line item.
  finds('Replace one receptacle in the front bedroom','PB-26-01-04');   // Outlet / switch replacement
  finds('The spigot on the north wall drips','PB-22-10-15');            // Frost-free hose bib
  finds('Commode rocks and needs resetting','PB-22-01-30');             // Loose toilet reset with new wax ring
  finds('Patch the sheetrock where the doorknob hit','PB-09-01-08');    // Drywall patch, medium
  finds('Add four can lights in the family room','PB-26-50-01');        // Recessed LED light
  finds('Flush the hot water tank','PB-22-01-10');                      // Water heater flush
});
