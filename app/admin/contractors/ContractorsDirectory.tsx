"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DIVISIONS, divisionLabel, divisionOrder } from "../../lib/scopes/divisions";
import { ActionLinks, contractorRequest, Notice, SystemLinks, type Capability, type ContractorProfile } from "./ui-shared";

const STEP_NAMES = ["Company", "Contact", "Trade capabilities", "Project history", "Pricing notes", "Review"];
const LIMIT = 25;
type Draft = { company: string; contact: string; phone: string; email: string; serviceArea: string; capabilities: Capability[]; history: string; pricingNotes: string; };
const emptyCapability = (division = "00"): Capability => ({division, trade: "", keywords: [], verified: false});
const blankDraft = (value?: ContractorProfile): Draft => ({
  company: value?.company ?? "", contact: value?.contact ?? "", phone: value?.phone ?? "",
  email: value?.email ?? "", serviceArea: value?.serviceArea ?? "",
  capabilities: (value?.capabilities ?? []).map(({division,trade,keywords,verified}) => ({division,trade,keywords:[...(keywords ?? [])],verified})),
  history: Array.isArray(value?.history) ? value.history.join("\n") : (value?.history ?? ""),
  pricingNotes: value?.pricingNotes ?? "",
});
const labelByDivision = (code: string) => code === "unclassified" ? "Trade needs classification" : divisionLabel(code);
const distinct = (a: Capability[]) => Array.from(new Map(a.map(x => [x.division + ":" + x.trade.toLowerCase(), x])).values());
const searchRow = (value: ContractorProfile, query: string) => !query || [
  value.company, value.contact, value.phone, value.email, value.serviceArea,
  ...(value.capabilities ?? []).flatMap(x => [x.division,x.trade,...(x.keywords ?? [])]),
].filter(Boolean).join(" ").toLowerCase().includes(query);
const sortOptions = [{value:"division",label:"Division, trade, company"},{value:"company",label:"Company A to Z"},{value:"company-desc",label:"Company Z to A"}];

