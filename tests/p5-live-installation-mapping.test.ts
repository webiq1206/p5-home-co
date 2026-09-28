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
