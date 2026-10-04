// Offline acceptance: genuine handlers, SQL, pricing, PDF and outbox.
import './offline-network-guard.cjs';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir,rename} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Delivery is replaced below; exercise both normal CRM delivery and QA suppression.
process.env.P5_CRM_DELIVERY='on';

await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-submit-'));
let db:any;
try{
  await cp('lib/p5',dir,{recursive:true});
  await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
  // Only replace the paid-provider boundary; priceCompleteScope stays genuine.
  await rename(path.join(dir,'scopePricing.ts'),path.join(dir,'scopePricingReal.ts'));
  await writeFile(path.join(dir,'scopePricing.ts'),`export * from './scopePricingReal.ts';let provider:any;export let calls=0;export const setProvider=(fn:any)=>provider=fn;export const requestPricing=(...args:any[])=>{calls++;return provider(...args);};`);
  await writeFile(path.join(dir,'deliveryAdapter.ts'),`
    import {buildCrmPayload} from './crmPayload.ts';
    export const EMAIL_SUPPORTS_IDEMPOTENCY=true;
    export const emails:any[]=[];export const crm:any[]=[];
    export async function adminRecipients(){return ['admin@example.invalid'];}
    export async function sendEmail(input:any){emails.push(input);return input.key;}
    export async function syncCrm(record:any,key:string){crm.push(buildCrmPayload(record,key));return key;}
  `);
  const load=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
  db=await load('database');
  const draft=await load('draftEndpoint'),submit=await load('submitEndpoint'),pdf=await load('customerPdfEndpoint');
  const provider=await load('scopePricing'),transport=await load('deliveryAdapter'),store=await load('store');
  const {createPlanningConfiguration,PLANNING_MODEL_VERSION}=await load('planningBooks');
  const {priceReviewedScope}=await load('costBook');
  const date=new Date();
  const config=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'Synthetic acceptance only',authorizedBy:'Test only',importedAt:date.toISOString(),rates:['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'].map(code=>({code,description:'Synthetic cabinetry work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic test',basis:'owner-average-cost'}))});
  const text='Change order: supply and install ten feet of base cabinetry. No other work.';
  const answers={service:'change-order',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise',address:'123 Test Street'};
  const contact={name:'Offline Test',email:'customer@example.invalid',phone:'2085550100'};
  // Brand-neutral: the same script runs on every site against its own domain and services.
  const {ESTIMATOR_BRAND:brand}=await load('brand');
  const site=`https://${brand.domain}`;
  assert.ok((brand.services as readonly string[]).includes(answers.service),`${brand.name} must offer the fixture service ${answers.service}`);
  const makeRequest=(route:string,id:string,key:string,body?:any)=>new Request(`${site}/api/p5-estimator/${route}`,{method:body===undefined?'GET':route==='draft'?'PUT':'POST',headers:{origin:site,'content-type':'application/json','x-p5-draft-id':id,'x-p5-draft-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const id=randomUUID(),key=randomBytes(32).toString('hex');
  let response=await draft.putDraft(makeRequest('draft',id,key,{text,answers,contact,revision:0}));
  assert.equal(response.status,200,await response.clone().text());
  await db.query("INSERT INTO p5_estimator_policy(id,payload,updated_by) VALUES('current',$1,'offline-test') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",[JSON.stringify(config)]);
  const saved=await store.readDraft(id,key);
  response=await draft.putDraft(makeRequest('draft',id,key,{text,answers,contact,revision:saved.revision,reviewed:true}));
  assert.equal(response.status,200,await response.clone().text());
  const reviewed=await store.readDraft(id,key);
  assert.ok(reviewed.reviewed,'ordinary review handler confirms scope');
  const lines=priceReviewedScope(reviewed.reviewed,config,date).internal.lines.map((line:any)=>line.id);
  assert.ok(lines.length,'real approved catalog resolves cabinet work');
  const incomplete=false;
  provider.setProvider(async(_instructions:string,input:any)=>{
    if(input.taskBatch)return {value:{tasks:input.taskBatch.map((item:any)=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]},sourceUrls:[]};
    if('priorPricingIssues' in input)return {value:{coveredTaskIds:['cabinets'],issues:incomplete?['Unverified complete cabinet scope.']:[]},sourceUrls:[]};
    return {value:{tasks:[{id:'cabinets',description:'Cabinet supply and installation',evidence:text}],issues:[]},sourceUrls:[]};
  });
  const wrongKey=randomBytes(32).toString('hex');
  assert.equal((await submit.postSubmission(makeRequest('submit',id,wrongKey,{revision:reviewed.revision}))).status,404);
  assert.equal((await submit.postSubmission(makeRequest('submit',id,key,{revision:reviewed.revision-1}))).status,409);
  assert.equal(provider.calls,0);assert.equal(transport.emails.length,0);assert.equal(transport.crm.length,0);
  response=await submit.postSubmission(makeRequest('submit',id,key,{revision:reviewed.revision}));
  assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(result.accepted,true);assert.ok(result.result.range);
  assert.ok(provider.calls>=2,'genuine pricing orchestration invokes fake provider');
  assert.equal(transport.emails.length,2);assert.equal(transport.crm.length,1);
  // The response, the saved-draft reload, the CRM customer copy and both emails
  // pass through the one customer boundary; the CRM copy is for this exact revision.
  for(const key of ['directCost','lines','costBookSnapshot','scopePricing','financeSnapshot'])assert.equal(key in result.result,false,`public result must not expose ${key}`);
  assert.equal(transport.crm[0].payload.estimate.revision,reviewed.revision);
  assert.equal(transport.crm[0].payload.estimate.id,id);
  assert.equal(transport.crm[0].bytes,Buffer.byteLength(transport.crm[0].body,'utf8'));
  assert.deepEqual(transport.crm[0].payload.estimate.customer.range,result.result.range);
  const reload=await (await draft.getDraft(makeRequest('draft',id,key))).json();
  assert.deepEqual(reload.result,result.result,'a reloaded submitted draft returns the same projected customer result');
  const pdfResponse=await pdf.getCustomerPdf(makeRequest('pdf',id,key));
  assert.equal(pdfResponse.status,200);assert.equal(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  assert.equal((await pdf.getCustomerPdf(makeRequest('pdf',id,wrongKey))).status,404);
  const beforeCalls=provider.calls,beforeOutbox=await db.query('SELECT * FROM p5_estimator_outbox WHERE draft_id=$1',[id]);
  response=await submit.postSubmission(makeRequest('submit',id,key,{revision:reviewed.revision}));
  assert.equal((await response.json()).duplicate,true);
  assert.equal(provider.calls,beforeCalls);assert.equal(transport.emails.length,2);assert.equal(transport.crm.length,1);
  assert.equal((await db.query('SELECT * FROM p5_estimator_outbox WHERE draft_id=$1',[id])).length,beforeOutbox.length);
  // Permanent no-provider QA restriction: genuine routes and SQL, no network.
  const qaId=randomUUID(),qaKey=randomBytes(32).toString('hex');
  const qaContact={name:'[QA] Deterministic boundary',email:'',phone:''};
  const qaText='New two-story home, 3,500 SF plus a 1,000 SF garage, premium finishes.';
  const qaAnswers={service:'new-construction',location:'Boise',sqft:'3500',stories:'2',garageIncluded:'yes',garageSqft:'1000',finish:'high-end'};
  const fixture=JSON.parse(await (await import('node:fs/promises')).readFile('tests/fixtures/p5-main12-saved-failure.json','utf8'));
  const actualFixture=fixture.find((row:any)=>row.source==='work').evidence.find((row:any)=>row.payload.input?.kind==='pricing').payload.input.configuration;
  await db.query("UPDATE p5_estimator_policy SET payload=$1 WHERE id='current'",[JSON.stringify(actualFixture)]);
  const beforeQaCalls=provider.calls,beforeQaEmails=transport.emails.length,beforeQaCrm=transport.crm.length;
  response=await draft.putDraft(makeRequest('draft',qaId,qaKey,{text:qaText,answers:qaAnswers,contact:qaContact,revision:0,qaDeterministicOnly:true,reviewed:true}));
  assert.equal(response.status,200,await response.clone().text());
  let qa=await store.readDraft(qaId,qaKey);
  const qaPolicy=await load('qaProviderPolicy');
  assert.equal(await qaPolicy.qaProvidersRestricted(qaId),true);
  response=await submit.postSubmission(makeRequest('submit',qaId,qaKey,{revision:qa.revision,background:true,retry:true}));
  assert.equal(response.status,422);assert.equal((await response.json()).qaProviderHold,true);
  assert.equal((await db.query("SELECT * FROM p5_estimator_work WHERE draft_id=$1 AND work_key='submit-request-v1'",[qaId])).length,0);
  const analysis=await load('analysisWork'),pricing=await load('pricingWork'),jobs=await load('backgroundJobs'),scopeEndpoint=await load('scopeEndpoint');
  await assert.rejects(()=>analysis.advanceAnalysis(qa,qa.text,qa.answers),/deterministic pricing only/);
  await assert.rejects(()=>pricing.priceSavedScope(qaId,qa.reviewed,actualFixture),/deterministic pricing only/);
  await assert.rejects(()=>jobs.queuedJob({kind:'pricing',draft:qa,configuration:actualFixture}),/deterministic pricing only/);
  const benchmark=await load('readBenchmark');
  await assert.rejects(()=>benchmark.runReadBenchmark(qaId,qaKey,{}),/deterministic pricing only/);
  const form=new FormData();form.set('text',qa.text);form.set('revision',String(qa.revision));form.set('analyze','true');
  response=await scopeEndpoint.postScope(new Request(site+'/api/p5-estimator/scope',{method:'POST',headers:{origin:site,'x-p5-draft-id':qaId,'x-p5-draft-key':qaKey},body:form}));
  assert.equal(response.status,422,await response.clone().text());
  response=await draft.putDraft(makeRequest('draft',qaId,qaKey,{text:qa.text,answers:qa.answers,contact:qaContact,revision:qa.revision,clarification:{id:'qa-question',answer:'yes'}}));
  assert.equal(response.status,422,await response.clone().text());
  // Omission of the creation flag and a new revision never remove the guard.
  response=await draft.putDraft(makeRequest('draft',qaId,qaKey,{text:qa.text,answers:{...qa.answers,exclusions:'Exclude landscaping'},contact:qaContact,revision:qa.revision,reviewed:true}));
  assert.equal(response.status,200,await response.clone().text());qa=await store.readDraft(qaId,qaKey);
  response=await submit.postSubmission(makeRequest('submit',qaId,qaKey,{revision:qa.revision}));
  assert.equal(response.status,422,await response.clone().text());assert.equal((await response.json()).qaProviderHold,true);
  assert.equal(provider.calls,beforeQaCalls);
  response=await draft.putDraft(makeRequest('draft',qaId,qaKey,{text:qa.text,answers:qaAnswers,contact:qaContact,revision:qa.revision,reviewed:true}));
  assert.equal(response.status,200,await response.clone().text());qa=await store.readDraft(qaId,qaKey);
  response=await submit.postSubmission(makeRequest('submit',qaId,qaKey,{revision:qa.revision}));
  assert.equal(response.status,200,await response.clone().text());const qaResult=await response.json();assert.ok(qaResult.result.range);
  const qaReload=await (await draft.getDraft(makeRequest('draft',qaId,qaKey))).json();assert.deepEqual(qaReload.result,qaResult.result);
  const qaPdf=await pdf.getCustomerPdf(makeRequest('pdf',qaId,qaKey));assert.equal(qaPdf.status,200);assert.equal(Buffer.from(await qaPdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  response=await submit.postSubmission(makeRequest('submit',qaId,qaKey,{revision:qa.revision,background:true}));assert.equal((await response.json()).duplicate,true);
  assert.equal(provider.calls,beforeQaCalls);assert.equal(transport.emails.length,beforeQaEmails);assert.equal(transport.crm.length,beforeQaCrm);
  console.log('PASS: persisted QA restriction, analysis/clarification/background/pricing holds, ineligible edit, deterministic submit/reload/PDF/duplicate; zero provider calls and notifications.');
  console.log('PASS: genuine authenticated review, pricing, PDF/outbox, wrong-key/stale guards, duplicate fencing; isolated PGlite and fake provider/transports only.');
}finally{
  if(db)await db.database.close();
  // Windows and file-sync clients can hold the directory briefly after the database closes.
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
