import test from "node:test";
import assert from "node:assert/strict";
import {PROJECT_SERVICE_ROLES,PROJECT_MILESTONES,newProjectServices,projectServiceCode,projectServiceLines,validateProjectServices,projectOverheadCredit,PROJECT_OVERHEAD_CREDIT_ID,projectServiceHoursEditable,projectServiceCostBasis,documentProjectServiceBasis} from "../lib/p5/projectServices.ts";
import {PRICE_BOOK,priceBookRate} from "../lib/p5/priceBook.ts";
import {calculateP5Estimate,DEFAULT_FINANCE,COST_CATEGORIES,type PricingInput} from "../lib/p5/pricing.ts";
import {priceScope} from "../app/lib/scopes/pricing.ts";
import {DEFAULT_SCOPE_SETTINGS,emptyScope,type ScopeDoc,type ScopeTask,type ItemKey} from "../app/lib/scopes/types.ts";
import {carryForward,normalizeScope} from "../app/lib/scopes/normalize.ts";
import {buildEstimatePayload} from "../app/lib/scopes/estimate.ts";
import {priceEstimate,customerEstimate,internalReport} from "../app/lib/estimator/price.ts";
import {FLOWS} from "../app/lib/estimator/flows.ts";
import {BRAND_CONFIGS} from "../app/lib/estimator/brands.ts";
import {priceReviewedScope,type EstimatorConfiguration} from "../lib/p5/costBook.ts";
import {documentEstimate} from "../lib/p5/documentEstimateFigures.ts";
import {readSiteEstimate} from "../app/lib/leads/intakeContract.ts";
import {siteEstimatePricing} from "../app/lib/leads/site-estimate.ts";

const NOW=new Date("2026-11-23T12:00:00Z");
const roleCodes=PROJECT_SERVICE_ROLES.map(r=>r.code);
const ctx={service:"remodel",finishTier:"mid" as const,settings:DEFAULT_SCOPE_SETTINGS,acknowledged:new Set<string>(),now:NOW};
const task=(id:string,quantity=1):ScopeTask=>({
  id,title:"Install replacement door",description:"Install replacement door",phase:"construction",division:"08",
  costCode:"08-11-01",certainty:"confirmed",bucket:"approved",quantity:{value:quantity,unit:"EA"},evidence:[],
});
const input=(cost=10000):PricingInput=>({
  projectServices:newProjectServices(),service:"remodel",revision:"synthetic",scopeSummary:"Synthetic scope",
  lines:[{id:"trade",description:"Defined synthetic work",category:"subcontractors",quantity:1,unit:"LS",unitCost:cost,
    quantitySource:"Synthetic fixture",evidence:{basis:"written-quote",reference:"Synthetic quote",verifiedAt:NOW.toISOString(),validUntil:"2027-01-01"}}],
  coverage:COST_CATEGORIES.map(category=>({category,status:category==="subcontractors"?"included":"not-applicable",reason:"Synthetic fixture"})),
  risks:[],assumptions:[],exclusions:[],missingInformation:[],allowances:[],uncertainty:"low",locationProvided:true,
});

test("all three book codes have a final $120 hourly rate across tiers and remodel",()=>{
  for(const code of roleCodes) {
    const rows=PRICE_BOOK.filter(r=>r[0]===code);assert.equal(rows.length,1);
    for(const tier of ["builder","mid","high","luxury"] as const) for(const remodel of [false,true]){
      const rate=priceBookRate(rows[0],tier,remodel);
      assert.equal(rate.amount,120);assert.equal(rate.unit,"HR");assert.match(rate.source,/final client rate/);
    }
  }
});

