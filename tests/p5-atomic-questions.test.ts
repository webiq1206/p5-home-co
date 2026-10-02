import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts,answeredScopeQuestion} from '../lib/p5/clarifications.ts';
import {atomicInstructionQuestions,textBenchTopChoices,projectQuestionField} from '../lib/p5/atomicQuestions.ts';
test('conditioned-area and project-type paraphrases bind to existing answers',()=>{
 assert.equal(projectQuestionField('What is the total conditioned area in square feet?',{service:'addition'}),'sqft');
 assert.equal(projectQuestionField('What is the total conditioned living space area?',{service:'adu'}),'sqft');
 assert.equal(projectQuestionField('Is this project an addition, new construction, or remodel?',{service:'addition'}),'service');
 assert.equal(projectQuestionField('What is the total conditioned area of the existing house?',{service:'addition'}),undefined);
 assert.equal(projectQuestionField('Is this project an addition or remodel, or a combination of both?',{service:'addition'}),undefined);
});
import type {ScopeExtraction} from '../lib/p5/scope.ts';
test('internal pricing methodology is not a customer scope decision',()=>{
 assert.equal(answeredScopeQuestion('Should this re-estimate use the labeled unit prices as internal reference rates, or develop independent contractor labor and material costs from first principles?',{}),true);
 assert.equal(answeredScopeQuestion('Should the countertop use quartz or laminate?',{}),false);
});
test('concrete finish choices belong to materials, not budget tiers',()=>{
 assert.equal(projectQuestionField('What concrete finish is requested: broom, smooth or stamped?',{service:'remodel'}),'materials');
 assert.equal(projectQuestionField('What finish level should we budget for?',{service:'addition'}),'finish');
});
const scope:ScopeExtraction={summary:'Choose one bench top: butcher block 5 hours, painted MDF/wood 4 hours, laminate 2 hours, quartz 5 hours.',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:['Confirm cabinet base linear footage, room(s), and chosen bench top option.']}};
test('a document cannot ask again for the confirmed total project area',()=>{
 const question='What is the total square footage of the new addition?';
 const extraction={...scope,instructions:{...scope.instructions!,questions:[question]}};
 assert.deepEqual(instructionPrompts(extraction,{service:'addition',sqft:'200'}),[]);
 assert.equal(instructionPrompts(extraction,{service:'addition'})[0].field,'sqft','a missing area uses the normal numeric field');
 const conflicted={...extraction,conflicts:[{field:'sqft' as const,values:['200','240'],explanation:'Conflicting stated project areas'}]};
 assert.equal(instructionPrompts(conflicted,{service:'addition',sqft:'200'}).length,1,'a genuine conflict still needs a decision');
 for(const text of ['What is the total square footage of the existing house?','What is the total roof area of the addition?','What is the total square footage of the garage?']){
  assert.equal(instructionPrompts({...extraction,instructions:{...extraction.instructions,questions:[text]}},{service:'addition',sqft:'200'}).length,1,'project area does not answer a component measurement');
 }
});
test('a bundled request becomes separate clear questions with evidence-based options',()=>{
 const questions=instructionPrompts(scope,{});
 assert.deepEqual(questions.map(q=>q.question),['How many linear feet of base cabinets are included?','Which rooms are the cabinets for?','Which bench top option would you like?']);
 assert.deepEqual(questions[2].values,['Butcher block','Matching painted MDF/wood','Laminate','Quartz']);
});
test('atomic questions skip known fields while a list of alternatives stays one decision',()=>{
 assert.deepEqual(atomicInstructionQuestions(scope.instructions!.questions[0],{cabinetBaseLf:'20',cabinetRoom:'kitchen'}),['Which bench top option would you like?']);
 const question='Which bench top: butcher block, painted MDF/wood, laminate, or quartz?';
 assert.deepEqual(atomicInstructionQuestions(question),[question]);
});

test('mixed alternatives never become an incomplete list of material choices',()=>{
 const mixed={...scope,summary:'',takeoffs:[{description:'ALTERNATE: oak flooring',component:'flooring',issues:[]},{description:'ALTERNATE: butcher block bench top',component:'bench top',issues:[]},{description:'ALTERNATE: laminate bench top',component:'bench top',issues:[]}] as any};
 assert.equal(textBenchTopChoices(mixed,'Which bench top option should we use?'),undefined);
});

test('cabinet measurement questions save one field at a time and disappear once answered',async()=>{
 const {scopeQuestions}=await import('../lib/p5/adaptive.ts');
 const extraction={...scope,instructions:{...scope.instructions!,questions:['What are the cabinet lengths?','What is the cabinet room type?']}};
 const initial=scopeQuestions({service:'cabinet-install'},extraction);
 assert.equal(initial[0].field,'cabinetBaseLf');assert.equal(initial[0].instructionId,undefined);
 assert.equal(initial[0].reason,'How many linear feet of base cabinets are included?');
 const next=scopeQuestions({service:'cabinet-install',cabinetBaseLf:'20'},extraction);
 assert.equal(next[0].field,'cabinetUpperLf');assert.equal(next.some(question=>question.field==='cabinetBaseLf'),false);
 const answered=instructionPrompts(extraction,{cabinetBaseLf:'20',cabinetUpperLf:'8',cabinetTallLf:'0',cabinetRoom:'mudroom'});
 assert.equal(answered.length,0);
 assert.equal(atomicInstructionQuestions('Confirm cabinet lengths and chosen bench top option.').at(-1),'Which bench top option would you like?');
});
