import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts,instructionPromptText,isResponsibilityPrompt,questionKey,removeInstructionPrompt} from '../lib/p5/clarifications.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {dynamicScopeFields} from '../lib/p5/dynamicQuestions.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import type {ScopeAnswers,ScopeExtraction} from '../lib/p5/scope.ts';
const extraction=(questions:string[]=[],extra:Partial<ScopeExtraction>={}):ScopeExtraction=>({summary:'QA scope',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],instructions:{...emptyInstructions(),questions},...extra});
const trim:ScopeAnswers={service:'handyman',taskList:'Install baseboard trim',trimLf:'200'};
const build:ScopeAnswers={service:'new-construction',taskList:'Complete new home',sqft:'2400',garageIncluded:'no'};

test('saving a follow-up retains the question instead of substituting its explanation',()=>{
 const original='Should we include or exclude painting? This affects the estimate.';
 const first=instructionPrompts(extraction([original]),trim)[0];
 assert.equal(first.question,'Should we include or exclude painting?');
 assert.equal(first.detail,'This affects the estimate.');
 assert.equal(instructionPromptText(first),original);
 const second=instructionPrompts(extraction([instructionPromptText(first)]),trim)[0];
 assert.equal(second.id,first.id);assert.equal(second.question,first.question);
});
test('explanatory text never hides an out-of-scope topic from relevance checks',()=>{
 const x=extraction(['What plumbing fixtures should be installed? This affects the estimate.']);
 const source='Price only baseboard trim.';
 assert.deepEqual(instructionPrompts(x,trim,source),[]);
 assert.deepEqual(scopeQuestions(trim,x,[],[],[],source),[]);
});
test('the queue and server sanitizer use the same source context',()=>{
 const x=extraction(['Which electrical panel should be installed? This affects cost.','What profile should the trim have? This changes the required material.']);
 const source='Price only trim.';
 const prompts=instructionPrompts(x,trim,source);
 const questions=scopeQuestions(trim,x,[],[],[],source);
 assert.equal(prompts.length,1);assert.match(prompts[0].question,/trim/);
 assert.deepEqual(questions.map(q=>q.instructionId),prompts.map(q=>q.id));
 assert.equal(questions[0].reason,prompts[0].question);
});
test('different questions with identical helper notes keep distinct stable identities',()=>{
 const x=extraction(['Which door should be replaced? This affects cost.','Which window should be replaced? This affects cost.']);
 const a={service:'handyman',taskList:'Replace a door and a window'};
 const prompts=instructionPrompts(x,a);
 assert.equal(prompts.length,2);assert.notEqual(prompts[0].id,prompts[1].id);
 assert.deepEqual(instructionPrompts(extraction(prompts.map(instructionPromptText)),a).map(q=>q.id),prompts.map(q=>q.id));
});
test('an answered question can be removed without reviving its helper text',()=>{
 const x=extraction(['Should we include or exclude painting? This affects the estimate.','Which door should be repaired?']);
 const [prompt]=instructionPrompts(x,{service:'handyman',taskList:'Repair a door and paint trim'});
 const cleaned=removeInstructionPrompt({...x.instructions!,questions:instructionPrompts(x,trim).map(instructionPromptText)},prompt.id);
 assert.equal(cleaned.questions.length,1);assert.match(cleaned.questions[0],/Which door/);
 assert.ok(!cleaned.questions.some(q=>questionKey(q)===prompt.id));
});
test('long questions retain complete source text behind concise UI formatting',()=>{
 const original=`For the existing access opening ${'described in the retained scope notes '.repeat(8)}which opening should be retained? Confirm before ordering.`;
 const prompt=instructionPrompts(extraction([original]),{service:'handyman',taskList:'Repair the existing opening'})[0];
 assert.equal(instructionPromptText(prompt),original);assert.ok(prompt.question.length<=240);
 assert.equal(questionKey(instructionPromptText(prompt)),prompt.id);
});
test('legacy prompt objects retain the question and separate helper note',()=>{
 assert.equal(instructionPromptText({id:'old',question:'Which door?',detail:'Confirm before ordering.'}),'Which door? Confirm before ordering.');
 assert.equal(instructionPromptText({id:'old',question:'Which door?'}),'Which door?');
});
test('scoped responsibility does not become a project-wide flag',()=>{
 const prompt=instructionPrompts(extraction(['For the kitchen, labor only or materials only? This affects pricing.']),{service:'whole-home',taskList:'Complete interior remodel'})[0];
 assert.equal(isResponsibilityPrompt(prompt),false);
});
test('invalid extracted quantities never suppress a required question',()=>{
 const x=extraction([],{facts:[{field:'trimLf',value:'two hundred-ish',source:'scope.pdf',evidence:'ambiguous',confidence:.99,basis:'stated'}]});
 assert.deepEqual(dynamicScopeFields({...trim,trimLf:''},x),['trimLf']);
});
test('non-finite confidence cannot suppress a required question',()=>{
 const x=extraction([],{facts:[{field:'trimLf',value:'200',source:'scope.pdf',evidence:'ambiguous',confidence:Infinity,basis:'stated'}]});
 assert.deepEqual(dynamicScopeFields({...trim,trimLf:''},x),['trimLf']);
});
test('conflicting source-only values remain unresolved without an explicit conflict record',()=>{
 const x=extraction([],{facts:[200,300].map(n=>({field:'trimLf' as const,value:String(n),source:`scope-${n}.pdf`,evidence:'stated length',confidence:.98,basis:'stated' as const}))});
 assert.deepEqual(dynamicScopeFields({...trim,trimLf:''},x),['trimLf']);
 assert.deepEqual(dynamicScopeFields(trim,x),[],'validated visitor corrections remain authoritative');
});
test('format-equivalent numeric facts do not create repeated questions',()=>{
 const x=extraction([],{facts:['200','200.0'].map(value=>({field:'trimLf' as const,value,source:'scope.pdf',evidence:'stated length',confidence:.98,basis:'stated' as const}))});
 assert.deepEqual(dynamicScopeFields({...trim,trimLf:''},x),[]);
});
test('inferred materials do not masquerade as specified selections',()=>{
 const x=extraction([],{facts:[{field:'materials',value:'Luxury materials',source:'photo.png',evidence:'Visual guess',confidence:.99,basis:'inferred'}]});
 assert.deepEqual(dynamicScopeFields(build,x),['finish']);
});
test('visual and inferred quantities are never factual one-click answers',()=>{
 for(const basis of ['visual','inferred'] as const){
  const x=extraction([],{facts:[{field:'trimLf',value:'200',source:'photo.png',evidence:'Unscaled visual estimate',confidence:.65,basis}]});
  const q=scopeQuestions({...trim,trimLf:''},x);
  assert.equal(q.length,1);assert.equal(q[0].field,'trimLf');assert.equal(q[0].values,undefined);
 }
});
test('question selection does not mutate retained project evidence',()=>{
 const x=extraction(['Which trim profile? This affects price.']);const a={...trim};const before=JSON.stringify({a,x});
 scopeQuestions(a,x,[],[],[],'Price only trim');assert.equal(JSON.stringify({a,x}),before);
});


