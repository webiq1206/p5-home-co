import test from 'node:test';
import assert from 'node:assert/strict';
import {priceCompleteScope,marketResolution,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
const date='2026-09-11T00:00:00.000Z',now=new Date(date);
const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic fixture',authorizedBy:'Test only',importedAt:date,rates:codes.map(code=>({code,description:'Synthetic work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic fixture',basis:'owner-average-cost'}))};
const config=createPlanningConfiguration(catalog);
const scope:ReviewedScope={text:'Supply ten feet of cabinetry and a specialty protective overlay.',answers:{service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise'},extraction:null,uploads:[],reviewedAt:date,corrections:[]};
const base=priceReviewedScope(scope,config,now);
const ids=(base.internal as any).lines.map((l:any)=>l.id);
const task={id:'cabinets',description:'Cabinet supply',evidence:'ten feet',existingLineIds:ids,additions:[],researchDescription:'',issues:[]};
const extra={id:'overlay',description:'Protective overlay',evidence:'ten feet',existingLineIds:[],additions:[],researchDescription:'Protective cabinet overlay',issues:[]};
const source=(url:string,low:number,high:number)=>({url,low,high,publishedAt:'2026-09-01',region:'Idaho',excerpt:`Material price ${low} to ${high} dollars per linear foot.`});
const urls=['https://supplier-a.example/pricing','https://supplier-b.example/pricing'];
const researched={rates:[{taskId:'overlay',description:'Protective overlay',unit:'LF',quantity:10,quantityEvidence:'Ten feet requested',basis:'material-purchase',includes:'overlay material',excludes:'',sources:[source(urls[0],10,20),source(urls[1],20,30)]}],issues:[]};
const replies=(values:unknown[]):PricingRequest=>async()=>({value:values.shift(),sourceUrls:urls});
test('Provider failure cannot publish the otherwise available partial range',async()=>{
 assert.ok(base.customer.range);
 const r=await priceCompleteScope(scope,config,async()=>{throw new Error('offline')},now);
 assert.equal(r.customer.range,null);assert.ok(r.internal.scopePricing.issues.length);
});
test('A mapped task plus an unsupported task cannot masquerade as complete',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:''}],issues:[]},{coveredTaskIds:['cabinets'],issues:['Overlay is unpriced']}]),now);
 assert.equal(r.customer.range,null);
});
test('Semantic mapping uses the existing cost amount without inventing a rate',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:'',additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet fixture conversion'}]}],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(r.customer.range);assert.equal((r.internal as any).lines.find((l:any)=>l.id==='scope-1').unitCost,100);
 assert.notEqual(r.internal.revision,base.internal.revision);
});
test('Sourced averages add missing costs, retain sources, and preserve financial reconciliation',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task,extra],issues:[]},researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
 assert.ok(r.customer.range);assert.equal((r.internal as any).lines.find((l:any)=>l.id==='market-1').cost,200);
 assert.ok(Math.abs((r.internal as any).reconciliation)<1e-8);
 assert.ok((r.customer.range?.low||0)>(base.customer.range?.low||0));
 assert.ok(JSON.stringify(r.internal.scopePricing).includes(urls[0]));
 assert.ok(!JSON.stringify(r.customer).includes('unitCost'));
});
test('Uncited, stale, duplicate-source, reversed and selling-price evidence is rejected',()=>{
 assert.throws(()=>marketResolution(researched,[],[extra],now));
 for(const change of [()=>{const r=structuredClone(researched);r.rates[0].sources[1].url=urls[0];return r},()=>{const r=structuredClone(researched);r.rates[0].sources[0].publishedAt='2020-01-01';return r},()=>{const r=structuredClone(researched);r.rates[0].sources[0].high=1;return r},()=>({...researched,rates:[{...researched.rates[0],basis:'customer-selling-price'}]})])assert.throws(()=>marketResolution(change(),urls,[extra],now));
});
test('Independent audit blocks missed original work or duplicate assembly charges',async()=>{
 const r=await priceCompleteScope(scope,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:['cabinets'],issues:['Original overlay task omitted from inventory']}]),now);
 assert.equal(r.customer.range,null);
});
test('Invalid catalog references and zero-quantity output never release a range',async()=>{
 for(const a of [{code:'missing',quantity:10,quantityEvidence:'ten feet'},{code:'03-15-02-M',quantity:0,quantityEvidence:'ten feet'}]){
  const r=await priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:'',additions:[a]}],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
  assert.equal(r.customer.range,null);
 }
});
