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
 assert.equal(suggestedTrade('Repair concrete slab before flooring installation.'),'Concrete');
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