test("three positive scope-based defaults scale; milestone totals and overrides are exact",()=>{
  const small=projectServiceLines(newProjectServices(),100,1);
  const large=projectServiceLines(newProjectServices(),1000000,100);
  assert.deepEqual(small.map(r=>r.quantity),[.25,.125,.125]);
  assert.deepEqual(large.map(r=>r.quantity),[500,200,100]);
  for(let i=0;i<3;i++) {
    assert.ok(large[i].quantity>small[i].quantity);
    assert.equal(large[i].price,large[i].quantity*120);
    assert.ok(Math.abs(PROJECT_MILESTONES.reduce((n,m)=>n+large[i].hours[m],0)-large[i].quantity)<1e-8);
  }
  const plan={...newProjectServices(),hours:{"01-31-03":{planning:2,delivery:4,closeout:1}}};
  assert.equal(projectServiceLines(plan,1000000,100)[0].quantity,7);
  assert.throws(()=>validateProjectServices({...plan,hours:{"01-31-03":{planning:0,delivery:0,closeout:0}}}),/positive/);
  assert.throws(()=>validateProjectServices({...plan,hours:{"01-31-03":{planning:NaN,delivery:1,closeout:1}}}),/finite/);
  assert.equal(validateProjectServices({...plan,hours:{"01-31-04":{planning:.125,delivery:0,closeout:0}}}).hours!["01-31-04"]!.planning,.125);
});

test("internal draft hours remain editable for new unsent estimates without unlocking issued or legacy quotes",()=>{
  const p=newProjectServices(),unsent={unsent:true,signed:false,invoiced:false};
  assert.equal(projectServiceHoursEditable(p),true);
  assert.equal(projectServiceHoursEditable(p,unsent),true);
  assert.equal(projectServiceHoursEditable(undefined,unsent),false);
  for(const gate of [{...unsent,unsent:false},{...unsent,signed:true},{...unsent,invoiced:true}])
    assert.equal(projectServiceHoursEditable(p,gate),false);
});

test("scope pricing aggregates rooms once, excludes duplicate fees/superintendent and is idempotent",()=>{
  const doc:ScopeDoc={...emptyScope(),projectServices:newProjectServices(),tasks:[task("kitchen"),task("bath"),
    {...task("duplicate"),costCode:"01-31-03"},{...task("superintendent"),costCode:"01-31-02"}]};
  const priced=priceScope(doc,ctx);
  const services=priced.lines.filter(l=>l.basis==="project-service");
  assert.deepEqual(services.map(l=>l.id),roleCodes);
  assert.ok(services.every(l=>l.unitPrice===120&&l.price===Math.round(l.quantity*12000)/100));
  assert.ok(!priced.lines.some(l=>l.taskId==="superintendent"||l.taskId==="duplicate"));
  assert.deepEqual(priceScope(doc,ctx),priced);
  const legacy=priceScope({...doc,projectServices:undefined,tasks:[task("kitchen"),task("bath")]},ctx);
  const credit=priced.lines.find(l=>l.id===PROJECT_OVERHEAD_CREDIT_ID)?.price??0;
  assert.ok(credit<=0);
  assert.ok(Math.abs(priced.totals.basePrice-legacy.totals.basePrice-services.reduce((n,l)=>n+l.price,0)-credit)<.011);
});

test("legacy scope versions stay unchanged and internal milestone decisions survive regeneration",()=>{
  const legacy={...emptyScope(),tasks:[task("one")]};
  assert.equal(priceScope(legacy,ctx).lines.some(l=>l.basis==="project-service"),false);
  const generated=normalizeScope(legacy,{assetIds:[],validCostCode:()=>true});
  const plan={...newProjectServices(),hours:{"01-31-05":{planning:.25,delivery:.5,closeout:1}}};
  assert.deepEqual(carryForward({...legacy,projectServices:plan},generated).projectServices,plan);
  assert.equal(carryForward(legacy,{...generated,projectServices:newProjectServices()}).projectServices,undefined);
});

