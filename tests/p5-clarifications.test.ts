import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts,removeInstructionAnswerBlocks} from '../lib/p5/clarifications.ts';
import {require as tsxRequire} from 'tsx/cjs/api';
import {pathToFileURL} from 'node:url';
const resolver=()=>tsxRequire('../lib/p5/clarificationAnswer.ts',pathToFileURL(`${process.cwd()}/tests/p5-clarifications.test.ts`).href) as typeof import('../lib/p5/clarificationAnswer.ts');
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const scope=():ScopeExtraction=>({summary:'Trim scope',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],instructions:{...emptyInstructions(),inclusions:['Trim'],exclusions:['Plumbing'],questions:['Labor only or materials only?','Should we include or exclude painting?']},documentCoverage:{expectedPages:80,complete:true,pages:[]},takeoffs:[]});

test('legacy paragraphs become distinct, concise questions and exact duplicates collapse',()=>{
  const e=scope();e.instructions!.questions=['Labor only or materials only? Should we include or exclude painting?','Labor only or materials only?'];
  const q=instructionPrompts(e,{});assert.equal(q.length,2);assert.deepEqual(q[0].values,['Labor only','Materials only','Labor and materials']);assert.equal(q[1].question,'Should we include or exclude painting?');
});
test('legacy company-fit questions use the service picker instead of an instruction loop',()=>{
  const e=scope();e.instructions!.questions=['Does the submitted scope require residential remodel work?','Which of the following services does your requested estimate cover?'];
  const q=scopeQuestions({},e);assert.equal(q.some(q=>q.instructionId),false);assert.ok(q.find(q=>q.field==='service')?.values?.length);
  e.instructions!.questions=['Which of the following services does your estimate cover? Should we include or exclude painting?'];
  assert.deepEqual(instructionPrompts(e,{}).map(q=>q.question),['Should we include or exclude painting?']);
});
test('clarification updates instructions without sending documents or changing page coverage',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  process.env.OPENAI_API_KEY='synthetic';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const e=scope();const id=instructionPrompts(e,{})[0].id;let calls=0;
  const request:typeof fetch=async(_url,options)=>{
    calls++;const body=JSON.parse(String(options?.body));assert.equal(body.input[0].content.some((c:any)=>c.type==='input_file'||c.type==='input_image'),false);
    const output={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,laborOnly:true,questions:[]},pages:[],takeoffs:[]};
     return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  };
  try{
    const result=await resolveInstructionAnswer(e,{service:'handyman'},{id,answer:'Labor only'},[],request);
    assert.equal(calls,1);assert.equal(result.extraction?.documentCoverage,e.documentCoverage);assert.equal(result.extraction?.takeoffs,e.takeoffs);
    assert.deepEqual(result.extraction?.instructions?.exclusions,['Plumbing']);assert.equal(result.extraction?.instructions?.laborOnly,true);
    assert.deepEqual(instructionPrompts(result.extraction,result.answers).map(q=>q.question),['Should we include or exclude painting?']);
    const repeated=await resolveInstructionAnswer(result.extraction,result.answers,{id,answer:'Labor only'},result.history,request);
    assert.equal(calls,1);assert.equal(repeated.history.length,1);assert.match(result.answers.estimatingInstructions||'',/Answer: Labor only/);
  }finally{delete process.env.OPENAI_API_KEY;}
});
test('only the current first instruction prompt can be answered',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  const e=scope();const prompts=instructionPrompts(e,{});
  await assert.rejects(resolveInstructionAnswer(e,{},{
    id:prompts[1].id,answer:'Exclude it'
  }),/question has changed/);
});
test('a provider-retained answered prompt is removed without losing unrelated prompts',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  process.env.OPENAI_API_KEY='synthetic';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const e=scope();const prompts=instructionPrompts(e,{});let calls=0;
  const request:typeof fetch=async(_url,options)=>{
    calls++;const body=JSON.parse(String(options?.body));assert.equal(body.input[0].content.some((c:any)=>c.type==='input_file'||c.type==='input_image'),false);
    const output={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,questions:[e.instructions!.questions[0],e.instructions!.questions[1]]},pages:[],takeoffs:[]};
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  };
  try{
    const result=await resolveInstructionAnswer(e,{},{id:prompts[0].id,answer:'Labor only'},[],request);
    assert.equal(calls,1);
    assert.deepEqual(instructionPrompts(result.extraction,result.answers).map(q=>q.question),['Should we include or exclude painting?']);
  }finally{delete process.env.OPENAI_API_KEY;}
});
test('source clarification blocks can be removed without removing visitor scope notes',()=>{
  const history=[{id:'labor',question:'Labor only or materials only?',answer:'Labor only'}];
  assert.equal(removeInstructionAnswerBlocks('Keep first-floor trim.\n\nQuestion: Labor only or materials only?\nAnswer: Labor only',history),'Keep first-floor trim.');
});
test('invalid or stale clarification cannot replace the server extraction',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  await assert.rejects(resolveInstructionAnswer(scope(),{},{id:'forged',answer:'yes'}),/question has changed/);
  await assert.rejects(resolveInstructionAnswer(scope(),{},{id:'x',answer:''}),/Enter an answer/);
});
test('document alternatives become short options and selected cabinet labor reconciles to 14 hours',async()=>{
  const {resolveInstructionAnswer}=await resolver();process.env.OPENAI_API_KEY='synthetic';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const e=scope();e.instructions!.questions=['Should the bench top alternative be included, and if so which one (matching painted or butcher block)?'];
  const source=(page:number)=>[{source:'cabinet-estimate.pdf',page,sheet:`P${page}`,revision:''}];
  e.takeoffs=[
    {id:'base-assembly',description:'Base cabinet assembly',building:'Main',floor:'1',component:'assembly labor',quantity:2,unit:'hours',basis:'stated',evidence:'Base assembly 2 hours',sources:source(1),supersedes:[],issues:[]},
    {id:'installation',description:'Cabinet installation',building:'Main',floor:'1',component:'installation labor',quantity:8,unit:'hours',basis:'stated',evidence:'Installation 8 hours',sources:source(1),supersedes:[],issues:[]},
    {id:'painted-top',description:'Painted matching bench top',building:'Main',floor:'1',component:'painted top labor',quantity:4,unit:'hours',basis:'stated',evidence:'Painted top adds 4 hours',sources:source(2),supersedes:[],issues:['Selection required']},
    {id:'butcher-top',description:'Butcher block bench top',building:'Main',floor:'1',component:'butcher block top labor',quantity:5,unit:'hours',basis:'stated',evidence:'Butcher block option adds 5 hours',sources:source(2),supersedes:[],issues:['Selection required']},
  ];
  const prompt=instructionPrompts(e,{})[0];assert.deepEqual(prompt.values,['matching painted','butcher block']);
  const request:typeof fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,questions:[]},pages:[],takeoffs:[]})}]}]});
  try{
    const result=await resolveInstructionAnswer(e,{service:'cabinet-install'},{id:prompt.id,answer:'Matching painted bench top'},[],request);
    assert.equal(result.extraction?.facts.find(f=>f.field==='laborHours')?.value,'14');
    assert.equal(result.answers.laborHours,'14');
    assert.match(result.extraction?.takeoffs?.find(t=>t.id==='painted-top')?.issues.join(' ')||'',/Selected alternative/);
    assert.match(result.extraction?.takeoffs?.find(t=>t.id==='butcher-top')?.issues.join(' ')||'',/Unselected alternative/);
    assert.equal(result.extraction?.documentCoverage,e.documentCoverage);
    const manual=await resolveInstructionAnswer(e,{service:'cabinet-install',laborHours:'12'},{id:prompt.id,answer:'Matching painted bench top'},[],request);
    assert.equal(manual.answers.laborHours,'12');
  }finally{delete process.env.OPENAI_API_KEY;}
});
test('internal payload labels are removed from every visitor question surface',()=>{
  const e=scope();e.instructions!.questions=['Does previousAnswers include painting?'];
  e.clarifications=[{field:'materials',question:'Confirm savedProjectDetails and projectDescription materials.',reason:'Internal'}];
  const questions=scopeQuestions({service:'bathroom',sqft:'80',demolition:'Remove tile'},e,[],[],['materials']);
  assert.equal(questions.some(q=>/previousAnswers|savedProjectDetails|projectDescription/.test(`${q.reason} ${q.detail||''}`)),false);
});
