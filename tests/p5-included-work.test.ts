import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution} from '../lib/p5/scopePricing.ts';
import {PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import {EMPTY_CONFIGURATION,type EstimatorConfiguration} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
const date='2026-10-02T00:00:00Z';
const config:EstimatorConfiguration={...EMPTY_CONFIGURATION,planningCatalog:{version:PLANNING_MODEL_VERSION,source:'Synthetic test',authorizedBy:'Test only',importedAt:date,rates:[{code:'TEST-INSTALL',description:'Fixture install / replace, per fixture (labor)',type:'Labor',unit:'EA',amount:70,source:'Synthetic test',basis:'owner-average-cost'}]}};
function fixture(){
 const addition={code:'TEST-INSTALL',quantity:3,quantityEvidence:'3 owner-supplied fixtures to install'};
 const tasks=[{id:'install',description:'Install three owner-supplied fixtures',evidence:'Three fixtures',existingLineIds:[] as string[],additions:[{...addition}],researchDescription:'',issues:[]},
 {id:'remove',description:'Remove and dispose of three old fixtures',evidence:'Three old fixtures',existingLineIds:[] as string[],additions:[{...addition,quantityEvidence:'3 old fixtures; removal included in per-fixture installation labor'}],researchDescription:'',issues:[]}];
 return {tasks,issues:[],notes:[],replacements:[],removeExclusions:[]};
}
test('catalog resolution charges explicitly included supporting labor once while preserving both tasks',()=>{
 const mapping=fixture();const result=catalogResolution(mapping,config,[],new Date(date));
 assert.equal(result.rules.length,1);assert.equal(result.rules[0].quantity.fixed,3);assert.equal(result.rules[0].unitCost,70);
 assert.equal(mapping.tasks.length,2);assert.deepEqual(mapping.tasks[1].existingLineIds,[result.rules[0].id]);assert.deepEqual(mapping.tasks[1].additions,[]);assert.deepEqual(result.issues,[]);
 assert.match(result.assumptions.join(' '),/charged once/);
 // Re-evaluating normalized mapping must retain coverage, not resurrect the charge.
 const again=catalogResolution(mapping,config,[],new Date(date));assert.equal(again.rules.length,1);assert.deepEqual(again.issues,[]);
});
test('included-work reconciliation is operation-based, not tied to a fixture or catalog code',()=>{
 const mapping=fixture();mapping.tasks[0].description='Install three owner-supplied cabinets';mapping.tasks[1].description='Align three newly installed cabinets';mapping.tasks[1].additions[0].quantityEvidence='3 cabinets; alignment covered by installation labor';
 const result=catalogResolution(mapping,config,[],new Date(date));assert.equal(result.rules.length,1);assert.deepEqual(mapping.tasks[1].existingLineIds,['scope-1']);
});
for(const kind of ['missing evidence','uncertain evidence','negated evidence','separate work','different quantity','different place','ambiguous installation','materials','separate buildings'])test(`does not silently merge ${kind}`,()=>{
 const mapping=fixture();let configuration=structuredClone(config);let scope:ReviewedScope|undefined;
 if(kind==='missing evidence')mapping.tasks[1].additions[0].quantityEvidence='3 old fixtures';
 if(kind==='uncertain evidence')mapping.tasks[1].additions[0].quantityEvidence='Removal may be included in installation labor';
 if(kind==='negated evidence')mapping.tasks[1].additions[0].quantityEvidence='Removal not included in installation labor';
 if(kind==='separate work')mapping.tasks[1].description='Remove three additional old fixtures';
 if(kind==='different quantity')mapping.tasks[1].additions[0].quantity=2;
 if(kind==='different place')Object.assign(mapping.tasks[1].additions[0],{building:'Garage'});
 if(kind==='ambiguous installation')mapping.tasks.push({...structuredClone(mapping.tasks[0]),id:'install-other'});
 if(kind==='materials'){configuration.planningCatalog!.rates[0].type='Material';mapping.tasks[0].description='Install three fixtures';mapping.tasks[0].additions[0].quantityEvidence='3 fixtures to install';}
 if(kind==='separate buildings')scope={text:'Install three fixtures and remove three old fixtures',answers:{service:'handyman',location:'Nampa'},extraction:{summary:'Three fixtures',answers:{},questions:[],assumptions:[],instructions:{...emptyInstructions(),separateBuildings:true}} as any,uploads:[],reviewedAt:date,corrections:[]};
 const result=catalogResolution(mapping,configuration,[],new Date(date),scope);
 assert.equal(mapping.tasks[1].additions.length,1);assert.deepEqual(mapping.tasks[1].existingLineIds,[]);assert.ok(result.rules.length>=2);
});
