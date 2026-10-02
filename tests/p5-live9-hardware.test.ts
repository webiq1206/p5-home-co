import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution,incompatibleDoorHardwareRemoval,normalizeConsumableMapping} from '../lib/p5/scopePricing.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {applyMinorWorkAllowance} from '../lib/p5/minorWorkAllowance.ts';
import {contractorConsumableIncluded} from '../lib/p5/contractorConsumables.ts';

const now=new Date('2026-10-01T12:00:00Z');
const scope:ReviewedScope={text:'Replace three owner-supplied door levers. Remove and dispose of old levers. Contractor provides labor and consumables.',answers:{service:'handyman',location:'Nampa'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]};
const rates=[
 {code:'QA-DOOR',description:'Door removal. Includes haul-off',type:'Labor',unit:'EA',amount:80,source:'Synthetic fixture',basis:'owner-average-cost'},
 {code:'QA-HARDWARE',description:'Door hardware install / replace, per door (labor). Labor only; material priced separately',type:'Labor',unit:'EA',amount:75,source:'Synthetic fixture',basis:'owner-average-cost'},
];
const config={...EMPTY_CONFIGURATION,planningCatalog:{version:'qa',source:'synthetic',importedAt:now.toISOString(),rates}} as any;
const task=(id:string,description:string,code:string)=>({id,description,evidence:description,issues:[],existingLineIds:[],researchDescription:'',additions:[{code,quantity:3,quantityEvidence:'Three existing door levers'}]});
const mapping=(tasks:any[])=>({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]});

test('door hardware cannot use whole-door demolition, including existing-price references',()=>{
 const description='Remove and dispose of three existing interior passage door levers.';
 assert.equal(incompatibleDoorHardwareRemoval(description,rates[0].description),true);
 assert.equal(incompatibleDoorHardwareRemoval('Remove three doors.',rates[0].description),false);
 assert.equal(incompatibleDoorHardwareRemoval(description,rates[1].description),false);
 const m=mapping([task('remove',description,'QA-DOOR')]);
 const rejected=catalogResolution(m,config,[],now,scope);
 assert.equal(rejected.rules.length,0);
 assert.match(rejected.issues.join(' '),/whole-door removal/);
 const existing={id:'old',description:rates[0].description,category:'field-labor',quantity:3,unit:'EA',unitCost:80};
 const covered={...task('remove',description,'QA-DOOR'),additions:[],existingLineIds:['old']};
 assert.match(catalogResolution(mapping([covered]),config,[existing] as any,now,scope).issues.join(' '),/whole-door removal/);
 normalizeConsumableMapping(m,config,[],scope);
 assert.deepEqual(m.tasks[0].additions,[]);
 assert.match(m.tasks[0].researchDescription,/compatible hardware replacement/);
});

test('explicit labor-only replacement rate cannot erase requested generic consumables',()=>{
 const install=task('install','Replace three owner-supplied interior passage door levers.','QA-HARDWARE');
 const m=mapping([install]);
 normalizeConsumableMapping(m,config,[],scope);
 normalizeConsumableMapping(m,config,[],scope);
 assert.equal(m.tasks.filter(t=>t.id==='required-contractor-consumables').length,1);
 assert.deepEqual(m.tasks[0].additions,install.additions);
 assert.match(m.tasks[1].researchDescription,/Material purchase only/);
 const ownerOnly={...scope,text:'Replace three owner-supplied door levers. Owner supplies all installation parts and consumables.'};
 const ownerMap=mapping([structuredClone(install)]);
 normalizeConsumableMapping(ownerMap,config,[],ownerOnly);
 assert.equal(ownerMap.tasks.length,1);
});

test('combined installation wording retains labor and creates one separately covered consumables task',()=>{
 const description='Install three interior passage door levers on existing predrilled doors; remove and dispose of existing levers; contractor provides labor and installation consumables (fasteners, lubricant, shims as needed). Owner supplies three door levers.';
 const install=task('install',description,'QA-HARDWARE');
 const disposal={...task('disposal','Remove and dispose of three existing interior passage door levers and associated hardware.','QA-HARDWARE'),additions:[],researchDescription:'Task merged with installation; removal labor and disposal are ancillary to installation work.'};
 const m=mapping([install,disposal]);
 assert.equal(contractorConsumableIncluded(scope,description),false);
 normalizeConsumableMapping(m,config,[],scope);normalizeConsumableMapping(m,config,[],scope);
 assert.equal(m.tasks[0].additions[0].code,'QA-HARDWARE');
 assert.equal(m.tasks.filter(t=>t.id==='required-contractor-consumables').length,1);
 const r=catalogResolution(m,config,[],now,scope);applyMinorWorkAllowance(m.tasks,r,[],now);
 assert.equal(r.rules.filter(rule=>rule.category==='field-labor').length,1);
 assert.equal(r.rules.find(rule=>rule.category==='field-labor')?.quantity.fixed,3);
 assert.equal(r.rules.filter(rule=>rule.id==='minor-work-allowance').length,1);
 assert.ok(m.tasks.every(t=>!t.researchDescription));
 assert.ok(m.tasks.slice(1).every(t=>t.existingLineIds.includes('minor-work-allowance')));
 assert.deepEqual(r.issues,[]);
});

test('physical operation verbs cannot classify a combined task as a consumables purchase',()=>{
 for(const verb of ['Install','Replace','Repair','Remove','Perform installation','Provide replacement'])assert.equal(contractorConsumableIncluded(scope,`${verb} fixtures; contractor provides labor and consumables.`),false);
 assert.equal(contractorConsumableIncluded(scope,'Supply contractor installation consumables'),true);
 assert.equal(contractorConsumableIncluded(scope,'Installation consumables'),true);
 assert.equal(contractorConsumableIncluded(scope,'Install levers: Supply contractor installation consumables'),true,'a separately named material component remains eligible');
});
