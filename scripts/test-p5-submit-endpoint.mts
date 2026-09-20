// Offline acceptance: genuine handlers, SQL, pricing, PDF and outbox.
import './offline-network-guard.cjs';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir,rename} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

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
  let incomplete=false;
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
  incomplete=true;
  const heldId=randomUUID(),heldKey=randomBytes(32).toString('hex');
  response=await draft.putDraft(makeRequest('draft',heldId,heldKey,{text,answers,contact,revision:0,reviewed:true}));
  assert.equal(response.status,200,await response.clone().text());
  const held=await store.readDraft(heldId,heldKey);
  response=await submit.postSubmission(makeRequest('submit',heldId,heldKey,{revision:held.revision}));
  assert.equal(response.status,422,await response.clone().text());
  assert.equal((await store.readDraft(heldId,heldKey)).status,'draft');
  assert.equal((await db.query('SELECT * FROM p5_estimator_outbox WHERE draft_id=$1',[heldId])).length,0);
  assert.equal(transport.emails.length,2);assert.equal(transport.crm.length,1);
  assert.equal((await pdf.getCustomerPdf(makeRequest('pdf',heldId,heldKey))).status,404);
  console.log('PASS: genuine authenticated review, pricing, PDF/outbox, wrong-key/stale guards, duplicate fencing and incomplete-price hold; isolated PGlite and fake provider/transports only.');
}finally{
  if(db)await db.database.close();
  // Windows and file-sync clients can hold the directory briefly after the database closes.
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}