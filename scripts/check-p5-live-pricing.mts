import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {PricingQualification,digest,readAllowance,pricingSourceIdentity} from './lib/pricingQualification.ts';
import {capturePricingDelivery} from './lib/capturedPricingDelivery.ts';
import {priceCompleteScope,requestPricing,type PricingRequest} from '../lib/p5/scopePricing';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand';
import type {EstimatorConfiguration} from '../lib/p5/costBook';
import type {ReviewedScope} from '../lib/p5/scope';

// Opt-in paid inference with synthetic scope and read-only approved pricing.
// Application DB reads are SELECT-only. Draft/outbox writes and delivery are
// exercised exclusively in the isolated in-memory capture fixture.
if(process.env.P5_RUN_LIVE_PRICING!=='true')throw new Error('Explicit live pricing test authorization is required.');
// A boolean opt-in is NOT a spending allowance. Validate before even reading DB.
const allowanceFile=process.env.P5_PRICING_ALLOWANCE_FILE;
const allowance=readAllowance(allowanceFile);
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main(){
 const sourceSha256=pricingSourceIdentity();
 const allowanceRoot=`p5-verification/pricing-qualification/${digest(allowance.id)}`;
 const artifactRoot=`${allowanceRoot}/${Date.now()}-${randomUUID()}`;
 const qualification=new PricingQualification(allowanceFile,`${allowanceRoot}.sqlite`,sourceSha256);
 const originalFetch=globalThis.fetch;
 const providerReceipts:unknown[]=[];
 try{
 qualification.assertClear();
 const {query}=await import('../lib/p5/database');
 const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 assert.ok(policy?.payload?.planningCatalog?.rates?.length,'The approved catalog must be populated');
 const configuration=policy.payload as EstimatorConfiguration,before=fingerprint(configuration),reports:any[]=[];
 const services=brand.services as readonly string[],cabinet=String(brand.id)==='cabinet';
 const baseService=services.includes('handyman')?'handyman':services.includes('kitchen')?'kitchen':services[0];
 const selected=process.env.P5_LIVE_PRICING_SCENARIO||'both';assert.ok(['both','mapping','missing'].includes(selected));
  await mkdir(artifactRoot,{recursive:true});
 for(const scenario of ['mapping','missing'].filter(s=>selected==='both'||s===selected)){
   const capturedTransport:typeof fetch=async(input,init)=>{
    const response=await originalFetch(input,init);
    let metadata:any=null;
    try{metadata=await response.clone().json();}catch{/* The guard freezes unparseable replies. */}
    // Capture only billing/identity evidence, never keys, headers, raw errors
    // or provider content. Keep mismatched identities visible for reconciliation.
    providerReceipts.push({scenario,httpStatus:response.status,
     model:typeof metadata?.model==='string'?metadata.model:null,
     serviceTier:typeof metadata?.service_tier==='string'?metadata.service_tier:null,
     status:typeof metadata?.status==='string'?metadata.status:null,
     usage:metadata?.usage&&typeof metadata.usage==='object'?metadata.usage:null});
    await writeFile(`${artifactRoot}/provider-receipts.json`,JSON.stringify(providerReceipts,null,2));
    return response;
   };
   const guarded=qualification.guardedFetch({documentId:`pricing-${scenario}`,kind:'short'},capturedTransport);
   // QA-only: request standard processing explicitly, before the guard computes
   // the durable request identity and reservation. Customer pricing is unchanged.
   globalThis.fetch=(input,init)=>{
    const endpoint=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(endpoint.endsWith('/responses')&&typeof init?.body==='string'){
     const body=JSON.parse(init.body);
     if(body.service_tier===undefined)body.service_tier='default';
     return guarded(input,{...init,body:JSON.stringify(body)});
    }
    return guarded(input,init);
   };
  const missing=scenario==='missing';
  const text=missing?'Supply 100 linear feet of standard paint-grade wood crown moulding for kitchen cabinets in Boise, Idaho. Materials only; owner installs it. Price the moulding by linear foot using a preliminary average material cost for the area.':cabinet?'Install 20 linear feet of owner-supplied, assembled paint-grade Shaker base cabinets on the first floor of Building Alpha. Installation labor only, including normal leveling, fastening and adjustment.':'Fit and fasten 100 linear feet of paint-grade interior base moulding on the first floor of Building Alpha. Baseboard installation labor only. Owner supplies all materials.';
  const instructions=missing?'Price only the 100 linear feet of crown moulding material. Exclude installation, painting, cabinet casework and all other work. Use sourced regional average material costs per linear foot, or a clearly labeled broader benchmark. Do not shop suppliers or require an exact SKU.':'Price only the specified first-floor installation labor in Building Alpha. Owner supplies all materials. Exclude all plumbing, electrical and second-floor work. Do not charge owner-supplied materials.';
  const scope:ReviewedScope={text,answers:{service:missing&&services.includes('cabinet-product')?'cabinet-product':cabinet?'cabinet-install':baseService,location:'Boise, Idaho',estimatingInstructions:instructions,...(cabinet&&!missing?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0',cabinetTallLf:'0'}:{})},extraction:null,uploads:[],reviewedAt:new Date().toISOString(),corrections:[]};
  const config=structuredClone(configuration);
  // A deliberately missing material category in an in-memory test copy forces
  // the research path. The owner's saved185-rate catalog remains untouched.
  if(missing)config.planningCatalog!.rates=config.planningCatalog!.rates.filter(rate=>rate.type!=='Material');
  const stages:any[]=[];const request:PricingRequest=async(instructions,input,search,remaining)=>{
   const start=performance.now();try{const result=await requestPricing(instructions,input,search,remaining);stages.push({search,milliseconds:Math.round(performance.now()-start),sourceUrls:result.sourceUrls,value:result.value});return result;}catch(error){stages.push({search,milliseconds:Math.round(performance.now()-start),error:'Qualification pricing stage blocked or failed'});throw error;}finally{await writeFile(`${artifactRoot}/live-pricing-${scenario}-stages.json`,JSON.stringify(stages,null,2));}
  };
  const start=performance.now();const result=await priceCompleteScope(scope,config,request);const internal=result.internal as any;
  const issues=internal.scopePricing?.issues||[];const lines=internal.lines||[];
  reports.push({scenario,scope,elapsedMs:Math.round(performance.now()-start),stages,result,passed:Boolean(result.customer.range)&&lines.length>0&&lines.every((line:any)=>line.quantity>0&&line.cost>0)&&issues.length===0});
  await writeFile(`${artifactRoot}/live-pricing-${scenario}-report.json`,JSON.stringify(reports.at(-1),null,2));
  qualification.assertClear();
  if(reports.at(-1).passed)await capturePricingDelivery(result,scope,`${artifactRoot}/${scenario}`,originalFetch);
 }
 globalThis.fetch=originalFetch;
 const [after]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
  const report={synthetic:true,brand:brand.id,sourceSha256,configurationSha256:before,allowanceId:allowance.id,approvedRateCount:configuration.planningCatalog!.rates.length,approvedConfigurationUnchanged:before===fingerprint(after.payload),businessWrites:0,reports};
  await writeFile(`${artifactRoot}/live-pricing-report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({brand:brand.id,approvedRateCount:report.approvedRateCount,unchanged:report.approvedConfigurationUnchanged,scenarios:reports.map(r=>({scenario:r.scenario,passed:r.passed,range:r.result.customer.range,elapsedMs:r.elapsedMs,issues:r.result.internal.scopePricing?.issues}))}));
 assert.ok(report.approvedConfigurationUnchanged,'The approved configuration must not change');assert.ok(reports.every(r=>r.passed),'Every synthetic scope must have a complete positive range');
 }finally{
  globalThis.fetch=originalFetch;
  await writeFile(`p5-verification/pricing-qualification/${digest(allowance.id)}-spend.json`,JSON.stringify(qualification.report(),null,2));
  qualification.close();
 }
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Pricing qualification blocked or failed; inspect the local spend ledger and qualification artifacts.');process.exit(1);});
