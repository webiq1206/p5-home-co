import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {tsImport} from 'tsx/esm/api';
import {pathToFileURL} from 'node:url';
const resolver=()=>tsImport('../lib/p5/clarificationAnswer.ts',pathToFileURL(`${process.cwd()}/tests/p5-clarifications.test.ts`).href) as Promise<typeof import('../lib/p5/clarificationAnswer.ts')>;
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
test('invalid or stale clarification cannot replace the server extraction',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  await assert.rejects(resolveInstructionAnswer(scope(),{},{id:'forged',answer:'yes'}),/question has changed/);
  await assert.rejects(resolveInstructionAnswer(scope(),{},{id:'x',answer:''}),/Enter an answer/);
});
