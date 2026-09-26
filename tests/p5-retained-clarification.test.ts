import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {resolveInstructionAnswer} from '../lib/p5/clarificationAnswer.ts';
import {applyRetainedBenchTopAnswer,retainedPricingProjection,retainedPricingScopeProjection} from '../lib/p5/retainedClarification.ts';
import {validateExtraction,type ScopeExtraction, type ReviewedScope} from '../lib/p5/scope.ts';
import {pricingSourceParts} from '../lib/p5/pricingSources.ts';

/** Configure exactly one provider - a synthetic OpenAI - for a test that stubs
 * the transport with an OpenAI-shaped reply.
 *
 * Without this, a host that has ANTHROPIC_API_KEY set (Replit does) configures
 * Anthropic as well, and Anthropic leads scope reads. The stub's OpenAI body
 * then reaches the Anthropic branch, which finds no stop_reason and raises
 * "analysis-incomplete". That failed the production build while the same test
 * passed on a laptop with no Anthropic key - the difference was the
 * environment, never the code under test. */
function onlySyntheticOpenAi():()=>void{
  const keys=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_MODEL','ANTHROPIC_API_KEY','P5_SCOPE_PROVIDER','P5_SCOPE_MODEL','P5_SCOPE_FAST_MODEL','P5_SCOPE_OPENAI_MODEL','P5_TEXT_RACE'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  process.env.OPENAI_API_KEY='synthetic';
  return()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}};
}


const question='Which bench top option should be included in the estimate?';
const source='Option 1: butcher block (+5h); Option 2: matching painted MDF/wood (+4h); Option 3: laminate (+2h); Option 4: quartz (+5h). Assembly 2 hours + cabinet installation 8 hours.';

function extraction():ScopeExtraction{
  return {
    summary:'Cabinet package',
    facts:[{field:'taskList',value:'Two cabinet units and 9 knobs/pulls.',confidence:1,source:'cabinet.pdf',evidence:`Two cabinet units and 9 knobs/pulls. ${source}`,basis:'stated'}],
    conflicts:[],reviewNotes:[],missingInformation:[],
    instructions:{...emptyInstructions(),questions:[question]},
    takeoffs:[
      ...([
        ['butcher block',5],
        ['matching painted MDF/wood',4],
        ['laminate',2],
        ['quartz',5],
      ] as [string,number][]).map(([description,quantity],index)=>({id:`top-${index}`,description:`${description} bench top`,building:'Main',floor:'1',component:'bench top option',quantity,unit:'HR',basis:'stated' as const,evidence:source,sources:[{source:'cabinet.pdf',page:2,sheet:'A1',revision:'1'}],supersedes:[],issues:[]})),
      {id:'cabinet-units',description:'Cabinet units',building:'Main',floor:'1',component:'cabinet',quantity:1,unit:'EA',basis:'stated',evidence:'One cabinet unit on the schedule.',sources:[{source:'cabinet.pdf',page:2,sheet:'A1',revision:'1'}],supersedes:[],issues:[]},
      {id:'hardware',description:'Knobs/pulls',building:'Main',floor:'1',component:'hardware',quantity:5,unit:'EA',basis:'stated',evidence:'Five knobs/pulls on the hardware schedule.',sources:[{source:'cabinet.pdf',page:2,sheet:'A1',revision:'1'}],supersedes:[],issues:[]},
    ],
    documentCoverage:{expectedPages:1,complete:true,pages:[{source:'cabinet.pdf',page:2,sheet:'A1',revision:'1',status:'read',notes:[]}]},
  };
}

test('retained cabinet choices come from source evidence and retain their labor increments',()=>{
  const prompt=instructionPrompts(extraction(),{})[0];
  assert.equal(prompt.question,question);
  assert.deepEqual(prompt.values,[
    'Option 1: butcher block (+5h)',
    'Option 2: matching painted MDF/wood (+4h)',
    'Option 3: laminate (+2h)',
    'Option 4: quartz (+5h)',
  ]);
});

