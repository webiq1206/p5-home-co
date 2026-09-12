import test from 'node:test';
import assert from 'node:assert/strict';
import {priceCompleteScope,marketResolution,requestPricing,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
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
const replies=(values:unknown[]):PricingRequest=>{const first=values[0] as {tasks:typeof task[]};const queue=[{tasks:first.tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},...values];return async()=>({value:queue.shift(),sourceUrls:urls});};
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
test('Incorrect assembly lines can be replaced without charging both, but cannot remain coverage references',async()=>{
 const old=ids[0];
 const corrected={...task,existingLineIds:ids.filter((id:string)=>id!==old),additions:[{code:'03-17-01-M',quantity:12,quantityEvidence:'Corrected synthetic twelve-foot takeoff'}]};
 const mapping={tasks:[corrected],issues:[],replacements:[{lineId:old,reason:'Incorrect synthetic takeoff'}],removeExclusions:[]};
 const r=await priceCompleteScope(scope,config,replies([mapping,{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.ok(r.customer.range);assert.ok(!(r.internal as any).lines.some((l:any)=>l.id===old));assert.equal((r.internal as any).lines.find((l:any)=>l.id==='scope-1').quantity,12);
 const invalid=await priceCompleteScope(scope,config,replies([{...mapping,tasks:[task]},{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.equal(invalid.customer.range,null);
});
test('Invalid catalog references and zero-quantity output never release a range',async()=>{
 for(const a of [{code:'missing',quantity:10,quantityEvidence:'ten feet'},{code:'03-15-02-M',quantity:0,quantityEvidence:'ten feet'}]){
  const r=await priceCompleteScope(scope,config,replies([{tasks:[task,{...extra,researchDescription:'',additions:[a]}],issues:[]},{coveredTaskIds:['cabinets','overlay'],issues:[]}]),now);
  assert.equal(r.customer.range,null);
 }
});
test('Anthropic-only configuration supports JSON and real tool-source extraction',async()=>{
 const names=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_PRICING_MODEL','P5_PRICING_RESEARCH_MODEL'];
 const saved=names.map(n=>process.env[n]);const oldFetch=globalThis.fetch;
 try{
  for(const n of names)delete process.env[n];process.env.ANTHROPIC_API_KEY='synthetic-test-key';
  let search=false;
  globalThis.fetch=async(url,init)=>{
   assert.equal(url,'https://api.anthropic.com/v1/messages');
   const input=JSON.parse(String(init?.body));search=Boolean(input.tools);assert.equal(input.model,'claude-sonnet-5');
   return Response.json({stop_reason:'end_turn',content:search?[{type:'text',text:'Searching now.'},{type:'web_search_tool_result',content:urls.map(url=>({type:'web_search_result',url}))},{type:'text',text:JSON.stringify(researched)}]:[{type:'text',text:'{"coveredTaskIds":["cabinets"],"issues":[]}'}]});
  };
  assert.deepEqual((await requestPricing('JSON',{},false,1000)).value,{coveredTaskIds:['cabinets'],issues:[]});
  process.env.OPENAI_API_KEY='synthetic-openai-key';
  assert.deepEqual((await requestPricing('JSON',{},false,1000)).value,{coveredTaskIds:['cabinets'],issues:[]});
  const r=await requestPricing('JSON',{},true,1000);assert.ok(search);assert.deepEqual(r.sourceUrls,urls);assert.deepEqual(r.value,researched);
  let calls=0;
  globalThis.fetch=async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));
   if(calls===1)return Response.json({stop_reason:'end_turn',content:[{type:'web_search_tool_result',content:urls.map(url=>({type:'web_search_result',url}))},{type:'text',text:'# Research\nSynthetic cited report.'}]});
   assert.ok(body.output_config.format.schema.properties.rates);assert.equal(body.tools,undefined);assert.ok(body.messages[0].content.includes(urls[0]));
   return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(researched)}]});
  };
  const normalized=await requestPricing('JSON',{},true,5000);assert.equal(calls,2);assert.deepEqual(normalized.value,researched);assert.ok(normalized.sourceReport?.startsWith('# Research'));assert.deepEqual(normalized.sourceUrls,urls);
  globalThis.fetch=async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"rates":[],"issues":[]}'}]});
  await assert.rejects(()=>requestPricing('JSON',{},true,1000),/search-unavailable/);
 }finally{globalThis.fetch=oldFetch;names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i]});}
});
test('Allowance notes release a range only after complete scope coverage passes the independent audit',async()=>{
 const withNotes={...scope,answers:{...scope.answers,allowances:'Cabinet selections are included in the material supply budget.'}};
 assert.equal(priceReviewedScope(withNotes,config,now).customer.range,null);
 const okay=await priceCompleteScope(withNotes,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:['cabinets'],issues:[]}]),now);
 assert.ok(okay.customer.range);
 const unclear=await priceCompleteScope(withNotes,config,replies([{tasks:[task],issues:[]},{coveredTaskIds:[],issues:['Delivery and tax treatment is unresolved']}]),now);
 assert.equal(unclear.customer.range,null);
 assert.equal(unclear.customer.scopeTasks[0].description,'Cabinet supply');
});
test('A researched specialist takeoff resolves the generic small-job hold only after verification',async()=>{
 const specialist={...scope,text:'Concrete protective overlay, ten linear feet.',answers:{service:'handyman',laborHours:'2',location:'Boise'}};
 const initial=priceReviewedScope(specialist,config,now);
 assert.equal(initial.customer.range,null);
 const initialIds=(initial.internal as any).lines.map((l:any)=>l.id);
 const labor={...task,id:'prep',description:'Preparation labor',existingLineIds:initialIds};
 const priced=await priceCompleteScope(specialist,config,replies([{tasks:[labor,extra],issues:[]},researched,{coveredTaskIds:['prep','overlay'],issues:[]}]),now);
 assert.ok(priced.customer.range);
 const failed=await priceCompleteScope(specialist,config,replies([{tasks:[labor,extra],issues:[]},researched,{coveredTaskIds:['prep'],issues:['Specialist scope remains incomplete']}]),now);
 assert.equal(failed.customer.range,null);
});

