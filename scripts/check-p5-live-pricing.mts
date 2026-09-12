import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {query} from '../lib/p5/database';
import {priceCompleteScope,requestPricing,type PricingRequest} from '../lib/p5/scopePricing';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand';
import type {EstimatorConfiguration} from '../lib/p5/costBook';
import type {ReviewedScope} from '../lib/p5/scope';

// Opt-in paid inference with synthetic scope and read-only approved pricing.
// No draft, rate, lead, CRM, outbox or email write is called by this script.
if(process.env.P5_RUN_LIVE_PRICING!=='true')throw new Error('Explicit live pricing test authorization is required.');
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main(){
 const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 assert.ok(policy?.payload?.planningCatalog?.rates?.length,'The approved catalog must be populated');
 const configuration=policy.payload as EstimatorConfiguration,before=fingerprint(configuration),reports:any[]=[];
 const services=brand.services as readonly string[],cabinet=String(brand.id)==='cabinet';
 const baseService=services.includes('handyman')?'handyman':services.includes('kitchen')?'kitchen':services[0];
 const selected=process.env.P5_LIVE_PRICING_SCENARIO||'both';assert.ok(['both','mapping','missing'].includes(selected));
 for(const scenario of ['mapping','missing'].filter(s=>selected==='both'||s===selected)){
  const missing=scenario==='missing';
  const text=missing?'Supply one complete dual-bin 35-quart soft-close wood pullout waste-container insert sized for an 18-inch base cabinet. Supply the insert and its mounting hardware only; no cabinet box, door or installation labor. Pickup in Boise, Idaho.':cabinet?'Install 20 linear feet of owner-supplied, assembled paint-grade Shaker base cabinets on the first floor of Building Alpha. Installation labor only, including normal leveling, fastening and adjustment.':'Fit and fasten 100 linear feet of paint-grade interior base moulding on the first floor of Building Alpha. Baseboard installation labor only. Owner supplies all materials.';
  const instructions=missing?'Materials only. Include the complete insert and necessary mounting hardware. No installation, no cabinet casework. Show a sourced preliminary purchase-cost allowance if the exact supplier selection is unconfirmed.':'Price only the specified first-floor installation labor in Building Alpha. Owner supplies all materials. Exclude all plumbing, electrical and second-floor work. Do not charge owner-supplied materials.';
  const scope:ReviewedScope={text,answers:{service:missing&&services.includes('cabinet-product')?'cabinet-product':cabinet?'cabinet-install':baseService,location:'Boise, Idaho',estimatingInstructions:instructions,...(cabinet&&!missing?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0',cabinetTallLf:'0'}:{})},extraction:null,uploads:[],reviewedAt:new Date().toISOString(),corrections:[]};
  const config=structuredClone(configuration);
  // A deliberately missing material category in an in-memory test copy forces
  // the research path. The owner's saved185-rate catalog remains untouched.
  if(missing)config.planningCatalog!.rates=config.planningCatalog!.rates.filter(rate=>rate.type!=='Material');
  const stages:any[]=[];const request:PricingRequest=async(instructions,input,search,remaining)=>{
   const start=performance.now();try{const result=await requestPricing(instructions,input,search,remaining);stages.push({search,milliseconds:Math.round(performance.now()-start),sourceUrls:result.sourceUrls});return result;}catch(error){stages.push({search,milliseconds:Math.round(performance.now()-start),error:error instanceof Error?error.message:'failed'});throw error;}
  };
  const start=performance.now();const result=await priceCompleteScope(scope,config,request);const internal=result.internal as any;
  const issues=internal.scopePricing?.issues||[];const lines=internal.lines||[];
  reports.push({scenario,scope,elapsedMs:Math.round(performance.now()-start),stages,result,passed:Boolean(result.customer.range)&&lines.length>0&&lines.every((line:any)=>line.quantity>0&&line.cost>0)&&issues.length===0});
 }
 const [after]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 const report={synthetic:true,brand:brand.id,approvedRateCount:configuration.planningCatalog!.rates.length,approvedConfigurationUnchanged:before===fingerprint(after.payload),businessWrites:0,reports};
 await mkdir('p5-verification',{recursive:true});await writeFile('p5-verification/live-pricing-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({brand:brand.id,approvedRateCount:report.approvedRateCount,unchanged:report.approvedConfigurationUnchanged,scenarios:reports.map(r=>({scenario:r.scenario,passed:r.passed,range:r.result.customer.range,elapsedMs:r.elapsedMs,issues:r.result.internal.scopePricing?.issues}))}));
 assert.ok(report.approvedConfigurationUnchanged,'The approved configuration must not change');assert.ok(reports.every(r=>r.passed),'Every synthetic scope must have a complete positive range');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error instanceof Error?error.message:'Live pricing check failed');process.exit(1);});
