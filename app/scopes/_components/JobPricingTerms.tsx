"use client";
import { useState, type FormEvent } from "react";
import { JOB_POLICIES, defaultJobClass, type JobClass, type ReviewedJobTerms } from "../../../lib/p5/netPricingPolicy.ts";
import { api, type Workspace } from "./client.ts";

const LABELS: Record<JobClass,string> = {
  "builder-cabinets":"Repeat builder stock cabinets","retail-cabinets":"Retail cabinet supply","installed-cabinets":"Installed cabinets",
  "same-layout-kitchen":"Same-layout kitchen","standard-remodel":"Bathroom or light remodel","complex-remodel":"Structural kitchen or whole-home remodel",
  "short-service":"Handyman or short work","simple-addition":"Verified one-story addition","verified-conversion":"Verified ADU conversion","protected":"Protected scope",
};
const CHECKS = [
  ["costsVerified","Current supplier and trade costs verified"],["scopeDefined","Scope and selections defined"],
  ["capacityOrRepeat","Repeat efficiency or open crew capacity confirmed"],["ownerReturnConfirmed","Profit dollars per owner hour accepted"],
  ["cashCovered","Cash available through the next collection"],
] as const;

export default function JobPricingTerms({ws,onSave}:{ws:Workspace;onSave:(value:Workspace)=>void}) {
  const saved=ws.doc.reviewedJobTerms;
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const current=saved?.jobClass??ws.pricing.netPricing?.jobClass??defaultJobClass(ws.project.service,ws.doc.summary);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const reason=String(data.get("reason")??"").trim();
    const terms:ReviewedJobTerms={
      jobClass:String(data.get("jobClass")) as JobClass, otherCostDollars:Number(data.get("dollars")),otherCostRate:Number(data.get("rate"))/100,
      costSource:String(data.get("source")??"").trim(),
      ...(data.get("protectedPrice")?{approvedSameScopePrice:Number(data.get("protectedPrice"))}:{}),
      competitive:{costsVerified:data.has("costsVerified"),scopeDefined:data.has("scopeDefined"),capacityOrRepeat:data.has("capacityOrRepeat"),
        ownerReturnConfirmed:data.has("ownerReturnConfirmed"),cashCovered:data.has("cashCovered"),reason}
    };
    setSaving(true);setError("");
    try {
      const result=await api<{workspace:Workspace}>(["/api/scopes",ws.project.id,"scope"].join("/"),{method:"POST",json:{action:"edit",ops:[{op:"pricing-terms",terms}]}});
      onSave(result.workspace);
    } catch (e) {setError(e instanceof Error?e.message:"Pricing could not be saved.");}
    finally {setSaving(false);}
  }
  return <details className="sc-card"><summary>Review job pricing and order eligibility</summary>
    <form onSubmit={submit}><fieldset disabled={saving}>
      <label>Job class <select name="jobClass" defaultValue={current}>{Object.keys(JOB_POLICIES).map(id=><option key={id} value={id}>{LABELS[id as JobClass]}</option>)}</select></label>
      <p>Include both owners’ compensation, overhead, company interest and taxes once. Enter expenses already included in direct costs as zero here.</p>
      <label>Other costs allocated in dollars <input required type="number" min="0" step="0.01" name="dollars" defaultValue={saved?.otherCostDollars??0}/></label>
      <label>Additional expenses as a percent of sales <input required type="number" min="0" max="84.99" step="0.01" name="rate" defaultValue={((saved?.otherCostRate??ws.pricing.policy.overheadRate)*100).toFixed(2)}/></label>
      <label>Cost source and calculation <input name="source" required defaultValue={saved?.costSource}/></label>
      <label>Previously approved price for this scope <input type="number" name="protectedPrice" min="0.01" step="0.01" defaultValue={saved?.approvedSameScopePrice}/></label>
      <p>For a repeat builder stock order, confirm all five items and document the repeat order, approved layout, landed supplier cost and payment covering the order. Other work uses its job class rate.</p>
      {CHECKS.map(([key,label])=><label key={key}><input type="checkbox" name={key} defaultChecked={saved?.competitive?.[key]}/>{label}</label>)}
      <label>Order eligibility and supporting evidence <input name="reason" defaultValue={saved?.competitive?.reason}/></label>
      {error&&<p role="alert">{error}</p>}<button type="submit">{saving?"Saving":"Save pricing review"}</button>
    </fieldset></form></details>;
}