test("document financial engine adds flat fees once with no markup, no extra profit and reconciles",()=>{
  const i=input();const legacy=calculateP5Estimate({...i,projectServices:undefined},DEFAULT_FINANCE,[],NOW);
  const priced=calculateP5Estimate(i,DEFAULT_FINANCE,[],NOW);
  const services=priced.lines.filter(l=>projectServiceCode(l.id));
  assert.equal(services.length,3);
  assert.ok(services.every(l=>l.sellingUnitPrice===120&&l.contingency===0&&l.operatingProfit===0));
  // New plans bill internal labor in full at $120/hr: no overhead credit.
  const credit=priced.projectServiceOverheadCredit??0;
  assert.equal(credit,0);
  assert.equal(priced.contractPrice-legacy.contractPrice,services.reduce((n,l)=>n+l.sellingAmount,0));
  // Saved plans from before 24 Nov 2026 (no overheadCredit flag) keep their credit.
  const {overheadCredit:_none,...savedPlan}=i.projectServices!;
  const saved=calculateP5Estimate({...i,projectServices:savedPlan},DEFAULT_FINANCE,[],NOW);
  const savedCredit=saved.projectServiceOverheadCredit??0;
  assert.equal(savedCredit,projectOverheadCredit(services.reduce((n,l)=>n+l.sellingAmount,0),legacy.contractPrice,legacy.allocations.overhead));
  assert.ok(savedCredit>0);
  assert.equal(priced.operatingProfit,legacy.operatingProfit);
  assert.ok(Math.abs(priced.reconciliation)<.00001);
  assert.deepEqual(calculateP5Estimate({...i,lines:priced.lines},DEFAULT_FINANCE,[],NOW),priced);
});

test("document reviewed-scope compiler passes the new-project marker, legacy snapshots do not gain fees",()=>{
  const configuration:EstimatorConfiguration={finance:DEFAULT_FINANCE,costBooks:[{
    service:"remodel",verifiedScope:"Synthetic",reviewedAt:NOW.toISOString(),coverage:input().coverage,
    assumptions:[],exclusions:[],rules:input().lines.map(l=>({...l,quantity:{fixed:1,factor:1}})),
  }]};
  const scope={text:"Synthetic door installation",answers:{service:"remodel",location:"Boise"},extraction:null,uploads:[],reviewedAt:NOW.toISOString(),corrections:[]};
  const a=priceReviewedScope({...scope,projectServices:newProjectServices()},configuration,NOW).internal;
  const b=priceReviewedScope(scope,configuration,NOW).internal;
  assert.equal("lines" in a&&a.lines?.filter(l=>projectServiceCode(l.id)).length,3);
  assert.equal("lines" in b&&b.lines?.filter(l=>projectServiceCode(l.id)).length,0);
});

test("every live brand embed project uses the same mandatory fees and total-only customer view",()=>{
  for(const brand of Object.values(BRAND_CONFIGS).filter(b=>b.live)) for(const project of brand.projects) {
    assert.ok(FLOWS.some(f=>f.id===project));
    const estimate=priceEstimate({brand:brand.id,project,tier:"mid",answers:{},address:"Synthetic test location",property:null},{now:NOW});
    const services=estimate.pricing.lines.filter(l=>l.basis==="project-service");
    if(brand.id==="handyman"){
      // Handyman Co bills $95/hr all-in on every job, paint and flooring included: no $120 lines.
      assert.equal(services.length,0,`${brand.id}/${project}`);
      assert.ok(!estimate.pricing.lines.some(l=>l.basis==="project-service-credit"),`${brand.id}/${project}: credit`);
    } else if(estimate.pricing.lines.some(l=>l.basis!=="project-service"&&l.basis!=="trip-charge")){
      assert.equal(services.length,3,`${brand.id}/${project}`);
      assert.ok(services.every(l=>l.unitPrice===120));
      const report=internalReport(estimate);
      assert.ok(roleCodes.every(code=>report.lines.some(line=>line.code===code)),`${brand.id}/${project}: internal codes`);
    }
    const customer=customerEstimate(estimate,{token:"synthetic",address:null,createdAt:NOW,officialCopy:"after-review"});
    assert.doesNotMatch(JSON.stringify(customer),/01-31-0[345]|unitCost|unitPrice|overheadRecovery/);
  }
});

