"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { divisionLabel, divisionOrder } from "../../../lib/scopes/divisions";
import {ActionLinks, contractorRequest, Notice, type ContractorProfile} from "../../../admin/contractors/ui-shared";

const STATUSES = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  bidding: "Bidding",
  follow_up: "Needs follow-up",
  declined: "Declined",
  awarded: "Awarded",
} as const;
type Status = keyof typeof STATUSES;
type OutreachEvent = {
  id?: number | string; contractorId?: number; status: Status; updatedAt?: string; createdAt?: string;
  actorName?: string | null; followUpAt?: string | null; note?: string | null;
  items?: (string | {id?: string; title?: string; division?: string})[];
  contractor?: ContractorProfile; contractorName?: string;
};
type Group = {contractor: ContractorProfile; itemIds: string[]; status?:Status; lastEvent?:OutreachEvent | null; events?:OutreachEvent[]};
type Item = {id: string; division: string; title: string; status: "qualified" | "needs_contractor" | "internal" | "not_in_scope"; options: {contractor:ContractorProfile; reason: string}[]};
type Data = {project: {id:number;title:string};items:Item[];groups:Group[];history?:OutreachEvent[]; historyLimited?:boolean; warning?:string | null};
const displayStatus = (status?: Status | null) => status && STATUSES[status] ? STATUSES[status] : STATUSES.not_contacted;
const dateLabel = (value?:string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-US", {dateStyle:"medium",timeStyle:"short",timeZone:"America/Boise"}) + " MT" : "";
};
const division = (code:string) => /^\d{2}$/.test(code) ? divisionLabel(code) : "Unclassified scope";
const due = (event?:OutreachEvent|null) => {
  if (!event?.followUpAt || event.status === "awarded" || event.status === "declined") return false;
  return new Date(event.followUpAt).getTime() <= Date.now();
};

function bidDraft(group:Group, items:Item[]): string | null {
  const address = group.contractor.email?.trim();
  if (!address || !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(address) || items.length === 0) return null;
  // Scope titles only, no customer name, address, pricing, or private project metadata.
  const body = "Hi,\n\nCould you confirm you're available to bid the following scope?\n\n" +
    items.map(item=>"- " + item.title.replace(/[\r\n]+/g," ")).join("\n") +
    "\n\nPlease let us know what details you need and when you could provide a bid.\n\nThanks,\nP5 Home Co";
  const url = "mailto:" + encodeURIComponent(address).replace(/%40/g,"@") + "?subject=" + encodeURIComponent("P5 Home Co bid request") + "&body=" + encodeURIComponent(body);
  return url.length <= 1900 ? url : null;
}

