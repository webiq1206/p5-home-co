import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
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
test('ambiguous responsibility clarification retains provider and document protections',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  process.env.OPENAI_API_KEY='synthetic';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const e=scope();const id=instructionPrompts(e,{})[0].id;let calls=0;
  const request:typeof fetch=async(_url,options)=>{
    calls++;const body=JSON.parse(String(options?.body));assert.equal(body.input[0].content.some((c:any)=>c.type==='input_file'||c.type==='input_image'),false);
    const output={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,laborOnly:true,questions:[]},pages:[],takeoffs:[]};
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  };
  try{
    const answer='Labor only, but owner supplies materials for paint';
    const result=await resolveInstructionAnswer(e,{service:'handyman'},{id,answer},[],request);
    assert.equal(calls,1);assert.equal(result.extraction?.documentCoverage,e.documentCoverage);assert.equal(result.extraction?.takeoffs,e.takeoffs);
    assert.deepEqual(result.extraction?.instructions?.exclusions,['Plumbing']);assert.equal(result.extraction?.instructions?.laborOnly,true);
    assert.deepEqual(instructionPrompts(result.extraction,result.answers).map(q=>q.question),['Should we include or exclude painting?']);
    const repeated=await resolveInstructionAnswer(result.extraction,result.answers,{id,answer},result.history,request);
    assert.equal(calls,1);assert.equal(repeated.history.length,1);assert.match(result.answers.estimatingInstructions||'',/Answer: Labor only/);
  }finally{delete process.env.OPENAI_API_KEY;}
});
test('exact responsibility choices resolve locally, preserve evidence and retry idempotently',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  try{
    for(const answer of ['Labor only','Materials only','Labor and materials']){
      const e=scope();
      e.facts=[{field:'sqft',value:'80',confidence:.99,source:'scope.pdf',evidence:'80 square feet',basis:'stated'}];
      const pages=e.documentCoverage,takeoffs=e.takeoffs,facts=e.facts;
      const id=instructionPrompts(e,{})[0].id;let calls=0;
      const request:typeof fetch=async()=>{calls++;throw new Error('A constrained choice must not call a provider.');};
      const result=await resolveInstructionAnswer(e,{service:'handyman'},{id,answer},[],request);
      assert.equal(calls,0);
      assert.equal(result.extraction?.documentCoverage,pages);
      assert.equal(result.extraction?.takeoffs,takeoffs);
      assert.deepEqual(result.extraction?.facts,facts);
      assert.equal(result.extraction?.instructions?.laborOnly,answer==='Labor only');
      assert.equal(result.extraction?.instructions?.materialsOnly,answer==='Materials only');
      assert.deepEqual(instructionPrompts(result.extraction,result.answers).map(q=>q.question),['Should we include or exclude painting?']);
      const retried=await resolveInstructionAnswer(result.extraction,result.answers,{id,answer},result.history,request);
      assert.equal(calls,0);
      assert.deepEqual(retried,result);
    }
  }finally{
    for(const key of keys){
      if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    }
  }
});
test('explicit project-wide responsibility wording remains locally constrained',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  try{
    const e=scope();e.instructions!.questions=['For the entire project, choose Labor only, Materials only, or Labor and materials?'];
    const prompt=instructionPrompts(e,{})[0];assert.deepEqual(prompt.values,['Labor only','Materials only','Labor and materials']);
    let calls=0;const request:typeof fetch=async()=>{calls++;throw new Error('A project-wide constrained choice must not call a provider.');};
    const result=await resolveInstructionAnswer(e,{service:'handyman'},{id:prompt.id,answer:'Materials only'},[],request);
    assert.equal(calls,0);assert.equal(result.extraction?.instructions?.laborOnly,false);assert.equal(result.extraction?.instructions?.materialsOnly,true);
  }finally{
    for(const key of keys){
      if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    }
  }
});
test('scoped responsibility choices retain the choices but use provider interpretation',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  process.env.OPENAI_API_KEY='synthetic';
  try{
    const e=scope();e.instructions!.questions=['Should kitchen trim be labor only or materials only?'];
    const prompt=instructionPrompts(e,{})[0];assert.deepEqual(prompt.values,['Labor only','Materials only','Labor and materials']);
    let calls=0;
    const request:typeof fetch=async(_url,options)=>{
      calls++;const body=JSON.parse(String(options?.body));assert.equal(body.input[0].content.some((c:any)=>c.type==='input_file'||c.type==='input_image'),false);
      const output={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,laborOnly:true,materialsOnly:false,questions:[]},pages:[],takeoffs:[]};
      return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    };
    const result=await resolveInstructionAnswer(e,{service:'handyman'},{id:prompt.id,answer:'Labor only'},[],request);
    assert.equal(calls,1);
    assert.equal(result.extraction?.instructions?.laborOnly,true);
  }finally{
    for(const key of keys){
      if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    }
  }
});
test('invalid or stale clarification cannot replace the server extraction',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  await assert.rejects(resolveInstructionAnswer(scope(),{},{id:'forged',answer:'yes'}),/question has changed/);
  await assert.rejects(resolveInstructionAnswer(scope(),{},{id:'x',answer:''}),/Enter an answer/);
});
