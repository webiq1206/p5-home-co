import test from 'node:test';
import assert from 'node:assert/strict';
import {missingScopeFields} from '../lib/p5/missingFields.ts';
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
