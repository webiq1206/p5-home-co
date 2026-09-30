import test from 'node:test';
import assert from 'node:assert/strict';
import {contractorConsumableIncluded} from '../lib/p5/contractorConsumables.ts';
import {suggestedTrade} from '../lib/p5/trades.ts';
import {applyCabinetIntent,cabinetIntent} from '../lib/p5/projectIntent.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {advisoryIssue,pricedTaskRemark,findingBlocks,correctableDuplicate,planningResolution,marketResolution} from '../lib/p5/scopePricing.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
const text='Install 100 linear feet of owner-supplied 3.25-inch primed MDF baseboard. Labor only. Owner supplies the baseboard; contractor supplies nails and caulk. No painting.';
const scope:ReviewedScope={text,answers:{service:'handyman',ownerSupplied:'Owner supplies baseboard; contractor supplies nails and caulk'},extraction:null,uploads:[],reviewedAt:'2026-09-24',corrections:[]};
test('live new-home missing utility coverage cannot become an assumption because the parent has a price',()=>{
 const tasks=[{id:'project:utility-connections-within-perimeter',description:'Install and connect stubbed utilities within the building perimeter'}];
 for(const issue of [
  'project:utility-connections-within-perimeter is missing a positive priced line for required stub-to-building utility connection work.',
  'There are no positive priced lines (/plumbing, /HVAC, /electric) included. This integral portion of the scope remains uncosted.',
  tasks[0].description+': full pricing coverage has not been verified.'
 ]){
  assert.equal(advisoryIssue(issue),false,issue);
  assert.equal(pricedTaskRemark(issue,tasks),false,issue);
  assert.equal(findingBlocks(issue,tasks,tasks),true,issue);
 }
});
test('RE10 general supplies cannot acquire cabinet hardware or shims without cabinet work',async()=>{
 const {normalizeConsumableMapping}=await import('../lib/p5/scopePricing.ts');
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const rates=priceBookRates({service:'re10'});
 const unrelated=rates.filter(rate=>rate.type==='Material'&&/cabinet|vanity/i.test(rate.description)&&/shim|hardware|fastener/i.test(rate.description));
 assert.ok(unrelated.length>0);
 const local={...scope,text:'Replace two GFCIs, one PVC P-trap and patch Type X drywall. Include normal installation supplies.',answers:{service:'re10'}};
 const supplies={id:'supplies',description:'Supply normal installation consumables',evidence:'Include normal installation supplies.',additions:unrelated.map(rate=>({code:rate.code,quantity:1,quantityEvidence:'ALLOWANCE: general supplies',quantityRange:null})),existingLineIds:[],researchDescription:'',issues:[]};
 const repair={...supplies,id:'repairs',description:'Replace two GFCI receptacles, replace one PVC P-trap and patch one drywall hole.',additions:[]};
 const mapping={tasks:[supplies,repair],issues:[],notes:[],replacements:[],removeExclusions:[]};
 normalizeConsumableMapping(mapping,{planningCatalog:{rates}} as any,[],local);
 assert.deepEqual(supplies.additions,[]);
 assert.match(supplies.researchDescription,/actual remaining supplies/);
 const {consumableApplicationMatches}=await import('../lib/p5/consumableCoverage.ts');
 assert.equal(consumableApplicationMatches('Cabinet mounting shims',[{description:'Install one 30-inch vanity'}]),true);
 assert.equal(consumableApplicationMatches('Cabinet mounting shims',[{description:'Remove existing vanity only'}]),false);
 assert.equal(consumableApplicationMatches('Cabinet mounting shims',[{description:'Replace two GFCIs. Retain cabinets.'}]),false);
});
test('paint preparation fills nail holes; it does not buy nails in proportion to wall area',async()=>{
 const {wrongHoleFillingFastener}=await import('../lib/p5/scopePricing.ts');
 const prep='Perform standard prep for all painted surfaces: fill nail holes and minor cracks, patch small holes, clean surfaces for 4000 SF walls and 1800 SF ceilings.';
 const local={...scope,text:'Paint walls and ceilings. Include filling nail holes.',answers:{service:'remodel'}};
 assert.equal(contractorConsumableIncluded(local,prep),false);
 assert.equal(wrongHoleFillingFastener(prep,'Coated steel trim nails, 1020 count box'),true);
 assert.equal(wrongHoleFillingFastener(prep,'Nail-hole filler'),false);
 assert.equal(wrongHoleFillingFastener('Install 420 LF baseboard and fill nail holes.','Finish nails'),false);
 assert.equal(wrongHoleFillingFastener('Reattach loose drywall with screws and fill screw holes.','Drywall screws'),false);
});
test('contractor consumables are item-specific and do not authorize owner products or extra materials',()=>{
 for(const component of ['Finish nails','Paintable caulk','Install baseboard: finish nails (materials)','Nails, interior trim caulk, and nail-hole filler for 100 LF of owner-supplied primed MDF baseboard'])assert.equal(contractorConsumableIncluded(scope,component),true,component);
 for(const component of ['Baseboard','Install nails and caulk: MDF baseboard','Owner-supplied nails','Adhesive','Supply and install baseboard','Cabinets including fasteners','Baseboard with nails'])assert.equal(contractorConsumableIncluded(scope,component),false,component);
 assert.equal(contractorConsumableIncluded({...scope,text:'Labor only. Owner supplies all nails and caulk.',answers:{}},'Nails'),false);
 assert.equal(contractorConsumableIncluded({...scope,text:'Include normal fastening and leveling consumables.',answers:{}},'Cabinet shims'),true);
 const generic='Supply normal cabinet mounting screws, shims, fasteners and other standard installation consumables for fastening and leveling.: Cabinet + Vanity Hardware - Materials';
 assert.equal(contractorConsumableIncluded({...scope,text:'Contractor supplies all mounting consumables.',answers:{}},generic),true);
 for(const product of ['Cabinet + Vanity Hardware - Materials','Supply mounting screws: Decorative knobs and pulls','Supply mounting screws: Cabinet materials'])assert.equal(contractorConsumableIncluded({...scope,text:'Contractor supplies all mounting consumables.',answers:{}},product),false,product);
});
test('cabinet installation operations are labor, while the specified screws and shims are materials',()=>{
 const cabinet={...scope,text:'Owner supplies assembled cabinets and handles. Contractor supplies only screws and shims. Include leveling, fastening, adjustments and handle installation.',answers:{}};
 for(const operation of ['Leveling, fastening, adjustments, and handle installation','Cabinet leveling','Fastening cabinets to walls'])assert.equal(contractorConsumableIncluded(cabinet,operation),false,operation);
 for(const supply of ['Mounting screws','Cabinet shims','Fastening materials','Leveling supplies'])assert.equal(contractorConsumableIncluded(cabinet,supply),true,supply);
});
test('catalog section labels cannot turn installation into painting',()=>{
 assert.equal(suggestedTrade('Cabinet install labor only (12-39 Cabinet Refacing, Refinishing & Install)'), 'Cabinets');
 assert.equal(suggestedTrade('Finish carpenter (12-39 Cabinet Refacing, Refinishing & Install)'), 'Trim & Finish Carpentry');
 assert.equal(suggestedTrade('Repainting cabinets (12-39 Cabinet Refacing, Refinishing & Install)'), 'Painting');
});
test('multi-trade sites retain the actual scope when cabinets are excluded',()=>{
 const services=['whole-home','handyman','cabinet-install','cabinet-product'];
 const flooring='Supply and install 200 SF of LVP flooring. Exclude plumbing, electrical, painting, cabinets and all other rooms.';
 assert.equal(cabinetIntent(flooring,services),undefined);
 assert.equal(applyCabinetIntent(flooring,services,{service:'whole-home'}).answers.service,'whole-home');
 assert.equal(cabinetIntent('Supply and install cabinets throughout a new home.',services),undefined);
 assert.equal(cabinetIntent('Supply and install cabinets.',['cabinet-install','cabinet-product']),'cabinet-install');
 if(ESTIMATOR_BRAND.id==='cabinet')assert.equal(cabinetIntent('Install 10 LF of owner-supplied base cabinets. Exclude cabinet purchase, demolition, countertops, plumbing and electrical.',ESTIMATOR_BRAND.services),'cabinet-install');
});
test('a verified missing consumable component cannot be downgraded because its parent labor is priced',()=>{
 const tasks=[{id:'base-cab-install',description:'Install base cabinets'}];
 const issue='base-cab-install uses labor-only PB rates that require materials separately, but no positive material line covers the requested contractor-provided normal fastening and leveling consumables. The task is incomplete.';
 assert.equal(advisoryIssue(issue),false);assert.equal(pricedTaskRemark(issue,tasks),false);assert.equal(findingBlocks(issue,tasks,tasks),true);
 assert.equal(correctableDuplicate('scope-1 duplicates scope-2. '+issue),false);
});
test('planning and sourced materials do not inherit owner supply from the baseboard they fasten',()=>{
 const task={id:'fasteners-caulk',description:'Supply nails and caulk required for installation of the 100 LF of baseboard.',evidence:text,existingLineIds:[],additions:[],researchDescription:'Nails and caulk material only',issues:[]};
 const rate={taskId:task.id,description:'Contractor-supplied finish nails and caulk',unit:'LS',quantity:1,quantityEvidence:'ALLOWANCE: One small installation consumables package; confirm usage.',quantityRange:{low:1,high:1},basis:'material-purchase',includes:'Nails and caulk only',excludes:'Baseboard, installation labor, painting',low:18,high:40,confidence:'medium',rationale:'Synthetic regression fixture only.'};
 const now=new Date('2026-09-24');
 const planned=planningResolution({rates:[rate],issues:[],notes:[]},[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope);
 assert.equal(planned.rules.length,1,JSON.stringify(planned.issues));assert.equal(planned.rules[0].category,'materials');
 const urls=['https://fixture-a.invalid','https://fixture-b.invalid'];
 const evidence={url:urls[0],publishedAt:'2026-09-23',dateBasis:'published',region:'Idaho',excerpt:'Synthetic tax and pickup included.'};
 const marketRate=Object.fromEntries(Object.entries(rate).filter(([key])=>!['low','high','confidence','rationale'].includes(key)));
 const sourced={...marketRate,sources:urls.map(url=>({url,low:18,high:40,unit:'LS',costBasis:'material-purchase',sourceType:'regional-guide',dateBasis:'published',publishedAt:'2026-09-23',region:'Boise, Idaho',excerpt:'Synthetic material purchase price.'})),landedCost:{taxRate:0,freightPerUnit:0,taxOnFreight:false,taxEvidence:evidence,freightEvidence:evidence}};
 assert.equal(marketResolution({rates:[sourced],issues:[],notes:[]},urls,[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope).rules.length,1);
 for(const description of ['Sink base cabinet','Supplies, stops, and trap, per fixture']){
  assert.equal(planningResolution({rates:[{...rate,description}],issues:[],notes:[]},[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope).rules.length,0);
  assert.equal(marketResolution({rates:[{...sourced,description}],issues:[],notes:[]},urls,[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope).rules.length,0);
 }
 // The exception applies only to consumable material. A combined installed package remains blocked.
 assert.equal(planningResolution({rates:[{...rate,basis:'subcontractor-installed'}],issues:[],notes:[]},[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope).rules.length,0);
});

test('flooring supplies cannot be priced as preparation or adhesive removal',()=>{
 const floor={...scope,text:'Supply and install 300 SF LVP. Include ordinary installation supplies. Exclude floor preparation, grinding and leveling.',answers:{}};
 for(const component of ['Provide ordinary installation supplies for LVP flooring','Flooring underlayment / pad','Flooring adhesive'])
  assert.equal(contractorConsumableIncluded(floor,component),true,component);
 for(const component of ['Floor prep / adhesive removal (grind)','Provide installation supplies: Floor prep / adhesive removal (grind)','Demolition of glued flooring'])
  assert.equal(contractorConsumableIncluded(floor,component),false,component);
 assert.equal(suggestedTrade('Install mid-range LVP flooring in 300 sqft room over concrete slab.'),'Flooring');
 assert.equal(suggestedTrade('Install 300 SF LVP on the existing concrete floor.'),'Flooring');
 assert.equal(suggestedTrade('Install LVP over concrete.'),'Flooring');
 assert.equal(suggestedTrade('Repair concrete slab before flooring installation.'),'Concrete');
 assert.equal(suggestedTrade('Grind and level the concrete slab before installing LVP.'),'Concrete');
});

test('an incompatible flooring supply mapping returns to pricing without retaining preparation cost',async()=>{
 const {normalizeConsumableMapping}=await import('../lib/p5/scopePricing.ts');
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const floor={...scope,text:'Supply and install 300 SF LVP. Include ordinary installation supplies. Exclude floor preparation, grinding and leveling.',answers:{service:'remodel',flooringSqft:'300'}};
 const task={id:'supplies',description:'Provide ordinary installation supplies for LVP flooring installation in 300 sqft room.',evidence:floor.text,additions:[{code:'PB-09-65-13-M',quantity:300,quantityEvidence:'ALLOWANCE: ordinary installation supplies',quantityRange:{low:300,high:300}}],existingLineIds:[],researchDescription:'',issues:[]};
 const mapping={tasks:[task],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const config={planningCatalog:{rates:priceBookRates({service:'remodel'})}} as any;
 normalizeConsumableMapping(mapping,config,[],floor);
 assert.equal(task.additions.length,0);
 assert.match(task.researchDescription,/Material purchase only/);
 task.additions=[{code:'PB-09-60-06',quantity:300,quantityEvidence:'ALLOWANCE: underlayment if required by the selected LVP',quantityRange:{low:300,high:300}}];
 task.researchDescription='';
 normalizeConsumableMapping(mapping,config,[],floor);
 assert.equal(task.additions[0].code,'PB-09-60-06');
 assert.equal(task.researchDescription,'');
});

test('ready-slab ordinary supplies cannot consume a grinding rate, but expressly requested preparation remains billable',async()=>{
 const {normalizeConsumableMapping}=await import('../lib/p5/scopePricing.ts');
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const config={planningCatalog:{rates:priceBookRates({service:'remodel'})}} as any;
 const text='Owner removed old flooring. Supply 330 SF mid-range LVP including 10% waste and install over sound level existing concrete slab in one 300 SF room. Contractor provides ordinary installation supplies and minor cleanup. Exclude demolition, leveling, floor prep, adhesive removal, grinding, baseboard, transitions, painting, plumbing, electrical and cabinetry.';
 const floor={...scope,text,answers:{service:'remodel',flooringSqft:'300',exclusions:'Demolition; leveling; floor prep; adhesive removal; grinding; baseboard; transitions; painting; plumbing; electrical; cabinetry'}};
 const addition=(code:string,quantity:number)=>({code,quantity,quantityEvidence:`${quantity} SF from reviewed scope`});
 const task=(id:string,description:string,additions:ReturnType<typeof addition>[])=>({id,description,evidence:text,additions,existingLineIds:[],researchDescription:'',issues:[]});
 const supply=task('ordinary-supplies','Provide ordinary LVP installation supplies in 300 SF room',[addition('PB-09-65-13-M',300)]);
 const install=task('install-lvp','Install 300 SF LVP over existing concrete slab',[addition('PB-09-65-01-L',300)]);
 const purchase=task('purchase-lvp','Supply 330 SF LVP including 10% waste',[addition('PB-09-65-01-M',330)]);
 const mapping={tasks:[purchase,install,supply],issues:[],notes:[],replacements:[],removeExclusions:[]};
 normalizeConsumableMapping(mapping,config,[],floor);
 assert.deepEqual(purchase.additions.map(a=>[a.code,a.quantity]),[['PB-09-65-01-M',330]]);
 assert.deepEqual(install.additions.map(a=>[a.code,a.quantity]),[['PB-09-65-01-L',300]]);
 assert.equal(suggestedTrade(install.description),'Flooring');
 assert.deepEqual(supply.additions,[],'excluded grinding is never billed as ordinary supplies');
 assert.match(supply.researchDescription,/Material purchase only/,'unpriced materials remain explicit rather than receiving an invented rate');
 assert.equal(contractorConsumableIncluded(floor,'Supply ordinary installation supplies: Floor prep / adhesive removal (grind)'),false);
 const prep={...floor,text:'Owner requests grinding adhesive residue from 300 SF of concrete slab before new LVP installation. Contractor also provides ordinary installation supplies.',answers:{service:'remodel',flooringSqft:'300'}};
 const requestedPrep=task('requested-prep','Grind adhesive residue from 300 SF concrete slab before LVP installation',[addition('PB-09-65-13',300)]);
 const prepMapping={tasks:[requestedPrep],issues:[],notes:[],replacements:[],removeExclusions:[]};
 normalizeConsumableMapping(prepMapping,config,[],prep);
 assert.deepEqual(requestedPrep.additions.map(a=>[a.code,a.quantity]),[['PB-09-65-13',300]],'a real, expressly requested preparation task is retained');
 assert.equal(suggestedTrade(requestedPrep.description),'Concrete');
});

test('owner-provided all parts cannot become a generated contractor screw purchase',async()=>{
 const {normalizeConsumableMapping}=await import('../lib/p5/scopePricing.ts');
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const local={...scope,text:'Replace three interior lever handles. All parts are provided by owner.',answers:{service:'handyman'},extraction:{summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{inclusions:[],exclusions:[],questions:[],buildings:[],floors:[],responsibilities:['Contractor provides minor installation consumables and screws'],laborOnly:false,materialsOnly:false,separateBuildings:false}}};
 assert.equal(contractorConsumableIncluded(local,'Supply contractor screws'),false);
 const mapping={tasks:[{id:'handles',description:'Install three owner-supplied lever handles',evidence:local.text,additions:[{code:'PB-01-01-01',quantity:1,quantityEvidence:'ALLOWANCE: one hour'}],existingLineIds:[],researchDescription:'',issues:[]}],issues:[],notes:[],replacements:[],removeExclusions:[]};
 normalizeConsumableMapping(mapping,{planningCatalog:{rates:priceBookRates({service:'handyman'})}} as any,[],local);
 assert.deepEqual(mapping.tasks.map(t=>t.id),['handles']);
});
test('repair minor-material references survive consumable normalization',async()=>{
 const {normalizeConsumableMapping,catalogResolution}=await import('../lib/p5/scopePricing.ts');
 const {priceBookRates}=await import('../lib/p5/priceBook.ts');
 const local={...scope,text:'Replace one P-trap and patch one 1 SF drywall hole. Include normal installation supplies.',answers:{service:'re10'}};
 const task=(id:string,description:string,code:string)=>({id,description,evidence:description,additions:code?[{code,quantity:1,quantityEvidence:'One repair stated'}]:[],existingLineIds:[] as string[],researchDescription:'',issues:[]});
 const supplies=task('supplies','Provide normal installation supplies','');supplies.existingLineIds=['PB-22-01-29','PB-09-01-08'];
 const mapping={tasks:[task('trap','Replace one P-trap','PB-22-01-29'),task('patch','Repair one 1 SF drywall hole','PB-09-01-08'),supplies],issues:[],notes:[],replacements:[],removeExclusions:[]};
 const config={planningCatalog:{rates:priceBookRates({service:'re10'}),importedAt:'2026-09-30T00:00:00Z'}} as any;
 normalizeConsumableMapping(mapping,config,[],local);
 assert.deepEqual(supplies.existingLineIds,['PB-22-01-29','PB-09-01-08']);assert.equal(supplies.researchDescription,'');
 const resolved=catalogResolution(mapping,config,[],new Date('2026-09-30'),local);
 assert.deepEqual(supplies.existingLineIds,['scope-1','scope-2']);assert.equal(resolved.rules.length,2);
});
