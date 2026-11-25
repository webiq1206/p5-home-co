import test from "node:test";
import assert from "node:assert/strict";
import {NET_POLICY_VERSION,allocatePrice,netQuotePrice,quoteForScope,residualRate,type ReviewedJobTerms} from "../lib/p5/netPricingPolicy.ts";
import {newProjectServices,projectServiceLines,resolveProjectServiceLine} from "../lib/p5/projectServices.ts";
import {priceEstimate,customerEstimate,priceWithheld} from "../app/lib/estimator/price.ts";
import {BRAND_CONFIGS} from "../app/lib/estimator/brands.ts";
import {calculateP5Estimate,DEFAULT_FINANCE,COST_CATEGORIES,type PricingInput} from "../lib/p5/pricing.ts";

const competitive = {costsVerified:true,scopeDefined:true,capacityOrRepeat:true,ownerReturnConfirmed:true,cashCovered:true,reason:"Repeat work, confirmed hours and funded materials."};
const finance = {...DEFAULT_FINANCE,interestRate:.01, companyTaxRate:.005,netCostSource:"Illustrative confirmed company budget, owner payroll included."};
test("approved examples match the Drive worksheet after gross and net checks",()=>{
  const cabinet=netQuotePrice({jobClass:"builder-cabinets",direct:7000,otherCostDollars:1400,otherCostRate:0,competitive,minimumGrossTarget:.25});
  const kitchen=netQuotePrice({jobClass:"same-layout-kitchen",direct:32000,otherCostDollars:4000,otherCostRate:0,competitive});
  const addition=netQuotePrice({jobClass:"simple-addition",direct:140000,otherCostDollars:30000,otherCostRate:0,competitive});
  assert.deepEqual([cabinet.price,kitchen.price,addition.price],[9883,44445,200000]);
  for(const q of [cabinet,kitchen,addition]) assert.ok(q.netMargin>=.15);
});
test("verified terms, owner return, unallocated sales expenses and protected quotes",()=>{
  const terms:ReviewedJobTerms={jobClass:"simple-addition",otherCostDollars:30000,otherCostRate:.015,costSource:"Site verified",competitive};
  const floor=quoteForScope("addition","One story",[],140000,.20,0,150000,terms);
  assert.ok(floor.lowerTier&&floor.netMargin>=.15);
  const normal=quoteForScope("addition","One story",[],140000,.20,0,150000,{...terms,competitive:{...competitive,cashCovered:false}});
  assert.ok(normal.price>floor.price && !normal.lowerTier);
  for(const risk of ["Second story","Underpinning","Unknown utilities","Major structural tie-in"]){
    const q=quoteForScope("addition",risk,[],140000,.20,0,235000,terms);
    assert.equal(q.jobClass,"protected");assert.ok(q.price>=235000 && !q.lowerTier);
  }
  assert.equal(residualRate(finance,.20).rate,.21500000000000002);
  assert.equal(residualRate(DEFAULT_FINANCE,.20).confirmed,false);
  assert.deepEqual(allocatePrice(10,[1,1,1]),[3.33,3.34,3.33]);
});
test("every guided brand and project returns a protected range or withholds pricing",()=>{
  for(const brand of Object.values(BRAND_CONFIGS)) for(const project of brand.projects){
    const estimate=priceEstimate({brand:brand.id,project,answers:{},tier:"mid",address:null,property:null},{finance});
    const view=customerEstimate(estimate,{token:"test-policy",address:null,createdAt:new Date(),officialCopy:"after-review"});
    if(priceWithheld(estimate)){assert.equal(view.range,null);continue;}
    const q=estimate.pricing.netPricing;assert.ok(q,brand.id+"/"+project);
    assert.ok(view.range && view.range.low>=q.price && q.netMargin>=.15);
    assert.equal(Math.round(100*estimate.pricing.lines.filter(l=>!l.optional).reduce((a,l)=>a+l.price,0)),100*estimate.pricing.totals.basePrice);
    assert.ok(!JSON.stringify(view).includes("netPricing"));
    assert.ok(view.divisions.every(d=>!("low" in d)&&!("high" in d)));
  }
});
test("QBO respects the immutable rate on the stored estimate",()=>{
  for(const [plan,rate] of [[newProjectServices(),125],[{version:"project-services-v2" as const},120]] as const) {
    for(const item of projectServiceLines(plan,4500,1)){
      const resolved=resolveProjectServiceLine({sku:item.code,unit:"HR",unitPrice:item.unitPrice,quantity:item.quantity,amount:item.price});
      assert.equal(resolved?.unitPrice,rate);assert.ok(["47","48","49"].includes(resolved!.qboItemId));
    }
  }
  assert.throws(()=>resolveProjectServiceLine({sku:"01-31-03",unit:"HR",unitPrice:117,quantity:1,amount:117}));
});
const doc:PricingInput={pricingVersion:NET_POLICY_VERSION,service:"handyman",revision:"test",scopeSummary:"One contractor visit",locationProvided:true,risks:[],assumptions:[],exclusions:[],allowances:[],missingInformation:[],uncertainty:"low",
  lines:[{id:"visit",category:"subcontractors",description:"Documented fixed callout",unit:"EA",quantity:1,unitCost:99,fixedSaleUnitPrice:135,quantitySource:"Signed scope",evidence:{basis:"written-quote",reference:"Vendor callout quote",verifiedAt:"2026-11-01",validUntil:"2026-12-01"}}],
  coverage:COST_CATEGORIES.map(category=>({category,status:category==="subcontractors"?"included":"not-applicable",reason:"Explicitly reviewed"}))};