test('exact retained-document answer updates active scope without rereading',async()=>{
  const e=extraction();
  const prompt=instructionPrompts(e,{})[0];
  const answer='Option 2: matching painted MDF/wood bench top only. Exclude butcher block, laminate and quartz alternatives. Include the two cabinet units and 9 knobs/pulls. Assembly 2 hours + cabinet installation 8 hours + selected top fabrication/install 4 hours = 14 labor hours.';
  const result=await resolveInstructionAnswer(e,{}, {id:prompt.id,answer},[],async()=>{throw new Error('provider must not be called');});
  assert.equal(result.answers.laborHours,'14');
  assert.match(result.answers.taskList||'',/2 cabinet units/);
  assert.match(result.answers.taskList||'',/9 knobs\/pulls/);
  assert.match(result.answers.taskList||'',/matching painted MDF\/wood/);
  assert.match(result.answers.exclusions||'',/butcher block/);
  assert.match(result.answers.exclusions||'',/laminate/);
  assert.match(result.answers.exclusions||'',/quartz/);
  assert.equal(result.extraction?.instructions?.questions.length,0);
  assert.deepEqual(result.extraction?.takeoffs?.map(item=>[item.id,item.quantity]),[
    ['top-1',4],['cabinet-units',2],['hardware',9],['assembly-labor',2],['cabinet-installation-labor',8],
  ]);
  assert.deepEqual((result.extraction as any).laborCoverage,{totalHours:14,components:[
    {id:'assembly-labor',description:'Assembly',hours:2},
    {id:'cabinet-installation-labor',description:'Cabinet installation',hours:8},
    {id:'top-1',description:'matching painted MDF/wood bench top fabrication/install',hours:4},
  ],nonAdditiveSummary:true,basis:'retained-document-clarification'});
  assert.equal(result.extraction?.documentCoverage,e.documentCoverage);
  const overlay=(result.extraction as any).clarificationProvenance;
  assert.equal(overlay.clarifications[0].source.takeoffs.length,6);
  assert.equal(overlay.clarifications[0].excluded.length,3);
  const pricing=retainedPricingProjection(result.extraction);
  assert.equal((pricing as any).clarificationProvenance,undefined);
  assert.equal((pricing as any).sourceHistory,undefined);
  assert.ok(!(pricing?.facts||[]).some(fact=>fact.field!=='exclusions'&&/butcher|laminate|quartz/i.test(`${fact.value} ${fact.evidence}`)));
  assert.ok(!(pricing?.takeoffs||[]).some(item=>/butcher|laminate|quartz/i.test(item.description)));
  const pricingScope=retainedPricingScopeProjection({answers:result.answers,extraction:result.extraction});
  assert.doesNotMatch(pricingScope.answers.estimatingInstructions||'',/Exclude butcher block/);
});

test('retained clarification recovers component hours archived by labor aggregation',()=>{
  const e=extraction();
  const laborFacts=[
    {field:'laborHours' as const,value:'2',confidence:1,source:'cabinet.pdf',evidence:'Assembly: 2 labor hours.',basis:'stated' as const},
    {field:'laborHours' as const,value:'8',confidence:1,source:'cabinet.pdf',evidence:'Cabinet installation: 8 labor hours.',basis:'stated' as const},
  ];
  e.sourceHistory={version:'p5-retained-clarification-v1',clarifications:[],laborFacts} as any;
  const prompt=instructionPrompts(e,{})[0];
  const result=applyRetainedBenchTopAnswer(e,{},prompt.detail||prompt.question,'Option 2: matching painted MDF/wood bench top.');
  if(result.status!=='resolved')throw new Error('expected a resolved bench top answer');
  assert.equal(result.answers.laborHours,'14');
  assert.deepEqual((result.extraction as any).laborCoverage.components.map((component:any)=>component.hours),[2,8,4]);
});

