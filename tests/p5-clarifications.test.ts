import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {require as tsxRequire} from 'tsx/cjs/api';
import {pathToFileURL} from 'node:url';
const resolver=()=>tsxRequire('../lib/p5/clarificationAnswer.ts',pathToFileURL(`${process.cwd()}/tests/p5-clarifications.test.ts`).href) as typeof import('../lib/p5/clarificationAnswer.ts');
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {scopeQuestions,reconcileScope} from '../lib/p5/adaptive.ts';
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
  // Isolate every provider credential so a developer's real keys can never route this fixture to a live provider.
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  process.env.OPENAI_API_KEY='synthetic';
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
  }finally{
    for(const key of keys){
      if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    }
  }
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

test('a customer contradiction retains its confirmation and exact source quantities',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];process.env.OPENAI_API_KEY='synthetic';
  try{
    const e=scope();e.instructions!.questions=['Who will supply the doors?'];
    e.instructions!.inclusions=['Install four doors','120 lf baseboard'];
    e.instructions!.exclusions=['Plumbing','Electrical'];
    e.facts=[{field:'taskList',value:'Install four doors',confidence:.99,source:'scope.pdf p.1',evidence:'four doors',basis:'stated'},
      {field:'trimLf',value:'120',confidence:.99,source:'scope.pdf p.1',evidence:'120 lf baseboard',basis:'stated'}];
    const originalFacts=structuredClone(e.facts);
    const answers={service:'handyman',taskList:'Install four doors',trimLf:'120'};
    const prompt=instructionPrompts(e,answers)[0];
    const request:typeof fetch=async(_url,options)=>{
      const body=JSON.parse(String(options?.body));
      assert.match(JSON.stringify(body),/four installations and one supplied door/);
      const output={summary:'',facts:[],conflicts:[{field:'ownerSupplied',values:['Customer supplies all doors','Contractor supplies one door'],explanation:'Your selection and typed detail differ. Should we supply one door?'}],
        reviewNotes:[],missingInformation:[],clarifications:[{field:'ownerSupplied',question:'Should we supply one door and install all four?',reason:'Confirm supply responsibility'}],
        instructions:{...e.instructions,questions:[]},pages:[],takeoffs:[]};
      return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    };
    const result=await resolveInstructionAnswer(e,answers,{id:prompt.id,answer:"I'll supply all of them\nI have three doors. Please include one more."},[],request);
    assert.deepEqual(result.extraction?.facts,originalFacts);
    assert.equal(result.answers.taskList,'Install four doors');assert.equal(result.answers.trimLf,'120');
    assert.equal(result.extraction?.conflicts.length,1);
    assert.deepEqual(result.unresolvedFields,['ownerSupplied']);
    assert.ok(result.extraction?.clarifications?.some(q=>q.question==='Should we supply one door and install all four?'));
    assert.deepEqual(result.extraction?.instructions?.exclusions,['Plumbing','Electrical']);
    assert.match(result.answers.estimatingInstructions||'',/I have three doors/);
    assert.ok(scopeQuestions(result.answers,result.extraction,reconcileScope(result.answers,result.extraction!).conflicts).some(q=>q.conflict&&q.field==='ownerSupplied'));
  }finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
test('an answer that gives no count is kept and priced, never asked again (live RE-10, 2026-09-21)',async()=>{
  const {resolveInstructionAnswer}=await resolver();
  const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];process.env.OPENAI_API_KEY='synthetic';
  try{
    const e=scope();e.instructions!.questions=['How many garage light fixtures need repair?'];
    const answers={service:'handyman',taskList:'Fix garage lighting'};
    const prompt=instructionPrompts(e,answers)[0];
    // The re-read turns the non-answer into new questions; none of them may reach the customer.
    const request:typeof fetch=async()=>{
      const output={summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[{field:'taskList',question:'Answer did not specify a count.?',reason:'No count'}],
        instructions:{...e.instructions,questions:['Answer did not specify a count.?']},pages:[],takeoffs:[]};
      return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    };
    const result=await resolveInstructionAnswer(e,answers,{id:prompt.id,answer:'Not sure, all of the ones in the garage'},[],request);
    assert.deepEqual(result.extraction?.instructions?.questions,[]);
    assert.equal((result.extraction?.clarifications||[]).some(q=>/did not specify/i.test(q.question)),false);
    assert.match(result.answers.estimatingInstructions||'',/all of the ones in the garage/);
  }finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