export default function ContractorsDirectory({canEdit}: {canEdit: boolean}) {
  const [rows, setRows] = useState<ContractorProfile[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [term, setTerm] = useState("");
  const [division, setDivision] = useState("");
  const [trade, setTrade] = useState("");
  const [sort, setSort] = useState("division");
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<ContractorProfile | "new" | null>(null);
  const [profile, setProfile] = useState<number | null>(null);
  const start = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void contractorRequest<{contractors: ContractorProfile[]}>("", {signal: controller.signal})
      .then(data => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.contractors)) throw new Error("The directory returned an unexpected response.");
        setRows(data.contractors);
        const id = Number(new URLSearchParams(window.location.search).get("id"));
        if (id > 0 && data.contractors.some(row => row.id === id)) setProfile(id);
      }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [reloadKey]);

  const view = useMemo(() => {
    const trades = new Set<string>();
    let result: {person: ContractorProfile; division: string; trade: string}[] = [];
    const matched = new Set<number>();
    for (const person of rows ?? []) {
      const capabilities = distinct(person.capabilities ?? []);
      const appearance = capabilities.length ? capabilities : [{division:"unclassified",trade:"Needs classification",keywords:[],verified:false}];
      for (const cap of appearance) if (!division || division === cap.division) trades.add(cap.trade);
      if (!searchRow(person, term.trim().toLowerCase())) continue;
      const relevant = appearance.filter(cap => (!division || division === cap.division) && (!trade || trade === cap.trade));
      if (relevant.length) matched.add(person.id);
      for (const cap of (sort === "division" ? relevant : relevant.slice(0,1))) result.push({person,division:cap.division,trade:cap.trade});
    }
    const companyOrder = (a: typeof result[number],b: typeof result[number]) => a.person.company.localeCompare(b.person.company, undefined, {sensitivity:"base"}) || a.person.id - b.person.id;
    result = result.sort((a,b) => sort === "company-desc" ? -companyOrder(a,b) : sort === "company" ? companyOrder(a,b) :
      divisionOrder(a.division) - divisionOrder(b.division) || a.trade.localeCompare(b.trade) || companyOrder(a,b));
    return {trades:[...trades].sort((a,b)=>a.localeCompare(b)), result, matched:matched.size};
  }, [rows, term, division, trade, sort]);

  const jump = () => requestAnimationFrame(() => start.current?.focus());
  const setEdit = (value: typeof editing) => {setEditing(value);setNotice("");jump();};
  const active = rows?.find(person => person.id === profile);
  const pageCount = Math.max(1,Math.ceil(view.result.length/LIMIT));
  const currentPage = Math.min(page,pageCount-1);
  const visible = view.result.slice(currentPage*LIMIT,(currentPage+1)*LIMIT);

  return <div ref={start} tabIndex={-1} className="ct-surface">
    {editing ? <ProfileEditor initial={editing === "new" ? undefined : editing} cancel={() => setEdit(null)} save={person => {
      setRows(previous => [...(previous ?? []).filter(p => p.id !== person.id),person]);
      setEditing(null);
      setProfile(person.id);
      setNotice("Contractor profile saved.");
      jump();
    }}/> : active ? <section className="ct-panel">
      <button className="lead-action" type="button" onClick={() => {setProfile(null);jump();}}>Back to directory</button>
      {notice && <Notice>{notice}</Notice>}
      <div className="ct-panel-head">
        <div><p className="ct-kicker">Contractor profile</p><h2>{active.company}</h2></div>
        {canEdit && <button className="lead-action ct-primary" type="button" onClick={()=>setEdit(active)}>Edit profile</button>}
      </div>
      <ActionLinks person={active}/>
      <dl className="ct-meta">
        <div><dt>Service area</dt><dd>{active.serviceArea || "Not recorded"}</dd></div>
        <div><dt>Project history</dt><dd>{(Array.isArray(active.history) ? active.history.join("\n") : active.history) || "Not recorded"}</dd></div>
        <div><dt>Pricing notes</dt><dd>{active.pricingNotes || "Not recorded"}</dd></div>
      </dl>
      <h3>Trade capabilities</h3>
      {(active.capabilities ?? []).length > 0 ? <ul className="ct-capabilities">{[...active.capabilities].sort((a,b)=>divisionOrder(a.division)-divisionOrder(b.division)).map((cap,i)=><li key={i}>
        <strong>{divisionLabel(cap.division)} · {cap.trade}</strong>
        <span className={'ct-badge' + (cap.verified ? '' : ' ct-badge-warning')}>{cap.verified ? "Verified capability" : "Needs verification"}</span>
        {cap.keywords?.length > 0 && <p>{cap.keywords.join(", ")}</p>}
      </li>)}</ul> : <p className="ct-muted">No confirmed trade capabilities on file.</p>}
      <h3>Linked records</h3>
      <SystemLinks person={active}/>
    </section> : <>
      <div className="ct-panel">
        <div className="ct-panel-head">
          <div><h2>Find a contractor</h2><p className="ct-muted">Search names, services, trade types, or contact details.</p></div>
          {canEdit && <button type="button" className="lead-action ct-primary" onClick={() => setEdit("new")}>Add contractor</button>}
        </div>
        <div className="ct-filters">
          <label>Search<input type="search" placeholder="e.g. Cabinet door supply" value={term} onChange={e=>{setTerm(e.target.value);setPage(0);}}/></label>
          <label>Division<select value={division} onChange={e=>{setDivision(e.target.value);setTrade("");setPage(0);}}>
            <option value="">All divisions</option>
            {DIVISIONS.map(d => <option value={d.code} key={d.code}>{divisionLabel(d.code)}</option>)}
            <option value="unclassified">Needs classification</option>
          </select></label>
          <label>Trade type<select value={trade} onChange={e=>{setTrade(e.target.value);setPage(0);}}><option value="">All trades</option>{view.trades.map(t=><option key={t}>{t}</option>)}</select></label>
          <label>Sort<select value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}>{sortOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
        </div>
      </div>
      {error ? <Notice type="alert">{error} <button className="lead-action" type="button" onClick={()=>{setError("");setReloadKey(x=>x+1);}}>Try again</button></Notice>
        : !rows ? <Notice>Loading contractor records…</Notice>
        : <p className="ct-result-count" role="status">{view.matched} {view.matched === 1 ? "contractor" : "contractors"}{sort === "division" && view.matched !== view.result.length ? " · Multi-trade profiles appear under each trade" : ""}</p>}
      {rows && !error && !visible.length && <p className="ct-panel ct-muted">{rows.length ? "No contractors match these filters." : "No contractor profiles are available yet."}</p>}
      <div className="ct-rows">{visible.map(({person,division:code,trade:craft},index) => {
        const prev = visible[index - 1];
        const heading = sort === "division" && (!prev || prev.division !== code || prev.trade !== craft);
        return <div key={person.id + ":" + code + ":" + craft}>
          {heading && <h3 className="ct-group-heading">{labelByDivision(code)}{code !== "unclassified" && <span>{craft}</span>}</h3>}
          <article className="ct-row">
            <div><strong>{person.company}</strong><p className="ct-muted">{[person.contact,person.serviceArea].filter(Boolean).join(" · ") || "Contact and service area not recorded"}</p></div>
            <button type="button" className="lead-action" aria-label={'View profile for ' + person.company} onClick={()=>{setProfile(person.id);jump();}}>View profile</button>
          </article>
        </div>;
      })}</div>
      {pageCount > 1 && <nav className="ct-pages" aria-label="Directory pages">
        <button className="lead-action" type="button" disabled={currentPage === 0} onClick={()=>{setPage(currentPage-1);jump();}}>Previous</button>
        <span>Page {currentPage+1} of {pageCount}</span>
        <button className="lead-action" type="button" disabled={currentPage === pageCount-1} onClick={()=>{setPage(currentPage+1);jump();}}>Next</button>
      </nav>}
    </>}
  </div>;
}

