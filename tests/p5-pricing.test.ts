import test from "node:test";
import assert from "node:assert/strict";
import { COST_CATEGORIES, SERVICE_MATRIX, UNCONFIGURED_FINANCE, allowanceAdjustment, calculateP5Estimate, companyAllocation, customerEstimate, landedUnitCost, loadedHourlyCost, priceFromRiskAdjustedCost, type FinancePolicy, type PricingInput, type Service } from "../lib/p5/pricing.ts";

const now = new Date("2026-09-10T12:00:00Z");
const finance: FinancePolicy = { annualOverhead: 420000, annualRevenue: 6000000, forecastSource: "TEST FIXTURE ONLY: conservative forecast", reviewedAt: "2026-09-10", approvedBy: ["Nick"] };
function input(service: Service = "kitchen"): PricingInput {
  return { service, revision: "fixture-revision-1", scopeSummary: "Test project scope", uncertainty: "low", locationProvided: true,
    lines: [{ id: "trade-1", category: "subcontractors", description: "Complete defined trade scope", unit: "package", quantity: 1, unitCost: 60000,
      quantitySource: "TEST signed scope", evidence: { basis: "written-quote", reference: "TEST quote", verifiedAt: "2026-09-01", validUntil: "2026-10-01" } }],
    coverage: COST_CATEGORIES.map(category => ({ category, status: category === "subcontractors" ? "included" : "not-applicable", reason: "TEST ONLY: explicitly reviewed fixture coverage" })),
    risks: [], assumptions: [], exclusions: [], missingInformation: [], allowances: [],
  };
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("authoritative $60,000 / .60 example and seven divisors", () => {
  near(priceFromRiskAdjustedCost(60000, .20, .20), 100000);
  for (const [margin, divisor] of [[.10,.70],[.12,.68],[.15,.65],[.18,.62],[.20,.60],[.25,.55],[.30,.50]]) near(priceFromRiskAdjustedCost(60000,.20,margin),60000/divisor);
});
for (const [service, target, floor, stretch] of [
  ["handyman",.25,.20,.30],["re10",.25,.20,.30],["cabinet-product",.15,.12,.20],
  ["cabinet-install",.20,.15,.25],["kitchen",.20,.15,.25],["bathroom",.20,.15,.25],
  ["whole-home",.18,.15,.22],["addition",.15,.12,.20],["adu",.15,.12,.20],
  ["new-construction",.15,.10,.20],["change-order",.25,.20,.30],["rush",.25,.20,.30],
] as const) test(`${service}: exact service target, floor, stretch and allocation reconciliation`, () => {
  const result = calculateP5Estimate(input(service), finance, [], now);
  near(result.targetOperatingProfit,target); near(result.matrix.floor,floor); near(result.matrix.stretch,stretch);
  near(result.contractPrice, result.riskAdjustedDirectCost/(1-.20-target));
  near(result.allocationDollars.nick, result.contractPrice*.05);
  near(result.allocationDollars.jared,result.contractPrice*.05);
  near(result.allocationDollars.social,result.contractPrice*.02);
  near(result.allocationDollars.overhead,result.contractPrice*.08);
  near(result.operatingProfit,result.contractPrice*target);near(result.reconciliation,0);
  assert.equal(result.publishable,true);
  assert.ok(1-result.allocations.total-result.riskAdjustedDirectCost/result.planningRange.low >= floor-1e-10);
});
test("contingency is in direct cost before applying the formula", () => {
  const result = calculateP5Estimate({...input(),contingencyRate:.10},finance,[],now);
  near(result.contingency,6000);near(result.riskAdjustedDirectCost,66000);near(result.contractPrice,110000);
});
test("overhead immediately rises with the actual conservative forecast; profit stays intact", () => {
  const policy = {...finance,annualRevenue:2400000};
  const rates = companyAllocation(policy,now); near(rates.overhead,.175);near(rates.total,.295);
  const result = calculateP5Estimate(input(),policy,[],now);near(result.divisor,.505);near(result.targetOperatingProfit,.20);
});
test("missing or stale forecast cannot produce a customer range", () => {
  for (const policy of [UNCONFIGURED_FINANCE,{...finance,reviewedAt:"2026-05-01"},{...finance,reviewedAt:"2027-01-01"},{...finance,forecastSource:""}]) {
    const result = calculateP5Estimate(input(),policy,[],now);assert.equal(result.publishable,false);
    assert.equal(customerEstimate(result,"Test").range,null);
  }
});
test("invalid arithmetic and impossible overhead cannot produce totals", () => {
  for (const n of [-1,NaN,Infinity]) assert.throws(()=>priceFromRiskAdjustedCost(n,.20,.20));
  assert.throws(()=>priceFromRiskAdjustedCost(60000,.8,.2));
  assert.throws(()=>calculateP5Estimate(input(),{...finance,annualRevenue:100000},[],now));
});
test("below-floor pricing requires two distinct owners for this revision", () => {
  const i={...input(),targetMargin:.14};
  const a={owner:"Nick" as const,recordId:"stored-1",writtenReason:"Verified highly repeatable scope with documented strategic value",approvedAt:"2026-09-09",estimateRevision:i.revision};
  assert.equal(calculateP5Estimate(i,finance,[],now).publishable,false);
  assert.equal(calculateP5Estimate(i,finance,[a,a],now).publishable,false);
  assert.equal(calculateP5Estimate(i,finance,[a,{...a,owner:"Jared",estimateRevision:"old-revision"}],now).publishable,false);
  assert.equal(calculateP5Estimate(i,finance,[a,{...a,owner:"Jared",recordId:"stored-2"}],now).publishable,true);
});
test("urgent projects use the rush matrix with separate risk allowance", () => {
  const r=calculateP5Estimate({...input("new-construction"),urgency:"emergency",risks:["compressed-schedule"]},finance,[],now);
  assert.equal(r.service,"rush");assert.ok(r.targetOperatingProfit>=.25);assert.equal(r.matrix.floor,.20);assert.ok(r.contingency>0);
});
test("unknown location adds risk without demanding a street address", () => {
  const r=calculateP5Estimate({...input("new-construction"),locationProvided:false},finance,[],now);
  assert.ok(r.riskFactors.includes("jurisdiction-uncertain"));assert.equal(r.publishable,true);
});
test("uncertainty widens the range and never reduces the central direct cost", () => {
  const low=calculateP5Estimate(input(),finance,[],now);
  const high=calculateP5Estimate({...input(),uncertainty:"high"},finance,[],now);
  assert.ok(high.planningRange.high-high.planningRange.low>low.planningRange.high-low.planningRange.low);
  assert.ok(high.riskAdjustedDirectCost>=low.riskAdjustedDirectCost);
});
test("allowance increases and decreases use the same divisor and never double count", () => {
  near(allowanceAdjustment(1200,1000,.10,.20,.20),366.6666666666667);
  near(allowanceAdjustment(1000,1200,.10,.20,.20),-366.6666666666667);
  const i=input(); i.allowances=[{id:"a",description:"Fixture allowance",directAmount:60000,costLineIds:["trade-1"],includes:["Defined scope"],tax:true,freight:true,delivery:true,installation:true,waste:true,selectionDeadline:"2026-10-01"}];
  near(calculateP5Estimate(i,finance,[],now).directCost,60000);
  i.allowances.push({...i.allowances[0],id:"b"});assert.throws(()=>calculateP5Estimate(i,finance,[],now));
});
test("loaded labor and landed cost include every specified component", () => {
  near(loadedHourlyCost({wage:30,payrollTaxes:3,workersComp:2,benefits:4,paidNonproductiveTime:5,directLaborExpenses:6}),50);
  near(landedUnitCost({netPurchase:100,tax:6,freight:10,delivery:5,waste:7,storage:2,handling:3}),133);
});
test("missing burdens, owner replacement cost, stale quotes and incomplete scope block the range", () => {
  for (const category of ["materials","field-labor","owner-production"] as const) {
    const i=input();i.lines[0].category=category;
    assert.equal(calculateP5Estimate(i,finance,[],now).publishable,false);
  }
  const expired=input();expired.lines[0].evidence.validUntil="2026-09-01";assert.equal(calculateP5Estimate(expired,finance,[],now).publishable,false);
  const verbal=input();verbal.lines[0].evidence.basis="planning-assumption";assert.equal(calculateP5Estimate(verbal,finance,[],now).publishable,false);
  const missing=input();missing.coverage=[];assert.equal(calculateP5Estimate(missing,finance,[],now).publishable,false);
});
test("negative, blank, duplicate and inconsistent direct-cost lines are rejected", () => {
  for (const amount of [-10,0,NaN,Infinity]) {const i=input();i.lines[0].unitCost=amount;assert.throws(()=>calculateP5Estimate(i,finance,[],now));}
  const dupe=input();dupe.lines.push({...dupe.lines[0]});assert.throws(()=>calculateP5Estimate(dupe,finance,[],now));
  const blank=input();blank.lines[0].id="";assert.throws(()=>calculateP5Estimate(blank,finance,[],now));
});
test("market pressure flags the result without automatically cutting profit", () => {
  const r=calculateP5Estimate({...input(),benchmark:{low:100,high:1000,source:"TEST benchmark",validUntil:"2026-10-01"}},finance,[],now);
  near(r.targetOperatingProfit,.20);assert.ok(r.warnings.some(w=>w.code==="benchmark-outlier"));
});
test("customer projection excludes internal rates, evidence, approvals and dollars", () => {
  const r=calculateP5Estimate(input(),finance,[],now);const p=customerEstimate(r,"Kitchen");
  for (const key of ["divisor","operatingProfit","allocationDollars","financeSnapshot","ownerApprovals","lines","directCost","targetOperatingProfit"]) assert.equal(key in p,false);
  assert.match(p.disclaimer,/not a bid, quote, offer or guaranteed price/);
});
