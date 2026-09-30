import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {emptyInstructions,mergeInstructions} from '../lib/p5/instructions.ts';
import {dynamicScopeFields} from '../lib/p5/dynamicQuestions.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const extraction=(extra:Partial<ScopeExtraction>={}):ScopeExtraction=>({summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],...extra});

test('live component kitchen intake asks requested quantities and respects retained room finishes',()=>{
 const source='Remodel my Boise kitchen with new cabinets and quartz counters, a backsplash and one sink and faucet. Retain appliances and flooring. No electrical upgrades.';
 const fields=dynamicScopeFields({service:'kitchen'},null,[],source);
 for(const field of ['cabinetBaseLf','cabinetUpperLf','cabinetTallLf','countertopSqft','tileSqft'])assert.ok(fields.includes(field as any),field);
 assert.ok(!fields.includes('sqft'));assert.ok(!fields.includes('flooringSqft'));
 const answered=dynamicScopeFields({service:'kitchen',cabinetBaseLf:'18',cabinetUpperLf:'12',cabinetTallLf:'0',countertopSqft:'45',tileSqft:'30'},null,[],source);
 assert.equal(answered.length,0);
});

test('live new-home intake binds repeated project questions to one answer and preserves conditional context',()=>{
 const x=extraction({instructions:{...emptyInstructions(),questions:[
  'What is the total conditioned living area of the new home (excluding garage and covered outdoor spaces)?',
  'How many stories will the new home have?','How many bathrooms are included in the new home?',
  'Will a garage be included in the new home? If so, what is its area in square feet?',
  'What finish level do you want for the new home?'
 ]},clarifications:[{field:'sqft',question:'About how many square feet of living space are included?',reason:'Area'},{field:'finish',question:'What finish level do you want for the new home?',reason:'Selection'}]});
 const questions=scopeQuestions({service:'new-construction'},x,[],[],[],'Build a new home in Boise.');
 for(const field of ['sqft','finish','stories','bathrooms','garageIncluded'])assert.equal(questions.filter(q=>q.field===field).length,1,field);
 assert.ok(!questions.some(q=>/^if so/i.test(q.reason)));
 assert.ok(!questions.some(q=>q.field==='estimatingInstructions'));
 const answered=scopeQuestions({service:'new-construction',sqft:'2000',finish:'mid-range',stories:'1',bathrooms:'2',garageIncluded:'no'},x,[],[],[],'Build a new home in Boise.');
 assert.equal(answered.length,0,'answered facts must not reappear under instruction wording');
});

test('live cabinet clarification uses separate numeric controls and keeps the remaining runs after one answer',()=>{
 const x=extraction({clarifications:[{field:'cabinetBaseLf',question:'What are the total linear feet for the base, upper, and any tall kitchen cabinets to be supplied?',reason:'Quantities are missing.'}]});
 const source='Supply painted shaker kitchen cabinets only. Owner collects and installs. No countertops.';
 const answers={service:'cabinet-product',cabinetRoom:'kitchen',cabinetConstruction:'painted shaker',exclusions:'countertops'};
 const first=scopeQuestions(answers,x,[],[],[],source);
 assert.deepEqual(first.map(q=>q.field),['cabinetBaseLf','cabinetUpperLf','cabinetTallLf']);
 const next=scopeQuestions({...answers,cabinetBaseLf:'12'},x,[],[],[],source);
 assert.deepEqual(next.map(q=>q.field),['cabinetUpperLf','cabinetTallLf']);
 assert.equal(scopeQuestions({...answers,cabinetBaseLf:'12',cabinetUpperLf:'8',cabinetTallLf:'0'},x,[],[],[],source).length,0);
});

test('live RE10 repair asks the patch dimensions rather than the whole-project area',()=>{
 const x=extraction({instructions:{...emptyInstructions(),questions:['How many GFCI outlets need replacement?','What is the approximate size and location of the drywall hole to patch?']}});
 const source='Replace GFCI outlets and a leaking sink P-trap, and patch a drywall hole. No new circuits, new sink or whole-room painting.';
 const questions=scopeQuestions({service:'re10'},x,[],[],['sqft'],source);
 assert.equal(questions.length,2);assert.ok(!questions.some(q=>q.field==='sqft'));
 assert.ok(questions.some(q=>/size and location/.test(q.reason)));
});

test('an unspecified fixture placeholder cannot be offered as a meaningful confirmed answer',()=>{
 const x=extraction({facts:[{field:'fixtures',value:'Replace bathroom fixtures (type/quantity not specified)',confidence:.6,source:'typed scope',evidence:'Replace fixtures',basis:'stated'}],clarifications:[{field:'fixtures',question:'Which fixtures are being replaced?',reason:'Missing count and type'}]});
 const q=scopeQuestions({service:'bathroom'},x,[],[],[],'Replace bathroom fixtures.').find(q=>q.field==='fixtures');
 assert.equal(q?.reason,'Which fixtures are being replaced, and how many of each?');assert.equal(q?.values,undefined);
});

test('live 32-page cross-reference directions never become conflicting purchases',()=>{
 const directions=['Preserve the final-sheet exclusions.','Do not multiply work from repeated cross-references.'];
 const merged=mergeInstructions([{...emptyInstructions(),inclusions:[...directions,'Roof replacement'],exclusions:[...directions,'Roof replacement']}]);
 assert.deepEqual(merged.responsibilities,directions);
 assert.deepEqual(merged.questions,['Confirm whether to include or exclude Roof replacement.']);
 const x=extraction({instructions:{...emptyInstructions(),questions:directions.map(t=>'Confirm whether to include or exclude '+t)}});
 const q=scopeQuestions({service:'new-construction',sqft:'2000',garageIncluded:'no',finish:'mid-range'},x,[],[],[],'Build a complete new home.');
 assert.equal(q.length,0);
});
