import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readSiteEstimate} from "../app/lib/leads/intakeContract.ts";
import {siteEstimatePricing} from "../app/lib/leads/site-estimate.ts";
import {BRANDS} from "../app/lib/leads/types.ts";
import {buildEstimatePayload,requiredEstimateItems} from "../app/lib/scopes/estimate.ts";
import type {ItemKey,PricingResult} from "../app/lib/scopes/types.ts";
import {priceEstimate} from "../app/lib/estimator/price.ts";
import {BRAND_CONFIGS} from "../app/lib/estimator/brands.ts";
import {PROJECT_SERVICE_ROLES,resolveProjectServiceLine} from "../lib/p5/projectServices.ts";

const money=(n:number)=>Math.round(n*100)/100;
const hours=[.617285,.125,.125];
const serviceLines=()=>PROJECT_SERVICE_ROLES.map((r,i)=>({
  sku:r.code,qboItemId:r.qboItemId,title:r.name,quantity:hours[i],
  unit:"HR",unitPrice:120,amount:money(hours[i]*120),division:"Kitchen",
}));
function envelope(lines:unknown[]=serviceLines(),kind="planning-range"){
  const total=money(lines.reduce<number>((n,l)=>n+Number((l as {amount:number}).amount),0));
  return {kind,low:total,high:total,base:total,lines,verified:true};
}
function payload(pricing:PricingResult,emptyItems=false){
  const itemIds=(emptyItems?{}:Object.fromEntries(pricing.lines.map(l=>[l.item,`ordinary-${l.item}`]))) as Record<ItemKey,string>;
  return buildEstimatePayload({customerId:"synthetic-offline-only",pricing,itemIds,
    taxable:["Handyman Service Work","Cabinet Installation"],exclusions:[],privateNote:"Offline payload test; never sent"});
}

test("all local brand payloads retain validated SKUs and server-resolved P5 item IDs through serialization",()=>{
  for(const brand of BRANDS)for(const kind of ["planning-range","document"]){
    const incoming=envelope([{title:"Ordinary work",quantity:1,unit:"LS",amount:800},...serviceLines()],kind);
    const parsed=readSiteEstimate(JSON.stringify(incoming));
    assert.equal(parsed.problem,null,`${brand}/${kind}`);
    const retained=JSON.parse(JSON.stringify(parsed.estimate));
    const reread=readSiteEstimate(retained).estimate!;
    const pricing=siteEstimatePricing(brand,reread);
    const built=payload(pricing);
    for(const [i,role] of PROJECT_SERVICE_ROLES.entries()){
      assert.deepEqual(reread.lines[i+1].qboItemId,role.qboItemId);
      const line=built.Line.find(l=>l.SalesItemLineDetail?.ItemRef.value===role.qboItemId)!;
      assert.ok(line,`${brand}/${kind}/${role.code}: no brand-default fallback`);
      assert.equal(line.SalesItemLineDetail!.Qty,hours[i]);
      assert.equal(line.SalesItemLineDetail!.UnitPrice,120);
      assert.equal(line.SalesItemLineDetail!.TaxCodeRef.value,"NON","same service classification as guided");
      assert.equal(line.Amount,money(hours[i]*120));
      assert.equal(pricing.lines.find(l=>l.sku===role.code)!.division,"01");
    }
    assert.equal(money(built.Line.reduce((n,l)=>n+(l.Amount??0),0)),incoming.base);
    assert.equal(built.EmailStatus,"NotSet");
  }
});

test("SKU-only and matching legacy itemId hints resolve without any generic item mapping",()=>{
  const lines=serviceLines().map(({qboItemId,...l},i)=>({...l,itemId:Number(qboItemId),unit:i?"hours":"hr"}));
  const parsed=readSiteEstimate(envelope(lines)).estimate!;
  assert.ok(parsed);
  const pricing=siteEstimatePricing("Boise Handyman Co",parsed);
  assert.deepEqual(requiredEstimateItems(pricing),[]);
  assert.equal(payload(pricing,true).Line.filter(l=>l.DetailType==="SalesItemLineDetail").length,3);
  for(const l of serviceLines()){
    const {qboItemId,...withoutId}=l;
    assert.equal(resolveProjectServiceLine(withoutId)!.qboItemId,qboItemId);
  }
});