test('Large scope maps bounded batches and audits every original task together',async()=>{
 const tasks=Array.from({length:14},(_,i)=>({...task,id:`task-${i}`,description:`Assembly component ${i}`}));
 let calls=0;
 const request:PricingRequest=async(_instructions,input)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(data.taskBatch){assert.ok(data.taskBatch.length<=6);assert.equal(data.priorMappedTasks.length,(calls-2)*6);return {value:{tasks:data.taskBatch.map((t:any)=>({...task,...t})),issues:[]},sourceUrls:[]};}
  assert.equal(data.tasks.length,14);return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[]},sourceUrls:[]};
 };
 const result=await priceCompleteScope(scope,config,request,now);
 assert.equal(calls,5);assert.ok(result.customer.range);assert.equal(result.customer.scopeTasks.length,14);
});
test('A missing or substituted batch task never releases a partial total',async()=>{
 let calls=0;
 const result=await priceCompleteScope(scope,config,async()=>({value:++calls===1?{tasks:[{id:task.id,description:task.description,evidence:task.evidence}],issues:[]}:{tasks:[{...task,id:'substituted'}],issues:[]},sourceUrls:[]}),now);
 assert.equal(result.customer.range,null);assert.equal(calls,2);
});
test('Research batches retain unique rule IDs and all source evidence',async()=>{
 const tasks=Array.from({length:7},(_,i)=>({...extra,id:`gap-${i}`}));let calls=0;let searches=0;
 const result=await priceCompleteScope(scope,config,async(_instructions,input,search)=>{
  const data=input as any;calls++;
  if(calls===1)return {value:{tasks:tasks.map(({id,description,evidence})=>({id,description,evidence})),issues:[]},sourceUrls:[]};
  if(data.taskBatch)return {value:{tasks:data.taskBatch.map((t:any)=>({...extra,...t})),issues:[]},sourceUrls:[]};
  if(search){searches++;assert.ok(data.tasks.length<=3);return {value:{rates:data.tasks.map((t:any)=>({...researched.rates[0],taskId:t.id})),issues:[]},sourceUrls:urls};}
  assert.equal(data.research.length,3);assert.equal(new Set(data.additionalRules.map((r:any)=>r.id)).size,7);
  return {value:{coveredTaskIds:tasks.map(t=>t.id),issues:[]},sourceUrls:[]};
 },now);
 assert.equal(searches,3);assert.ok(result.customer.range);
});

test('Valid JSON research with incompatible field types gets a saved constrained normalization stage',async()=>{
 let calls=0;let formatting=0;
 const inputs:unknown[]=[{tasks:[task,extra].map(({id,description,evidence})=>({id,description,evidence})),issues:[]},{tasks:[task,extra],issues:[]},{...researched,rates:[{...researched.rates[0],includes:['overlay material'],excludes:[]}],issues:[{message:'Formatting fixture only'}]},researched,{coveredTaskIds:['cabinets','overlay'],issues:[]}];
 const result=await priceCompleteScope(scope,config,async(instructions,input,search)=>{
  calls++;
  if(calls===4){formatting++;assert.equal(search,false);assert.ok(instructions.startsWith('Convert the supplied research report'));assert.deepEqual((input as any).sourceUrls,urls);assert.ok((input as any).report.includes('overlay material'));}
  return {value:inputs.shift(),sourceUrls:search?urls:[]};
 },now);
 assert.equal(formatting,1);assert.ok(result.customer.range);assert.ok(JSON.stringify(result.internal.scopePricing.research).includes(urls[0]));
});