test('classification: source service survives an unsupported website brand',async()=>{
 const {EXTRACTION_SYSTEM}=await import('../lib/p5/extraction.ts');
 assert.match(EXTRACTION_SYSTEM,/Classify the actual requested work using the complete service field vocabulary/);
 assert.doesNotMatch(EXTRACTION_SYSTEM,/select service only for the requested work that this company offers/);
 assert.match(EXTRACTION_SYSTEM,/requested subset controls/);
 assert.match(EXTRACTION_SYSTEM,/exclusions, negated alternatives/);
});
test('classification: follow-ups require a real project-specific pricing gap',async()=>{
 const {EXTRACTION_SYSTEM}=await import('../lib/p5/extraction.ts');
 assert.match(EXTRACTION_SYSTEM,/QUESTION NECESSITY:/);
 assert.match(EXTRACTION_SYSTEM,/Do not generate a checklist from the service name/);
 assert.match(EXTRACTION_SYSTEM,/not missing customer facts/);
});
test('classification: stale remodel refresh answers are replaced with build-appropriate choices',async()=>{
 const {deriveScopeAnswers}=await import('../lib/p5/adaptive.ts');
 const previous={...build,finish:'refresh'};
 assert.equal(deriveScopeAnswers(previous).finish,undefined);
 const q=scopeQuestions(previous,null);
 assert.equal(q.length,1);assert.equal(q[0].field,'finish');
 assert.ok(!q[0].values?.includes('refresh'));
 assert.equal(previous.finish,'refresh','the source snapshot remains unchanged');
});
