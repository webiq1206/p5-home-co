import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import {PGlite} from "@electric-sql/pglite";
import {
  PROJECT_SERVICE_ROLES,projectServiceDefaults,validateProjectServiceDefaults,
  newProjectServices,projectServiceLines,assertProjectServiceSet,
} from "../lib/p5/projectServices.ts";
import {loadProjectServiceDefaults} from "../lib/p5/projectServicePolicy.ts";
import type {PolicySaveDeps} from "../lib/p5/adminEndpoint.ts";
import {DraftError} from "../lib/p5/store.ts";
import {DEFAULT_FINANCE} from "../lib/p5/pricing.ts";
import {configurationIdentity} from "../lib/p5/pricingCache.ts";
import {priceEstimate,internalReport,customerEstimate} from "../app/lib/estimator/price.ts";
import {readSiteEstimate} from "../app/lib/leads/intakeContract.ts";
import {siteEstimatePricing} from "../app/lib/leads/site-estimate.ts";
import {requiredEstimateItems,buildEstimatePayload} from "../app/lib/scopes/estimate.ts";
import type {ItemKey} from "../app/lib/scopes/types.ts";
import {emptyScope,DEFAULT_SCOPE_SETTINGS} from "../app/lib/scopes/types.ts";
import {priceScope} from "../app/lib/scopes/pricing.ts";
import {calculateP5Estimate,COST_CATEGORIES} from "../lib/p5/pricing.ts";

// Node's native TS runner does not resolve Next's extensionless server helper.
// Keep the actual endpoint/auth implementation; only resolve its package file.
registerHooks({resolve(specifier,context,next){
  return next(specifier==="next/headers"?"next/headers.js":specifier,context);
}});
const {savePolicyWithDeps:putAdminPolicy,validateConfiguration}=await import("../lib/p5/adminEndpoint.ts");

const edited={
  "01-31-03":{hoursPer1000:.625,minimumHours:.375},
  "01-31-04":{hoursPer1000:.375,minimumHours:.2},
  "01-31-05":{hoursPer1000:.25,minimumHours:.15},
};
const configuration=()=>({finance:{...DEFAULT_FINANCE,annualRevenue:2100000,forecastSource:"Isolated fixture",reviewedAt:new Date().toISOString()},costBooks:[],projectServiceDefaults:structuredClone(edited)});
const request=(version:number,configurationValue:unknown)=>new Request("https://p5homeco.com/api/admin/p5-estimators",{
  method:"PUT",headers:{"content-type":"application/json",origin:"https://p5homeco.com"},
  body:JSON.stringify({version,configuration:configurationValue}),
});

