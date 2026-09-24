import test from 'node:test';
import assert from 'node:assert/strict';
import {retainExplicitSelections} from '../lib/p5/explicitSelections.ts';
import {dynamicScopeFields,questionContext,scopeFieldApplies,scopePromptApplies} from '../lib/p5/dynamicQuestions.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {mergeScopeFacts,type ScopeExtraction} from '../lib/p5/scope.ts';

const empty:ScopeExtraction={summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[]};
const remodel='Kitchen remodel in Nampa. Supply and install 24 linear feet of new painted shaker cabinets and 45 square feet of quartz countertops. Cabinet removal has already been completed. Existing layout stays. Exclude plumbing, electrical, flooring and appliances.';
test('measured cabinets and counters do not need whole-room area, even with a kitchen service label',()=>{
 const a={service:'kitchen',taskList:remodel,cabinetBaseLf:'24',countertopSqft:'45'};
 const context=questionContext(a,null,remodel);
 assert.equal(context.fullProject,false);
 assert.equal(scopeFieldApplies('sqft',context),false);
 assert.equal(scopePromptApplies('sqft','How large is the room?',context),false);
 assert.deepEqual(dynamicScopeFields(a,null,['sqft','finish','flooringSqft','countertopSqft'],remodel),[]);
});
test('broad kitchen remodels and added wall painting retain area questions',()=>{
 for(const taskList of ['Complete kitchen remodel','Replace cabinets, countertops and flooring',remodel+' Paint the kitchen walls.']){
  assert.ok(dynamicScopeFields({service:'kitchen',taskList}).includes('sqft'),taskList);
 }
});
test('new build standard finishes are retained when omitted by the provider',()=>{
 const text='Build a new 2400 square foot single-story home with a 600 square foot attached garage in Nampa. Three bedrooms, two bathrooms, flat lot, city water and sewer, standard builder-grade new finishes. Include complete construction.';
 const x=retainExplicitSelections(empty,text);
 const a=mergeScopeFacts({service:'new-construction',sqft:'2400',garageIncluded:'yes',garageSqft:'600',taskList:text},x).answers;
 assert.equal(a.finish,'mid-range');
 assert.deepEqual(scopeQuestions(a,x,[],[],[],text),[]);
});
test('finish recovery never converts unrelated, negated or ambiguous words into a selection',()=>{
 for(const text of ['Custom home with standard hardware','Do not use standard finishes','Premium or standard finishes?','Either standard finishes or premium finishes','Standard finishes in the bath; premium finishes in the kitchen','Maybe standard finishes','Builder-grade cabinets are excluded']){
  assert.equal(retainExplicitSelections(empty,text).facts.length,0,text);
 }
 assert.equal(retainExplicitSelections(empty,'Premium finishes', {finish:'mid-range'}).facts.length,0);
 const conflict={...empty,conflicts:[{field:'finish' as const,values:['mid-range','high-end'],explanation:'Unresolved scope'}]};
 assert.equal(retainExplicitSelections(conflict,'Standard finishes').facts.length,0);
});
test('measured labor-only trim is recognized without another project type or room area question',()=>{
 const text='Labor only in Nampa: install and paint 120 linear feet of baseboard trim. Owner supplies all trim, paint and materials. No wall painting, flooring or other work.';
 const x=retainExplicitSelections(empty,text);
 const a=mergeScopeFacts({taskList:text,trimLf:'120'},x).answers;
 assert.equal(a.service,'handyman');
 assert.equal(questionContext(a,x,text).laborOnly,true);
 assert.deepEqual(scopeQuestions(a,x,[],[],[],text),[]);
 for(const suffix of [' New home construction.',' Part of a kitchen remodel.',' RE-10 inspection repairs.',' This is a change order.'])assert.equal(retainExplicitSelections(empty,text+suffix).facts.length,0);
});
test('owner-supplied measured baseboard retains explicit scope and skips only the redundant project-type question',()=>{
 const text='Install 100 linear feet of owner-supplied baseboard in Caldwell. Labor only. Exclude painting, plumbing and electrical.';
 const supplied:ScopeExtraction={...empty,
  facts:[{field:'trimLf',value:'100',source:'qa-scope.txt',evidence:'100 linear feet of owner-supplied baseboard',confidence:1,basis:'stated'}],
  instructions:{inclusions:['Install baseboard'],exclusions:['Painting','Plumbing','Electrical'],responsibilities:['Owner supplies baseboard'],buildings:[],floors:[],separateBuildings:false,laborOnly:true,materialsOnly:false,questions:[]}};
 const x=retainExplicitSelections(supplied,text),a=mergeScopeFacts({taskList:text},x).answers;
 assert.equal(a.service,'handyman');assert.equal(a.trimLf,'100');
 assert.deepEqual(x.instructions,supplied.instructions);
 assert.deepEqual(scopeQuestions(a,x,[],[],[],text),[]);
 for(const context of ['Kitchen remodel.','New construction.','RE-10 inspection repairs.','Rush emergency work.','This is a change order.']){
  assert.equal(retainExplicitSelections(supplied,`${text} ${context}`).facts.some(f=>f.field==='service'),false,context);
 }
});
test('painted shaker vanity specifications replace the generic finish tier without choosing box construction',()=>{
 const text='Supply and install one 48-inch-wide bathroom vanity cabinet in Nampa. Painted shaker cabinet, standard hardware. Existing vanity removal is already completed. Exclude countertop, sink, plumbing and electrical.';
 const a={service:'cabinet-product',taskList:text,cabinetRoom:'bathroom',cabinetBaseLf:'4'};
 const context=questionContext(a,null,text);
 assert.equal(scopeFieldApplies('finish',context),false);
 assert.deepEqual(dynamicScopeFields(a,null,['finish','cabinetBaseLf'],text),[]);
 assert.ok(dynamicScopeFields(a,{...empty,clarifications:[{field:'cabinetConstruction',question:'Plywood or particleboard boxes?',reason:'Different box costs'}]},[],text).includes('cabinetConstruction'));
});

test('provider response integration recovers supplied finish selections before returning extraction',async()=>{
 const keys=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_SCOPE_PROVIDER','P5_SCOPE_MODEL','P5_SCOPE_FAST_MODEL','P5_SCOPE_OPENAI_MODEL','P5_TEXT_RACE'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];
 process.env.OPENAI_API_KEY='synthetic-test';
 try{
  const {analyzeBatch}=await import('../lib/p5/extraction.ts');
  const request:typeof fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(empty)}]}]});
  const result=await analyzeBatch('Build a new home with standard finishes.',[],{},request,5000,Date.now()+5000);
  assert.equal(result.extraction.facts.find(f=>f.field==='finish')?.value,'mid-range');
 }finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});

test('dimensions and material specifications do not force another baseboard project-type question',()=>{
 const text='In Boise, install 100 linear feet of owner-supplied 3.25-inch primed MDF baseboard in one empty first-floor room. Labor only: measure, cut, attach, caulk and fill nail holes. Owner supplies baseboard; contractor supplies nails and caulk. No painting.';
 assert.equal(retainExplicitSelections(empty,text).facts.find(f=>f.field==='service')?.value,'handyman');
});
