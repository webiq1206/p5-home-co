import test from 'node:test';
import assert from 'node:assert/strict';
import {generalInstallationRequirement,normalizeConsumableMapping,preserveScopeExclusions,findingBlocks,correctableDuplicate,catalogResolution} from '../lib/p5/scopePricing.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import {validateExtraction} from '../lib/p5/scope.ts';
import {contractorConsumableIncluded} from '../lib/p5/contractorConsumables.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
import {supportedUnit,unitKey,reusableUnit} from '../lib/p5/unitRates.ts';

test('installation kits keep their own unit and are not reused as a per-cabinet rate',()=>{
 assert.equal(supportedUnit('kit'),true);
 assert.equal(unitKey('kits'),'kit');
 assert.notEqual(unitKey('kit'),unitKey('each'));
 assert.equal(reusableUnit('kit'),false);
});

test('an unavailable catalog placeholder only yields to an explicitly requested pricing fallback',()=>{
 const scope={text:'Install owner-supplied base cabinets with contractor-supplied screws and shims.',answers:{},extraction:null} as any;
 const task={id:'base',description:'Install owner-supplied base cabinets',evidence:scope.text,existingLineIds:['labor'],additions:[{code:'INVENTED',quantity:1}],researchDescription:'Material purchase: installation screws and shims'};
 normalizeConsumableMapping({tasks:[task]} as any,EMPTY_CONFIGURATION,[{id:'labor',category:'field-labor'}] as any,scope);
 assert.deepEqual(task.additions,[]);
 assert.deepEqual(task.existingLineIds,['labor']);
 assert.match(task.researchDescription,/screws and shims/);
 const noFallback={...task,additions:[{code:'INVENTED',quantity:1}],researchDescription:''};
 normalizeConsumableMapping({tasks:[noFallback]} as any,EMPTY_CONFIGURATION,[],scope);
 assert.equal(noFallback.additions.length,1,'without fallback the unknown rate still fails validation');
});

test('invalid exclusion edits preserve scope while exact generated defaults can still be corrected',()=>{
 const scope={answers:{exclusions:'Finish painting the wall'},extraction:{instructions:{exclusions:['New circuits']}}} as any;
 const mapping={removeExclusions:[
  {text:'Exclude finish painting the wall',reason:'Spot priming is included'},
  {text:'Finish painting the wall',reason:'Incorrect removal of user exclusion'},
  {text:'New circuits',reason:'Incorrect removal of extracted exclusion'},
  {text:'Permit fees',reason:'Explicitly requested and priced'},
  {text:'Invented exclusion',reason:'Invalid reference'},
 ]} as any;
 preserveScopeExclusions(mapping,['Finish painting the wall','New circuits','Permit fees'],scope);
 assert.deepEqual(mapping.removeExclusions,[{text:'Permit fees',reason:'Explicitly requested and priced'}]);
});

test('generic installation requirements do not become a second complete assembly',()=>{
  assert.equal(generalInstallationRequirement('Provide all necessary labor and installation materials for complete installation.'),true);
  for(const description of ['Supply two faucets and installation materials.','Provide screws and shims for cabinet installation.','Install a second vanity.','Provide all labor and installation materials for an additional vanity.'])assert.equal(generalInstallationRequirement(description),false);
});

test('explicitly included screws and shims need material pricing, never another cabinet labor line',()=>{
  const scope={text:'Install owner-supplied assembled cabinets. Include installation labor, shims, screws, fastening, alignment and cleanup.',answers:{},extraction:null,uploads:[],reviewedAt:'2026-09-28',corrections:[]} as any;
  assert.equal(contractorConsumableIncluded(scope,'Supply cabinet shims and screws'),true);
  const task={id:'consumables',description:'Supply cabinet shims and screws',existingLineIds:['labor'],additions:[{code:'PB-12-39-06',quantity:30}],researchDescription:null};
  const mapping={tasks:[task]} as any;
  const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates:[{code:'PB-12-39-06',type:'Labor'}]}} as any;
  normalizeConsumableMapping(mapping,configuration,[{id:'labor',category:'field-labor',quantity:30,unitCost:100}] as any,scope);
  assert.deepEqual(task.additions,[]);
  assert.deepEqual(task.existingLineIds,[]);
  assert.match(task.researchDescription!,/Material purchase only/);
  assert.equal(contractorConsumableIncluded({...scope,text:'Owner supplies all screws and shims. Installation labor only.'},'Supply screws and shims'),false);
});

test('duplicate assembly findings and unresolved overlap cannot release an inflated total',()=>{
  const tasks=[{id:'install-materials',description:'Provide installation materials'}];
  for(const issue of ['install-materials: Duplicated assembly pricing.', 'The installed vanity and countertop could overlap.', 'These sinks must not be double-charged.'])assert.equal(findingBlocks(issue,tasks,tasks),true,issue);
  assert.equal(correctableDuplicate('install-materials: Duplicated assembly pricing.'),true);
  assert.equal(correctableDuplicate('The installed vanity and countertop could overlap.'),false);
});

test('a vanity consumables task cannot purchase another cabinet or plumbing fixtures',()=>{
  const scope={text:'Supply and install a vanity. Include labor, installation materials and cleanup.',answers:{},extraction:null,uploads:[],reviewedAt:'2026-09-28',corrections:[]} as any;
  const task={id:'consumables',description:'Supply all necessary installation consumables (e.g., caulk, shims, fasteners) for vanity, countertop, sinks, and faucets.',existingLineIds:[],additions:[{code:'CABINET',quantity:1},{code:'TRAPS',quantity:2}],researchDescription:null};
  const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates:[{code:'CABINET',type:'Material',description:'Sink base (material only)'},{code:'TRAPS',type:'Material',description:'Supplies, stops, and trap, per fixture'}]}} as any;
  normalizeConsumableMapping({tasks:[task]} as any,configuration,[],scope);
  assert.deepEqual(task.additions,[]);
  assert.match(task.researchDescription!,/Material purchase only/);
});

