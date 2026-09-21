import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExtraction,protectPricingFacts,mergeScopeFacts,type ScopeExtraction,type ScopeField} from '../lib/p5/scope.ts';
import {dynamicScopeFields,questionContext,scopeFieldApplies} from '../lib/p5/dynamicQuestions.ts';
import {scopeAssumptions,finishOptionsForService,deriveScopeAnswers} from '../lib/p5/adaptive.ts';
import {retainCompletedCabinetRemoval} from '../lib/p5/completedWork.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';

const empty:ScopeExtraction={summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[]};
function measurement(field:ScopeField,value:string,evidence:string){return {...empty,facts:[{field,value,evidence,source:'Written project scope',confidence:.98,basis:'calculated' as const}]};}

test('a stated 48-inch vanity survives validation and pricing protection without a repeat measurement question',()=>{
 const source='Install a new 48-inch vanity cabinet. Labor and installation only.';
 const x=protectPricingFacts(validateExtraction(measurement('cabinetBaseLf','4','48-inch vanity cabinet / 12 = 4 linear feet.')));
 assert.equal(x.facts.length,1);
 const answers=mergeScopeFacts({service:'bathroom',sqft:'100',taskList:source},x).answers;
 assert.equal(answers.cabinetBaseLf,'4');
 assert.ok(!dynamicScopeFields(answers,x,[],source).includes('cabinetBaseLf'));
 assert.ok(!scopeFieldApplies('finish',questionContext(answers,x,source)));
 assert.doesNotMatch(scopeAssumptions(answers,[],x,source).join(' '),/finish|material/i);
});
test('an explicitly counted pantry width is converted without treating cabinet count as linear feet',()=>{
 const evidence='Two tall pantry cabinets, each 24 inches wide. 2 * 24 / 12 = 4 linear feet.';
 const x=protectPricingFacts(validateExtraction(measurement('cabinetTallLf','4',evidence)));
 assert.equal(x.facts[0]?.value,'4');
 for(const [field,value,invalid] of [
  ['cabinetTallLf','2',evidence],
  ['cabinetUpperLf','4','48-inch vanity cabinet'],
  ['cabinetBaseLf','4','Vanity is 48 inches tall'],
  ['cabinetBaseLf','4','Assumed 48-inch vanity cabinet'],
  ['cabinetTallLf','4','Two tall cabinets; width not specified'],
  ['cabinetTallLf','2','Tall cabinets each 24 inches wide'],
  ['cabinetBaseLf','4','Two 48-inch vanity cabinets'],
  ['cabinetUpperLf','8','Two 48-inch upper cabinets'],
 ] as const)assert.equal(protectPricingFacts(validateExtraction(measurement(field,value,invalid))).facts.length,0,invalid);
 assert.equal(protectPricingFacts(validateExtraction(measurement('cabinetUpperLf','4','One 48-inch-wide upper cabinet'))).facts[0]?.value,'4');
 assert.equal(protectPricingFacts(validateExtraction(measurement('cabinetBaseLf','8','Two 48-inch vanity cabinets'))).facts[0]?.value,'8');
});
test('painted trim needs its linear footage, while painted walls still need area',()=>{
 const source='Install 200 linear feet of primed MDF baseboard. Include caulking and two coats of white paint. We supply trim and paint. Labor only.';
 const answers={service:'handyman',taskList:source,trimLf:'200'};
 assert.deepEqual(dynamicScopeFields(answers,null,[],source),[]);
 assert.ok(dynamicScopeFields({service:'handyman',taskList:'Paint the living room walls'}).includes('sqft'));
 assert.ok(!dynamicScopeFields({service:'handyman',taskList:'Paint existing wall cabinets'}).includes('sqft'));
});
test('specific cabinet construction and finish replace a generic finish tier',()=>{
 const answers={service:'cabinet-install',cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'12',cabinetTallLf:'4',cabinetConstruction:'Frameless plywood boxes, painted white Shaker doors, soft-close hinges and drawer slides'};
 assert.ok(!dynamicScopeFields(answers).includes('finish'));
 assert.ok(!scopeFieldApplies('finish',questionContext(answers)));
 assert.doesNotMatch(scopeAssumptions(answers,['finish']).join(' '),/finish/i);
 assert.ok(dynamicScopeFields({...answers,cabinetConstruction:'Frameless cabinets'}).includes('finish'));
 assert.ok(dynamicScopeFields({...answers,cabinetConstruction:''},{...empty,facts:[{field:'cabinetConstruction',value:answers.cabinetConstruction,confidence:.99,source:'photo.png',evidence:'Visual appearance',basis:'visual'}]}).includes('finish'));
});
// Changed on purpose 2026-09-20: Builder Grade is the price book's production-builder spec, so a
// new build or a stock-cabinet job keeps it rather than being pushed a tier higher.
test('every service keeps the Builder Grade tier the price book prices it at',()=>{
 for(const service of ['new-construction','addition','adu','cabinet-product','cabinet-install','kitchen']){
  assert.ok(finishOptionsForService(service).includes('refresh'));
  assert.equal(deriveScopeAnswers({service,finish:'refresh'}).finish,'refresh');
 }
});
test('already removed cabinets never acquire a new removal charge while other demolition is retained',()=>{
 const x:ScopeExtraction={...empty,summary:'Supply and install cabinets; removal of existing cabinets.',instructions:{...emptyInstructions(),inclusions:['Removal of existing cabinets','Remove wall tile']},facts:[
  {field:'installation',value:'Contractor supplies and installs new cabinets; removes existing cabinets.',source:'Typed scope',confidence:1,evidence:'Existing cabinets are removed.'},
  {field:'demolition',value:'Removal of existing cabinets; remove wall tile.',source:'Typed scope',confidence:1,evidence:'Remove wall tile. Existing cabinets are removed.'},
 ]};
 const safe=retainCompletedCabinetRemoval(x,'Supply and install new cabinets. Remove wall tile. Existing cabinets are removed.');
 assert.match(safe.facts.find(f=>f.field==='installation')!.value,/supplies and installs new cabinets/);
 assert.match(safe.facts.find(f=>f.field==='demolition')!.value,/remove wall tile/);
 assert.match(safe.facts.find(f=>f.field==='exclusions')!.value,/already complete and excluded/);
 assert.match(safe.summary,/already completed/);
 assert.match(x.summary,/removal of existing cabinets/,'original extraction remains unchanged');
 for(const source of ['Once existing cabinets are removed, install the replacements.','Existing cabinets are not removed.','Existing cabinets will be removed.','Remove the existing cabinets.','Existing cabinets are removed by our contractor.'])assert.equal(retainCompletedCabinetRemoval(x,source),x,source);
});