test('ambiguous and negated alternatives never select a top',async()=>{
  const e=extraction();
  const prompt=instructionPrompts(e,{})[0];
  await assert.rejects(
    resolveInstructionAnswer(e,{}, {id:prompt.id,answer:'Option 1 or Option 2'},[],async()=>{throw new Error('provider must not be called');}),
    /choose one bench top option/,
  );
  const result=await resolveInstructionAnswer(e,{}, {id:prompt.id,answer:'Do not use butcher block, laminate, or quartz; use matching painted MDF/wood only.'},[],async()=>{throw new Error('provider must not be called');});
  assert.equal(result.answers.laborHours,'14');
  assert.ok(!(result.extraction?.takeoffs||[]).some(item=>/butcher|laminate|quartz/i.test(item.description)));
  for(const answer of ['Exclude quartz, but include matching painted MDF/wood.','Not butcher block; choose option 2.']){
    const selected=await resolveInstructionAnswer(e,{}, {id:prompt.id,answer},[],async()=>{throw new Error('provider must not be called');});
    assert.match(selected.answers.materials||'',/matching painted MDF\/wood/);
    assert.equal(selected.answers.laborHours,'14');
  }
});

test('partial retained answer can change stated cabinet and hardware quantities',async()=>{
  const e=extraction();
  const prompt=instructionPrompts(e,{})[0];
  const result=await resolveInstructionAnswer(e,{}, {id:prompt.id,answer:'Option 2; make it 3 cabinet units and 12 knobs/pulls.'},[],async()=>{throw new Error('provider must not be called');});
  assert.equal(result.answers.laborHours,'14');
  assert.match(result.answers.taskList||'',/3 cabinet units/);
  assert.match(result.answers.taskList||'',/12 knobs\/pulls/);
  assert.deepEqual(result.extraction?.takeoffs?.map(item=>[item.id,item.quantity]),[
    ['top-1',4],['cabinet-units',3],['hardware',12],['assembly-labor',2],['cabinet-installation-labor',8],
  ]);
});

