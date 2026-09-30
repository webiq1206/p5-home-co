import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConsumableCoverage} from '../lib/p5/consumableCoverage.ts';
import {researchTaskBatches,openAiPricingRequestEnvelope,CONSUMABLE_COVERAGE} from '../lib/p5/scopePricing.ts';
const supplies=()=>({id:'supplies',description:'Supply contractor installation consumables',evidence:'Include installation supplies.',researchDescription:'Material purchase only: installation supplies',existingLineIds:[],additions:[],issues:[]});
const vanity={...supplies(),id:'vanity',description:'Install one 30-inch vanity in the existing bathroom.',evidence:'One 30-inch vanity',researchDescription:''};
const tile={id:'tile-setting',description:'Tile setting materials: thinset, grout and trim',quantity:144,unit:'SF',unitCost:4,category:'materials'};
const caulk={id:'sealant',description:'Silicone caulk for perimeter sealing at vanity and shower',quantity:2,unit:'tube',unitCost:10,category:'materials'};
const covered=(line=tile)=>({lineId:line.id,excerpt:line.description,reason:'Full requested installation area included.'});
const remaining={material:'Cabinet mounting screws',application:'Mount the one 30-inch vanity to wall framing.',operationTaskId:'vanity',operationEvidence:vanity.description,quantityEvidence:'ALLOWANCE: four screws at two attachment points; verify substrate.'};
const plan=(coveredItems=[covered()],remainingItems=[remaining])=>({tasks:[{id:'supplies',covered:coveredItems,remaining:remainingItems}]});

test('the real coverage provider request requires material decisions, never an audit response',()=>{
 const request=openAiPricingRequestEnvelope(CONSUMABLE_COVERAGE,{gaps:[supplies()],operations:[vanity],pricedComponents:[tile]},false);
 const format=(request.body as any).text.format;
 assert.equal(format.strict,true);
 assert.deepEqual(format.schema.required,['tasks']);
 const decision=format.schema.properties.tasks.items;
 assert.deepEqual(decision.required,['id','covered','remaining']);
 assert.deepEqual(decision.properties.covered.items.required,['lineId','excerpt','reason']);
 assert.deepEqual(decision.properties.remaining.items.required,['material','application','operationTaskId','operationEvidence','quantityEvidence']);
 assert.equal(format.schema.properties.coveredTaskIds,undefined);
});

test('already priced tile setting is linked once while actual vanity supplies retain their application',()=>{
 const task=supplies();const out=applyConsumableCoverage(plan(),[task],[task,vanity],[tile]);
 assert.deepEqual(task.existingLineIds,['tile-setting']);assert.equal(out.length,1);
 assert.match(out[0].researchDescription,/Mount the one 30-inch vanity/);
 assert.doesNotMatch(out[0].researchDescription,/thinset|grout/);
 const scope={text:'Install one vanity. Include installation supplies.',answers:{service:'bathroom'},extraction:null,uploads:[],reviewedAt:'2026-09-30',corrections:[]};
 const research=researchTaskBatches(out,scope).flat();
 assert.equal(research.length,1);assert.match(research[0].researchDescription,/four screws at two attachment points/);
 assert.equal(task.description,'Supply contractor installation consumables');
});
test('fully covered named materials leave research, retaining positive coverage for the independent audit',()=>{
 const task={...supplies(),researchDescription:'Material purchase only: thinset, grout and sealant'};
 assert.deepEqual(applyConsumableCoverage(plan([covered(),covered(caulk)],[]),[task],[task,vanity],[tile,caulk]),[]);
 assert.deepEqual(task.existingLineIds,['tile-setting','sealant']);assert.equal(task.researchDescription,'');
});
test('invalid coverage, absent operations and reusable tools never erase an unresolved supply gap',()=>{
 const bad=[plan([{...covered(),lineId:'nonexistent'}],[]),plan([{...covered(),excerpt:'Thinset and grout all included: invented'}],[]),plan([],[]),plan([], [{...remaining,operationTaskId:'invented'}]),plan([], [{...remaining,material:'Grout application bag'}])];
 for(const value of bad){const task=supplies();assert.throws(()=>applyConsumableCoverage(value,[task],[task,vanity],[tile]));assert.deepEqual(task,supplies());}
 assert.throws(()=>applyConsumableCoverage(plan([covered()],[]),[{...supplies(),researchDescription:'Supply shims and thinset',evidence:'Include shims and thinset.'}],[vanity],[tile]),/Named consumable disappeared/);
 assert.throws(()=>applyConsumableCoverage(plan([covered()],[]),[supplies()],[vanity],[{...tile,quantity:0}]),/Unsupported/);
 const exclusion={...tile,description:'Tile labor only; installation materials excluded'};
 assert.throws(()=>applyConsumableCoverage(plan([covered(exclusion)],[]),[supplies()],[vanity],[exclusion]),/exclusion/);
});
test('a partial invalid response does not mutate earlier accepted parent references',()=>{
 const first=supplies(),second={...supplies(),id:'other'};
 const value=plan();value.tasks.push({...value.tasks[0],id:'other',covered:[{...covered(),lineId:'missing'}]});
 assert.throws(()=>applyConsumableCoverage(value,[first,second],[vanity],[tile]));assert.deepEqual(first,supplies());
});
