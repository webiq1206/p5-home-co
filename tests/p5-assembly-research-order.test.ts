import test from 'node:test';
import assert from 'node:assert/strict';
import {priceCompleteScope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {PRICE_BOOK} from '../lib/p5/priceBookData.ts';
import {priceBookRate} from '../lib/p5/priceBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

process.env.P5_PRICING_LEDGER_TEST_MODE||='memory';
const requiredCodes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','TEST-DOOR-M','TEST-DOOR-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic fixture',authorizedBy:'Test only',importedAt:'2026-09-29T12:00:00Z',rates:requiredCodes.map(code=>({code,description:code.includes('DOOR')?'Door':code.includes('03-16')?'Tile':'Synthetic work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':code.includes('DOOR')?'EA':code.includes('03-16')?'SF':'LF',amount:100,source:'Synthetic fixture',basis:'owner-average-cost'}))};

test('complete ADU coverage settles before redundant cabinet and sink research, with outside utilities retained',async()=>{
 const now=new Date('2026-09-29T12:00:00Z');
 const codes=['90-50-10','22-13-01','09-30-01','09-30-04'];
 const rates=codes.map(code=>priceBookRate(PRICE_BOOK.find(row=>row[0]===code)!,'mid',false));
 const config=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'Real approved book test fixture',authorizedBy:'Test only',importedAt:now.toISOString(),rates:[...catalog.rates,...rates]});
 const scope:ReviewedScope={text:'Construct a complete 1200 SF detached ADU with 12 LF base kitchen cabinets, one standard kitchen sink, 100 SF bathroom tile floor and wet area, and 20 LF sewer extension.',answers:{service:'adu',sqft:'1200',location:'Boise, Idaho',finish:'mid-range',estimatingInstructions:'Include the specified kitchen and bathroom finishes and the separate 20 LF sewer extension.'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]};
 const tasks=[
 {id:'adu',description:'Construct complete detached 1200 SF ADU',evidence:'1200 SF conditioned space',existingLineIds:[],additions:[{code:rates[0].code,quantity:2,quantityEvidence:'1200 SF / 600 SF per complete ADU assembly = 2 assemblies'}],researchDescription:'',issues:[]},
 {id:'base',description:'Provide and install 12 LF kitchen base cabinets',evidence:'12 LF within the complete ADU',existingLineIds:[],additions:[],researchDescription:'',issues:[]},
 {id:'sink',description:'Provide and install one standard kitchen sink',evidence:'One sink inside the complete ADU',existingLineIds:[],additions:[],researchDescription:'',issues:[]},
 {id:'tile',description:'Install 100 SF bathroom tile flooring and wet area',evidence:'100 SF total bathroom tile',existingLineIds:[],additions:[{code:rates[2].code,quantity:40,quantityEvidence:'ALLOWANCE: 40 SF floor within the total bathroom tile allowance',quantityRange:{low:30,high:50}},{code:rates[3].code,quantity:60,quantityEvidence:'ALLOWANCE: 60 SF wet wall within the total bathroom tile allowance',quantityRange:{low:50,high:70}}],researchDescription:'',issues:[]},
 {id:'sewer',description:'Extend sewer 20 LF outside the ADU',evidence:'20 LF sewer extension',existingLineIds:[],additions:[{code:rates[1].code,quantity:20,quantityEvidence:'20 LF requested'}],researchDescription:'',issues:[]}
 ];
 let searches=0,audits=0;
 const request:PricingRequest=async(_instructions,input,search)=>{
  const value=input as {taskBatch?:{id:string}[];priorPricingIssues?:string[];additionalRules?:{id:string;scopeTaskId?:string;quantity:{fixed?:number}}[]};
  if(search){searches++;throw new Error('Covered assembly work must not enter research');}
  if(value.taskBatch)return {value:{tasks:value.taskBatch.map(t=>tasks.find(task=>task.id===t.id)),issues:[],notes:[],replacements:[],removeExclusions:[]},sourceUrls:[]};
  if(value.priorPricingIssues){
   audits++;
   assert.deepEqual(value.priorPricingIssues,[]);
   assert.equal(value.additionalRules?.filter(r=>r.scopeTaskId==='adu').length,1);
   assert.equal(value.additionalRules?.find(r=>r.scopeTaskId==='adu')?.quantity.fixed,2);
   assert.equal(value.additionalRules?.find(r=>r.scopeTaskId==='sewer')?.quantity.fixed,20);
   return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[],notes:[],resolvedIssues:[]},sourceUrls:[]};
  }
  return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[],notes:[]},sourceUrls:[]};
 };
 const priced=await priceCompleteScope(scope,config,request,now);
 assert.ok(priced.customer.range,JSON.stringify(priced.internal.scopePricing?.issues));
 assert.equal(searches,0);assert.equal(audits,1);
 assert.equal(priced.customer.lineItems.length,2,'one complete assembly and the separate utility extension');
});
