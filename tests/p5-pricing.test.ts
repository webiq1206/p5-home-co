import test from "node:test";
import assert from "node:assert/strict";
import {tradeForLine,apportionAmount} from "../lib/p5/trades.ts";
import {validateReferences,compareReference,referenceDirectCostBudget,type PriceReference} from "../lib/p5/references.ts";
import {combineScopeExtractions,mergeScopeFacts} from "../lib/p5/scope.ts";
import {analyzeScope} from "../lib/p5/extraction.ts";
import {PDFDocument} from "pdf-lib";
import { COST_CATEGORIES, SERVICE_MATRIX, UNCONFIGURED_FINANCE, allowanceAdjustment, calculateP5Estimate, companyAllocation, customerEstimate, customerSafeNotes, landedUnitCost, loadedHourlyCost, priceFromRiskAdjustedCost, type FinancePolicy, type PricingInput, type Service } from "../lib/p5/pricing.ts";

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
  ["handyman",.12,.10,.15],["re10",.12,.10,.15],["cabinet-product",.12,.10,.15],
  ["cabinet-install",.12,.10,.15],["kitchen",.12,.10,.15],["bathroom",.12,.10,.15],
  ["whole-home",.12,.10,.15],["addition",.12,.10,.15],["adu",.12,.10,.15],
  ["new-construction",.12,.10,.15],["change-order",.12,.10,.15],["rush",.25,.20,.30],
] as const) test(`${service}: exact service target, floor, stretch and allocation reconciliation`, () => {
  const result = calculateP5Estimate(input(service), finance, [], now);
  near(result.targetOperatingProfit,target); near(result.matrix.floor,floor); near(result.matrix.stretch,stretch);
  near(result.contractPrice, result.riskAdjustedDirectCost/(1-.20-target));
  assert.deepEqual(Object.keys(result.allocationDollars),["overhead"]);
  near(result.allocationDollars.overhead,result.contractPrice*.20);
  near(result.operatingProfit,result.contractPrice*target);near(result.reconciliation,0);
  assert.equal(result.publishable,true);
  assert.ok(1-result.allocations.total-result.riskAdjustedDirectCost/result.planningRange.low >= floor-1e-10);
});
test("contingency is in direct cost before applying the formula", () => {
  const result = calculateP5Estimate({...input(),contingencyRate:.10},finance,[],now);
  near(result.contingency,6000);near(result.riskAdjustedDirectCost,66000);near(result.contractPrice,66000/.68);
});
test("the budget is recovered once and only increases above the approved standard", () => {
  for(const [revenue,required] of [[1400000,.30],[2000000,.21],[2100000,.20],[2400000,.175],[3000000,.14],[4000000,.105],[5000000,.084]]){
    const policy={...finance,annualRevenue:revenue};
    const rates=companyAllocation(policy,now);near(rates.requiredOverhead!,required);near(rates.total,Math.max(.20,required));near(rates.overhead,rates.total);
    const result=calculateP5Estimate(input(),policy,[],now);near(result.divisor,1-Math.max(.20,required)-.12);near(result.targetOperatingProfit,.12);
  }
});
test("the approved initial rate works without a forecast and keeps overdue reviews visible", () => {
  for (const policy of [UNCONFIGURED_FINANCE,{...finance,reviewedAt:"2026-05-01"},{...finance,forecastSource:""}]) {
    const result = calculateP5Estimate(input(),policy,[],now);assert.equal(result.publishable,true);
    assert.ok(customerEstimate(result,"Test").range);near(result.allocations.total,.20);assert.ok(result.requiresAdminReview);
  }
  const future=calculateP5Estimate(input(),{...finance,reviewedAt:"2027-01-01"},[],now);assert.equal(future.publishable,false);
  const staleHigher=companyAllocation({...finance,annualRevenue:1400000,reviewedAt:"2026-01-01"},now);near(staleHigher.total,.30);
});
test("17.5 percent requires earned-revenue evidence instead of just a sales goal",()=>{
  const reduced={...finance,annualRevenue:2400000,overheadRate:.175};
  const blocked=calculateP5Estimate(input(),reduced,[],now);assert.equal(blocked.publishable,false);near(blocked.allocations.total,.20);
  const evidence={annualizedEarnedRevenue:2400000,annualizedOverhead:420000,source:"TEST ONLY: consistent earned revenue and complete overhead for the reviewed period",reviewedAt:"2026-09-01"};
  const approved=calculateP5Estimate(input(),{...reduced,reducedRateReview:evidence},[],now);assert.equal(approved.publishable,true);near(approved.allocations.total,.175);near(approved.divisor,.705);
  for(const changed of [{...evidence,annualizedEarnedRevenue:2200000},{...evidence,annualizedOverhead:430000},{...evidence,reviewedAt:"2026-01-01"},{...evidence,source:""}])assert.equal(calculateP5Estimate(input(),{...reduced,reducedRateReview:changed},[],now).publishable,false);
  assert.equal(calculateP5Estimate(input(),{...finance,annualOverhead:360000},[],now).publishable,false);
});
test("invalid arithmetic and impossible overhead cannot produce totals", () => {
  for (const n of [-1,NaN,Infinity]) assert.throws(()=>priceFromRiskAdjustedCost(n,.20,.20));
  assert.throws(()=>priceFromRiskAdjustedCost(60000,.8,.2));
  assert.throws(()=>calculateP5Estimate(input(),{...finance,annualRevenue:100000},[],now));
});
test("below-floor pricing requires two distinct owners for this revision", () => {
  const i={...input(),targetMargin:.08};
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
  near(r.targetOperatingProfit,.12);assert.ok(r.warnings.some(w=>w.code==="benchmark-outlier"));
});
test("customer projection excludes internal rates, evidence, approvals and dollars", () => {
  const r=calculateP5Estimate(input(),finance,[],now);const p=customerEstimate(r,"Kitchen");
  for (const key of ["divisor","operatingProfit","allocationDollars","financeSnapshot","ownerApprovals","lines","directCost","targetOperatingProfit"]) assert.equal(key in p,false);
  assert.match(p.disclaimer,/not a bid, quote, offer or guaranteed price/);
});
test("customer notes retain honest allowances without leaking internal unit-cost arithmetic",()=>{
  const leaking="$2.00/LF ($200.00 direct cost)";
  const i=input();i.scopeSummary=`Reviewed remodeling scope; ${leaking}`;i.lines[0].description=`Install 100 LF of trim; ${leaking}`;
  i.assumptions=["Existing layout remains.",leaking,`Preliminary trim allowance based on ${leaking}; confirm field quantity.`];
  i.exclusions=[`Painting excluded; ${leaking}`];
  i.allowances=[{id:"trim",description:`Trim selection; ${leaking}`,directAmount:60000,costLineIds:["trade-1"],includes:[`100 LF trim; ${leaking}`],tax:true,freight:true,delivery:true,installation:true,waste:true,selectionDeadline:"2026-10-01"}];
  const internal=calculateP5Estimate(i,finance,[],now),customer=customerEstimate(internal,i.scopeSummary);
  assert.ok(internal.assumptions.includes(leaking),"the admin result retains the original pricing audit note");
  assert.ok(customer.assumptions.includes("Existing layout remains."));
  assert.ok(customer.assumptions.some(note=>/Preliminary trim allowance; confirm field quantity/.test(note)));
  assert.match(customer.summary,/Reviewed remodeling scope/);
  assert.match(customer.lineItems[0].description,/Install 100 LF of trim/);
  assert.match(customer.exclusions[0],/Painting excluded/);
  assert.match(customer.allowances[0].description,/Trim selection/);
  assert.match(customer.allowances[0].includes[0],/100 LF trim/);
  assert.equal(customer.lineItems[0].quantity,internal.lines[0].quantity);
  assert.deepEqual(customer.range,internal.planningRange);
  assert.ok(!JSON.stringify(customer).includes(leaking));
  assert.ok(!JSON.stringify(customer).includes("direct cost"));
  assert.deepEqual(customerSafeNotes([leaking]),[]);
});
test("overhead doors and lights retain their scope while financial overhead stays private",()=>{
  const i=input();
  i.lines=[{...i.lines[0],id:"door",description:"Repair the overhead garage door and its opener.",unitCost:400},{...i.lines[0],id:"lights",description:"Replace two overhead lights.",unitCost:200}];
  i.assumptions=["Overhead recovery rate is 20%.","Overhead: 20%", "$120 for overhead", "Use existing overhead wiring."];
  const internal=calculateP5Estimate(i,finance,[],now);
  const customer=customerEstimate(internal,"Repair the overhead garage door and replace two overhead lights.");
  assert.match(customer.summary,/overhead garage door/);
  assert.deepEqual(customer.lineItems.map(line=>line.description),i.lines.map(line=>line.description));
  assert.deepEqual(customer.assumptions,["Use existing overhead wiring."]);
  assert.deepEqual(customer.range,internal.planningRange);
  assert.equal(customer.lineItems.reduce((sum,line)=>sum+line.low,0),customer.range!.low);
  assert.equal(customer.lineItems.reduce((sum,line)=>sum+line.high,0),customer.range!.high);
  assert.ok(internal.assumptions.includes("Overhead: 20%"));
});
test("customer categories use trades and reconcile both endpoints without exposing costs",()=>{
  const i=input();i.lines=[{...i.lines[0],id:"paint",description:"Painting",trade:"Painting",unitCost:15000},{...i.lines[0],id:"drywall",description:"Drywall",trade:"Drywall",unitCost:25000},{...i.lines[0],id:"floor",description:"Flooring",trade:"Flooring",unitCost:20000}];
  const result=calculateP5Estimate(i,finance,[],now),customer=customerEstimate(result,"Reviewed scope");
  assert.deepEqual(customer.includedCategories,["Painting","Drywall","Flooring"]);
  assert.equal(customer.categoryRanges.reduce((n,c)=>n+c.low,0),customer.range!.low);
  assert.equal(customer.categoryRanges.reduce((n,c)=>n+c.high,0),customer.range!.high);
  const incomplete={...i,coverage:[]};assert.equal(customerEstimate(calculateP5Estimate(incomplete,UNCONFIGURED_FINANCE,[],now),"Scope").categoryRanges.length,0);
  assert.equal(tradeForLine({description:"Mini split installation"}),"Heating & Cooling");
  assert.throws(()=>tradeForLine({description:"Painting",trade:"Unknown"}));
  assert.deepEqual(apportionAmount(10,[1,1,1]),[4,3,3]);
});
test("every item recovers overhead and profit once, with exact customer reconciliation",()=>{
  const i=input();i.lines=[{...i.lines[0],id:"a",trade:"Painting",quantity:33.33,unit:"SF",unitCost:12.3456},{...i.lines[0],id:"b",trade:"Painting",quantity:7,unitCost:81.07},{...i.lines[0],id:"c",trade:"Drywall",quantity:1234,unit:"SF",unitCost:2.031}];
  const result=calculateP5Estimate(i,UNCONFIGURED_FINANCE,[],now),customer=customerEstimate(result,"Test items");
  let overhead=0,profit=0,selling=0;
  for(const line of result.lines){near(line.cost+line.contingency+line.overheadRecovery+line.operatingProfit,line.sellingAmount);near(line.sellingUnitPrice*line.quantity,line.sellingAmount);overhead+=line.overheadRecovery;profit+=line.operatingProfit;selling+=line.sellingAmount;}
  near(overhead,result.allocationDollars.overhead);near(profit,result.operatingProfit);near(selling,result.contractPrice);
  for(const endpoint of ["low","high"] as const){assert.equal(customer.lineItems.reduce((s,l)=>s+l[endpoint],0),customer.range![endpoint]);for(const category of customer.categoryRanges)assert.equal(customer.lineItems.filter(l=>l.category===category.category).reduce((s,l)=>s+l[endpoint],0),category[endpoint]);}
  for(const line of customer.lineItems){for(const key of ["unitCost","cost","contingency","overheadRecovery","operatingProfit","evidence"])assert.equal(key in line,false);near(line.unitLow*line.quantity,line.low);near(line.unitHigh*line.quantity,line.high);}
});
test("owner salaries in overhead cannot be charged again as production wages",()=>{
  const i=input();i.lines=[{...i.lines[0],category:"owner-production",quantity:20,unit:"hour",unitCost:60,evidence:{basis:"market-replacement",reference:"TEST ONLY additional replacement labor outside the salaried budget",verifiedAt:"2026-09-01",validUntil:"2026-10-01"}}];
  i.coverage=COST_CATEGORIES.map(category=>({category,status:category==="owner-production"?"included":"not-applicable",reason:"TEST ONLY verified applicable coverage"}));
  assert.equal(calculateP5Estimate(i,finance,[],now).publishable,false);
  i.lines[0].ownerLaborTreatment="included-in-overhead";assert.equal(calculateP5Estimate(i,finance,[],now).publishable,false);
  i.lines[0].ownerLaborTreatment="additional-project-labor";assert.equal(calculateP5Estimate(i,finance,[],now).publishable,true);
});
test("historical unit prices produce cost ceilings without being treated as net cost",()=>{
  const budget=referenceDirectCostBudget(100,.20,.20,.10);near(budget.maximumDirectUnitCost,60/1.10);
  near(budget.maximumDirectUnitCost*1.10/.60,100);assert.match(budget.note,/not an observed/);
  assert.throws(()=>referenceDirectCostBudget(100,.80,.20,.10));assert.throws(()=>referenceDirectCostBudget(-1,.20,.20,.10));
});
test("selling prices and unknown bases cannot pass as direct costs",()=>{
  for(const basis of ["customer-price","unknown"] as const){const i=input();i.lines[0].priceBasis=basis;const r=calculateP5Estimate(i,finance,[],now);assert.equal(r.publishable,false);assert.ok(r.warnings.some(w=>w.code==="selling-price-as-cost"));}
});
test("historical comparisons require compatible base scope and never apply a second markup",()=>{
  const reference:PriceReference={id:"test-ref",source:"Synthetic reference",sourceDate:"2026-09-01",page:1,trade:"Painting",description:"Defined paint scope",quantity:100,unit:"SF",unitPrice:4,extendedPrice:400,priceBasis:"customer-price",commercialStatus:"base",location:"Synthetic location",conditions:"Synthetic scope",warnings:[]};
  const selection={referenceId:reference.id,costLineId:"paint",quantity:200,unit:"SF",adjustedCustomerUnitPrice:4.5,scopeConfirmed:true,locationConfirmed:true,dateConfirmed:true,rationale:"Synthetic scope matches after documented finish and date adjustments."};
  const result=compareReference(reference,selection,700);assert.equal(result.comparablePrice,900);assert.equal(result.status,"below-reference");
  for(const variant of [{...reference,commercialStatus:"optional"},{...reference,priceBasis:"unknown"},{...reference,warnings:["Unit is unclear"]},{...reference,quantity:0}])assert.throws(()=>compareReference(variant as PriceReference,selection,700));
  assert.throws(()=>compareReference(reference,{...selection,unit:"LF"},700));
  assert.throws(()=>compareReference(reference,{...selection,dateConfirmed:false},700));
  assert.throws(()=>validateReferences([reference,reference]));
  assert.ok(validateReferences([{...reference,extendedPrice:500}])[0].warnings.length);
});
test("page merging preserves additive trade scope and conflicting measurements",()=>{
  const part=(field:string,value:string,source:string)=>({summary:"Scope",facts:[{field:field as "plumbing"|"sqft",value,source,evidence:value,confidence:.99}],conflicts:[],missingInformation:[],reviewNotes:[]});
  const combined=combineScopeExtractions([part("plumbing","Install sink","Page 1"),part("plumbing","Replace supply lines","Page 2"),part("sqft","200","Page 1"),part("sqft","300","Page 2")]);
  const merged=mergeScopeFacts({},combined);
  assert.match(merged.answers.plumbing!,/Install sink\nReplace supply lines/);
  assert.equal(merged.answers.sqft,undefined);assert.ok(merged.conflicts.some(c=>c.field==="sqft"));
});
test("PDF analysis accounts for every page and holds failed pages for review",async()=>{
  const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
  const saved=Object.fromEntries(names.map(key=>[key,process.env[key]]));names.forEach(key=>delete process.env[key]);process.env.OPENAI_API_KEY='synthetic-only';
  try{
    const doc=await PDFDocument.create();for(let i=0;i<17;i++)doc.addPage();const calls:string[]=[];
    const transport:typeof fetch=async(_url,options)=>{
      const body=JSON.parse(String(options?.body));const label=body.input[0].content.find((x:{text?:string})=>x.text?.startsWith('Source filename:')).text;
      calls.push(label);const manifest=JSON.parse(label.split('Original page manifest: ')[1]);
      if(manifest.some((p:{page:number})=>p.page===9))return new Response('failure',{status:503});
      return Response.json({status:'completed',model:'gpt-4.1-2025-04-14',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'Synthetic page scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],pages:manifest.map((p:object)=>({...p,sheet:'',revision:'',status:'read',notes:[]}))})}]}]});
    };
    const result=await analyzeScope('Synthetic scope',[{name:'synthetic.pdf',type:'application/pdf',data:Buffer.from(await doc.save())}],{},transport);
    assert.equal(calls.length,3);assert.equal(result.extraction.documentCoverage?.complete,false);
    assert.equal(result.extraction.documentCoverage?.expectedPages,17);
    assert.match(result.extraction.reviewNotes.join(' '),/pages 9 to 16 of 17/);
  }finally{names.forEach(key=>{if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];});}
});

test("explicit complex scope uses the approved higher target without reducing service safeguards",()=>{
  for(const service of ["kitchen","cabinet-product","whole-home","addition","adu","new-construction"] as const){
    const complex=calculateP5Estimate({...input(service),complexity:"complex"},finance,[],now);
    near(complex.targetOperatingProfit,.14);near(complex.matrix.stretch,.15);near(complex.matrix.floor,SERVICE_MATRIX[service].floor);near(complex.allocations.total,.20);near(complex.reconciliation,0);
    const risk=calculateP5Estimate({...input(service),complexity:"complex",risks:["hidden-conditions","limited-access","difficult-sequencing","incomplete-plans"]},finance,[],now);assert.ok(risk.targetOperatingProfit>=.14&&risk.targetOperatingProfit<=.15);
  }
  assert.throws(()=>calculateP5Estimate({...input(),complexity:"invalid" as any},finance,[],now));
});

test("a labeled regional planning average is reviewed, never a reason to withhold the range", () => {
  const planningLine = { id: "planning-1", category: "materials" as const, description: "Ceiling drywall patch materials",
    unit: "SF", quantity: 30, unitCost: 12, quantitySource: "TEST customer statement",
    estimatingBasis: "regional-planning-average",
    evidence: { basis: "regional-planning-average" as const, reference: "TEST regional average", verifiedAt: "2026-09-01", validUntil: "2026-10-01" } };
  // No estimatePurpose: the ordinary path a brand cost book takes. Before this
  // change that combination produced planning-average-preliminary-only at
  // severity block, and one slow research lookup meant no estimate at all.
  const coverage = COST_CATEGORIES.map(category => ({ category, status: category === "materials" ? "included" as const : "not-applicable" as const, reason: "TEST ONLY: explicitly reviewed fixture coverage" }));
  // estimatePurpose 'preliminary' is what costBook now declares whenever any
  // line is priced from an allowance, which is the case the research timeout
  // produces.
  const result = calculateP5Estimate({ ...input("handyman"), lines: [planningLine as never], coverage, estimatePurpose: "preliminary" }, finance, [], now);
  const blocking = result.warnings.filter(w => w.severity === "block");
  assert.deepEqual(blocking, [], `a planning average must not block: ${blocking.map(w => w.code).join(", ")}`);
  assert.ok(result.warnings.some(w => w.code.startsWith("planning-average-preliminary")), "it is still raised for review");
  const customer = customerEstimate(result, "Ceiling repair");
  assert.ok(customer.range, "the planning range is released");
  assert.ok(customer.disclaimer.toLowerCase().includes("not a bid"), "and stays explicitly preliminary");
});

test("uncertain lines widen the high end as independent errors, not all at their worst case together", () => {
  // Twenty small allowances, each with an unverified count of 1 to 5. Live on the Marcliffe RE-10 the
  // stacked worst case produced $28,200 to $45,900 for a list of small repairs.
  const base = input("re10");
  const line = (i: number) => ({ ...base.lines[0], id: `repair-${i}`, description: `Repair ${i}`, unit: "each", quantity: 3, unitCost: 200, quantityRange: { low: 1, high: 5 } });
  const many = calculateP5Estimate({ ...base, lines: Array.from({ length: 20 }, (_, i) => line(i)) }, finance, [], now);
  const worst = calculateP5Estimate({ ...base, lines: Array.from({ length: 20 }, (_, i) => ({ ...line(i), quantity: 5, quantityRange: undefined })) }, finance, [], now);
  assert.ok(many.planningRange.high < worst.contractPrice, "twenty upsides no longer compound into every line at its worst case");
  assert.ok(many.planningRange.high >= many.contractPrice, "the high end never falls below the modeled price");
  // One uncertain allowance keeps its whole upside.
  const one = calculateP5Estimate({ ...base, lines: [line(0)] }, finance, [], now);
  const oneFull = calculateP5Estimate({ ...base, lines: [{ ...line(0), quantity: 5, quantityRange: undefined }] }, finance, [], now);
  assert.ok(one.planningRange.high >= oneFull.contractPrice * 0.999, "a single allowance's full upside is still covered");
});

test("an RE-10 gets one firm price: the modeled contract price, shown as a single number everywhere", async () => {
  const {isRe10Scope} = await import("../lib/p5/costBook.ts");
  const {priceText, priceLabel} = await import("../lib/p5/presentation.ts");
  const base = input("re10");
  const line = { ...base.lines[0], id: "boot", description: "Vent boot", unit: "each", quantity: 3, unitCost: 200, quantityRange: { low: 1, high: 5 } };
  const firm = calculateP5Estimate({ ...base, firmPrice: true, lines: [line] }, finance, [], now);
  assert.equal(firm.planningRange.low, firm.planningRange.high, "one price, not a range");
  assert.ok(firm.planningRange.low >= firm.contractPrice && firm.planningRange.low - firm.contractPrice < 100, "the firm price is the margin-correct contract price, rounded up");
  const ranged = calculateP5Estimate({ ...base, lines: [line] }, finance, [], now);
  assert.ok(ranged.planningRange.low < ranged.planningRange.high, "other work keeps its range");
  assert.equal(priceText({ low: 28200, high: 28200 }), "$28,200");
  assert.equal(priceText({ low: 28200, high: 40000 }), "$28,200 to $40,000");
  assert.equal(priceLabel({ low: 1, high: 1 }), "Your price");
  // Live Marcliffe RE-10s were classified as handyman work; the document itself makes it an RE-10.
  assert.ok(isRe10Scope({ answers: { service: "handyman" }, text: "Please estimate the repair items listed on this RE-10 inspection notice." }));
  assert.ok(isRe10Scope({ answers: { service: "handyman" }, uploads: [{ name: "5487 N Marcliffe Ave RE-10 Inspection Contingency Notice.pdf" }] }));
  assert.ok(!isRe10Scope({ answers: { service: "handyman" }, text: "Replace two exterior outlets and fix a leaking trap." }));
});

test("contingency is a flat 10% on remodels and new construction and none on cabinet or handyman work", () => {
  for (const service of ["kitchen", "bathroom", "whole-home", "addition", "adu", "new-construction"] as Service[])
    assert.equal(calculateP5Estimate({ ...input(service), risks: ["hidden-conditions", "occupied-home"] }, finance, [], now).contingencyRate, .10, service);
  for (const service of ["handyman", "re10", "cabinet-product", "cabinet-install", "change-order", "rush"] as Service[])
    assert.equal(calculateP5Estimate({ ...input(service), risks: ["hidden-conditions"] }, finance, [], now).contingency, 0, service);
  assert.equal(calculateP5Estimate({ ...input("new-construction"), urgency: "emergency" }, finance, [], now).contingencyRate, .10, "a rushed new build keeps its contingency");
});

// Live 2026-09-23: "The quantity range must contain the modeled quantity" threw away completed
// pricing, the stage was asked again, and a five-item bedroom scope reached 27 mapping calls. A
// range that does not contain the value it brackets is one repairable line, not a dead estimate.
test("a range that does not contain its own value is widened, not thrown",()=>{
  const base=input();
  const line={...base.lines[0],quantity:10,unitCost:100,cost:1000};
  // The model put the range beside the quantity instead of around it.
  const priced=calculateP5Estimate({...base,lines:[{...line,quantityRange:{low:12,high:15}}]},finance,[],now);
  assert.ok(priced.planningRange.high>0,"the estimate still prices");
  // And the same for a unit-cost range.
  const cost=calculateP5Estimate({...base,lines:[{...line,unitCostRange:{low:120,high:150}}]},finance,[],now);
  assert.ok(cost.planningRange.high>0,"a unit-cost range is repaired the same way");
  // Widening is the safe direction: the range feeds the HIGH end, so the top can only stay honest.
  const narrow=calculateP5Estimate({...base,lines:[{...line,quantityRange:{low:10,high:10}}]},finance,[],now);
  assert.ok(priced.planningRange.high>=narrow.planningRange.high,"a range reaching past the quantity still lifts the top");
});
test("a genuinely unusable range is still refused",()=>{
  const base=input();
  const line={...base.lines[0],quantity:10,unitCost:100,cost:1000};
  // Not a packaging quirk: a non-finite bound says nothing about the work and cannot be repaired.
  assert.throws(()=>calculateP5Estimate({...base,lines:[{...line,quantityRange:{low:Number.NaN,high:15}}]},finance,[],now));
});
