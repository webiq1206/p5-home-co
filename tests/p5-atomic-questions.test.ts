import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {atomicInstructionQuestions,textBenchTopChoices} from '../lib/p5/atomicQuestions.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const scope:ScopeExtraction={summary:'Choose one bench top: butcher block 5 hours, painted MDF/wood 4 hours, laminate 2 hours, quartz 5 hours.',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:['Confirm cabinet base linear footage, room(s), and chosen bench top option.']}};
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
