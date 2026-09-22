import test from 'node:test';
import assert from 'node:assert/strict';
import {missingScopeFields,missingNoteField} from '../lib/p5/missingFields.ts';
import {categoryBreakdown,fieldCategory} from '../lib/p5/presentation.ts';
import {questionForField,questionReason} from '../lib/p5/adaptive.ts';
import {priceCompleteScope,planningResolution,RESEARCH_STAGE_MS,PRICING_STAGE_MAX_MS,type PricingRequest,HANDOFF_ISSUE} from '../lib/p5/scopePricing.ts';
import {PricingStageTimeout} from '../lib/p5/pricingProgress.ts';
import {BACKGROUND_JOB_LIMIT_MS,CLIENT_BUDGET_MS,PRICING_PASS_MS} from '../lib/p5/processingBudget.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {estimatorTheme} from '../lib/p5/theme.ts';
// The brand that records provider charges (P5 Home Co) keeps them in memory during tests; other brands ignore this.
process.env.P5_PRICING_LEDGER_TEST_MODE||='memory';

test('missing cost-book quantities become answerable fields, review-only items do not',()=>{
  const fields=missingScopeFields(['Missing quantity: tileSqft for Tile installation','Missing cost condition: structural for Beam work','Missing cost rate: 03-01-01 needs review','Missing quantity: Drywall has a zero quantity; confirm exclusion']);
  assert.deepEqual(fields.map(f=>f.field),['structural','tileSqft']);
  assert.equal(fields.find(f=>f.field==='tileSqft')?.label,'Tile area in square feet');
});

test('a jump-to question uses everyday wording and brand-limited choices',()=>{
  assert.equal(questionReason('sqft',{service:'bathroom'}),'About how large is the area being worked on?');
  assert.match(questionReason('sqft',{service:'new-construction'}),/living space/);
  const finish=questionForField('finish',{service:'kitchen'});
  assert.ok(finish.values?.includes('mid-range'));
  assert.equal(questionForField('tileSqft',{}).values,undefined);
  const service=questionForField('service',{});
  assert.ok(service.values?.every(v=>!['not-a-service'].includes(v)));
});

test('review details group by presentation category',()=>{
  assert.equal(fieldCategory('service'),'Project at a glance');
  assert.equal(fieldCategory('plumbing'),'Plumbing');
  assert.equal(fieldCategory('taskList'),'Additional scope details');
});

test('category breakdown carries subtotals, quantities, unit prices and pricing status',()=>{
  const result={includedCategories:['Plumbing'],range:{low:100,high:200},categoryRanges:[{category:'Plumbing',low:100,high:200}],lineItems:[{id:'p',category:'Plumbing',description:'Fixture installation',quantity:2,unit:'EA',low:100,high:200,unitLow:50,unitHigh:100,pricingStatus:'estimated-allowance',verification:'Confirm selections.'}],scopeTasks:[{description:'Install two fixtures',category:'Plumbing'},{description:'Paint the walls'}]};
  // Unit prices are asserted explicitly; one brand hides them from customers by default.
  const groups=categoryBreakdown(result,true,false);
  assert.deepEqual(groups.map(g=>g.category),['Plumbing','Painting']);
  assert.equal(groups[0].low,100);assert.equal(groups[0].items[0].unitHigh,100);assert.equal(groups[0].items[0].status,'estimated-allowance');
  assert.deepEqual(groups[1].tasks,['Paint the walls']);assert.equal(groups[1].items.length,0);
});

test('processing budgets keep one browser wait under a minute while durable work continues',()=>{
  assert.ok(CLIENT_BUDGET_MS<60_000);
  assert.ok(BACKGROUND_JOB_LIMIT_MS>CLIENT_BUDGET_MS*5);
  // A research stage is no longer required to fit inside one browser wait.
  // Pricing runs as a polled background job, so the browser never blocks on a
  // stage; it polls and is shown saved progress. What must hold is that a
  // stage fits inside the pass that runs it, or a pass could never finish one
  // - which is what happened at 40 s: research timed out on every attempt and
  // every estimate silently fell back to a planning average.
  assert.ok(RESEARCH_STAGE_MS<=PRICING_STAGE_MAX_MS,'a research stage must fit inside the per-stage ceiling');
  assert.ok(PRICING_STAGE_MAX_MS<PRICING_PASS_MS,'a stage must fit inside one pricing pass');
});

