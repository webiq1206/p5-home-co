"use client";
import {useEffect,useState} from "react";
import {TRADE_CATEGORIES} from "@/lib/p5/trades";
import {P5ReferenceCostBudget} from "./P5ReferenceCostBudget";
import type {PriceReference} from "@/lib/p5/references";
export function P5PriceReferences({review}:{review?:{reviewId:string;estimate:{lines:{id:string;description:string;quantity:number;unit:string}[]}}|null}){
  const [records,setRecords]=useState<PriceReference[]>([]),[version,setVersion]=useState(0);
  const [overheadRate,setOverheadRate]=useState<number|null>(null);
  const [search,setSearch]=useState(""),[trade,setTrade]=useState("");
  const [pending,setPending]=useState<PriceReference[]|null>(null),[notes,setNotes]=useState("");
  const [selected,setSelected]=useState<PriceReference|null>(null),[lineId,setLineId]=useState("");
  const [quantity,setQuantity]=useState(""),[rate,setRate]=useState(""),[rationale,setRationale]=useState("");
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const control={display:"block",width:"100%",maxWidth:"100%",minHeight:44,fontSize:16,padding:10,color:"#17201b",background:"#fff",boxSizing:"border-box" as const,margin:"8px 0 16px"};
  async function request(method="GET",body?:unknown){const r=await fetch("/api/admin/p5-estimators/references",{method,headers:{"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||"Reference review failed.");return data;}
  async function load(){const data=await request();setRecords(data.records);setVersion(data.version);setOverheadRate(typeof data.overheadRate==="number"?data.overheadRate:null);}
  useEffect(()=>{let active=true;fetch("/api/admin/p5-estimators/references").then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||"Reference review failed.");if(active){setRecords(data.records);setVersion(data.version);setOverheadRate(typeof data.overheadRate==="number"?data.overheadRate:null);}}).catch(e=>{if(active)setMessage(e.message);});return()=>{active=false;};},[]);
  const visible=records.filter(r=>(!trade||r.trade===trade)&&`${r.description} ${r.source}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Historical pricing references"><h2>Historical pricing references</h2>
    <p>Compare like-for-like items before changing a price. These examples are separate from the current direct-cost book. Optional items, allowances, unclear units and embedded overhead need review.</p>
    <details><summary>Import reviewed examples</summary><label>Reference JSON file<input style={control} type="file" accept=".json" onChange={async e=>{try{const f=e.target.files?.[0];if(!f)return;if(f.size>7500000)throw new Error("Use a file below 7.5 MB.");const data=JSON.parse(await f.text());if(!Array.isArray(data.references))throw new Error("Choose a P5 reference file.");setPending(data.references);setMessage(`${data.references.length} references ready for review and import.`);}catch(e){setMessage(String(e));}}}/></label>
      <label>Source review notes<textarea style={control} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Record the price basis, date, geography, exclusions and unresolved figures."/></label>
      <button style={{minHeight:44,padding:12}} disabled={busy||!pending||notes.trim().length<30} onClick={async()=>{setBusy(true);try{const data=await request("PUT",{version,references:pending,notes});await load();setPending(null);setMessage(`Saved ${data.count} historical references. No direct costs were changed.`);}catch(e){setMessage(String(e));}finally{setBusy(false);}}}>Save reference book</button>
    </details>
    <label>Find an item<input style={control} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search description or source"/></label>
    <label>Trade category<select style={control} value={trade} onChange={e=>setTrade(e.target.value)}><option value="">All trades</option>{TRADE_CATEGORIES.map(t=><option key={t}>{t}</option>)}</select></label>
    <p>{visible.length} matching items. Showing up to 30. Narrow your search to find the right scope.</p>
    <ul style={{paddingLeft:20}}>{visible.slice(0,30).map(r=><li key={r.id} style={{padding:"10px 0"}}><button style={{minHeight:44,textAlign:"left",maxWidth:"100%",whiteSpace:"normal"}} onClick={()=>{setSelected(r);setQuantity("");setRate("");setConfirmed(false);setRationale("");}}>{r.trade}: {r.description}</button><p>{r.sourceDate} | {r.quantity} {r.unit} at ${r.unitPrice.toLocaleString("en-US")} | {r.priceBasis.replaceAll("-"," ")}</p></li>)}</ul>
    {selected&&<div><h3>{selected.description}</h3><p>{selected.source}, page {selected.page}. {selected.location}. {selected.conditions}</p><p>Scope status: {selected.commercialStatus}. Source line total: ${selected.extendedPrice.toLocaleString("en-US")}.</p><ul>{selected.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
      <P5ReferenceCostBudget reference={selected} overheadRate={overheadRate}/>
      {review&&<><label>Compare with reviewed cost line<select style={control} value={lineId} onChange={e=>{setLineId(e.target.value);const line=review.estimate.lines.find(l=>l.id===e.target.value);setQuantity(line?String(line.quantity):"");}}><option value="">Choose a reviewed line</option>{review.estimate.lines.map(l=><option value={l.id} key={l.id}>{l.description}</option>)}</select></label>
      <label>Saved cost-line quantity ({review.estimate.lines.find(l=>l.id===lineId)?.unit||selected.unit})<input style={control} inputMode="decimal" value={quantity} readOnly/></label>
      <label>Adjusted customer price per {selected.unit}<input style={control} inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)}/></label>
      <label>Why this scope and price are comparable<textarea style={control} value={rationale} onChange={e=>setRationale(e.target.value)}/></label>
      <label style={{display:"flex",gap:12,padding:"12px 0"}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked the specifications, units, project size, location, document date and any price adjustments.</label>
      <button disabled={busy||!confirmed||!lineId} style={{minHeight:44,padding:12}} onClick={async()=>{setBusy(true);try{const result=await request("POST",{referenceVersion:version,reviewId:review.reviewId,selection:{referenceId:selected.id,costLineId:lineId,quantity:Number(quantity),unit:selected.unit,adjustedCustomerUnitPrice:Number(rate),scopeConfirmed:confirmed,locationConfirmed:confirmed,dateConfirmed:confirmed,rationale}});setMessage(`Comparison saved: ${result.status.replaceAll("-"," ")}. Reviewed selling amount $${result.customerLinePrice.toFixed(2)}; comparable amount $${result.comparablePrice.toFixed(2)}. ${result.note} Direct-cost ceiling at this selling price: $${result.directCostBudget.maximumDirectUnitCost.toFixed(2)} per ${selected.unit}. Reviewed direct cost: $${result.reviewedDirectUnitCost.toFixed(2)}. The ceiling is a budget limit, not a verified supplier cost.`);}catch(e){setMessage(String(e));}finally{setBusy(false);}}}>Compare and save evidence</button></>}
    </div>}{message&&<p role="status">{message}</p>}
  </section>;
}
