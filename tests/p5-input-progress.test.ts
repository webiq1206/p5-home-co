import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analysisProgress} from '../lib/p5/analysisProgress.ts';
import {combineScopeExtractions,type ScopeExtraction} from '../lib/p5/scope.ts';
import {analysisMessage,processingPresentation,type ProcessingStatus} from '../lib/p5/processingStatus.ts';
import {customerChoiceLabel,selectCustomerAnswer,contextualCustomerAnswer,exactCustomerChoice,customerQuestionKey} from '../lib/p5/customerAnswers.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {removeInstructionPrompt} from '../lib/p5/clarifications.ts';

test('text-only source sections are not described as documents',()=>{
  const result=analysisProgress([{},{result:{extraction:{}}}],[],false);
  assert.equal(result.message,'Read 1 of 2 scope sections.');
  assert.equal(result.totalPages,0);
});
test('all text analysis phases suppress stale document titles and page counters',()=>{
  for(const phase of ['preparing','instructions','reading','cross-referencing'] as const){
    const state:ProcessingStatus={phase,message:'Reading documents',totalPages:4,readPages:2,updatedAt:''};
    const view=processingPresentation('Reading your documents',state,null,false);
    assert.equal(view.total,0);assert.equal(view.read,0);
    assert.doesNotMatch(view.title+' '+view.detail,/documents|drawings|pages|files/i);
  }
  for(const event of ['start','busy','error','retry'] as const)assert.doesNotMatch(analysisMessage(false,event),/documents|files|pages/i);
});
test('text retry and initial legacy statuses never claim to read documents',()=>{
  assert.equal(processingPresentation('Reading your documents',null,null,false).title,'Understanding your project');
  const state:ProcessingStatus={phase:'retrying',message:'Reading your files',updatedAt:''};
  assert.doesNotMatch(JSON.stringify(processingPresentation('',state,null,false)),/reading.*files/i);
});
test('real document progress and upload progress retain actual counts',()=>{
  const state:ProcessingStatus={phase:'reading',inputKind:'documents',message:'Reading evidence',totalPages:4,readPages:2,updatedAt:''};
  assert.equal(processingPresentation('',state,null).total,4);
  assert.equal(processingPresentation('',state,null).read,2);
  assert.equal(processingPresentation('',state,30,true).title,'Saving your files');
  assert.equal(processingPresentation('',{...state,readPages:7},null,true).read,4);
});
test('quick selections preserve custom details and replace only the prior selection',()=>{
  const choices=["I'll supply all of them",'Please include all of them'];
  assert.equal(selectCustomerAnswer(choices[0],'',choices),choices[0]);
  assert.equal(selectCustomerAnswer(choices[1],choices[0],choices),choices[1]);
  assert.equal(selectCustomerAnswer(choices[1],'I have three doors.',choices),choices[1]+'\nI have three doors.');
  assert.equal(selectCustomerAnswer(choices[0],choices[1]+'\nI have three doors.',choices),choices[0]+'\nI have three doors.');
  assert.equal(selectCustomerAnswer(choices[0],choices[0]+'\nI have three doors.',choices),choices[0]+'\nI have three doors.');
});
test('choice plus detail, negation and uncertainty cannot collapse into a preset',()=>{
  const options=['standard','priority','emergency'];
  for(const answer of ['Standard\nBut next Friday only','Not an emergency',"I'm not sure if standard is enough",'Standard, except for the urgent leak']){
    assert.equal(exactCustomerChoice(answer,options),null,answer);
  }
  assert.equal(exactCustomerChoice(' Standard ',options),'standard');
  assert.equal(exactCustomerChoice('Please include labor only',['Labor only'],customerChoiceLabel),'Labor only');
  assert.equal(exactCustomerChoice('Please include labor only\nSupply one door too',['Labor only'],customerChoiceLabel),null);
});
test('unfinished answers are scoped to the exact question including ordinary fields',()=>{
  const door={field:'ownerSupplied',reason:'Who supplies the doors?'};
  const trim={field:'ownerSupplied',reason:'Who supplies the baseboard?'};
  assert.equal(customerQuestionKey(door),customerQuestionKey({...door}));
  assert.notEqual(customerQuestionKey(door),customerQuestionKey(trim));
  assert.equal(customerQuestionKey({...door,instructionId:'retained-id'}),'retained-id');
  assert.equal(customerQuestionKey(null),undefined);
});
test('customer wording preserves who is responsible and retains the question for typed details',()=>{
  assert.equal(customerChoiceLabel('Owner handles installation'),"I'll arrange installation");
  assert.equal(customerChoiceLabel('Labor only'),'Please include labor only');
  assert.equal(contextualCustomerAnswer('Who supplies the doors?','I have three.'),'Question: Who supplies the doors?\nMy answer: I have three.');
  const extraction:ScopeExtraction={summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{inclusions:['Install four doors'],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:['Who will supply the doors?']}};
  assert.deepEqual(instructionPrompts(extraction,{service:'handyman',taskList:'Install four doors'})[0].values,["I'll supply all of them",'Please include all of them',"I'll supply some of them","I'm not sure yet"]);
});
test('answer chips do not submit prematurely and short custom answers are not rejected by length',()=>{
  const source=readFileSync(new URL('../components/P5Estimator.tsx',import.meta.url),'utf8');
  const handler=source.split('const choose=')[1].split('const skipQuestion=')[0];
  assert.doesNotMatch(handler,/advance\(|logExchange\(/);
  assert.match(handler,/selectCustomerAnswer/);
  assert.ok(!source.includes('if(text.length>40||filesRef.current.length)'));
});
test('initial analysis is input-aware before the first status poll',()=>{
  const source=readFileSync(new URL('../components/P5Estimator.tsx',import.meta.url),'utf8');
  assert.ok(!source.includes("setBusy('Reading your documents and project details...')"));
});
test('different questions sharing a field survive the page merge',()=>{
  const part=(question:string):ScopeExtraction=>({summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[{field:'otherDetails',question,reason:'Affects scope'}]});
  const merged=combineScopeExtractions([part('What sizes are the doors?'),part('Should we remove the old baseboard?'),part('What sizes are the doors?')]);
  const answers={service:'handyman',taskList:'Install doors and baseboard',trimLf:'120'};
  const prompts=instructionPrompts(merged,answers);
  assert.deepEqual(prompts.map(q=>q.question),['What sizes are the doors?','Should we remove the old baseboard?']);
  assert.equal(new Set(prompts.map(q=>q.id)).size,2);
  assert.equal(scopeQuestions(answers,merged).filter(q=>q.instructionId).length,2);
  const resolved={...merged,instructions:removeInstructionPrompt(merged.instructions!,prompts[0].id)};
  assert.deepEqual(instructionPrompts(resolved,answers).map(q=>q.id),[prompts[1].id]);
});

// Live 2026-09-23: through a whole revision wait the customer saw neither the ETA nor the
// stay-or-email choice. Both hang off operationKind, which was recognised by comparing `busy` to two
// exact strings - but `busy` is replaced by whatever the server last reported ("Recovering an
// interrupted step", "Your scope is queued for pricing"), so the match almost always failed.
test('the running operation declares its kind instead of it being guessed from the progress message',()=>{
  const source=readFileSync(new URL('../components/P5Estimator.tsx',import.meta.url),'utf8');
  const line=source.split('\n').find(l=>l.includes('const operationKind='))||'';
  assert.ok(line,'operationKind is still computed somewhere');
  assert.doesNotMatch(line,/\bbusy\s*===/,'the kind must not be recovered by matching the progress message');
  assert.match(line,/runKind/,'it comes from the kind the caller declared');
  // run(label,operation,kind) is the single place a background operation announces itself.
  assert.match(source,/setRunKind\(kind\)/,'the declared kind is recorded when the operation starts');
  assert.match(source,/setRunKind\(null\)/,'and cleared when it ends');
  // Both surfaces must still gate the choice on a pricing run, never show it while reading.
  assert.equal(source.split(/operationKind==='pricing'\?waitChoice:null/).length-1,1,'the active card offers the choice while pricing');
  assert.equal(source.split(/paused\.kind==='pricing'\?waitChoice:null/).length-1,1,'so does the resumed card');
});
