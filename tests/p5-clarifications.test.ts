import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionPrompts,removeInstructionAnswerBlocks} from '../lib/p5/clarifications.ts';
import {require as tsxRequire} from 'tsx/cjs/api';
import {pathToFileURL} from 'node:url';
const resolver=()=>tsxRequire('../lib/p5/clarificationAnswer.ts',pathToFileURL(`${process.cwd()}/tests/p5-clarifications.test.ts`).href) as typeof import('../lib/p5/clarificationAnswer.ts');
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {pricingExtraction} from '../lib/p5/quantityReconciliation.ts';
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
test('generic live cabinet question draws four retained choices and excludes every unselected top',async()=>{
  const {resolveInstructionAnswer}=await resolver();process.env.OPENAI_API_KEY='synthetic';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const e=scope();e.instructions!.questions=['Which bench top option should be included in the estimate?'];
  e.facts=[{field:'laborHours',value:'10',confidence:.99,source:'cabinet-estimate.pdf',evidence:'Known base and installation subtotal',basis:'calculated'}];
  const source=(page:number)=>[{source:'cabinet-estimate.pdf',page,sheet:`P${page}`,revision:''}];
  const takeoff=(id:string,description:string,quantity:number,unit:string,page:number,issues:string[]=[])=>({id,description,building:'Main',floor:'1',component:description,quantity,unit,basis:'stated' as const,evidence:`${description}: ${quantity} ${unit}`,sources:source(page),supersedes:[],issues});
  e.takeoffs=[
    takeoff('cabinet-units','Two cabinet units',2,'ea',1),takeoff('knobs','Nine knobs/pulls',9,'ea',1),
    takeoff('base-assembly','Base cabinet assembly labor',2,'hours',1),takeoff('installation','Cabinet installation labor',8,'hours',1),
    takeoff('butcher-labor','ALTERNATE: butcher block bench top - additional labor',5,'hours',2,['Selection required']),
    takeoff('butcher-material','ALTERNATE: butcher block bench top - material',13.3,'LF',2,['Selection required']),
    takeoff('painted-labor','ALTERNATE: matching painted MDF/wood bench top - additional labor',4,'hours',2,['Selection required']),
    takeoff('painted-material','ALTERNATE: matching painted MDF/wood bench top - material',13.3,'LF',2,['Selection required']),
    takeoff('laminate-labor','ALTERNATE: laminate bench top - additional labor',2,'hours',2,['Selection required']),
    takeoff('laminate-material','ALTERNATE: laminate bench top - material',13.3,'LF',2,['Selection required']),
    takeoff('quartz-labor','ALTERNATE: quartz bench top - additional labor',5,'hours',2,['Selection required']),
    takeoff('quartz-material','ALTERNATE: quartz bench top - material',13.3,'LF',2,['Selection required']),
  ];
  const prompt=instructionPrompts(e,{})[0];
  assert.deepEqual(prompt.values,['butcher block bench top','matching painted MDF/wood bench top','laminate bench top','quartz bench top']);
  const request:typeof fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,questions:[]},pages:[],takeoffs:[]})}]}]});
  const answer='Option 2: matching painted MDF/wood bench top only. Exclude butcher block, laminate and quartz alternatives. Include the two cabinet units and 9 knobs/pulls. Assembly 2 hours + cabinet installation 8 hours + selected top fabrication/install 4 hours = 14 labor hours.';
  try{
    const result=await resolveInstructionAnswer(e,{service:'cabinet-install'},{id:prompt.id,answer},[],request);
    assert.equal(result.extraction?.facts.find(f=>f.field==='laborHours')?.value,'14');
    assert.equal(result.answers.laborHours,'14');
    assert.equal(result.extraction?.documentCoverage,e.documentCoverage);
    for(const id of ['painted-labor','painted-material'])assert.match(result.extraction?.takeoffs?.find(t=>t.id===id)?.issues.join(' ')||'',/Selected alternative/);
    for(const id of ['butcher-labor','butcher-material','laminate-labor','laminate-material','quartz-labor','quartz-material'])assert.match(result.extraction?.takeoffs?.find(t=>t.id===id)?.issues.join(' ')||'',/Unselected alternative/);
    const priced=pricingExtraction(result.extraction);
    assert.deepEqual(priced?.takeoffs?.map(t=>t.id),['cabinet-units','knobs','base-assembly','installation','painted-labor','painted-material']);
    assert.equal(priced?.takeoffs?.some(t=>/butcher|laminate|quartz/i.test(t.description)),false);
  }finally{delete process.env.OPENAI_API_KEY;}
});
test('explicit exclusions are never selected and ambiguous alternative replies retain a concise question',async()=>{
  const {resolveInstructionAnswer}=await resolver();process.env.OPENAI_API_KEY='synthetic';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const e=scope();e.instructions!.questions=['Which bench top option should be included in the estimate?'];
  e.facts=[{field:'laborHours',value:'10',confidence:.99,source:'cabinet-estimate.pdf',evidence:'Partial subtotal',basis:'calculated'}];
  const source=[{source:'cabinet-estimate.pdf',page:2,sheet:'P2',revision:''}];
  e.takeoffs=['butcher block','matching painted MDF/wood','laminate','quartz'].map((name,index)=>({id:`top-${index}`,description:`ALTERNATE: ${name} bench top - additional labor`,building:'Main',floor:'1',component:`${name} bench top`,quantity:[5,4,2,5][index],unit:'hours',basis:'stated' as const,evidence:`${name} option`,sources:source,supersedes:[],issues:['Selection required']}));
  const prompt=instructionPrompts(e,{})[0];
  const request:typeof fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,questions:[]},pages:[],takeoffs:[]})}]}]});
  try{
    const result=await resolveInstructionAnswer(e,{laborHours:'10'},{id:prompt.id,answer:'Exclude butcher block, laminate and quartz.'},[],request);
    assert.equal(result.extraction?.takeoffs?.some(t=>/Selected alternative/.test(t.issues.join(' '))),false);
    assert.equal(result.extraction?.facts.some(f=>f.field==='laborHours'),false);
    assert.equal(result.answers.laborHours,undefined);
    assert.deepEqual(instructionPrompts(result.extraction,result.answers)[0].values,prompt.values);
    assert.equal(instructionPrompts(result.extraction,result.answers)[0].question,'Which bench top option should be included in the estimate?');
    const mixed=structuredClone(e);
    mixed.takeoffs=[
      mixed.takeoffs![0],
      {...mixed.takeoffs![1],id:'flooring-option',description:'ALTERNATE: oak flooring',component:'flooring'},
      {...mixed.takeoffs![2],id:'fixture-option',description:'ALTERNATE: brass fixture',component:'fixture'},
    ];
    assert.equal(instructionPrompts(mixed,{})[0].values,undefined);
  }finally{delete process.env.OPENAI_API_KEY;}
});
test('internal payload labels are removed from every visitor question surface',()=>{
  const e=scope();e.instructions!.questions=['Does previousAnswers include painting?'];
  e.clarifications=[{field:'materials',question:'Confirm savedProjectDetails and projectDescription materials.',reason:'Internal'}];
  const questions=scopeQuestions({service:'bathroom',sqft:'80',demolition:'Remove tile'},e,[],[],['materials']);
  assert.equal(questions.some(q=>/previousAnswers|savedProjectDetails|projectDescription/.test(`${q.reason} ${q.detail||''}`)),false);
});
