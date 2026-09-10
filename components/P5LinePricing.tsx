"use client";
import {useState} from "react";
import type {P5Estimate} from "@/lib/p5/pricing";
const money=(n:number)=>n.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
export function P5LinePricing({estimate}:{estimate:P5Estimate}){
  const [filter,setFilter]=useState("");
  const lines=estimate.lines.filter(line=>`${line.description} ${line.trade}`.toLowerCase().includes(filter.toLowerCase()));
  return <section aria-label="Item pricing breakdown"><h3>Item pricing breakdown</h3>
    <p>Each item includes its direct cost, contingency, share of overhead and operating profit. The calculations retain full precision; displayed amounts are rounded to cents.</p>
    <label>Find a priced item<input style={{display:"block",width:"100%",maxWidth:"100%",minHeight:44,fontSize:16,padding:12,color:"#17201b",background:"#fff",boxSizing:"border-box"}} value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Description or trade"/></label>
    <p>{lines.length} matching items.</p>
    {lines.map(line=><details key={line.id} style={{border:"1px solid #88928c",borderRadius:8,padding:14,margin:"12px 0"}}><summary style={{minHeight:44,cursor:"pointer"}}>{line.trade}: {line.description} ({money(line.sellingAmount)})</summary>
      <p>{line.quantity.toLocaleString("en-US")} {line.unit} at {money(line.unitCost)} direct cost per {line.unit}.</p>
      <dl style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,210px),1fr))",gap:16,margin:0}}>{[["Direct cost",line.cost],["Contingency",line.contingency],["Overhead recovery",line.overheadRecovery],["Operating profit",line.operatingProfit],["Selling price per unit",line.sellingUnitPrice],["Selling amount",line.sellingAmount]].map(([label,value])=><div key={String(label)}><dt>{String(label)}</dt><dd style={{margin:0,fontWeight:600}}>{money(Number(value))}</dd></div>)}</dl>
    </details>)}
  </section>;
}