export default function OutreachBoard({projectId,canEdit}: {projectId:number;canEdit:boolean}) {
  const [data,setData] = useState<Data | null>(null);
  const [view,setView] = useState<"scope" | "groups" | "history">("scope");
  const [onlyMissing,setOnlyMissing] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [loading,setLoading] = useState(true);
  const [reload,setReload] = useState(0);
  const [editing,setEditing] = useState<Group | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const controller = new AbortController();
    void contractorRequest<Data>("/outreach?projectId=" + projectId, {signal:controller.signal})
      .then(result=>{
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.items) || !Array.isArray(result.groups)) throw new Error("The outreach view returned an unexpected response.");
        setData(result);setLoading(false);
      }).catch((e:Error)=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});
    return ()=>controller.abort();
  },[projectId,reload]);

  const refresh = () => {setError("");setLoading(true);setReload(x=>x+1);};
  const focusTop = () => requestAnimationFrame(()=>top.current?.focus());
  const sorted = [...(data?.items ?? [])].sort((a,b)=>divisionOrder(a.division)-divisionOrder(b.division));
  const shown = onlyMissing ? sorted.filter(x=>x.status==="needs_contractor") : sorted;
  const counts = {qualified:sorted.filter(x=>x.status==="qualified").length,missing:sorted.filter(x=>x.status==="needs_contractor").length};
  const itemById = new Map(sorted.map(item=>[item.id,item]));
  const groupById = new Map((data?.groups ?? []).map(group=>[group.contractor.id,group.contractor]));
  const history = (data?.history ?? (data?.groups ?? []).flatMap(group => (group.events ?? []).map(event=>({...event, contractorName:group.contractor.company}))))
    .slice().sort((a,b)=>(b.createdAt ?? b.updatedAt ?? "").localeCompare(a.createdAt ?? a.updatedAt ?? ""));
  const groupItems = (group:Group): Item[] => group.itemIds.flatMap(id=>{const item=itemById.get(id);return item ? [item] : [];}).sort((a,b)=>divisionOrder(a.division)-divisionOrder(b.division));
  const grouped = [...(data?.groups ?? [])].sort((a,b)=>divisionOrder(groupItems(a)[0]?.division ?? "")-divisionOrder(groupItems(b)[0]?.division ?? "") || Number(due(b.lastEvent))-Number(due(a.lastEvent)) || a.contractor.company.localeCompare(b.contractor.company));

  return <div className="ct-surface" tabIndex={-1} ref={top}>
    {editing ? <OutreachEditor projectId={projectId} group={editing} items={groupItems(editing)} cancel={()=>{setEditing(null);focusTop();}} saved={()=>{
      setEditing(null);setNotice("Outreach update saved. No message was sent.");refresh();focusTop();
    }}/> : <>
      <div className="ct-panel">
        <div className="ct-panel-head">
          <div><h2>Project outreach list</h2><p className="ct-muted">{data ? counts.qualified + " scope items covered · " + counts.missing + " need a contractor" : "Recommendations update with the saved scope and directory."}</p></div>
          <button className="lead-action" type="button" onClick={refresh} disabled={loading}>Refresh recommendations</button>
        </div>
        <div className="ct-tabs" aria-label="Outreach views">
          {([["scope","By scope item"],["groups","Grouped by contractor"],["history","Outreach history"]] as const).map(([key,label])=><button key={key} type="button" className={'lead-action'+(view===key?' ct-primary':'')} aria-pressed={view===key} onClick={()=>{setView(key);setNotice("");}}>{label}</button>)}
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {data?.warning && <Notice>{data.warning}</Notice>}
      {error && <Notice type="alert">{error} <button type="button" className="lead-action" onClick={refresh}>Try again</button></Notice>}
      {loading && <Notice>{data ? "Refreshing recommendations…" : "Loading project scope…"}</Notice>}
      {data && !error && view === "scope" && <>
        <label className="ct-check"><input type="checkbox" checked={onlyMissing} onChange={e=>setOnlyMissing(e.target.checked)}/>Only items that need a contractor</label>
        {!shown.length && <p className="ct-panel ct-muted">{onlyMissing ? "No items currently need a contractor." : "This project has no saved scope items yet. Save a scope to get recommendations."}</p>}
        {shown.map((item,i)=><section key={item.id}>
          {(i===0 || shown[i-1].division !== item.division) && <h2 className="ct-group-heading">{division(item.division)}</h2>}
          <article className="ct-panel ct-scope-item">
            <div className="ct-panel-head"><h3>{item.title}</h3>
              <span className={'ct-badge' + (item.status === "needs_contractor" ? " ct-badge-warning" : "")}>{{
                qualified:"Qualified options",needs_contractor:"Needs contractor",internal:"Internal work",not_in_scope:"Not in active scope",
              }[item.status] ?? "Needs review"}</span></div>
            {item.status==="qualified" && <ol className="ct-options">{item.options.slice(0,3).map(({contractor,reason})=><li key={contractor.id}>
              <Link href={'/admin/contractors?id=' + contractor.id}><strong>{contractor.company}</strong></Link>
              <p>{reason}</p>
              <ActionLinks person={contractor}/>
            </li>)}</ol>}
            {item.status==="needs_contractor" && <p className="ct-muted">No documented contractor matches this specific work. Review it in the directory.</p>}
          </article>
        </section>)}
      </>}
      {data && !error && view==="groups" && <>
        {!grouped.length && <p className="ct-panel ct-muted">No eligible contractor groups for the current scope.</p>}
        {grouped.map(group=>{
          const items = groupItems(group);
          const draft = bidDraft(group,items);
          const current = group.status ?? group.lastEvent?.status;
          const next = dateLabel(group.lastEvent?.followUpAt);
          return <section className="ct-panel" key={group.contractor.id}>
            <div className="ct-panel-head">
              <div><h3><Link href={'/admin/contractors?id=' + group.contractor.id}>{group.contractor.company}</Link></h3><p className="ct-muted">{items.length ? items.length + (items.length === 1 ? " matching item" : " matching items") : "No longer recommended for the current scope; history remains."}</p></div>
              <span className={'ct-badge' + (due(group.lastEvent) ? " ct-badge-warning" : "")}>{due(group.lastEvent) ? "Follow-up due" : displayStatus(current)}</span>
            </div>
            {next && <p className="ct-muted">Follow-up: {next}</p>}
            <ActionLinks person={group.contractor}/>
            {items.length>0 && <ul className="ct-group-items">{items.map(item=><li key={item.id}><span>{division(item.division)}</span><strong>{item.title}</strong></li>)}</ul>}
            <div className="ct-contact">
              {draft && <a className="lead-action" href={draft}>Open grouped bid request draft</a>}
              {canEdit && <button type="button" className="lead-action ct-primary" onClick={()=>{setEditing(group);focusTop();}}>Log outreach</button>}
            </div>
            {group.lastEvent?.note && <p className="ct-muted">Latest note: {group.lastEvent.note}</p>}
          </section>;
        })}
      </>}
      {data && !error && view==="history" && <>
        {data.historyLimited && <Notice>Showing the latest 500 outreach events.</Notice>}
        {!history.length && <p className="ct-panel ct-muted">No outreach has been logged for this project.</p>}
        {history.map((event,index)=><article className="ct-panel" key={event.id ?? index}>
          <div className="ct-panel-head"><h3>{event.contractor?.company || event.contractorName || groupById.get(event.contractorId ?? 0)?.company || "Contractor outreach"}</h3><span className="ct-badge">{displayStatus(event.status)}</span></div>
          <p className="ct-muted">{[dateLabel(event.createdAt ?? event.updatedAt),event.actorName].filter(Boolean).join(" · ")}</p>
          {event.note && <p>{event.note}</p>}
          {event.followUpAt && <p className="ct-muted">Follow-up: {dateLabel(event.followUpAt)}</p>}
          {!!event.items?.length && <ul className="ct-group-items">{event.items.map((item,i)=><li key={i}>{typeof item === "string" ? itemById.get(item)?.title || item : item.title || item.id || "Scope item"}</li>)}</ul>}
        </article>)}
      </>}
    </>}
  </div>;
}

