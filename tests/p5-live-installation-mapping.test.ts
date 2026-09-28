import test from 'node:test';
import assert from 'node:assert/strict';
import {generalInstallationRequirement,normalizeConsumableMapping,findingBlocks,correctableDuplicate} from '../lib/p5/scopePricing.ts';
import {contractorConsumableIncluded} from '../lib/p5/contractorConsumables.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';

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

test('owner-supplied cabinets use the explicit matching labor component, never an invented rate split',()=>{
 const scope={text:'Install 18 LF of owner-supplied base cabinets.',answers:{},extraction:null,uploads:[],reviewedAt:'2026-09-28',corrections:[]} as any;
 const task={id:'base',description:scope.text,evidence:scope.text,existingLineIds:[],additions:[{code:'PB-12-32-01',quantity:18}],researchDescription:null};
 const configuration={...EMPTY_CONFIGURATION,planningCatalog:{rates:[{code:'PB-12-32-01',type:'Subcontractor',unit:'LF',description:'Base cabinets, installed'},{code:'PB-12-32-01-L',type:'Labor',unit:'LF',description:'Base cabinets, installation labor only'}]}} as any;
 normalizeConsumableMapping({tasks:[task]} as any,configuration,[],scope);
 assert.equal(task.additions[0].code,'PB-12-32-01-L');
});
