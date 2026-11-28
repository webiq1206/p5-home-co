import test from "node:test";
import assert from "node:assert/strict";
import {priceApprovedScope,type Release,type QuoteInput,type Trust} from "../lib/p5/approvedQuote.ts";

const classes=Object.fromEntries(Object.entries({
  "builder-cabinets":[2500,2200,null],"retail-cabinets":[3000,3000,null],"installed-cabinets":[3200,3000,null],
  "same-layout-kitchen":[3000,1800,2800],"standard-remodel":[3200,1800,3000],"complex-remodel":[3500,2000,null],
  "short-service":[4000,1800,3500],"simple-addition":[3200,1800,3000],"verified-conversion":[3200,1800,3000],
  "protected":[0,2000,null]
}).map(([k,[grossBps,normalNetBps,concessionGrossBps]])=>[k,{grossBps,normalNetBps,concessionGrossBps}])) as Release["classes"];
const release=(version="synthetic-1",n=100_000):Release=>({
  version,hash:"a".repeat(64),hardFloorBps:1500,classes,
  rate(code){return ["TASK","CAB"].includes(code)?{unit:"ea",cents:n}:null},
  services:{management:{code:"PM",retailCents:12500},administration:{code:"PA",retailCents:12500},accounting:{code:"AC",retailCents:12500}},
});
const testInput=(jobClass:QuoteInput["groups"][number]["jobClass"]="standard-remodel"):QuoteInput=>({
  groups:[{id:"main",jobClass}],
  tasks:[{id:"t",groupId:"main",code:"TASK",contextKey:"mid",unit:"ea",milliQuantity:2000}],
  serviceHours:{management:{groupId:"main",milliHours:2000,approvalRef:"approval-h"},administration:{groupId:"main",milliHours:1000,approvalRef:"approval-h"},accounting:{groupId:"main",milliHours:1000,approvalRef:"approval-h"}},
  sharedCostCents:2_300,salesCostBps:2000,
});
const internal:Trust={audience:"internal",internalHourlyCostCents:{management:6500,administration:4400,accounting:5300}};
const checks={scopeDefined:true,costsVerified:true,capacityOrRepeat:true,ownerReturnConfirmed:true,cashCovered:true,reason:"Verified scope and funding"};
test("matrix, fixed $125 hours, and no relabeling builder orders",()=>{
  for(const [cls,net] of Object.entries({"standard-remodel":1800,"complex-remodel":2000,"retail-cabinets":3000,"installed-cabinets":3000,"builder-cabinets":3000,"short-service":1800,"verified-conversion":1800})){
    const quote=priceApprovedScope(release(),testInput(cls as QuoteInput["groups"][number]["jobClass"]),internal);
    assert.equal(quote.groups[0].netBps,net);
    assert.deepEqual(quote.lines.filter(x=>x.kind==="internal").map(x=>x.saleCents),[25000,12500,12500]);
    assert.equal(quote.lines.reduce((a,x)=>a+x.saleCents,0),quote.totalCents);
  }
  const x=priceApprovedScope(release(),testInput("builder-cabinets"),{...internal,groups:{main:{checks,builder:{priorDistinctBooked:2,steady:false,evidenceRef:"verified-2-prior"}}}});
  assert.equal(x.groups[0].netBps,2200);
  assert.equal(x.groups[0].grossBps,2500);
});
test("mixed remodel applies installed-cabinet rule separately and common costs once",()=>{
  const y=testInput("complex-remodel");
  y.groups.push({id:"cab",jobClass:"installed-cabinets"});
  y.tasks.push({id:"c",groupId:"cab",code:"CAB",contextKey:"mid",unit:"ea",milliQuantity:750,allowanceCents:123});
  const q=priceApprovedScope(release(),y,internal);
  assert.deepEqual(q.groups.map(g=>g.netBps),[3000,2000]);
  assert.equal(q.groups.reduce((a,g)=>a+g.sharedCostCents,0),2300);
  assert.equal(q.lines.reduce((a,l)=>a+l.saleCents,0),q.totalCents);
  assert.equal(q.lines.find(l=>l.id==="c")?.costCents,75123);
});
test("authorized 15% concession stays private, and reject below-floor, rush and no verified facts",()=>{
  const privateConcession={netBps:1500,actorId:"admin-a",approvalId:"receipt",reason:"Documented competitive bid"};
  const trusted:Trust={...internal,groups:{main:{checks,privateConcession}}};
  const q=priceApprovedScope(release(),testInput(),trusted);
  assert.equal(q.groups[0].netBps,1500);
  assert.equal(q.groups[0].approval?.actorId,"admin-a");
  assert.throws(()=>priceApprovedScope(release(),testInput(),{...trusted,audience:"public"}),/concession/);
  assert.throws(()=>priceApprovedScope(release(),testInput(),{...trusted,groups:{main:{checks,privateConcession:{...privateConcession,netBps:1499}}}}),/concession/);
  assert.throws(()=>priceApprovedScope(release(),testInput(),{...trusted,groups:{main:{privateConcession}}}),/concession/);
});
test("unknown rates or units, duplicated service codes, and unreviewed protected scopes fail",()=>{
  assert.throws(()=>priceApprovedScope(release(),testInput("protected"),internal),/same-scope/);
  const x=testInput();x.tasks[0].unit="lf";
  assert.throws(()=>priceApprovedScope(release(),x,internal),/unit/);
  x.tasks[0].code="PM";
  assert.throws(()=>priceApprovedScope(release(),x,internal),/cannot be added again/);
});
test("different synthetic versions do not change a prior snapshot calculation",()=>{
  const x=testInput(), old=release(), next=release("synthetic-2",110_000);
  const before=priceApprovedScope(old,x,internal), later=priceApprovedScope(next,x,internal);
  assert.notEqual(before.totalCents,later.totalCents);
  assert.equal(before.pricingVersion,"synthetic-1");
  assert.deepEqual(priceApprovedScope(old,x,internal),before);
});
