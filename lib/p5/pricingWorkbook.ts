import { PricingReleaseValidationError,validatePricingSnapshot,type PricingSnapshot,type ReleasedJobPolicy } from "./pricingRelease.ts";
import type { PriceBookRow } from "./priceBookData.ts";
import type { JobClass } from "./netPricingPolicy.ts";

export const CANONICAL_P5_WORKBOOK="1DLwv_kKsbkKUkf-uevZQhKLtghys4rF9DUVQ1SDotc0";
const classLabels:Record<string,JobClass>={
  "Repeat builder stock cabinets":"builder-cabinets","Retail cabinet supply":"retail-cabinets","Standard installed cabinets":"installed-cabinets",
  "Same-layout kitchen":"same-layout-kitchen","Standard bath or light multiroom":"standard-remodel","Structural kitchen or complex whole home":"complex-remodel",
  "Handyman or short work":"short-service","Simple one-story addition":"simple-addition","Verified ADU conversion":"verified-conversion",
  "New home or detached new-build ADU":"protected","High-risk addition or uncertain conversion":"protected","Other or change order":"protected",
};
const head=["ID","Division","Section","Item","Unit","Cost type","Essential book cost","Signature book cost","Premium book cost","Luxury book cost","Essential reference sell","Signature reference sell","Premium reference sell","Luxury reference sell","Remodel premium"];
const flat=(v:unknown)=>typeof v==="string"?v.replace(/\s+/g," ").trim():"";
const present=(v:unknown)=>v!==null&&v!==undefined&&v!=="";
const number=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
type Values=readonly (readonly unknown[])[];
/**
 * Compile an UNFORMATTED_VALUE read of the two exact source ranges. The importer
 * changes no worksheet and does not publish. Use a server-resolved baseline
 * from the approved catalog to preserve flags, labor splits, and rate semantics
 * absent from the editable workbook. Metadata changes need an explicit adapter.
 */
export function compilePricingWorkbook(input:{workbookId:string;costBook:Values;policy:Values},baseline:PricingSnapshot) {
  const issues:string[]=[];
  if(input.workbookId!==CANONICAL_P5_WORKBOOK) throw new PricingReleaseValidationError(["Select the canonical P5 Cost Book."]);
  if(!head.every((name,i)=>flat(input.costBook[0]?.[i])===name))throw new PricingReleaseValidationError(["Cost Book headers changed. Compare the approved schema before importing."]);
  if(flat(input.policy[2]?.[0])!=="Project class"||flat(input.policy[2]?.[3])!=="Normal net target")throw new PricingReleaseValidationError(["Pricing Policy headers changed."]);
  const baseByCode=new Map(baseline.lines.map(line=>[line[0],line]));
  const found=new Map<string,PriceBookRow>();
  for(const [i,row] of input.costBook.slice(1).entries()){
    if(!row.some(present))continue;
    const code=flat(row[0]), base=baseByCode.get(code);
    if(!base){issues.push(`Row ${i+2}: new or unknown cost code must have approved scope flags and cost metadata.`);continue;}
    if(found.has(code)){issues.push(`${code}: duplicate cost code.`);continue;}
    if(base.slice(1,6).some((v,j)=>flat(v)!==flat(row[j+1]))){
      issues.push(`${code}: division, scope, unit, or cost type changed. Review its scope metadata first.`);continue;
    }
    const tiers=row.slice(6,10);
    if(tiers.length!==4||!tiers.every(number)||!number(row[14])){
      issues.push(`${code}: use numeric book-cost and remodel-premium cells, not formatted text.`);continue;
    }
    // K:N are reference selling amounts, never direct cost inputs.
    const line=base.slice() as PriceBookRow;
    line[10]=tiers[0];line[11]=tiers[1];line[12]=tiers[2];line[13]=tiers[3];line[14]=row[14];
    found.set(code,line);
  }
  if(found.size!==baseByCode.size)issues.push(`Expected ${baseByCode.size} validated cost codes; found ${found.size}.`);
  const policies={...baseline.rules.jobPolicies};
  const matched=new Set<JobClass>(), labels=new Set<string>();
  for(const row of input.policy.slice(3,16)){
    const label=flat(row[0]), name=classLabels[label];
    if(label==="Rush work"){
      if(!number(row[3])||row[3]<.25)issues.push("Rush work must target at least 25% net.");
      continue;
    }
    if(!Object.hasOwn(classLabels,label)||!name||labels.has(label)){issues.push("Missing, unrecognized, or duplicate pricing class.");continue;}
    labels.add(label);
    const gross=row[1],net=row[3], concession=row[6];
    if(!number(net)||(!number(gross)&&name!=="protected")||(present(concession)&&!number(concession))){
      issues.push(`${label}: margin fields must be valid numeric percentages.`);continue;
    }
    const next:ReleasedJobPolicy=[number(gross)?gross:0,number(concession)?concession:null,net];
    if(matched.has(name)&&JSON.stringify(policies[name])!==JSON.stringify(next))issues.push("Protected job rows disagree about their shared rule.");
    policies[name]=next;
    matched.add(name);
  }
  if(matched.size!==Object.keys(baseline.rules.jobPolicies).length||labels.size!==Object.keys(classLabels).length)issues.push("The workbook job class matrix is incomplete.");
  const controls=new Map(input.policy.slice(16).map(row=>[flat(row[0]),row[1]]));
  if(controls.get("Hard net minimum")!==.15||controls.get("P5 project services per person-hour")!==125)issues.push("Keep the approved 15% floor and $125/hr project service rate.");
  const rush=input.policy.slice(3,16).find(row=>flat(row[0])==="Rush work")?.[3];
  if(issues.length)throw new PricingReleaseValidationError(issues.slice(0,70));
  return validatePricingSnapshot({...baseline,lines:baseline.lines.map(line=>found.get(line[0])!),rules:{...baseline.rules,
    jobPolicies:policies,rushMinNet:number(rush)?rush:baseline.rules.rushMinNet,
    rushCabinetMinNet:Math.max(number(rush)?rush:baseline.rules.rushMinNet,baseline.rules.rushCabinetMinNet)}});
}