test("QuickBooks retains three detailed hourly lines at $120, without sending or contacting QuickBooks",()=>{
  const pricing=priceScope({...emptyScope(),projectServices:newProjectServices(),tasks:[task("one")]},ctx);
  const itemIds=Object.fromEntries(pricing.lines.map(l=>[l.item,"synthetic-item"])) as Record<ItemKey,string>;
  const payload=buildEstimatePayload({customerId:"synthetic",pricing,itemIds,taxable:[],exclusions:[],privateNote:"Synthetic"});
  for(const role of PROJECT_SERVICE_ROLES){
    const line=payload.Line.find(l=>l.Description===role.name);
    assert.ok(line);assert.equal(line.DetailType,"SalesItemLineDetail");
    assert.equal(line.SalesItemLineDetail?.UnitPrice,120);
    assert.equal(line.SalesItemLineDetail?.ItemRef.value,role.qboItemId);
    assert.equal(line.Amount,(line.SalesItemLineDetail?.Qty??0)*120);
  }
});

test("small service and large projects retain all hourly roles without duplicate overhead recovery",()=>{
  for(const cost of [100,1000000]){
    const priced=calculateP5Estimate(input(cost),DEFAULT_FINANCE,[],NOW);
    const services=priced.lines.filter(l=>projectServiceCode(l.id));
    assert.equal(services.length,3);
    assert.ok(services.every(l=>l.quantity>0&&l.sellingUnitPrice===120));
    assert.ok((priced.projectServiceOverheadCredit??0)<=services.reduce((n,l)=>n+l.sellingAmount,0));
    assert.ok(Math.abs(priced.reconciliation)<.00001);
  }
});

test("document-to-QuickBooks transport preserves $120 hourly lines and exact net total, even over 60 lines",()=>{
  for(const count of [1,70]){
    const i=input(100);
    i.lines=Array.from({length:count},(_,n)=>({...i.lines[0],id:`trade-${n}`}));
    const priced=calculateP5Estimate(i,DEFAULT_FINANCE,[],NOW);
    const built=documentEstimate({scope:{answers:{service:"remodel"}},internal:priced,customer:{range:priced.planningRange}})!;
    assert.ok(built);
    assert.ok(Math.abs(built.estimate.lines.reduce((n,l)=>n+l.amount,0)-built.estimate.base)<.011);
    for(const role of PROJECT_SERVICE_ROLES){
      const line=built.estimate.lines.find(l=>l.title===role.name);
      assert.ok(line);assert.equal(line.unit,"HR");
      assert.equal(line.sku,role.code);
      assert.equal(line.amount,Math.round(line.quantity!*12000)/100);
    }
    assert.ok(built.estimate.lines.every(l=>l.amount>0));
    assert.ok(built.estimate.lines.length<=60);
  }
});

test("approved defaults use outside dollars only, never task count or per-milestone minimums",()=>{
  for(const tasks of [0,1,10000]){
    assert.deepEqual(projectServiceLines(newProjectServices(),0,tasks).map(l=>l.quantity),[.25,.125,.125]);
    assert.deepEqual(projectServiceLines(newProjectServices(),1000,tasks).map(l=>l.quantity),[.5,.2,.125]);
    assert.deepEqual(projectServiceLines(newProjectServices(),100000,tasks).map(l=>l.quantity),[50,20,10]);
  }
  const rows=projectServiceLines(newProjectServices(),100,1,{planning:100,delivery:0,closeout:0});
  for(const row of rows)assert.deepEqual(row.hours,{planning:row.quantity,delivery:0,closeout:0});
});

test("milestone outside costs allocate the whole-project total; unavailable costs split equally",()=>{
  const rows=projectServiceLines(newProjectServices(),10000,500,{planning:1000,delivery:8000,closeout:1000});
  assert.deepEqual(rows.map(l=>l.hours),[
    {planning:.5,delivery:4,closeout:.5},{planning:.2,delivery:1.6,closeout:.2},{planning:.1,delivery:.8,closeout:.1},
  ]);
  for(const row of projectServiceLines(newProjectServices(),0,0)){
    assert.ok(Object.values(row.hours).every(h=>h>0&&h<row.quantity));
    assert.ok(Math.abs(Object.values(row.hours).reduce((n,h)=>n+h,0)-row.quantity)<1e-8);
  }
  const override={...newProjectServices(),hours:{"01-31-05":{planning:.125,delivery:0,closeout:0}}};
  assert.deepEqual(projectServiceLines(override,1000000,1,{planning:0,delivery:1,closeout:0})[2].hours,override.hours["01-31-05"]);
});