test("fixed rate and pass-through lines retain their amounts and a loss is withheld",()=>{
  const q=calculateP5Estimate(doc,finance,[],new Date("2026-11-24"));
  assert.equal(q.contractPrice,135);assert.equal(q.lines[0].sellingAmount,135);
  assert.ok(!q.publishable && q.warnings.some(w=>w.code==="fixed-rate-conflict"));
  const cents=calculateP5Estimate({...doc,lines:[{...doc.lines[0],unitCost:40,fixedSaleUnitPrice:156.25}]},finance,[],new Date("2026-11-24"));
  assert.equal(cents.publishable,true);assert.equal(cents.netPricing!.price,156.25);
  const mixed=calculateP5Estimate({...doc,lines:[...doc.lines,{...doc.lines[0],id:"trade",fixedSaleUnitPrice:undefined,unitCost:450}]},finance,[],new Date("2026-11-24"));
  assert.equal(mixed.lines[0].sellingAmount,135);assert.equal(mixed.lines.reduce((n,l)=>n+l.sellingAmount,0),mixed.contractPrice);
  assert.ok(mixed.netPricing!.netMargin>=.15);assert.ok(Math.abs(mixed.reconciliation)<.00001);
});

test("a protected firm proposal requires an approved same-scope price", () => {
  const input: PricingInput = {...doc, service:"new-construction", firmPrice:true,
    lines:doc.lines.map(line=>({...line, fixedSaleUnitPrice:undefined, unitCost:45000})),
    scopeSummary:"Detached new home"};
  const date = new Date("2026-11-24");
  const initial = calculateP5Estimate(input, finance, [], date);
  assert.equal(initial.publishable, false);
  assert.ok(initial.warnings.some(w => w.code === "protected-price-review" && w.severity === "block"));
  const reviewed = calculateP5Estimate({...input, reviewedJobTerms:{jobClass:"protected", otherCostDollars:10000,
    otherCostRate:0, costSource:"Reviewed job budget", approvedSameScopePrice:100000}}, finance, [], date);
  assert.ok(reviewed.contractPrice >= 100000);
  assert.ok(!reviewed.warnings.some(w => w.code === "protected-price-review"));
});

test("fixed handyman labor counts toward one minimum per dispatch", () => {
  for (const [visits, expected] of [[1, 190], [2, 270]]) {
    const estimate = calculateP5Estimate({...doc, lines:[
      {...doc.lines[0], id:"labor", bookCode:"01-01-01", quantity:2, unitCost:30, fixedSaleUnitPrice:undefined},
      {...doc.lines[0], id:"minimum", bookCode:"01-01-07", quantity:visits, unitCost:0, fixedSaleUnitPrice:undefined},
    ]}, finance, [], new Date("2026-11-24"));
    assert.equal(estimate.contractPrice, expected);
    assert.equal(estimate.lines.reduce((sum,line)=>sum+line.sellingAmount,0), expected);
  }
});