test("real admin policy save and loader readback use isolated PostgreSQL with auth and stale-save guards",async()=>{
  const db=await PGlite.create();let writes=0;
  try{
    const schema=readFileSync(new URL("../lib/p5/store.ts",import.meta.url),"utf8")
      .match(/`(CREATE TABLE IF NOT EXISTS p5_estimator_policy[^`]+)`/)?.[1];
    assert.ok(schema);await db.exec(schema);
    const sql=(async(text:string,values:unknown[]=[])=>{writes++;return (await db.query(text,values)).rows;}) as PolicySaveDeps["query"];
    const deps:PolicySaveDeps={authorize:async()=>({id:"isolated-admin",email:"fixture@example.invalid"}),ensure:async()=>{},query:sql};
    const denied=await putAdminPolicy(request(0,configuration()),{...deps,authorize:async()=>{throw new DraftError("Administrator sign-in is required.",403);}});
    assert.equal(denied.status,403);assert.equal(writes,0);
    const first=await putAdminPolicy(request(0,configuration()),deps);
    assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
    const read=async()=>{const {rows}=await db.query<{configured:boolean;defaults:unknown}>(
      "SELECT payload ? 'projectServiceDefaults' AS configured,payload->'projectServiceDefaults' AS defaults FROM p5_estimator_policy WHERE id='current'");
      return rows[0]??null;};
    const retained=await loadProjectServiceDefaults(read);
    assert.deepEqual(retained,edited);
    const snapshot=newProjectServices(retained);
    const before=(await db.query<{payload:Record<string,unknown>}>("SELECT payload FROM p5_estimator_policy WHERE id='current'")).rows[0].payload;
    const changed=configuration();changed.projectServiceDefaults["01-31-03"].hoursPer1000=.75;
    const patch=new Request("https://p5homeco.com/api/admin/p5-estimators",{method:"PUT",headers:{"content-type":"application/json"},
      body:JSON.stringify({version:1,projectServiceDefaults:changed.projectServiceDefaults})});
    const saved=await putAdminPolicy(patch,deps);assert.equal(saved.status,200);
    assert.deepEqual((await saved.json()).projectServiceDefaults,changed.projectServiceDefaults,"response is persisted SQL readback");
    const after=(await db.query<{payload:Record<string,unknown>}>("SELECT payload FROM p5_estimator_policy WHERE id='current'")).rows[0].payload;
    assert.deepEqual({...after,projectServiceDefaults:before.projectServiceDefaults},before,"default-only save preserves every other policy field byte-for-value");
    assert.equal((await loadProjectServiceDefaults(read))["01-31-03"].hoursPer1000,.75);
    assert.equal(snapshot.defaults!["01-31-03"].hoursPer1000,.625,"existing project stays frozen");
    assert.equal((await putAdminPolicy(request(1,configuration()),deps)).status,409,"stale policy cannot overwrite newer settings");
    const invalid=configuration();invalid.projectServiceDefaults["01-31-04"].minimumHours=0;
    assert.equal((await putAdminPolicy(request(2,invalid),deps)).status,400);
    assert.equal((await loadProjectServiceDefaults(read))["01-31-03"].hoursPer1000,.75,"invalid save leaves persisted policy intact");
  }finally{await db.close();}
});

test("all six defaults reject zero, negative, missing, nonnumeric, nonfinite or extra price/item fields",()=>{
  for(const role of PROJECT_SERVICE_ROLES)for(const field of ["hoursPer1000","minimumHours"] as const)
    for(const value of [0,-1,NaN,Infinity,".25",null,100001]){
      const invalid=structuredClone(edited) as Record<string,Record<string,unknown>>;
      invalid[role.code][field]=value;
      assert.throws(()=>validateProjectServiceDefaults(invalid));
    }
  assert.throws(()=>validateProjectServiceDefaults({...edited,"01-31-03":{...edited["01-31-03"],unitPrice:130}}));
  assert.throws(()=>validateProjectServiceDefaults({...edited,"01-31-03":{...edited["01-31-03"],qboItemId:"999"}}));
  const missing={...edited} as Record<string,unknown>;delete missing["01-31-05"];
  assert.throws(()=>validateProjectServiceDefaults(missing));
  assert.deepEqual(validateConfiguration(configuration()).projectServiceDefaults,edited);
});

test("missing policy retains original defaults; malformed saved policy and read failures do not silently reprice",async()=>{
  assert.deepEqual(await loadProjectServiceDefaults(async()=>null),projectServiceDefaults());
  assert.deepEqual(await loadProjectServiceDefaults(async()=>({configured:false,defaults:null})),projectServiceDefaults());
  await assert.rejects(()=>loadProjectServiceDefaults(async()=>({configured:true,defaults:null})));
  await assert.rejects(()=>loadProjectServiceDefaults(async()=>{throw new Error("fixture unavailable");}),/fixture unavailable/);
});

test("project snapshots and overrides survive later defaults edits, with minimums applied once",()=>{
  const defaults=projectServiceDefaults(edited),plan=newProjectServices(defaults);
  const original=projectServiceLines(newProjectServices(),10000,999);
  const small=projectServiceLines(plan,100,999,{planning:1,delivery:1,closeout:1});
  assert.deepEqual(small.map(l=>l.quantity),[.375,.2,.15]);
  assert.deepEqual(small.map(l=>l.price),[45,24,18]);
  for(const line of small)assert.ok(Math.abs(Object.values(line.hours).reduce((a,b)=>a+b,0)-line.quantity)<1e-8);
  const large=projectServiceLines(plan,10000,1);
  assert.deepEqual(large.map(l=>l.quantity),[6.25,3.75,2.5]);
  defaults["01-31-03"].minimumHours=99;
  assert.deepEqual(projectServiceLines(plan,100,1).map(l=>l.quantity),[.375,.2,.15]);
  const overridden={...plan,hours:{"01-31-03":{planning:.1,delivery:.1,closeout:.1}}};
  assert.equal(projectServiceLines(overridden,1000000,999)[0].quantity,.3);
  assert.deepEqual(projectServiceLines(newProjectServices(),10000,999),original,"old v2 without a snapshot retains original defaults");
  assert.notEqual(configurationIdentity(configuration()),configurationIdentity({...configuration(),projectServiceDefaults:projectServiceDefaults()}));
});

test("four shared embed pricing paths and intake/QBO receiver retain saved default hours once at $120",async()=>{
  const settings=await loadProjectServiceDefaults(async()=>({configured:true,defaults:edited}));
  for(const brand of ["remodeling","construction","handyman","cabinet"] as const){
    const project={remodeling:"kitchen-remodel",construction:"custom-home",handyman:"handyman",cabinet:"kitchen-cabinets"}[brand];
    const priced=priceEstimate({brand,project,tier:"mid",answers:brand==="handyman"?{tasks:{faucet:2}}:{},address:"Isolated fixture",property:null},
      {projectServiceDefaults:settings,now:new Date("2026-11-23T12:00:00Z")});
    const roles=priced.pricing.lines.filter(l=>l.sku);
    const expected=projectServiceLines(newProjectServices(settings),priced.pricing.projectServiceBasis!.outsideDirectCost,1);
    assert.equal(roles.length,3);
    assert.deepEqual(roles.map(l=>l.quantity),expected.map(l=>l.quantity));
    const total=Math.round(roles.reduce((n,l)=>n+l.price,0)*100)/100;
    const incoming={kind:"planning-range",low:total,high:total,base:total,verified:true,lines:roles.map(l=>({
      sku:l.sku,title:l.description,quantity:l.quantity,unit:l.unit,amount:l.price,
    }))};
    const read=readSiteEstimate(JSON.parse(JSON.stringify(incoming)));
    assert.equal(read.problem,null);
    const pricing=siteEstimatePricing("P5 Home Co",read.estimate!);
    assert.deepEqual(requiredEstimateItems(pricing),[]);
    const qbo=buildEstimatePayload({customerId:"offline-not-sent",pricing,itemIds:{} as Record<ItemKey,string>,taxable:[],exclusions:[],privateNote:"Fixture only"});
    for(const role of PROJECT_SERVICE_ROLES){
      const stored=roles.find(l=>l.sku===role.code)!;
      const matches=qbo.Line.filter(l=>l.SalesItemLineDetail?.ItemRef.value===role.qboItemId);
      assert.equal(matches.length,1);assert.equal(matches[0].SalesItemLineDetail!.UnitPrice,120);
      assert.equal(matches[0].SalesItemLineDetail!.Qty,stored.quantity);
      assert.equal(matches[0].Amount,stored.price);
    }
    assert.match(JSON.stringify(internalReport(priced)),/0\.625/);
    assert.doesNotMatch(JSON.stringify(customerEstimate(priced,{token:"offline",address:null,createdAt:new Date(),officialCopy:"after-review"})),/hoursPer1000|minimumHours|01-31-03/);
    for(const bad of [[...incoming.lines,incoming.lines[0]],incoming.lines.slice(0,2)]){
      assert.throws(()=>assertProjectServiceSet(bad),/exactly once/);
      assert.equal(readSiteEstimate({...incoming,lines:bad}).estimate,null);
    }
  }
});

test("shared submit, new scope/document snapshot, admin UI and protected policy save are wired",()=>{
  const source=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
  assert.match(source("../app/lib/estimator/submit.ts"),/loadProjectServiceDefaults\(\)/);
  assert.match(source("../app/lib/scopes/engine.ts"),/newProjectServices\(await loadProjectServiceDefaults\(\)\)/);
  assert.match(source("../lib/p5/store.ts"),/existing\?existing\.payload\?\.projectServices:newProjectServices\(await loadProjectServiceDefaults\(\)\)/);
  assert.match(source("../app/admin/p5-estimators/page.tsx"),/ProjectServiceDefaultsEditor/);
  assert.match(source("../lib/p5/adminEndpoint.ts"),/deps\.authorize\?\?requireEstimatorAdmin/);
  assert.match(source("../components/ProjectServiceDefaultsEditor.tsx"),/validateProjectServiceDefaults/);
  assert.match(source("../app/lib/scopes/engine.ts"),/Project default snapshots are frozen/);
});

test("Scopes and document pricing consume the same frozen defaults, preserving per-project hour overrides",()=>{
  const plan=newProjectServices(edited);
  plan.hours={"01-31-04":{planning:.1,delivery:.1,closeout:.1}};
  const now=new Date("2026-11-23T12:00:00Z");
  const scoped=priceScope({...emptyScope(),projectServices:plan,tasks:[{
    id:"fixture-door",title:"Replacement door",description:"Replacement door",phase:"construction",
    division:"08",costCode:"08-11-01",certainty:"confirmed",bucket:"approved",
    quantity:{value:2,unit:"EA"},evidence:[],
  }]},{service:"remodel",finishTier:"mid",settings:DEFAULT_SCOPE_SETTINGS,acknowledged:new Set(),now});
  assert.equal(scoped.lines.find(l=>l.sku==="01-31-04")!.quantity,.3);
  const scopeExpected=projectServiceLines(plan,scoped.projectServiceBasis!.outsideDirectCost,1);
  assert.deepEqual(scoped.lines.filter(l=>l.sku).map(l=>l.quantity),scopeExpected.map(l=>l.quantity));
  const document=calculateP5Estimate({
    projectServices:plan,service:"remodel",revision:"isolated",scopeSummary:"Fixture",lines:[{
      id:"outside-trade",description:"Outside work",category:"subcontractors",quantity:1,unit:"LS",unitCost:10000,
      quantitySource:"Isolated fixture",evidence:{basis:"written-quote",reference:"Fixture",verifiedAt:now.toISOString(),validUntil:"2027-01-01"},
    }],coverage:COST_CATEGORIES.map(category=>({category,status:category==="subcontractors"?"included":"not-applicable",reason:"Fixture"})),
    risks:[],assumptions:[],exclusions:[],missingInformation:[],allowances:[],uncertainty:"low",locationProvided:true,
  },DEFAULT_FINANCE,[],now);
  assert.deepEqual(PROJECT_SERVICE_ROLES.map(r=>document.lines.find(l=>l.id===r.code)!.quantity),[6.25,.3,2.5]);
  assert.ok(document.lines.filter(l=>PROJECT_SERVICE_ROLES.some(r=>r.code===l.id)).every(l=>l.sellingUnitPrice===120));
});
