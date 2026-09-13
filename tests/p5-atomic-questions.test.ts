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