function OutreachEditor({projectId,group,items,cancel,saved}: {projectId:number;group:Group;items:Item[];cancel:()=>void;saved:()=>void}) {
  const [status,setStatus] = useState<Status>(group.status ?? group.lastEvent?.status ?? "contacted");
  const [note,setNote] = useState("");
  const [followUp,setFollowUp] = useState("");
  const [step,setStep] = useState(0);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const box = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  useEffect(()=>{box.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus();},[step]);
  const submit = async (e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setError("");
    if(step<2){setStep(step+1);return;}
    if(busy.current)return;
    busy.current=true;setSaving(true);
    try{
      const followUpAt = followUp ? new Date(followUp).toISOString() : null;
      const data = await contractorRequest<{ saved: boolean; eventId: string }>("/outreach",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({projectId,contractorId:group.contractor.id,status,note:note.trim(),followUpAt,itemIds:items.map(item=>item.id)}),
      });
      if (!data.saved || !data.eventId) throw new Error("The system did not confirm the outreach update.");
      saved();
    }catch(e){setError(e instanceof Error ? e.message : "Could not log outreach.");}
    finally{busy.current=false;setSaving(false);}
  };
  return <section className="ct-panel ct-editor">
    <div className="ct-panel-head"><div><p className="ct-kicker">Step {step+1} of 3 · {group.contractor.company}</p><h2>{["Outreach status","Outreach note","Set follow-up"][step]}</h2></div><button className="lead-action" type="button" onClick={cancel} disabled={saving}>Cancel</button></div>
    <form ref={box} onSubmit={submit}>
      <div className="ct-fields">
        {step===0 && <label>Status<select data-step-focus value={status} onChange={e=>setStatus(e.target.value as Status)}>{Object.entries(STATUSES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
        {step===1 && <label>Note <span className="ct-muted">(optional)</span><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} data-step-focus/></label>}
        {step===2 && <>
          <label>Follow-up <span className="ct-muted">({status==="follow_up" ? "required" : "optional"}, your device time)</span><input type="datetime-local" required={status==="follow_up"} data-step-focus value={followUp} onChange={e=>setFollowUp(e.target.value)}/></label>
          <p className="ct-muted">Logs {displayStatus(status).toLowerCase()} for {items.length || "no"} current scope {items.length===1?"item":"items"}. It does not email or call the contractor.</p>
        </>}
      </div>
      {error && <Notice type="alert">{error}</Notice>}
      <div className="ct-editor-actions">
        <button type="button" className="lead-action" disabled={step===0||saving} onClick={()=>setStep(step-1)}>Back</button>
        <button className="lead-action ct-primary" type="submit" disabled={saving || (step===2 && status==="follow_up" && !followUp)}>{saving?"Saving…":step===2?"Save outreach update":"Next"}</button>
      </div>
    </form>
  </section>;
}
