"use client";

import {useState,type CSSProperties,type FormEvent} from "react";
import {PROJECT_SERVICE_ROLES,validateProjectServiceDefaults,type ProjectServiceDefaults} from "../lib/p5/projectServices.ts";

type Props={
  value:ProjectServiceDefaults;
  onChange:(value:ProjectServiceDefaults)=>void;
  onSave:()=>Promise<void>;
  busy:boolean;
};

const control:CSSProperties={
  display:"block",width:"100%",maxWidth:"100%",minHeight:44,fontSize:16,
  color:"#383837",background:"#fff",padding:10,boxSizing:"border-box",marginTop:6,
};

export default function ProjectServiceDefaultsEditor({value,onChange,onSave,busy}:Props){
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [saving,setSaving]=useState(false);
  const locked=busy||saving;

  function update(code:typeof PROJECT_SERVICE_ROLES[number]["code"],key:"hoursPer1000"|"minimumHours",raw:string){
    const next={...value,[code]:{...value[code],[key]:raw===""?NaN:Number(raw)}};
    onChange(next);
    setError("");
    setStatus("Changes are staged in the current policy. Save to persist them.");
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError("");
    setStatus("");
    try{
      validateProjectServiceDefaults(value);
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Enter valid positive values for all six fields.");
      return;
    }
    setSaving(true);
    try{
      await onSave();
      setStatus("Save request completed. The parent admin page handles persistence and reload.");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Defaults could not be saved. Review the values and try again.");
    }finally{
      setSaving(false);
    }
  }

  return <form className="sc-card" noValidate onSubmit={submit} aria-labelledby="project-service-defaults-title">
    <h2 className="sc-h2" id="project-service-defaults-title">New-project service defaults</h2>
    <p>These assumptions apply only when a new project is created. Existing estimates keep their frozen service assumptions.</p>
    <p>Hours are calculated for the whole project, not separately for each milestone. The minimum is a whole-project floor.</p>
    <p>Service pricing is fixed at <strong>$120 per person-hour</strong>. Rates and accounting items are system-managed and cannot be edited here.</p>
    <p>Changes apply after you save. Only these six defaults are saved; financial forecasts and cost books stay unchanged. Existing projects keep their saved assumptions.</p>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:12,margin:"18px 0"}}>
      {PROJECT_SERVICE_ROLES.map(role=>{
        const row=value[role.code];
        return <fieldset key={role.code} disabled={locked} style={{minWidth:0,padding:14,border:"1px solid #b9b9b3",borderRadius:4}}>
          <legend style={{padding:"0 6px"}}><strong>{role.code}</strong> · {role.name}</legend>
          <label htmlFor={`service-default-${role.code}-factor`}>
            Hours per $1,000 of outside direct project costs
            <input id={`service-default-${role.code}-factor`} type="number" inputMode="decimal" min="0" max="100000" step="any" required
              style={control} value={Number.isFinite(row.hoursPer1000)?row.hoursPer1000:""}
              onChange={event=>update(role.code,"hoursPer1000",event.target.value)}
              aria-describedby={`service-default-${role.code}-factor-hint`}/>
          </label>
          <small id={`service-default-${role.code}-factor-hint`}>Use a finite value greater than zero. Fractions are supported.</small>
          <label htmlFor={`service-default-${role.code}-minimum`} style={{display:"block",marginTop:14}}>
            Whole-project minimum hours
            <input id={`service-default-${role.code}-minimum`} type="number" inputMode="decimal" min="0" max="100000" step="any" required
              style={control} value={Number.isFinite(row.minimumHours)?row.minimumHours:""}
              onChange={event=>update(role.code,"minimumHours",event.target.value)}
              aria-describedby={`service-default-${role.code}-minimum-hint`}/>
          </label>
          <small id={`service-default-${role.code}-minimum-hint`}>Applies once to the entire project, never per milestone.</small>
        </fieldset>;
      })}
    </div>

    {error&&<p role="alert" style={{color:"#8b2f25"}}>{error}</p>}
    {status&&<p role="status" aria-live="polite">{status}</p>}
    <button type="submit" className="sc-btn sc-btn-primary" style={{minHeight:44,padding:"10px 16px"}} disabled={locked}>
      {locked?"Saving…":"Save project defaults"}
    </button>
    {locked&&<p aria-live="polite">Saving policy changes. Controls are temporarily disabled.</p>}
  </form>;
}