function ProfileEditor({initial, cancel, save}: {initial?: ContractorProfile; cancel:()=>void; save:(row:ContractorProfile)=>void}) {
  const [draft, setDraft] = useState<Draft>(()=>blankDraft(initial));
  const [step, setStep] = useState(0);
  const [capIndex, setCapIndex] = useState<number | null>(null);
  const [cap, setCap] = useState<Capability>(emptyCapability);
  const [keywords, setKeywords] = useState("");
  const [capStep,setCapStep] = useState(0);
  const [capPage,setCapPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const focus = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({...d,[key]:value}));
  useEffect(() => { focus.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus(); }, [step,capIndex,capStep]);

  const beginCapability = (value?: Capability,index?: number) => {
    setCap(value ?? emptyCapability());
    setKeywords((value?.keywords ?? []).join(", "));
    setCapIndex(index ?? draft.capabilities.length);
    setCapStep(0);
  };
  const applyCapability = () => {
    const updated = [...draft.capabilities];
    updated[capIndex ?? updated.length] = {...cap,trade:cap.trade.trim(),keywords:[...new Set(keywords.split(",").map(k=>k.trim()).filter(Boolean))]};
    set("capabilities",updated);
    setCapIndex(null);
  };
  const done = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError("");
    if (capIndex !== null) {if (capStep === 0) setCapStep(1); else applyCapability(); return;}
    if (step < STEP_NAMES.length - 1) {setStep(step+1);return;}
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const data = await contractorRequest<{contractor:ContractorProfile}>("",{
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ ...(initial ? {id:initial.id} : {}), contractor:{ ...draft, company:draft.company.trim(), email:draft.email.trim(), phone:draft.phone.trim() } }),
      });
      if (!data.contractor?.id) throw new Error("The directory did not confirm a saved profile.");
      save(data.contractor);
    } catch (e) {setError(e instanceof Error ? e.message : "Could not save contractor.");}
    finally {setSaving(false);busy.current=false;}
  };
  const duplicateCapability = capIndex !== null && draft.capabilities.some((current,i)=> i !== capIndex && current.division === cap.division && current.trade.trim().toLowerCase() === cap.trade.trim().toLowerCase());
  return <section className="ct-panel ct-editor">
    <div className="ct-panel-head">
      <div><p className="ct-kicker">Step {step+1} of {STEP_NAMES.length} · {initial ? "Edit contractor" : "Add contractor"}</p><h2>{capIndex !== null ? (capStep === 0 ? "Classification" : "Specific work") : STEP_NAMES[step]}</h2></div>
      <button type="button" className="lead-action" onClick={cancel} disabled={saving}>Cancel</button>
    </div>
    <form onSubmit={done}>
      <div className="ct-fields" ref={focus}>
        {step === 0 && <>
          <label>Company name<input data-step-focus required maxLength={200} value={draft.company} onChange={e=>set("company",e.target.value)}/></label>
          <label>Service area<input maxLength={1000} placeholder="Cities or counties served" value={draft.serviceArea} onChange={e=>set("serviceArea",e.target.value)}/></label>
        </>}
        {step === 1 && <>
          <label>Primary contact<input data-step-focus maxLength={150} autoComplete="off" value={draft.contact} onChange={e=>set("contact",e.target.value)}/></label>
          <label>Phone<input type="tel" maxLength={48} autoComplete="off" value={draft.phone} onChange={e=>set("phone",e.target.value)}/></label>
          <label>Email<input type="email" maxLength={254} autoComplete="off" value={draft.email} onChange={e=>set("email",e.target.value)}/></label>
        </>}
        {step === 2 && (capIndex === null ? <>
          <p className="ct-muted">Give each verified line of work its own capability. Cabinet doors and installation are separate.</p>
          <div className="ct-contact">
            {draft.capabilities.slice(capPage*2, capPage*2+2).map((value,index)=><button type="button" className="lead-action" onClick={()=>beginCapability(value,capPage*2+index)} key={capPage*2+index}>{value.trade} · Edit</button>)}
            {draft.capabilities.length > 2 && <>
              <button type="button" className="lead-action" disabled={capPage===0} onClick={()=>setCapPage(capPage-1)}>Earlier trades</button>
              <button type="button" className="lead-action" disabled={(capPage+1)*2>=draft.capabilities.length} onClick={()=>setCapPage(capPage+1)}>More trades</button>
            </>}
          </div>
          <button data-step-focus type="button" className="lead-action" onClick={()=>beginCapability()}>Add capability</button>
        </> : capStep === 0 ? <>
          <label>Division<select data-step-focus value={cap.division} onChange={e=>setCap(c=>({...c,division:e.target.value}))}>
            {DIVISIONS.map(d=><option value={d.code} key={d.code}>{divisionLabel(d.code)}</option>)}
          </select></label>
          <label>Trade type<input value={cap.trade} required maxLength={150} onChange={e=>setCap(c=>({...c,trade:e.target.value}))}/></label>
          {duplicateCapability && <Notice type="alert">That trade already exists in this division. Edit the existing capability.</Notice>}
        </> : <>
          <label>Scope terms or cost codes<input data-step-focus value={keywords} maxLength={1200} placeholder="e.g. cabinet door supply, 12-31-10" onChange={e=>setKeywords(e.target.value)}/></label>
          <label className="ct-check"><input type="checkbox" checked={cap.verified} onChange={e=>setCap(c=>({...c,verified:e.target.checked}))}/>Work capability verified</label>
          {capIndex < draft.capabilities.length && <button type="button" className="lead-action" onClick={()=>{set("capabilities",draft.capabilities.filter((_,i)=>i!==capIndex));setCapPage(0);setCapIndex(null);}}>Remove this capability</button>}
        </>)}
        {step === 3 && <label>Documented work or projects<textarea data-step-focus rows={3} maxLength={12000} value={draft.history} onChange={e=>set("history",e.target.value)}/></label>}
        {step === 4 && <label>Useful pricing notes<textarea data-step-focus rows={3} maxLength={12000} value={draft.pricingNotes} onChange={e=>set("pricingNotes",e.target.value)}/></label>}
        {step === 5 && <>
          <details><summary data-step-focus>Review contact and capabilities</summary>
            <dl className="ct-meta"><div><dt>Company</dt><dd>{draft.company}</dd></div><div><dt>Service area</dt><dd>{draft.serviceArea || "Not recorded"}</dd></div><div><dt>Contact</dt><dd>{[draft.contact,draft.phone,draft.email].filter(Boolean).join(" · ") || "Not recorded"}</dd></div><div><dt>Capabilities</dt><dd>{draft.capabilities.map(c=>c.trade).join(", ") || "None recorded"}</dd></div></dl>
          </details>
          <details><summary>Review history and pricing notes</summary><p>{draft.history || "No project history recorded."}</p><p>{draft.pricingNotes || "No pricing notes recorded."}</p></details>
          <div className="ct-contact">{STEP_NAMES.slice(0,-1).map((name,i)=><button type="button" key={name} className="lead-action" onClick={()=>setStep(i)}>Edit {name.toLowerCase()}</button>)}</div>
        </>}
      </div>
      {error && <Notice type="alert">{error}</Notice>}
      <div className="ct-editor-actions">
        <button type="button" className="lead-action" disabled={(step === 0 && capIndex === null) || saving} onClick={() => {
          setError("");
          if (capIndex !== null) {if (capStep === 0) setCapIndex(null); else setCapStep(0);} else setStep(step-1);
        }}>Back</button>
        <button className="lead-action ct-primary" disabled={saving || (step === 0 && !draft.company.trim()) || (capIndex !== null && !capStep && (!cap.trade.trim() || duplicateCapability))}>
          {saving ? "Saving…" : capIndex !== null ? (capStep === 0 ? "Next" : "Use capability") : step < STEP_NAMES.length - 1 ? "Next" : "Save contractor"}
        </button>
      </div>
    </form>
  </section>;
}
