import test from "node:test";
import assert from "node:assert/strict";
import { compilePricingWorkbook, CANONICAL_P5_WORKBOOK } from "../lib/p5/pricingWorkbook.ts";
import {
  canonicalPricingJSON, digestPricingSnapshot, requireCatalogCompatibility, validatePricingSnapshot,
  PricingReleaseValidationError, type PricingSnapshot,
} from "../lib/p5/pricingRelease.ts";

function workbook(): PricingSnapshot {
  return {
    schemaVersion: 1, currency: "USD",
    lines: [
      ["00-10-01","Preconstruction","Plans","Drafter","HR","Fee / Professional Service","",null,3,0,85,85,85,85,0,""],
      ["00-40-01","Preconstruction","Insurance","Builder risk","% of const.","Percentage","",null,3,0,.0045,.0045,.0045,.0045,0,""],
      ...(["01-31-03","01-31-04","01-31-05"] as const).map(
        code=>[code,"General","Project services",code,"HR","Labor Only","",1,127,0,125,125,125,125,0,""] as PricingSnapshot["lines"][number]),
    ],
    rules: {
      minimumNetMargin:.15, rushMinNet:.25, rushCabinetMinNet:.30, builderMinimumDistinctBookedProjects:2,
      jobPolicies: {
        "builder-cabinets":[.25,null,.22], "retail-cabinets":[.30,null,.30], "installed-cabinets":[.32,null,.30],
        "same-layout-kitchen":[.30,.28,.18], "standard-remodel":[.32,.30,.18], "complex-remodel":[.35,null,.20],
        "short-service":[.40,.35,.18], "simple-addition":[.32,.30,.18], "verified-conversion":[.32,.30,.18],
        "protected":[0,null,.20],
      },
      projectServices: [
        {code:"01-31-03",rate:125,qboItemId:"48",minimumHours:.25,hoursPer1000:.5},
        {code:"01-31-04",rate:125,qboItemId:"49",minimumHours:.125,hoursPer1000:.2},
        {code:"01-31-05",rate:125,qboItemId:"47",minimumHours:.125,hoursPer1000:.1},
      ],
    },
  };
}

function includesIssue(run:()=>unknown, re:RegExp) {
  assert.throws(run,(e:unknown)=>e instanceof PricingReleaseValidationError && e.issues.some(x=>re.test(x)));
}

test("canonical digest is stable across object ordering and JSONB style readback",()=>{
  const input=workbook();
  const reordered=Object.fromEntries(Object.entries(input).reverse().map(([key,value]) =>
    [key,key==="rules"?Object.fromEntries(Object.entries(value).reverse()):value]));
  const first=validatePricingSnapshot(input), second=validatePricingSnapshot(reordered);
  assert.equal(canonicalPricingJSON(first),canonicalPricingJSON(second));
  assert.equal(digestPricingSnapshot(first),digestPricingSnapshot(second));
  assert.match(digestPricingSnapshot(first),/^[a-f0-9]{64}$/);
});

test("an approved line and higher complex target are versioned without mutating the earlier artifact",()=>{
  const draft=workbook(), previouslyApproved=validatePricingSnapshot(draft);
  draft.lines[0].splice(10,4,90,90,90,90);
  draft.rules.jobPolicies["complex-remodel"][2]=.22;
  const candidate=validatePricingSnapshot(draft);
  assert.notEqual(digestPricingSnapshot(previouslyApproved),digestPricingSnapshot(candidate));
  assert.equal(previouslyApproved.lines[0][10],85);
  assert.equal(previouslyApproved.rules.jobPolicies["complex-remodel"][2],.20);
  requireCatalogCompatibility(candidate,previouslyApproved.lines);
});

test("invalid, missing, duplicated and unit-reinterpreted lines are rejected",()=>{
  const draft=workbook();
  draft.lines.push(structuredClone(draft.lines[0]));
  draft.lines[0][10]=Number.NaN;
  draft.lines[1][4]="HR";
  includesIssue(()=>validatePricingSnapshot(draft),/duplicate/i);
  includesIssue(()=>validatePricingSnapshot(draft),/invalid|finish rates/i);
  includesIssue(()=>validatePricingSnapshot(draft),/unsupported UOM/);
  const valid=workbook();
  const mutated=workbook();
  mutated.lines[0][4]="EA";
  includesIssue(()=>requireCatalogCompatibility(validatePricingSnapshot(mutated),valid.lines),/changing the unit/);
  mutated.lines.shift();
  includesIssue(()=>requireCatalogCompatibility(validatePricingSnapshot(mutated),valid.lines),/missing a cost code/);
});

test("a release cannot undercut floor, builder eligibility, protected cabinet pricing or fixed internal rates",()=>{
  const bad=workbook();
  bad.rules.minimumNetMargin=.149;
  bad.rules.builderMinimumDistinctBookedProjects=1;
  bad.rules.jobPolicies["retail-cabinets"]=[.30,.20,.22];
  bad.rules.projectServices[0].rate=120;
  bad.rules.projectServices[1].qboItemId="195";
  bad.lines[4][12]=130;
  for(const pattern of [/15% net/,/two prior distinct/,/retail-cabinets/,/125 hourly/,/QuickBooks/]){
    includesIssue(()=>validatePricingSnapshot(bad),pattern);
  }
});

test("workbook compiler accepts unformatted direct-cost edits, ignores reference sells and holds bad versions",()=>{
  const baseline=workbook();
  const h=["ID","Division","Section","Item","Unit","Cost type","Essential\nbook cost","Signature\nbook cost","Premium\nbook cost","Luxury\nbook cost","Essential reference sell","Signature reference sell","Premium reference sell","Luxury reference sell","Remodel\npremium"];
  const costBook:unknown[][]=[h,...baseline.lines.map(l=>[...l.slice(0,6),...l.slice(10,14),0,0,0,0,l[14]])];
  costBook[1][6]=87;costBook[1][7]=87;costBook[1][8]=87;costBook[1][9]=87;costBook[1][10]=55555;
  const policy:unknown[][]=[[],[],["Project class","","","Normal net target"],
    ...([
      ["Repeat builder stock cabinets","builder-cabinets"],["Retail cabinet supply","retail-cabinets"],
      ["Standard installed cabinets","installed-cabinets"],["Same-layout kitchen","same-layout-kitchen"],
      ["Standard bath or light multiroom","standard-remodel"],["Structural kitchen or complex whole home","complex-remodel"],
      ["Handyman or short work","short-service"],["Simple one-story addition","simple-addition"],
      ["Verified ADU conversion","verified-conversion"],["New home or detached new-build ADU","protected"],
      ["High-risk addition or uncertain conversion","protected"],["Other or change order","protected"],
    ] as const).map(([label,k])=>{
      const [gross,concession,net]=baseline.rules.jobPolicies[k];return [label,gross,null,net,null,null,concession];
    }),["Rush work",null,null,.25],["Control","Value"],["Hard net minimum",.15],["P5 project services per person-hour",125]];
  const input={workbookId:CANONICAL_P5_WORKBOOK,costBook,policy};
  assert.equal(compilePricingWorkbook(input,baseline).lines[0][10],87);
  assert.equal(baseline.lines[0][10],85);
  costBook[1][6]="$87";
  includesIssue(()=>compilePricingWorkbook(input,baseline),/numeric book-cost/);
  includesIssue(()=>compilePricingWorkbook({...input,workbookId:"wrong"},baseline),/canonical P5/);
});