test("unknown SKUs, conflicting IDs, missing SKU, bad hours and non-$120 rates never fall back",()=>{
  const base=serviceLines()[0];
  const invalid=[
    {...base,sku:"01-31-99"},{...base,qboItemId:"999"},
    {...base,itemId:"49"},{...base,sku:undefined},
    {...base,unit:"EA"},{...base,quantity:0},{...base,quantity:-1},
    {...base,amount:0},{...base,amount:base.amount+1},{...base,unitPrice:125},
    {...base,qboItemId:null},
  ];
  for(const line of invalid){
    const result=readSiteEstimate({...envelope(),lines:[line]});
    assert.equal(result.estimate,null);
    assert.ok(result.problem,"Retain a safe diagnostic instead of silently dropping metadata");
    assert.throws(()=>resolveProjectServiceLine(line));
  }
});

test("pricing and final QBO payload builders independently reject forged service metadata",()=>{
  const parsed=readSiteEstimate(envelope()).estimate!;
  assert.throws(()=>siteEstimatePricing("P5 Home Co",{...parsed,lines:[
    {...parsed.lines[0],qboItemId:"49"},...parsed.lines.slice(1),
  ]}),/mapping/);
  const pricing=siteEstimatePricing("P5 Home Co",parsed);
  for(const change of [{qboItemId:"49"},{unitPrice:121},{quantity:1},{sku:"untrusted"}]){
    const forged={...pricing,lines:pricing.lines.map((l,i)=>i?l:{...l,...change})} as PricingResult;
    assert.throws(()=>payload(forged),/SKU|mapping|120/);
    assert.throws(()=>requiredEstimateItems(forged),/SKU|mapping|120/);
  }
});

test("shared guided pricing and incoming brand pricing use identical service-item and rate rules",()=>{
  for(const brand of Object.values(BRAND_CONFIGS).filter(b=>b.live)){
    const guided=priceEstimate({brand:brand.id,project:brand.projects[0],tier:"mid",
      answers:brand.projects[0]==="handyman"?{tasks:{faucet:2}}:{},address:"Synthetic offline location",property:null},{now:new Date("2026-11-23T00:00:00Z")});
    const roles=guided.pricing.lines.filter(l=>l.sku);
    // Handyman Co bills $95/hr all-in, so its jobs carry no $120 project-service lines.
    if(brand.projects[0]==="handyman"){assert.equal(roles.length,0,brand.id);continue;}
    assert.equal(roles.length,3,brand.id);
    const read=readSiteEstimate(envelope(roles.map(l=>({
      sku:l.sku,title:l.description,quantity:l.quantity,unit:l.unit,
      amount:l.price,itemId:PROJECT_SERVICE_ROLES.find(r=>r.code===l.sku)!.qboItemId,
    }))));
    assert.equal(read.problem,null);
    const incoming=payload(siteEstimatePricing("Boise Handyman Co",read.estimate!),true);
    const shared=payload(guided.pricing);
    for(const role of PROJECT_SERVICE_ROLES){
      const find=(p:ReturnType<typeof payload>)=>p.Line.find(l=>l.SalesItemLineDetail?.ItemRef.value===role.qboItemId)!;
      assert.deepEqual(find(incoming).SalesItemLineDetail,find(shared).SalesItemLineDetail);
      assert.equal(find(incoming).Amount,find(shared).Amount);
    }
  }
});

test("ordinary item mapping is preserved and guided delivery is not queued a second time",()=>{
  const parsed=readSiteEstimate(envelope([{title:"Ordinary work",amount:200,itemId:"untrusted-arbitrary-id"}])).estimate!;
  const pricing=siteEstimatePricing("Boise Handyman Co",parsed);
  assert.equal(pricing.lines[0].sku,undefined);
  assert.equal(payload(pricing).Line.find(l=>l.SalesItemLineDetail)?.SalesItemLineDetail?.ItemRef.value,
    "ordinary-Handyman Service Work");
  const handler=readFileSync(new URL("../app/api/leads/intake/handler.ts",import.meta.url),"utf8");
  assert.match(handler,/readSiteEstimate\(body\.estimate \?\? body\.site_estimate \?\? body\.siteEstimate\)/);
  assert.match(handler,/deps\.skipLeadAlert \|\| alerts\.siteEstimate/);
});