test('an allowance for consumables is a material task rather than an unrelated cabinet allowance',()=>{
 const scope={text:'Include labor, installation materials and cleanup.',answers:{},extraction:null,uploads:[],reviewedAt:'2026-09-28',corrections:[]} as any;
 const task={id:'consumables',description:'Provide allowance for installation consumables (fasteners, caulk, shims, adhesives, sealants, supply lines, etc.), separate from product cost.',existingLineIds:[],additions:[{code:'FILLER',quantity:1}],researchDescription:null};
 const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates:[{code:'FILLER',type:'Material',description:'Fillers / toe kick allowance'}]}} as any;
 assert.equal(contractorConsumableIncluded(scope,task.description),true);
 normalizeConsumableMapping({tasks:[task]} as any,configuration,[],scope);
 assert.deepEqual(task.additions,[]);
 assert.match(task.researchDescription!,/Material purchase only/);
});

test('owner-supplied cabinets use the explicit matching labor component, never an invented rate split',()=>{
 const scope={text:'Install 18 LF of owner-supplied base cabinets.',answers:{},extraction:null,uploads:[],reviewedAt:'2026-09-28',corrections:[]} as any;
 const task={id:'base',description:scope.text,evidence:scope.text,existingLineIds:[],additions:[{code:'PB-12-32-01',quantity:18}],researchDescription:null};
 const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates:[{code:'PB-12-32-01',type:'Subcontractor',unit:'LF',description:'Base cabinets, installed'},{code:'PB-12-32-01-L',type:'Labor',unit:'LF',description:'Base cabinets, installation labor only'}]}} as any;
 normalizeConsumableMapping({tasks:[task]} as any,configuration,[],scope);
 assert.equal(task.additions[0].code,'PB-12-32-01-L');
});

test('flooring waste increases purchased material without increasing installed labor',()=>{
 const scope={text:'Install LVP flooring with 10% material waste.',answers:{flooringSqft:'300',sqft:'326.81'},extraction:null,uploads:[],reviewedAt:'2026-09-28',corrections:[]} as any;
 const task={id:'floor',description:'Supply and install midrange LVP flooring in Room A, including 10% material waste.',evidence:'Confirmed 300 SF flooring area.',existingLineIds:[],issues:[],additions:[{code:'PB-09-65-01',quantity:330,quantityEvidence:'300 SF plus 10% material waste.'}],researchDescription:null};
 const rates=priceBookRates({service:'change-order',finish:'mid-range'});
 const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates,importedAt:'2026-09-28'}} as any;
 const mapping={tasks:[task],issues:[],notes:[],replacements:[],removeExclusions:[]} as any;
 normalizeConsumableMapping(mapping,configuration,[],scope);
 assert.deepEqual(task.additions.map(a=>[a.code,a.quantity]),[['PB-09-65-01-L',300],['PB-09-65-01-M',330]]);
 const result=catalogResolution(mapping,configuration,[],new Date('2026-09-28'),scope);
 assert.deepEqual(result.issues,[]);
 assert.deepEqual(result.rules.map(r=>[r.category,r.quantity.fixed]),[['field-labor',300],['materials',330]]);
 const installed=rates.find(r=>r.code==='PB-09-65-01')!;
 assert.equal(rates.find(r=>r.code==='PB-09-65-01-L')!.amount+rates.find(r=>r.code==='PB-09-65-01-M')!.amount,installed.amount);
});

test('confident raster dimensions require confirmation instead of silently pricing OCR mistakes',()=>{
 const base={summary:'Flooring plan',facts:[{field:'length',value:'20.75',source:'drawing.png',evidence:'20 feet 9 inches',confidence:1,basis:'stated'}],conflicts:[],missingInformation:[],reviewNotes:[]};
 const result=validateExtraction(base);
 assert.equal(result.conflicts[0]?.field,'length');
 assert.match(result.conflicts[0]?.explanation||'',/image readings can be mistaken/);
 assert.equal(validateExtraction({...base,facts:[{...base.facts[0],source:'typed scope'}]}).conflicts.length,0);
});

test('a flooring area described as including waste cannot silently become installed area',()=>{
 const result=validateExtraction({summary:'Flooring',facts:[{field:'flooringSqft',value:'330',source:'drawing.pdf',evidence:'300 SF plus 10% material waste',confidence:1,basis:'calculated'}],conflicts:[],missingInformation:[],reviewNotes:[]});
 assert.equal(result.conflicts[0]?.field,'flooringSqft');
 assert.match(result.conflicts[0]?.explanation||'',/before material waste/);
});

test('fresh estimate tolerates a catalog code mistakenly listed as a replacement without guessing line IDs',()=>{
 const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates:priceBookRates({service:'cabinet-install'}),importedAt:'2026-09-28'}} as any;
 const mapping={tasks:[],issues:[],notes:[],replacements:[{lineId:'PB-12-32-01-L',reason:'Replace product price with labor'}],removeExclusions:[]} as any;
 assert.deepEqual(catalogResolution(mapping,configuration,[],new Date('2026-09-28')).removeLineIds,[]);
 assert.throws(()=>catalogResolution(mapping,configuration,[{id:'actual-line'}] as any,new Date('2026-09-28')),/Unknown replacement line/);
 assert.throws(()=>catalogResolution({...mapping,replacements:[{lineId:'invented-line'}]},configuration,[],new Date('2026-09-28')),/Unknown replacement line/);
});