test('An audit finding is repaired with a labeled quantity allowance, then audited again',async()=>{
 const unresolved={...extra,researchDescription:''};
 const allowed={...unresolved,additions:[{code:'03-15-02-M',quantity:10,quantityRange:{low:8,high:15},quantityEvidence:'ALLOWANCE: Budget ten feet based on the cabinet run; confirm eight to fifteen feet before ordering.'}]};
 const priced=await priceCompleteScope(scope,config,replies([
   {tasks:[task,unresolved],issues:[]},
   {coveredTaskIds:['cabinets'],issues:['Overlay quantity and cost missing']},
   {tasks:[task,allowed],issues:[]},
   {coveredTaskIds:['cabinets','overlay'],issues:[]},
 ]),now);
 assert.ok(priced.customer.range);const line=priced.customer.lineItems.find(l=>l.id==='repair-scope-1');
 assert.equal(line?.pricingStatus,'estimated-allowance');assert.deepEqual(line?.quantityRange,{low:8,high:15});
 assert.ok(Math.abs((priced.internal as any).reconciliation)<1e-8);assert.ok(priced.customer.verificationItems.some(i=>i.includes('ALLOWANCE:')));
});
test('Trim-only and labor-only instructions replace whole-project defaults and reject material charges',async()=>{
 const instructions={...emptyInstructions(),inclusions:['First-floor trim only'],exclusions:['All plumbing'],floors:['1'],laborOnly:true};
 const restricted={...scope,text:'Price only first-floor trim labor. Owner supplies all materials. Exclude plumbing.',answers:{...scope.answers,estimatingInstructions:'Price only first-floor trim labor. Exclude plumbing.'},extraction:{summary:'Trim labor',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions}};
 const trim={id:'trim',description:'First-floor trim installation labor',evidence:'Requested trim only',existingLineIds:[],additions:[{code:'REF-GENERAL-HOUR',quantity:8,quantityEvidence:'ALLOWANCE: Eight installation hours based on the trim package, confirm six to twelve.',quantityRange:{low:6,high:12},floor:'1',building:'Main'}],researchDescription:'',issues:[]};
 const priced=await priceCompleteScope(restricted,config,replies([{tasks:[trim],issues:[]},{coveredTaskIds:['trim'],issues:[]}]),now);
 assert.ok(priced.customer.range);assert.equal((priced.internal as any).lines.length,1);assert.equal((priced.internal as any).lines[0].category,'field-labor');assert.equal(priced.customer.lineItems[0].floor,'1');
 const wrong={...trim,additions:[{...trim.additions[0],code:'03-15-02-M'}]};
 const refused=await priceCompleteScope(restricted,config,replies([{tasks:[wrong],issues:[]},{coveredTaskIds:['trim'],issues:[]}]),now);
 assert.equal(refused.customer.range,null);assert.ok(refused.internal.scopePricing.issues.some(i=>i.includes('labor-only')));
});
test('Separate building prices require every component to be assigned to a building',async()=>{
 const instructions={...emptyInstructions(),separateBuildings:true,buildings:['Main','ADU'],materialsOnly:true};
 const restricted={...scope,answers:{...scope.answers,estimatingInstructions:'Separate cabinet supply for Main and ADU'},extraction:{summary:'Separate cabinet supply',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions}};
 const tasks=['Main','ADU'].map((building,i)=>({id:building,description:building+' cabinet material',evidence:'Ten feet per building',existingLineIds:[],additions:[{code:'03-15-02-M',quantity:10,quantityEvidence:'Ten feet requested',building}],researchDescription:'',issues:[]}));
 const priced=await priceCompleteScope(restricted,config,replies([{tasks,issues:[]},{coveredTaskIds:['Main','ADU'],issues:[]}]),now);
 assert.ok(priced.customer.range);assert.deepEqual(priced.customer.lineItems.map(l=>l.building),['Main','ADU']);
 assert.equal(priced.customer.lineItems.reduce((n,l)=>n+l.low,0),priced.customer.range.low);assert.equal(priced.customer.lineItems.reduce((n,l)=>n+l.high,0),priced.customer.range.high);
 const missing=tasks.map(t=>({...t,additions:t.additions.map(a=>({...a,building:undefined}))}));
 const held=await priceCompleteScope(restricted,config,replies([{tasks:missing,issues:[]},{coveredTaskIds:['Main','ADU'],issues:[]}]),now);assert.equal(held.customer.range,null);
});
test('An undated actual supplier offering records retrieval date without inventing a publication date',()=>{
 const single={...researched,rates:[{...researched.rates[0],sources:[{...source(urls[0],10,20),publishedAt:'',dateBasis:'retrieved',sourceType:'supplier'}]}]};
 const rate=marketResolution(single,urls,[extra],now,0,'Boise').rules[0];
 assert.equal(rate.evidence.provenance?.status,'estimated');assert.equal(rate.evidence.provenance?.location,'Boise');
 assert.equal(rate.evidence.provenance?.sources[0].date,'2026-09-11');assert.equal(rate.evidence.provenance?.sources[0].dateBasis,'retrieved');
 assert.match(rate.evidence.reference,/retrieved 2026-09-11/);
});