test("the hours base excludes owners, prior allowances and itemized taxes; missing detail uses pre-owner costs",()=>{
  const line=input().lines[0];
  const basis=documentProjectServiceBasis([
    {...line,id:"outside",unitCost:10000,milestone:"delivery"},
    {...line,id:"materials",unitCost:1100,landed:{tax:100},milestone:"planning"},
    {...line,id:"owner",category:"owner-production",unitCost:10000},
    {...line,id:"01-31-01",category:"project-supervision",unitCost:3000},
    {...line,id:"01-31-03",unitCost:120},
    {...line,id:"overhead",category:"overhead",unitCost:40000},
    {...line,id:"profit",category:"profit",unitCost:40000},
    {...line,id:"taxes",category:"taxes",unitCost:40000},
  ]);
  assert.equal(basis.outsideDirectCost,11000);
  assert.deepEqual(basis.milestoneOutsideCosts,{planning:1000,delivery:10000,closeout:0});
  const fallback=projectServiceCostBasis([{cost:null}],2000);
  assert.equal(fallback.outsideDirectCost,2000);assert.equal(fallback.milestoneOutsideCosts,undefined);
  assert.deepEqual(projectServiceLines(newProjectServices(),fallback.outsideDirectCost,10).map(r=>r.quantity),[1,.4,.2]);
  assert.throws(()=>projectServiceCostBasis([{cost:100,tax:101}]),/tax/);
});

test("outside supervision stays chargeable, duplicate owner allowances are replaced once",()=>{
  const i=input();
  const owner={...i.lines[0],id:"01-31-02",category:"project-supervision" as const,unitCost:1000};
  const outside={...owner,id:"outside-supervisor",supervisionProvider:"outside" as const,unitCost:2000,
    evidence:{...owner.evidence,reference:"Written outside supervision quote; 01-31-02"}};
  const priced=calculateP5Estimate({...i,lines:[...i.lines,owner,outside]},DEFAULT_FINANCE,[],NOW);
  assert.ok(!priced.lines.some(l=>l.id===owner.id));
  assert.equal(priced.lines.find(l=>l.id===outside.id)?.cost,2000);
  assert.equal(priced.projectServiceBasis?.outsideDirectCost,12000);
  assert.ok(Math.abs(priced.reconciliation)<1e-8);
  assert.deepEqual(calculateP5Estimate({...i,lines:[...i.lines,owner,outside]},DEFAULT_FINANCE,[],NOW),priced);

  const scope=priceScope({...emptyScope(),projectServices:newProjectServices(),tasks:[
    {...task("outside"),costCode:"01-31-02",performer:"subcontractor",supervisionProvider:"outside",
      quote:{amount:1100,tax:100},milestone:"planning"},
    {...task("duplicate-owner"),costCode:"01-31-01",supervisionProvider:"owner"},
  ]},ctx);
  assert.ok(scope.lines.some(l=>l.taskId==="outside"&&l.basis==="written-quote"));
  assert.ok(!scope.lines.some(l=>l.taskId==="duplicate-owner"));
  assert.equal(scope.projectServiceBasis?.outsideDirectCost,1000);
  assert.deepEqual(scope.projectServiceBasis?.milestoneOutsideCosts,{planning:1000,delivery:0,closeout:0});
});

