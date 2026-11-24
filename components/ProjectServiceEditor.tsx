"use client";

import {useState} from "react";
import {PROJECT_MILESTONES,projectServiceLines,validateProjectServices,projectServiceDefaults,type ProjectServicePlan,type MilestoneHours} from "../lib/p5/projectServices.ts";

type Props={
  plan:ProjectServicePlan;directCost:number;taskCount:number;disabled?:boolean;
  milestoneOutsideCosts?:MilestoneHours;
  onSave:(plan:ProjectServicePlan)=>Promise<void>|void;
};
/** Internal only; callers enforce their existing pricing permissions. */
export default function ProjectServiceEditor(props:Props){
  if(props.plan.version==="project-services-v1")return <p>Historical project-service pricing is preserved. Refer to the original saved estimate for its hours and amounts; current defaults do not replace them.</p>;
  // A changed cost basis or saved override starts a fresh edit, rather than
  // silently saving stale defaults from the previous cost review.
  return <ProjectServiceFields key={JSON.stringify([props.plan,props.directCost,props.taskCount,props.milestoneOutsideCosts])} {...props}/>;
}
function ProjectServiceFields({plan,directCost,taskCount,milestoneOutsideCosts,disabled=false,onSave}:Props) {
  const initial=projectServiceLines(plan,directCost,taskCount,milestoneOutsideCosts);
  const [hours,setHours]=useState(()=>Object.fromEntries(initial.map(r=>[r.code,{...r.hours}])));
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  return <form className="sc-card" onSubmit={async event=>{
    event.preventDefault();setMessage("");setBusy(true);
    try {await onSave(validateProjectServices({...plan,hours}));setMessage("Milestone hours saved for this review.");}
    catch(error){setMessage(error instanceof Error?error.message:"Hours could not be saved.");}
    finally{setBusy(false);}
  }}>
    <h2 className="sc-h2">Project service hours</h2>
    {plan.version==="project-services-v1"?<p>Historical project-service assumptions are preserved. The new outside-cost defaults do not reprice this job.</p>:<p>Editable planning assumption, frozen for this project: {Object.entries(projectServiceDefaults(plan.defaults)).map(([code,d])=>`${code}: ${d.hoursPer1000} hours per $1,000 outside costs, whole-project minimum ${d.minimumHours} hours`).join("; ")}. Milestones share the total by outside cost, equally when unavailable; no milestone minimums. Each role is $120/person-hour without markup. Internal overrides take precedence. Salary-based overhead overlap is credited separately; distinct outside supervision stays chargeable.</p>}
    {initial.map(role=><fieldset key={role.code} disabled={disabled||busy||plan.version==="project-services-v1"} style={{minWidth:0,marginBottom:12,padding:12}}>
      <legend>{role.code} · {role.description}</legend>
      {PROJECT_MILESTONES.map(m=><label key={m} style={{display:"inline-flex",flexDirection:"column",marginRight:12,marginBottom:8,maxWidth:"100%"}}>
        {m.charAt(0).toUpperCase()+m.slice(1)} hours
        <input aria-label={`${role.description} ${m} hours`} type="number" min="0" max="100000" step="any" required
          style={{minHeight:44,width:180,maxWidth:"100%",boxSizing:"border-box",padding:8,fontSize:16}}
          value={Number.isFinite(hours[role.code][m])?hours[role.code][m]:""} onChange={e=>setHours({...hours,[role.code]:{...hours[role.code],[m]:e.target.value===""?NaN:Number(e.target.value)}})}/>
      </label>)}
      <p>{Number.isFinite(Object.values(hours[role.code]).reduce((a,b)=>a+b,0))?Object.values(hours[role.code]).reduce((a,b)=>a+b,0).toLocaleString("en-US",{maximumFractionDigits:9}):"-"} total hours · $120/hour</p>
    </fieldset>)}
    <p>Saving hours creates a draft review only; it does not update an existing QuickBooks estimate. Any estimate update uses the existing reviewed action.</p>
    {disabled||plan.version==="project-services-v1"?<p>Only authorized internal pricing managers can revise new-policy drafts or verified unsent, unsigned estimates. Legacy, sent, signed and invoiced estimates stay locked.</p>:
      <button type="submit" className="sc-btn sc-btn-primary" style={{minHeight:44,padding:"10px 16px"}} disabled={busy}>{busy?"Saving…":"Save milestone hours"}</button>}
    {message&&<p role="status">{message}</p>}
  </form>;
}
