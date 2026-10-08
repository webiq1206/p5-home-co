// Offline acceptance: genuine handlers, SQL, pricing, PDF and outbox.
import './offline-network-guard.cjs';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir,rename} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Delivery is replaced below; exercise both normal CRM delivery and QA suppression.
process.env.P5_CRM_DELIVERY='on';
// No provider sidecar is required. Refuse and count every fetch, including
// loopback, and clear inherited managed-provider configuration before imports.
for(const key of Object.keys(process.env))if(key.startsWith('AI_INTEGRATIONS_'))delete process.env[key];
Object.assign(process.env,{OPENAI_API_KEY:'offline-test-key-not-a-secret',ANTHROPIC_API_KEY:'offline-test-key-not-a-secret',GEMINI_API_KEY:'offline-test-key-not-a-secret',DATABASE_URL:'',P5_DOCUMENT_SERVICE_MODE:''});
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('QA acceptance forbids every network dispatch, including loopback');};

await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-submit-'));
let db:any;
try{
  await cp('lib/p5',dir,{recursive:true});
  await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export let queryHook:any;export const setQueryHook=(hook:any)=>{queryHook=hook;};export async function query(s:string,v:unknown[]=[]){const hook=queryHook;if(hook)await hook('before',s,v);const rows=(await database.query(s,v)).rows;if(hook)await hook('after',s,v);return rows;}`);
  // Replace and count both paid pricing boundaries; priceCompleteScope stays genuine.
  await rename(path.join(dir,'scopePricing.ts'),path.join(dir,'scopePricingReal.ts'));
  await writeFile(path.join(dir,'scopePricing.ts'),`export * from './scopePricingReal.ts';let provider:any;export let calls=0;export const setProvider=(fn:any)=>provider=fn;export const requestPricing=(...args:any[])=>{calls++;return provider(...args);};`);
  await rename(path.join(dir,'bookShortlist.ts'),path.join(dir,'bookShortlistReal.ts'));
  // Public sites hold every new project for team review (lib/p5/intakePolicy.ts). The
  // preserved pricing engine is exercised below behind an explicit harness-only switch,
  // after the public gate itself has been proven against the genuine policy.
  await rename(path.join(dir,'intakePolicy.ts'),path.join(dir,'intakePolicyReal.ts'));
  await writeFile(path.join(dir,'intakePolicy.ts'),`export * from './intakePolicyReal.ts';import {publicProjectMode as reviewed} from './intakePolicyReal.ts';let automated=false;export const setAutomatedPricingForTest=(value:boolean)=>{automated=value;};export function publicProjectMode(site:string,service=''){return automated?'automated':reviewed(site,service);}`);
  await writeFile(path.join(dir,'bookShortlist.ts'),`export * from './bookShortlistReal.ts';export let shortlistCalls=0;export async function shortlistBook(){shortlistCalls++;return new Map();}`);
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
  const provider=await load('scopePricing'),shortlist=await load('bookShortlist'),transport=await load('deliveryAdapter'),store=await load('store'),intakePolicy=await load('intakePolicy');
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
  // The public review gate: a confirmed, contactable project never prices or notifies on its own.
  for(const body of [{revision:reviewed.revision},{revision:reviewed.revision,background:true},{revision:reviewed.revision,notifyOnly:true,notifyEmail:'customer@example.invalid'}]){
    response=await submit.postSubmission(makeRequest('submit',id,key,body));
    assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).reviewRequired,true);
  }
  assert.equal(provider.calls,0);assert.equal(transport.emails.length,0);assert.equal(transport.crm.length,0);
  assert.equal((await db.query('SELECT * FROM p5_estimator_work WHERE draft_id=$1',[id])).length,0,'a held public submission records no pricing or submit-request work');
  assert.equal((await store.readDraft(id,key)).status,'draft');
  intakePolicy.setAutomatedPricingForTest(true);
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
  const beforeQaShortlistCalls=shortlist.shortlistCalls;
  const beforeQaCalls=provider.calls,beforeQaEmails=transport.emails.length,beforeQaCrm=transport.crm.length;
  // A real database error in the restriction insertion rolls back draft creation.
  const faultId=randomUUID(),faultKey=randomBytes(32).toString('hex');
  const creation={text:qaText,answers:qaAnswers,contact:qaContact,revision:0,qaDeterministicOnly:true};
  await db.database.exec(`CREATE FUNCTION qa_policy_fail() RETURNS trigger LANGUAGE plpgsql AS $qa$ BEGIN IF NEW.work_key='qa-no-provider-v1' THEN RAISE EXCEPTION 'Injected QA policy write failure'; END IF; RETURN NEW; END $qa$; CREATE TRIGGER qa_policy_fail BEFORE INSERT ON p5_estimator_work FOR EACH ROW EXECUTE FUNCTION qa_policy_fail();`);
  response=await draft.putDraft(makeRequest('draft',faultId,faultKey,creation));assert.equal(response.status,503);
  assert.equal(await store.readDraft(faultId,faultKey),null,'failed policy insertion must not leave a draft');
  assert.equal((await db.query('SELECT * FROM p5_estimator_work WHERE draft_id=$1',[faultId])).length,0);
  await db.database.exec('DROP TRIGGER qa_policy_fail ON p5_estimator_work; DROP FUNCTION qa_policy_fail();');
  response=await draft.putDraft(makeRequest('draft',faultId,faultKey,creation));assert.equal(response.status,200,'same-ID protected creation can retry after rollback');
  assert.equal((await db.query("SELECT * FROM p5_estimator_work WHERE draft_id=$1 AND work_key='qa-no-provider-v1'",[faultId])).length,1);
  // Pause around the actual atomic statement: another authenticated request
  // sees no draft before commit, then the restriction even before PUT returns.
  const concurrentId=randomUUID(),concurrentKey=randomBytes(32).toString('hex');
  let beforeReached!:()=>void,afterReached!:()=>void,allowWrite!:()=>void,allowReturn!:()=>void;
  const before=new Promise<void>(r=>{beforeReached=r;}),after=new Promise<void>(r=>{afterReached=r;});
  const writing=new Promise<void>(r=>{allowWrite=r;}),returning=new Promise<void>(r=>{allowReturn=r;});
  db.setQueryHook(async(phase:string,sql:string,values:unknown[])=>{if(!sql.startsWith('WITH saved AS')||values[0]!==concurrentId)return;if(phase==='before'){db.setQueryHook(undefined);beforeReached();await writing;}else{afterReached();await returning;}});
  const creating=draft.putDraft(makeRequest('draft',concurrentId,concurrentKey,creation));
  await before;
  response=await submit.postSubmission(makeRequest('submit',concurrentId,concurrentKey,{revision:1}));assert.equal(response.status,404);
  allowWrite();await after;
  response=await submit.postSubmission(makeRequest('submit',concurrentId,concurrentKey,{revision:1,background:true}));assert.equal(response.status,422);assert.equal((await response.json()).qaProviderHold,true);
  allowReturn();assert.equal((await creating).status,200);
  response=await draft.putDraft(makeRequest('draft',concurrentId,concurrentKey,creation));assert.equal(response.status,422,'lost-response creation retry cannot replace its permanent policy');
  assert.equal(provider.calls,beforeQaCalls);
  const fixture=JSON.parse(await (await import('node:fs/promises')).readFile('tests/fixtures/p5-main12-saved-failure.json','utf8'));
  const actualFixture=fixture.find((row:any)=>row.source==='work').evidence.find((row:any)=>row.payload.input?.kind==='pricing').payload.input.configuration;
  await db.query("UPDATE p5_estimator_policy SET payload=$1 WHERE id='current'",[JSON.stringify(actualFixture)]);

  response=await draft.putDraft(makeRequest('draft',qaId,qaKey,{text:qaText,answers:qaAnswers,contact:qaContact,revision:0,qaDeterministicOnly:true,reviewed:true}));
  assert.equal(response.status,200,await response.clone().text());
  let qa=await store.readDraft(qaId,qaKey);
  const qaPolicy=await load('qaProviderPolicy');
  const reviewEndpoint=await load('reviewRequest');
  response=await reviewEndpoint.requestProjectReview(makeRequest('review',qaId,qaKey,{name:'Separate contact',email:'review@example.invalid'}));
  assert.equal(response.status,422);assert.equal((await response.json()).qaReviewHold,true);
  assert.equal((await db.query("SELECT to_regclass('p5_estimator_review_requests') AS relation"))[0].relation,null,'review hold precedes even review-table creation');

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
  assert.equal(shortlist.shortlistCalls,beforeQaShortlistCalls,'restricted QA never enters the separate paid shortlist boundary');
  assert.equal(networkAttempts,0,'no fetch attempts, including shortlist and local provider sidecars');
  console.log('PASS: public review gate holds confirmed projects with zero pricing, work records or notifications before the harness-only automated switch.');
  console.log('PASS: persisted QA restriction, analysis/clarification/background/pricing holds, ineligible edit, deterministic submit/reload/PDF/duplicate; zero provider calls and notifications.');
  console.log('PASS: genuine authenticated review, pricing, PDF/outbox, wrong-key/stale guards, duplicate fencing; isolated PGlite and fake provider/transports only.');
}finally{
  if(db)await db.database.close();
  // Windows and file-sync clients can hold the directory briefly after the database closes.
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