test("salary overlap is credited once and does not erase non-salary overhead",()=>{
  assert.equal(projectOverheadCredit(1000,1000,.2),95.24);
  assert.equal(projectOverheadCredit(1000,1000,.2,420000,0),0);
  assert.equal(projectOverheadCredit(20,1000,.2),20);
  const i=input(100);
  const p=calculateP5Estimate(i,{...DEFAULT_FINANCE,ownerSalaryOverheadAnnual:0},[],NOW);
  assert.equal(p.projectServiceOverheadCredit,0);
  const legacy=calculateP5Estimate({...i,projectServices:undefined},DEFAULT_FINANCE,[],NOW);
  assert.equal(p.contractPrice,legacy.contractPrice+60);
});

test("previous hourly-policy estimates retain their exact original hours and overhead credit",()=>{
  const i={...input(100),projectServices:{version:"project-services-v1" as const}};
  const priced=calculateP5Estimate(i,DEFAULT_FINANCE,[],NOW);
  assert.deepEqual(priced.lines.filter(l=>projectServiceCode(l.id)).map(l=>l.quantity),[1,.5,.25]);
  const before=calculateP5Estimate({...i,projectServices:undefined},DEFAULT_FINANCE,[],NOW);
  assert.equal(priced.projectServiceOverheadCredit,Math.round(before.contractPrice*before.allocations.overhead*100)/100);
  assert.equal(projectServiceHoursEditable(i.projectServices),false);
});

test("document intake preserves final $120 rates and the approved 48/49/47 QuickBooks mapping",()=>{
  const priced=calculateP5Estimate(input(1234.57),DEFAULT_FINANCE,[],NOW);
  const body=documentEstimate({internal:priced,customer:{range:priced.planningRange}})!.estimate;
  const parsed=readSiteEstimate(body);
  assert.equal(parsed.problem,null);assert.ok(parsed.estimate);
  const pricing=siteEstimatePricing("P5 Home Co",parsed.estimate!);
  const items=Object.fromEntries(pricing.lines.map(l=>[l.item,"legacy-item"])) as Record<ItemKey,string>;
  const payload=buildEstimatePayload({customerId:"synthetic",pricing,itemIds:items,taxable:[],exclusions:[],privateNote:"Synthetic"});
  for(const role of PROJECT_SERVICE_ROLES){
    const line=payload.Line.find(l=>l.SalesItemLineDetail?.ItemRef.value===role.qboItemId);
    assert.ok(line,role.code);
    assert.equal(line.SalesItemLineDetail!.UnitPrice,120);
    assert.equal(line.Amount,Math.round(line.SalesItemLineDetail!.Qty*12000)/100);
  }
  const wrong={...body,lines:body.lines.map(l=>l.sku?{...l,amount:l.amount+1}:l)};
  assert.match(readSiteEstimate(wrong).problem!,/120/);
});

test("review publication retains hour overrides atomically without upgrading legacy policy",async()=>{
  const {PGlite}=await import("@electric-sql/pglite");
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../lib/p5/manualReview.ts",import.meta.url),"utf8");
  const expression=source.match(/payload=(CASE WHEN payload->'projectServices'[\s\S]+? ELSE payload END)/)?.[1];
  assert.ok(expression,"Use the actual maintained publication assignment");
  const plan={...newProjectServices(),hours:{"01-31-04":{planning:.125,delivery:.25,closeout:.125}}};
  const db=await PGlite.create();
  try{
    for(const payload of [{other:"preserved"},{other:"preserved",projectServices:{version:"project-services-v1"}},
      {other:"preserved",projectServices:newProjectServices()}]){
      const {rows}=await db.query(`SELECT ${expression} AS payload FROM (SELECT $2::jsonb AS payload) saved`,
        [JSON.stringify({projectServices:plan}),JSON.stringify(payload)]);
      assert.deepEqual(rows[0].payload,payload.projectServices?.version===plan.version?{...payload,projectServices:plan}:payload);
    }
    const payload={projectServices:newProjectServices()};
    const {rows}=await db.query(`SELECT ${expression} AS payload FROM (SELECT $2::jsonb AS payload) saved`,
      [JSON.stringify({}),JSON.stringify(payload)]);
    assert.deepEqual(rows[0].payload,payload);
  }finally{await db.close();}
});