test('each brand resolves a theme with an accent and heading font',()=>{
  for(const id of ['p5','remodeling','construction','handyman','cabinet']){const theme=estimatorTheme(id);assert.ok(theme.accent.startsWith('#'));assert.ok(theme.headingFont.length>0);assert.ok(['dark','light'].includes(theme.mode));}
  assert.equal(estimatorTheme('p5').mode,'light');assert.equal(estimatorTheme('remodeling').mode,'dark');
});

const date='2026-09-11T00:00:00.000Z',now=new Date(date);
const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic fixture',authorizedBy:'Test only',importedAt:date,rates:codes.map(code=>({code,description:'Synthetic work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic fixture',basis:'owner-average-cost'}))};
const config=createPlanningConfiguration(catalog);
const scope:ReviewedScope={text:'Supply ten feet of cabinetry and a specialty protective overlay.',answers:{service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise'},extraction:null,uploads:[],reviewedAt:date,corrections:[]};
const task={id:'cabinets',description:'Cabinet supply',evidence:'ten feet',existingLineIds:[] as string[],additions:[],researchDescription:'',issues:[]};
const extra={id:'overlay',description:'Protective overlay',evidence:'ten feet',existingLineIds:[],additions:[],researchDescription:'Protective cabinet overlay',issues:[]};
const planned={rates:[{taskId:'overlay',description:'Protective overlay',unit:'LF',quantity:10,quantityEvidence:'Ten feet requested',basis:'material-purchase',includes:'overlay material',excludes:'installation',low:12,high:24,confidence:'medium',rationale:'Typical regional material cost for protective overlay sheet goods.'}],issues:[],notes:[]};

test('planning averages are labeled allowances with the same quantity defenses',()=>{
  const resolved=planningResolution(planned,[extra],now,0,'Boise',scope);
  assert.equal(resolved.rules.length,1);
  const rule=resolved.rules[0];
  assert.equal(rule.id,'planning-1');assert.equal(rule.estimatingBasis,'regional-planning-average');assert.equal(rule.evidence.basis,'regional-planning-average');
  assert.equal(rule.unitCost,18);assert.equal(rule.allowance,true);assert.deepEqual(rule.unitCostRange,{low:12,high:24});
  assert.match(resolved.assumptions[0],/not verified local pricing/);
  // A range wider than six to one no longer ends the job: it is narrowed around its centre and still prices.
  const wide=planningResolution({...planned,rates:[{...planned.rates[0],low:1,high:100}]},[extra],now,0,'Boise',scope);
  assert.equal(wide.rules.length,1);assert.deepEqual(wide.rules[0].unitCostRange,{low:6.32,high:15.81});assert.equal(wide.issues.length,0);
  const reversed=planningResolution({...planned,rates:[{...planned.rates[0],low:9,high:3}]},[extra],now,0,'Boise',scope);
  assert.deepEqual(reversed.rules[0].unitCostRange,{low:3.29,high:8.22},'a reversed range is ordered, then narrowed to the allowed spread');
  assert.throws(()=>planningResolution({...planned,rates:[{...planned.rates[0],taskId:'unknown'}]},[extra],now,0,'Boise',scope),/Unknown planning scope task/);
  const missing=planningResolution({...planned,rates:[]},[extra],now,0,'Boise',scope);
  assert.ok(missing.issues.some(issue=>/no defensible planning average/.test(issue)));
});

test('a slow or unavailable web search falls back to a labeled planning average and still prices',async()=>{
  const stages:string[]=[];
  const request:PricingRequest=async(instructions,input,search)=>{
    const stage=search?'RESEARCH':instructions.startsWith('Inventory')?'INVENTORY':instructions.startsWith('You are a construction estimator')?'MAP':instructions.startsWith('Provide a defensible REGIONAL PLANNING AVERAGE')?'PLANNING':'AUDIT';
    stages.push(stage);
    if(stage==='INVENTORY')return {value:{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[],notes:[]},sourceUrls:[]};
    if(stage==='MAP'){const ids=((input as any).existingLines||[]).map((l:any)=>l.id);return {value:{tasks:[{...task,existingLineIds:ids},extra],issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};}
    if(stage==='RESEARCH')throw new PricingStageTimeout();
    if(stage==='PLANNING')return {value:planned,sourceUrls:[]};
    return {value:{coveredTaskIds:['cabinets','overlay'],issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  };
  const r=await priceCompleteScope(scope,config,request,now);
  assert.ok(r.customer.range,'a planning average allowance can complete a preliminary range');
  assert.ok(stages.includes('RESEARCH')&&stages.includes('PLANNING'));
  const line=(r.internal as any).lines.find((l:any)=>l.id==='planning-1');
  assert.ok(line);assert.equal(line.evidence.basis,'regional-planning-average');
  const item=r.customer.lineItems.find((l:any)=>l.id==='planning-1') as any;
  assert.equal(item.pricingStatus,'estimated-allowance');assert.match(item.verification,/Budget allowance; final selection to be confirmed/);
  assert.ok(r.customer.assumptions.some((a:string)=>a.includes('Budget allowance; final selection to be confirmed.')));
  assert.doesNotMatch(JSON.stringify(r.customer),/published cost research|planning average|local pricing/i);
  assert.ok((r.internal as any).warnings.some((w:any)=>w.code==='planning-average-preliminary'&&w.severity==='review'));
  assert.ok(!JSON.stringify(r.customer).includes('unitCost'));
});

test('a typed scope is read by every configured provider at once and the first valid result wins',async()=>{
  const {analyzeBatch}=await import('../lib/p5/extraction.ts');
  const saved={openai:process.env.OPENAI_API_KEY,anthropic:process.env.ANTHROPIC_API_KEY,integrated:process.env.AI_INTEGRATIONS_OPENAI_API_KEY};
  process.env.OPENAI_API_KEY='fixture';process.env.ANTHROPIC_API_KEY='fixture';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  // The race is opt-in (it doubles read spend); this test covers the opted-in path.
  const savedRace=process.env.P5_TEXT_RACE;process.env.P5_TEXT_RACE='true';
  const record={summary:'Bathroom remodel',facts:[{field:'service',value:'bathroom',confidence:.95,source:'typed scope',evidence:'bathroom remodel',basis:'stated'}],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:[],takeoffs:[]};
  const calls:string[]=[];
  const request:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push(url);
    if(url.includes('/responses')){await new Promise((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')));setTimeout(()=>reject(new Error('aborted')),1500);});throw new Error('unreachable');}
    await new Promise(r=>setTimeout(r,20));
    return Response.json({stop_reason:'tool_use',model:'claude-sonnet-5',content:[{type:'tool_use',name:'record_scope_analysis',input:record}]});
  };
  const started=Date.now();
  try{
    const result=await analyzeBatch('Remodel the bathroom.',[],{},request,5000,Date.now()+5000,{race:true});
    assert.equal(result.provider,'Anthropic');assert.equal(result.extraction.facts[0].value,'bathroom');
    assert.ok(Date.now()-started<1000,'the slow primary provider must not delay a valid fallback result');
    assert.ok(calls.some(url=>url.includes('/responses'))&&calls.some(url=>url.includes('/messages')),'both providers are asked');
  }finally{
    for(const [key,value] of [['OPENAI_API_KEY',saved.openai],['ANTHROPIC_API_KEY',saved.anthropic],['AI_INTEGRATIONS_OPENAI_API_KEY',saved.integrated],['P5_TEXT_RACE',savedRace]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('a billing refusal from Anthropic falls back to OpenAI for the stage and parks Anthropic',async()=>{
  const {requestPricing}=await import('../lib/p5/scopePricing.ts');
  const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','OPENAI_BASE_URL','P5_PRICING_PROVIDER'] as const;
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const n of names)delete process.env[n];
  process.env.ANTHROPIC_API_KEY='synthetic-anthropic';process.env.OPENAI_API_KEY='synthetic-openai';process.env.P5_PRICING_PROVIDER='anthropic';
  const runtime=globalThis as typeof globalThis & {p5AnthropicBlockedUntil?:number};runtime.p5AnthropicBlockedUntil=0;
  const realFetch=globalThis.fetch;let anthropicCalls=0,openaiCalls=0;
  globalThis.fetch=(async(input:any)=>{
    const url=String(input);
    if(url.includes('anthropic.com')){anthropicCalls++;return new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API.'}}),{status:400});}
    openaiCalls++;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"coveredTaskIds":["a"],"issues":[]}'}]}]});
  }) as typeof fetch;
  try{
    const first=await requestPricing('JSON',{},false,20000);
    assert.deepEqual(first.value,{coveredTaskIds:['a'],issues:[]});assert.equal(anthropicCalls,1);assert.equal(openaiCalls,1);
    const second=await requestPricing('JSON',{},false,20000);
    assert.deepEqual(second.value,{coveredTaskIds:['a'],issues:[]});assert.equal(anthropicCalls,1,'a billing block parks Anthropic for later stages');assert.equal(openaiCalls,2);
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(()=>requestPricing('JSON',{},false,20000),/pricing-provider-unavailable:anthropic-blocked/);
  }finally{
    globalThis.fetch=realFetch;runtime.p5AnthropicBlockedUntil=0;
    for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n]!;}
  }
});
test('a provider refusal ends the pricing job now instead of retrying for minutes',async()=>{
  const {PricingPending,isPricingPending,PRICING_UNAVAILABLE}=await import('../lib/p5/pricingProgress.ts');
  const fatal=new PricingPending(PRICING_UNAVAILABLE,0,true);
  assert.ok(isPricingPending(fatal));assert.equal(fatal.fatal,true);assert.equal(fatal.retryAfterMs,0);
  assert.equal(new PricingPending('x',1500).fatal,false);
});

test('a provider wording for a choice fact maps onto the option instead of failing the read',async()=>{
  const {coerceChoice,validateExtraction}=await import('../lib/p5/scope.ts');
  assert.equal(coerceChoice('finish','Standard finishes'),'mid-range');
  assert.equal(coerceChoice('finish','Premium'),'high-end');
  assert.equal(coerceChoice('finish','mid range'),'mid-range');
  assert.equal(coerceChoice('finish','purple'),null);
  const base={summary:'Bathroom',conflicts:[],reviewNotes:[],missingInformation:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:[],takeoffs:[]};
  const fact=(value:string)=>({field:'finish',value,confidence:.9,source:'typed scope',evidence:'standard finishes',basis:'stated'});
  const mapped=validateExtraction({...base,facts:[fact('Standard finishes')]});
  assert.equal(mapped.facts.find(f=>f.field==='finish')?.value,'mid-range');
  const dropped=validateExtraction({...base,facts:[fact('purple')]});
  assert.equal(dropped.facts.some(f=>f.field==='finish'),false,'an unmatched wording is asked, not fatal');
});

test('confirmation-only audit findings become disclosed assumptions, real gaps stay blocking',async()=>{
  const {advisoryIssue}=await import('../lib/p5/scopePricing.ts');
  assert.equal(advisoryIssue('All allowances use owner catalog line items per stated methodology; see each line for exact method.'),true);
  assert.equal(advisoryIssue('Final audit must confirm bathroom dimensions, fixture counts and owner selections.'),true);
  assert.equal(advisoryIssue('Demolish tub: mapped to Building Demolition + Haul, 15 SF. ALLOWANCE: rounded up to 15 SF. Must confirm final demo extent at site.'),true);
  assert.equal(advisoryIssue('Tile floor: full pricing coverage has not been verified.'),false);
  assert.equal(advisoryIssue('Exhaust fan wiring is omitted from the priced components.'),false);
  assert.equal(advisoryIssue('Priced hourly labor (12) does not reconcile with the confirmed 10 hours.'),false);
  // The handoff shown when pricing genuinely cannot finish must never read as
  // a confirmation-only note: an advisory issue is downgraded to a "To
  // confirm" assumption and a range is released. If this sentence is ever
  // reworded into something the classifier accepts, a partial total would
  // publish. Pin it.
  assert.equal(advisoryIssue(HANDOFF_ISSUE),false,'the handoff can never be downgraded to an assumption');
  assert.equal(advisoryIssue('Vanity top duplicated in both cabinetry and countertop lines.'),false);
});

test('OpenAI leads pricing stages by default and Anthropic covers its refusal',async()=>{
  const {requestPricing}=await import('../lib/p5/scopePricing.ts');
  const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','OPENAI_BASE_URL','P5_PRICING_PROVIDER'] as const;
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const n of names)delete process.env[n];
  process.env.ANTHROPIC_API_KEY='synthetic-anthropic';process.env.OPENAI_API_KEY='synthetic-openai';
  const runtime=globalThis as typeof globalThis & {p5AnthropicBlockedUntil?:number};runtime.p5AnthropicBlockedUntil=0;
  const realFetch=globalThis.fetch;let anthropicCalls=0,openaiCalls=0,openaiRefuses=false;
  globalThis.fetch=(async(input:any)=>{
    const url=String(input);
    if(url.includes('anthropic.com')){anthropicCalls++;return Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"coveredTaskIds":["b"],"issues":[]}'}]});}
    openaiCalls++;if(openaiRefuses)return new Response('{"error":{"message":"invalid_request"}}',{status:400});
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"coveredTaskIds":["a"],"issues":[]}'}]}]});
  }) as typeof fetch;
  try{
    const first=await requestPricing('JSON',{},false,20000);
    assert.deepEqual(first.value,{coveredTaskIds:['a'],issues:[]});assert.equal(openaiCalls,1);assert.equal(anthropicCalls,0,'OpenAI answers first');
    openaiRefuses=true;
    const second=await requestPricing('JSON',{},false,20000);
    assert.deepEqual(second.value,{coveredTaskIds:['b'],issues:[]});assert.equal(anthropicCalls,1,'a refusal falls through to Anthropic');
  }finally{
    globalThis.fetch=realFetch;runtime.p5AnthropicBlockedUntil=0;
    for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n]!;}
  }
});

test('a document read keeps a section when one takeoff lacks a page reference',async()=>{
  const {analyzeBatch}=await import('../lib/p5/extraction.ts');
  const saved={openai:process.env.OPENAI_API_KEY,anthropic:process.env.ANTHROPIC_API_KEY,integrated:process.env.AI_INTEGRATIONS_OPENAI_API_KEY};
  process.env.OPENAI_API_KEY='fixture';delete process.env.ANTHROPIC_API_KEY;delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const page={source:'estimate.pdf',page:1};
  const record={summary:'Kitchen estimate',facts:[{field:'service',value:'kitchen',confidence:.9,source:'estimate.pdf',evidence:'Kitchen renovation estimate',basis:'stated'}],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],
    instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},
    pages:[{source:'estimate.pdf',sheet:'',revision:'',page:1,status:'read',notes:[]}],
    takeoffs:[{id:'t1',description:'Base cabinets',building:'',floor:'',component:'cabinets',quantity:20,unit:'LF',basis:'stated',evidence:'20 LF base',supersedes:[],issues:[],sources:[{source:'estimate.pdf',sheet:'',revision:'',page:1}]},
      {id:'t2',description:'Countertop',building:'',floor:'',component:'countertop',quantity:40,unit:'SF',basis:'stated',evidence:'40 SF quartz',supersedes:[],issues:[],sources:[]}]};
  const request:typeof fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(record)}]}]});
  try{
    const result=await analyzeBatch('Price the cabinets.',[{name:'estimate.pdf',type:'application/pdf',data:Buffer.from('%PDF-1.4 fixture'),pages:[page]}],{},request,20000,Date.now()+20000);
    assert.equal(result.extraction.facts[0].value,'kitchen');
    assert.deepEqual((result.extraction.takeoffs||[]).map(t=>t.id),['t1'],'the takeoff without a page reference is dropped, the section survives');
    assert.ok(result.extraction.reviewNotes.some(n=>/lacked a usable page reference/.test(n)));
  }finally{
    for(const [key,value] of [['OPENAI_API_KEY',saved.openai],['ANTHROPIC_API_KEY',saved.anthropic],['AI_INTEGRATIONS_OPENAI_API_KEY',saved.integrated]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('planning-book wording links back to the unanswered quantity question',()=>{
  assert.equal(missingNoteField('Missing quantity: sqft'),'sqft');
  assert.equal(missingNoteField('Missing quantity: cabinetUpperLf'),'cabinetUpperLf');
  assert.equal(missingNoteField('Missing quantity: tileSqft for the requested tile work'),'tileSqft');
  assert.equal(missingNoteField('Missing cost condition: structural for Beam work'),'structural');
  assert.equal(missingNoteField('Missing cost rate: 03-01-01'),null);
  assert.equal(missingNoteField('Missing quantity: specialist trade takeoff for the additional work in this task list'),null);
  assert.equal(missingNoteField('Missing quantity: sqftage'),null,'an unknown field is not offered');
  assert.deepEqual(missingScopeFields(['Missing quantity: cabinetUpperLf','Missing quantity: sqft','Missing quantity: sqft']).map(f=>f.field).sort(),['cabinetUpperLf','sqft']);
});

test('an unknown floor or model is not an unknown quantity; evidence remarks on a priced line are disclosure',async()=>{
  const {advisoryIssue}=await import('../lib/p5/scopePricing.ts');
  const outlet={...extra,id:'outlet',description:'Seller to replace one outlet in the front corner bedroom to correct the grounding issue; interior floor not specified.',evidence:'one outlet',researchDescription:'Replace one receptacle'};
  const rate={...planned.rates[0],taskId:'outlet',description:'Replace one receptacle',unit:'each',quantity:1,quantityEvidence:'One outlet requested',basis:'subcontractor-installed',low:60,high:140};
  const resolved=planningResolution({...planned,rates:[rate]},[outlet],now,0,'Boise');
  assert.equal(resolved.rules.length,1);assert.deepEqual(resolved.issues,[]);
  const unknownCount={...outlet,description:'Replace receptacles; quantity not specified.',evidence:''};
  assert.ok(planningResolution({...planned,rates:[{...rate,quantity:4}]},[unknownCount],now,0,'Boise').issues.some(i=>/unmeasured/.test(i)));
  assert.equal(advisoryIssue('plumbing-vent-boots is not supportably priced: scope-1 is not a planning-* line and relies only on uncited general estimating knowledge rather than a published estimating guide, construction-cost database, or approved catalog rate.'),true);
  assert.equal(advisoryIssue('gfci-receptacles has incorrect quantity evidence: planning-201 states that six devices are explicitly requested, but the RE-10 does not state a count. Scope-7 models six locations, so planning-201 must identify six as a modeled allowance rather than a verified quantity before the task is treated as fully covered.'),true);
  assert.equal(advisoryIssue('scope-1 is uncited and duplicates scope-2'),false);
  assert.equal(advisoryIssue('The sprinkler pump task has no positive priced line.'),false);
});
test('an OpenAI rate limit is waited out, not ended by an Anthropic account with no credit (live 2026-09-21)',async()=>{
  const {requestPricing}=await import('../lib/p5/scopePricing.ts');
  const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','OPENAI_BASE_URL','P5_PRICING_PROVIDER'] as const;
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const n of names)delete process.env[n];
  process.env.ANTHROPIC_API_KEY='synthetic-anthropic';process.env.OPENAI_API_KEY='synthetic-openai';
  const runtime=globalThis as typeof globalThis & {p5AnthropicBlockedUntil?:number};runtime.p5AnthropicBlockedUntil=0;
  const realFetch=globalThis.fetch;let anthropicCalls=0;
  globalThis.fetch=(async(input:any)=>{
    if(String(input).includes('anthropic.com')){anthropicCalls++;return new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API.'}}),{status:400});}
    return new Response(JSON.stringify({error:{code:'RATELIMIT_EXCEEDED',message:'Rate limit exceeded.'}}),{status:429});
  }) as typeof fetch;
  try{
    // The stage reports the OpenAI rate limit (a busy provider the job waits out), not the billing refusal.
    await assert.rejects(()=>requestPricing('JSON',{},false,20000),/^Error: pricing-provider-unavailable:429/);
    assert.equal(anthropicCalls,1);
    await assert.rejects(()=>requestPricing('JSON',{},false,20000),/pricing-provider-unavailable:429/);
    assert.equal(anthropicCalls,1,'Anthropic is parked after a billing refusal');
  }finally{
    globalThis.fetch=realFetch;runtime.p5AnthropicBlockedUntil=0;
    for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n]!;}
  }
});
