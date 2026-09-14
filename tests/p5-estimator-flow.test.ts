import test from 'node:test';
import assert from 'node:assert/strict';
import {missingScopeFields,missingNoteField} from '../lib/p5/missingFields.ts';
import {categoryBreakdown,fieldCategory} from '../lib/p5/presentation.ts';
import {questionForField,questionReason} from '../lib/p5/adaptive.ts';
import {priceCompleteScope,planningResolution,RESEARCH_STAGE_MS,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {PricingStageTimeout} from '../lib/p5/pricingProgress.ts';
import {BACKGROUND_JOB_LIMIT_MS,CLIENT_BUDGET_MS} from '../lib/p5/processingBudget.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {estimatorTheme} from '../lib/p5/theme.ts';

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
  const groups=categoryBreakdown(result);
  assert.deepEqual(groups.map(g=>g.category),['Plumbing','Painting']);
  assert.equal(groups[0].low,100);assert.equal(groups[0].items[0].unitHigh,100);assert.equal(groups[0].items[0].status,'estimated-allowance');
  assert.deepEqual(groups[1].tasks,['Paint the walls']);assert.equal(groups[1].items.length,0);
});

test('processing budgets keep one browser wait under a minute while durable work continues',()=>{
  assert.ok(CLIENT_BUDGET_MS<60_000);
  assert.ok(BACKGROUND_JOB_LIMIT_MS>CLIENT_BUDGET_MS*5);
  assert.ok(RESEARCH_STAGE_MS<CLIENT_BUDGET_MS);
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
  assert.throws(()=>planningResolution({...planned,rates:[{...planned.rates[0],low:1,high:100}]},[extra],now,0,'Boise',scope),/Unsupported planning average range/);
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
  assert.equal(item.pricingStatus,'estimated-allowance');assert.match(item.verification,/not verified local pricing/);
  assert.ok(r.customer.assumptions.some((a:string)=>a.includes('Published cost research was not used')));
  assert.ok((r.internal as any).warnings.some((w:any)=>w.code==='planning-average-preliminary'&&w.severity==='review'));
  assert.ok(!JSON.stringify(r.customer).includes('unitCost'));
});

test('a typed scope is read by every configured provider at once and the first valid result wins',async()=>{
  const {analyzeBatch}=await import('../lib/p5/extraction.ts');
  const saved={openai:process.env.OPENAI_API_KEY,anthropic:process.env.ANTHROPIC_API_KEY,integrated:process.env.AI_INTEGRATIONS_OPENAI_API_KEY};
  process.env.OPENAI_API_KEY='fixture';process.env.ANTHROPIC_API_KEY='fixture';delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
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
    for(const [key,value] of [['OPENAI_API_KEY',saved.openai],['ANTHROPIC_API_KEY',saved.anthropic],['AI_INTEGRATIONS_OPENAI_API_KEY',saved.integrated]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
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
  assert.equal(advisoryIssue('Complete scope pricing could not be verified. An estimator must resolve the remaining work before a total is released.'),false);
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
