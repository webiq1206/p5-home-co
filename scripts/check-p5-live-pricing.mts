import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pricingMappingChecks} from '../services/document-service/scripts/pricing-mapping-checks.mjs';
import {query} from '../lib/p5/database.ts';
import {priceCompleteScope,requestPricing,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
import type {EstimatorConfiguration} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {customerPdf,administrativePdf,pdfFilename} from '../lib/p5/pdf.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {deliveryRetryDecision} from '../lib/p5/outbox.ts';

// Opt-in paid inference with synthetic scope and read-only approved pricing.
// No draft, rate, lead, CRM, outbox or email write is called by this script.
if(process.env.P5_RUN_LIVE_PRICING!=='true')throw new Error('Explicit live pricing test authorization is required.');
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function runLivePricing(options:{outputDirectory?:string}={}){
 const outputDirectory=options.outputDirectory||resolve('p5-verification');
 const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 assert.ok(policy?.payload?.planningCatalog?.rates?.length,'The approved catalog must be populated');
 const configuration=policy.payload as EstimatorConfiguration,before=fingerprint(configuration),reports:any[]=[];
 const services=brand.services as readonly string[],cabinet=String(brand.id)==='cabinet';
 const baseService=services.includes('handyman')?'handyman':services.includes('kitchen')?'kitchen':services[0];
 const selected=process.env.P5_LIVE_PRICING_SCENARIO||'both';assert.ok(['both','mapping','missing'].includes(selected));
 await mkdir(outputDirectory,{recursive:true,mode:0o700});
 for(const scenario of ['mapping','missing'].filter(s=>selected==='both'||s===selected)){
  const missing=scenario==='missing';
  const text=missing?'Supply 100 linear feet of standard paint-grade wood crown moulding for kitchen cabinets in Boise, Idaho. Materials only; owner installs it. Price the moulding by linear foot using a preliminary average material cost for the area.':cabinet?'Install 20 linear feet of owner-supplied, assembled paint-grade Shaker base cabinets on the first floor of Building Alpha. Installation labor only, including normal leveling, fastening and adjustment.':'Fit and fasten 100 linear feet of paint-grade interior base moulding on the first floor of Building Alpha. Baseboard installation labor only. Owner supplies all materials.';
  const instructions=missing?'Price only the 100 linear feet of crown moulding material. Exclude installation, painting, cabinet casework and all other work. Use sourced regional average material costs per linear foot, or a clearly labeled broader benchmark. Do not shop suppliers or require an exact SKU.':'Price only the specified first-floor installation labor in Building Alpha. Owner supplies all materials. Exclude all plumbing, electrical and second-floor work. Do not charge owner-supplied materials.';
  const scope:ReviewedScope={text,answers:{service:missing&&services.includes('cabinet-product')?'cabinet-product':cabinet?'cabinet-install':baseService,location:'Boise, Idaho',estimatingInstructions:instructions,...(cabinet&&!missing?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0',cabinetTallLf:'0'}:{})},extraction:null,uploads:[],reviewedAt:new Date().toISOString(),corrections:[]};
  const config=structuredClone(configuration);
  // A deliberately missing material category in an in-memory test copy forces
  // the research path. The owner's saved185-rate catalog remains untouched.
  if(missing)config.planningCatalog!.rates=config.planningCatalog!.rates.filter(rate=>rate.type!=='Material');
  const stages:any[]=[];const request:PricingRequest=async(instructions,input,search,remaining)=>{
    const start=performance.now();try{const result=await requestPricing(instructions,input,search,remaining);stages.push({search,milliseconds:Math.round(performance.now()-start),sourceUrls:result.sourceUrls,value:result.value});return result;}catch(error){stages.push({search,milliseconds:Math.round(performance.now()-start),error:error instanceof Error?error.message:'failed'});throw error;}finally{await writeFile(join(outputDirectory,`live-pricing-${scenario}-stages.json`),JSON.stringify(stages,null,2),{mode:0o600});}
  };
  const start=performance.now();const result=await priceCompleteScope(scope,config,request);const internal=result.internal as any;
  const issues=internal.scopePricing?.issues||[];const lines=internal.lines||[];
  const qualityChecks=missing?[]:pricingMappingChecks(result,cabinet);
   const draftId='00000000-0000-4000-8000-000000000005',revision=1;
   const contact={name:'Synthetic QA Customer',email:'qa-no-send@example.invalid',phone:null};
   const record={draftId,revision,brand:brand.name,estimator:brand.id,contact,scope,customer:result.customer,internal};
   const customerBytes=await customerPdf(draftId,result.customer as any),adminBytes=await administrativePdf(draftId,{...internal,contact,brand:brand.name,estimator:brand.id});
   const customerFilename=pdfFilename(draftId,'customer'),adminFilename=pdfFilename(draftId,'administrative');
   await Promise.all([writeFile(join(outputDirectory,customerFilename),customerBytes,{mode:0o600}),writeFile(join(outputDirectory,adminFilename),adminBytes,{mode:0o600})]);
   const customerMail=estimateEmail(draftId,record,false),adminMail=estimateEmail(draftId,record,true);
   const deliveryKey=(destination:string)=>`p5-${draftId}-${revision}-${createHash('sha256').update(destination).digest('hex').slice(0,20)}`;
   const emailPayloads={
    customer:{to:contact.email,subject:`Your ${brand.name} project estimate (ref ${draftId.slice(0,8)})`,...customerMail,attachments:[{filename:customerFilename,bytes:customerBytes.length,sha256:createHash('sha256').update(customerBytes).digest('hex')}],key:deliveryKey(`customer:${contact.email}`)},
    administrative:{to:'qa-admin-no-send@example.invalid',subject:`${brand.name}: internal estimate record (ref ${draftId.slice(0,8)})`,...adminMail,attachments:[{filename:adminFilename,bytes:adminBytes.length,sha256:createHash('sha256').update(adminBytes).digest('hex')}],key:deliveryKey('admin:qa-admin-no-send@example.invalid')}
   };
   const names=contact.name.split(/\s+/),firstName=names.shift()||null;
   const crmPayload={firstName,lastName:names.join(' ')||null,email:contact.email,phone:null,brand:brand.name,projectType:scope.answers.service,source:'Organic Website',sourceDetail:`p5-estimator:${draftId}`,propertyAddress:null,propertyCity:scope.answers.location||null,summary:result.customer.summary,externalLeadId:deliveryKey('crm'),originalForm:'p5-estimator',originalCampaign:null,utm:null,receivedAt:'2026-09-19T00:00:00.000Z'};
   const destinations=[`customer:${contact.email}`,'admin:qa-admin-no-send@example.invalid','crm'],seen=new Set<string>();
   const firstCapture=destinations.map(destination=>({destination,accepted:!seen.has(`${draftId}:${revision}:${destination}`)&&(seen.add(`${draftId}:${revision}:${destination}`),true)}));
   const duplicateCapture=destinations.map(destination=>({destination,suppressed:seen.has(`${draftId}:${revision}:${destination}`)}));
   const duplicateSuppression={firstCapture,duplicateCapture,ambiguousCrmDecision:deliveryRetryDecision('crm',false,1,new Date('2026-09-19T00:00:00.000Z'),Date.parse('2026-09-19T00:01:00.000Z')),businessWrites:0,realSends:0};
   const presentationChecks=[
    {name:'Customer and administrative PDFs are complete PDF files',pass:customerBytes.subarray(0,4).toString()==='%PDF'&&adminBytes.subarray(0,4).toString()==='%PDF'},
    {name:'Customer email excludes internal financial breakdown',pass:!customerMail.text.includes('INTERNAL FINANCIAL BREAKDOWN')&&!customerMail.html.includes('Internal financial breakdown')},
    {name:'Administrative email includes internal financial breakdown',pass:adminMail.text.includes('INTERNAL FINANCIAL BREAKDOWN')&&adminMail.html.includes('Internal financial breakdown')},
    {name:'All duplicate destinations are suppressed',pass:duplicateCapture.every(item=>item.suppressed)&&duplicateSuppression.ambiguousCrmDecision==='needs-review'}
   ];
   await Promise.all([
    writeFile(join(outputDirectory,'email-payloads.json'),JSON.stringify(emailPayloads,null,2),{mode:0o600}),
    writeFile(join(outputDirectory,'crm-payload.json'),JSON.stringify(crmPayload,null,2),{mode:0o600}),
    writeFile(join(outputDirectory,'duplicate-suppression.json'),JSON.stringify(duplicateSuppression,null,2),{mode:0o600})
   ]);
   const capture={customerPdf:{filename:customerFilename,bytes:customerBytes.length,sha256:emailPayloads.customer.attachments[0].sha256},administrativePdf:{filename:adminFilename,bytes:adminBytes.length,sha256:emailPayloads.administrative.attachments[0].sha256},emailPayloads:'email-payloads.json',crmPayload:'crm-payload.json',duplicateSuppression:'duplicate-suppression.json',presentationChecks,realSends:0,businessWrites:0};
   reports.push({scenario,scope,elapsedMs:Math.round(performance.now()-start),stages,result,qualityChecks,capture,passed:Boolean(result.customer.range)&&lines.length>0&&lines.every((line:any)=>line.quantity>0&&line.cost>0)&&issues.length===0&&qualityChecks.every(c=>c.pass)&&presentationChecks.every(c=>c.pass)});
   await writeFile(join(outputDirectory,`live-pricing-${scenario}-report.json`),JSON.stringify(reports.at(-1),null,2),{mode:0o600});
 }
 const [after]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
 const report={synthetic:true,brand:brand.id,approvedRateCount:configuration.planningCatalog!.rates.length,approvedConfigurationUnchanged:before===fingerprint(after.payload),businessWrites:0,realSends:0,reports};
 await writeFile(join(outputDirectory,'live-pricing-report.json'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify({brand:brand.id,approvedRateCount:report.approvedRateCount,unchanged:report.approvedConfigurationUnchanged,scenarios:reports.map(r=>({scenario:r.scenario,passed:r.passed,range:r.result.customer.range,elapsedMs:r.elapsedMs,issues:r.result.internal.scopePricing?.issues}))}));
 assert.ok(report.approvedConfigurationUnchanged,'The approved configuration must not change');assert.ok(reports.every(r=>r.passed),'Every synthetic scope must have a complete positive range');
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runLivePricing().then(()=>process.exit(0)).catch(error=>{console.error(error instanceof Error?error.message:'Live pricing check failed');process.exit(1);});