test('free-text provider clarification applies returned structured facts without source reread',async()=>{
  const e=extraction();
  e.instructions!.questions=['How many cabinet units should be included?'];
  const prompt=instructionPrompts(e,{})[0];
  const restore=onlySyntheticOpenAi();
  try{
    const result=await resolveInstructionAnswer(e,{},{id:prompt.id,answer:'Use 3 cabinet units.'},[],async(_url,options)=>{
      const body=JSON.parse(String(options?.body));
      assert.equal(body.input[0].content.some((item:any)=>item.type==='input_file'||item.type==='input_image'),false);
      const output={...e,facts:[{field:'taskList',value:'3 cabinet units',confidence:1,source:'typed scope',evidence:'Use 3 cabinet units.',basis:'stated'}],instructions:{...e.instructions,questions:[]},pages:[],takeoffs:[]};
      return Response.json({status:'completed', model:'gpt-4.1-2025-04-14',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    });
    assert.equal(result.answers.taskList,'3 cabinet units');
    assert.equal(result.extraction?.facts.find(fact=>fact.field==='taskList')?.value,'3 cabinet units');
    assert.equal(result.extraction?.takeoffs?.find(item=>item.id==='cabinet-units')?.quantity,3);
  }finally{
    restore();
  }
});

test('free-text quantity clarification replaces the contradicted active takeoff while retaining source evidence',async()=>{
  const e=extraction();
  e.instructions!.questions=['What trim length should be included?'];
  e.takeoffs=[{id:'trim-1',description:'Baseboard trim',building:'Main',floor:'1',component:'trim',quantity:10,unit:'LF',basis:'stated',evidence:'Original schedule: 10 LF trim.',sources:[{source:'cabinet.pdf',page:2,sheet:'A1',revision:'1'}],supersedes:[],issues:[]}];
  const prompt=instructionPrompts(e,{})[0];
  const restore=onlySyntheticOpenAi();
  try{
    const result=await resolveInstructionAnswer(e,{}, {id:prompt.id,answer:'Use 24 LF of trim.'},[],async()=>{
      const output={summary:'',facts:[{field:'trimLf',value:'24',confidence:1,source:'typed scope',evidence:'24 LF trim from typed answer.',basis:'stated'}],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],instructions:{...e.instructions,questions:[]},pages:[],takeoffs:[]};
      return Response.json({status:'completed', model:'gpt-4.1-2025-04-14',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    });
    assert.equal(result.extraction?.takeoffs?.[0].quantity,24);
    assert.match(result.extraction?.takeoffs?.[0].evidence||'',/Original schedule: 10 LF trim/);
    assert.equal(result.extraction?.takeoffs?.[0].sources[0].page,2);
  }finally{
    restore();
  }
});

test('retained selection preserves unrelated fact and instruction components',()=>{
  const e=extraction();
  e.facts.push(
    {field:'taskList',value:'Paint the hallway; Bench top options: butcher block (+5h), matching painted MDF/wood (+4h), laminate (+2h), quartz (+5h).',confidence:1,source:'cabinet.pdf',evidence:'Hallway paint and the retained bench top schedule.',basis:'stated'},
    {field:'materials',value:'Tile backsplash; quartz bench top',confidence:1,source:'cabinet.pdf',evidence:'Tile backsplash; quartz bench top is an alternate.',basis:'stated'},
    {field:'installation',value:'Plumbing fixture installation; laminate bench top installation',confidence:1,source:'cabinet.pdf',evidence:'Unrelated plumbing and retained bench top alternate.',basis:'stated'},
    {field:'exclusions',value:'Appliance relocation remains excluded.',confidence:1,source:'cabinet.pdf',evidence:'Appliance relocation remains excluded.',basis:'stated'},
  );
  e.instructions!.inclusions=['Paint the hallway; Option 1 butcher block bench top'];
  e.instructions!.exclusions=['Appliance relocation remains excluded.'];
  const answer='Option 2: matching painted MDF/wood bench top only. Exclude butcher block, laminate and quartz alternatives.';
  const resolved=applyRetainedBenchTopAnswer(e,{taskList:'Paint the hallway; Bench top options: butcher block (+5h), matching painted MDF/wood (+4h), laminate (+2h), quartz (+5h).',materials:'Tile backsplash; quartz bench top',installation:'Plumbing fixture installation; laminate bench top installation',exclusions:'Appliance relocation remains excluded.'},question,answer);
  assert.equal(resolved.status,'resolved');
  if(resolved.status!=='resolved')return;
  const task=resolved.extraction.facts.find(fact=>fact.field==='taskList')?.value||'';
  const materials=resolved.extraction.facts.find(fact=>fact.field==='materials')?.value||'';
  const installation=resolved.extraction.facts.find(fact=>fact.field==='installation')?.value||'';
  assert.match(task,/Paint the hallway/);
  assert.match(materials,/Tile backsplash/);
  assert.match(installation,/Plumbing fixture installation/);
  assert.match(resolved.answers.exclusions||'',/Appliance relocation remains excluded/);
  assert.match(resolved.extraction.instructions?.inclusions.join(' ')||'',/Paint the hallway/);
});

test('bench top length does not survive as an auto-derived base-cabinet dimension',()=>{
  const e=extraction();
  e.facts.push({field:'cabinetBaseLf',value:'13.3',confidence:1,source:'cabinet.pdf',evidence:'13.3 LF benchTOP length shown on the elevation.',basis:'calculated'});
  const prompt=instructionPrompts(e,{cabinetBaseLf:'13.3'})[0];
  const stale=applyRetainedBenchTopAnswer(e,{cabinetBaseLf:'13.3'},prompt.detail||prompt.question,'Option 2: matching painted MDF/wood bench top.');
  assert.equal(stale.status,'resolved');
  if(stale.status!=='resolved')return;
  assert.equal(stale.answers.cabinetBaseLf,undefined);
  assert.equal(stale.answers.cabinetTallLf,undefined);
  assert.equal(stale.extraction.facts.some(fact=>fact.field==='cabinetBaseLf'),false);
  assert.equal(stale.history.source.facts.some(fact=>fact.field==='cabinetBaseLf'&&fact.value==='13.3'),true);

  const corrected=applyRetainedBenchTopAnswer(e,{cabinetBaseLf:'20'},prompt.detail||prompt.question,'Option 2: matching painted MDF/wood bench top.');
  assert.equal(corrected.status,'resolved');
  if(corrected.status!=='resolved')return;
  assert.equal(corrected.answers.cabinetBaseLf,'20');
  assert.equal(corrected.extraction.facts.some(fact=>fact.field==='cabinetBaseLf'&&fact.value==='13.3'),true);
});

test('resolved bench-top blockers are archived and cleared without hiding unmeasured blockers',()=>{
  const e=extraction();
  e.conflicts=[
    {field:'materials',values:['butcher block','quartz'],explanation:'Conflicting bench top material alternatives require one selection.'},
    {field:'laborHours',values:['11','14'],explanation:'Different labor totals are tied to the bench top options.'},
    {field:'materials',values:['tile','paint'],explanation:'Unrelated finish materials still conflict.'},
  ];
  e.reviewNotes=['Review the conflicting bench top alternatives.','Confirm the unmeasured bench top depth.'];
  e.missingInformation=['Select one bench top option.','Confirm unmeasured cabinet depth.'];
  e.takeoffs![1].issues=['Conflicting bench top alternatives remain in this ledger.','Unmeasured top width is still unknown.'];
  const prompt=instructionPrompts(e,{})[0];
  const resolved=applyRetainedBenchTopAnswer(e,{},prompt.detail||prompt.question,'Option 2: matching painted MDF/wood bench top.');
  assert.equal(resolved.status,'resolved');
  if(resolved.status!=='resolved')return;
  assert.equal(resolved.extraction.conflicts.length,1);
  assert.match(resolved.extraction.conflicts[0].explanation,/Unrelated finish/);
  assert.deepEqual(resolved.extraction.reviewNotes,['Confirm the unmeasured bench top depth.']);
  assert.deepEqual(resolved.extraction.missingInformation,['Confirm unmeasured cabinet depth.']);
  assert.deepEqual(resolved.extraction.takeoffs?.[0].issues,['Unmeasured top width is still unknown.']);
  assert.equal(resolved.history.source.conflicts.length,3);
  assert.equal(resolved.history.source.takeoffs[1].issues.length,2);
});

test('combined assembly-installation takeoff splits into a non-additive 14-hour ledger',()=>{
  const e=extraction();
  e.takeoffs!.push({id:'combined-labor',description:'Assembly and cabinet installation',building:'Main',floor:'1',component:'combined labor',quantity:10,unit:'HR',basis:'stated',evidence:'Original schedule combines assembly and cabinet installation: 10 hours.',sources:[{source:'cabinet.pdf',page:2,sheet:'A1',revision:'1'}],supersedes:[],issues:[]});
  const prompt=instructionPrompts(e,{})[0];
  const resolved=applyRetainedBenchTopAnswer(e,{},prompt.detail||prompt.question,'Option 2: matching painted MDF/wood bench top. Assembly 2 hours + cabinet installation 8 hours.');
  assert.equal(resolved.status,'resolved');
  if(resolved.status!=='resolved')return;
  const validated=validateExtraction(JSON.parse(JSON.stringify(resolved.extraction)));
  const labor=validated.takeoffs?.filter(item=>item.unit==='HR'&&item.quantity!==null)||[];
  assert.deepEqual(labor.map(item=>[item.id,item.quantity]),[['top-1',4],['assembly-labor',2],['cabinet-installation-labor',8]]);
  assert.equal(labor.reduce((sum,item)=>sum+(item.quantity||0),0),14);
  assert.deepEqual((resolved.extraction as any).laborCoverage.components.map((component:any)=>component.id),['assembly-labor','cabinet-installation-labor','top-1']);
  const scope={text:'Price selected cabinet scope.',answers:resolved.answers,extraction:validated,uploads:[],uncertainFields:[],corrections:[],reviewedAt:'2026-09-12T00:00:00.000Z'} as ReviewedScope;
  const pricing=JSON.stringify(pricingSourceParts(scope));
  assert.match(pricing,/assembly-labor/);
  assert.match(pricing,/cabinet-installation-labor/);
  assert.doesNotMatch(pricing,/combined-labor/);
});