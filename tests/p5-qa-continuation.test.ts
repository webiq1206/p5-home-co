import '../scripts/offline-network-guard.cjs';
import test,{describe} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';

describe('QA guarded continuation',async()=>{
process.env.P5_ESTIMATOR_PROVIDER='anthropic';
process.env.P5_CRM_DELIVERY='on';
// @ts-expect-error Existing isolated PostgreSQL-compatible test support is JavaScript.
const {isolatedPool:memoryPool}=await import('../services/document-service/scripts/model-qa-support.mjs');
// @ts-expect-error The real budget implementation is JavaScript.
const {QaBudget}=await import('../services/document-service/src/qa-budget.mjs');
async function isolatedPool(){
  const connectionString=process.env.QA_RECOVERY_TEST_DATABASE_URL;
  if(!connectionString)return memoryPool();
  const target=new URL(connectionString);
  if(process.env.CI!=='true'||target.hostname!=='127.0.0.1'||target.pathname!=='/p5_test')throw Error('Only the disposable CI PostgreSQL service is supported.');
  const {Pool}=await import('pg'),owner=new Pool({connectionString});
  const schema='qa_continuation_'+randomUUID().replaceAll('-','');
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),close=pool.end.bind(pool);
  pool.end=async()=>{await close();try{await owner.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await owner.end();}};
  return pool;
}
const {inspectQaContinuation,continueQaCase,qaSavedPdf}=await import('../lib/p5/qaContinuation.ts');
const {qaContinuationHandlers}=await import('../lib/p5/qaContinuationEndpoint.ts');
const {withinQaOperation,withinQaOperationPhase}=await import('../lib/p5/qaOperationContext.ts');
const {assertQaOperationAccess}=await import('../lib/p5/qaOperationFence.ts');
const {QA_OPERATION_KEY}=await import('../lib/p5/qaCases.ts');
const {scopeFingerprint}=await import('../lib/p5/scopeReplacement.ts');
const {ensureSchema,readDraft,saveDraft,DraftError}=await import('../lib/p5/store.ts');
const ID='4b984f15-af82-41ff-b181-e16696ea779a',MODEL='claude-haiku-4-5-20251001',KEY='f'.repeat(64);
type Row=Awaited<ReturnType<typeof import('../lib/p5/database.ts').query>>[number];

test('real typed handler: inspect/capture costs zero, explicit exact approval spends once, and no credential or delivery is created',async()=>{
  const pool=await isolatedPool(),oldPool=globalThis.__p5Pool,oldFetch=globalThis.fetch;
  const savedEnv={...process.env};
  globalThis.__p5Pool=pool as Pool;
  Object.assign(process.env,{DATABASE_URL:'postgres://offline.invalid/isolated',ANTHROPIC_API_KEY:'synthetic-only',P5_DOCUMENT_SERVICE_URL:'https://p5homeco.com/api/p5-documents',P5_DOCUMENT_SERVICE_KEY:'synthetic-signature-key-00000000000000',P5_DOCUMENT_SERVICE_TENANT:'p5homeco.com',P5_OBJECT_STORAGE_ENABLED:'',P5_DOCUMENT_SERVICE_MODE:'',P5_CRM_DELIVERY:'on'});
  const statements:string[]=[],originalQuery=pool.query.bind(pool);pool.query=async(s:string,v:unknown[]=[])=>{statements.push(s);return originalQuery(s,v);};
  let paidCalls=0,unapprovedNetwork=0,brokerCalls=0,expireCapture=false,wireSuffix='';
  const text='Remodel a 120 SF living room in Boise. Paint all walls and retain the floor.';
  const answers={service:'remodel',sqft:'120',location:'Boise'};
  const extraction={summary:text,sourceText:'',facts:Object.entries(answers).map(([field,value])=>({field,value,confidence:1,basis:'stated',source:'typed scope',evidence:field==='service'?'Remodel':value})),conflicts:[],missingInformation:[],reviewNotes:[],pages:[],takeoffs:[]};
  const budget=new QaBudget({pool,transaction:async(run:(c:Row)=>Promise<unknown>)=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}},{provider:'anthropic',model:MODEL,key:'synthetic-only'},async()=>{
    paidCalls++;return Response.json({id:'synthetic-'+paidCalls,model:MODEL,stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic-tool',name:'record_scope_analysis',input:extraction}],usage:{input_tokens:100,output_tokens:10}},{headers:{'request-id':'synthetic-receipt-'+paidCalls}});
  });
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==`https://p5homeco.com/api/p5-documents/v1/projects/qa-paid-${ID}/qa-provider`){unapprovedNetwork++;throw Error('External network is forbidden.');}
    brokerCalls++;const body=JSON.parse(String(init?.body));if(wireSuffix)body.body.system+=wireSuffix;
    try{return Response.json(await budget.dispatch('p5homeco.com','qa-paid-'+ID,body.boundary,body.body,init?.signal,body.control));}
    catch(error){const held=error as Error&{code?:string;capturedIntent?:unknown};if(expireCapture&&held.capturedIntent)await pool.query('UPDATE p5_estimator_work SET lease_until=now()-interval \'1 second\' WHERE draft_id=$1 AND work_key=$2',[ID,QA_OPERATION_KEY]);return Response.json({error:held.code||held.message,...(held.capturedIntent?{capturedIntent:held.capturedIntent}:{})},{status:422});}
  };
  try{
    await ensureSchema();await budget.init();await budget.provision([{tenant:'p5homeco.com',project:'qa-paid-'+ID}]);
    await pool.query("INSERT INTO p5_estimator_drafts(id,key_hash,brand,revision,status,payload) VALUES($1,$2,'p5',1,'draft',$3)",[ID,createHash('sha256').update(KEY).digest('hex'),{text,answers,extraction:null,reviewed:null,contact:{name:'[QA] Controlled synthetic case',email:'',phone:''},wizard:{skipped:[],resolutions:{}}}]);
    await pool.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'qa-bounded-provider-v1','{\"brokerRequired\":true}')",[ID]);
    statements.length=0;
    const initial=await inspectQaContinuation('remodel');assert.equal(initial.stage,'reading');assert.equal(initial.qaAllowance,2000000);assert.deepEqual(initial.accounting,{historical:3250000,historicalUnknownIncluded:390000,blocked:false,permitted:0,inFlight:0,unknown:0});assert.ok(statements.every(s=>s.startsWith('SELECT')));assert.equal(paidCalls,0);
    const prepare={case:'remodel',token:initial.token,action:'prepare'};
    expireCapture=true;
    await assert.rejects(continueQaCase(prepare,'synthetic-admin'),/lease expired/);
    expireCapture=false;
    assert.equal(paidCalls,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM p5_estimator_work WHERE work_key='qa-next-stage-v1' OR work_key LIKE 'qa-transition-v1:%'")).rows[0].n,0,'Expired operations cannot publish a next action or completion receipt');
    const proxyResponse=await qaContinuationHandlers(async()=>({id:'synthetic-admin'})).POST(new Request('http://0.0.0.0:3000/api/admin/p5-estimators/qa-continuation',{method:'POST',headers:{origin:'https://p5homeco.com',host:'0.0.0.0:3000','x-forwarded-host':'p5homeco.com','x-forwarded-proto':'https','content-type':'application/json'},body:JSON.stringify(prepare)}));
    assert.equal(proxyResponse.status,200);const captured=await proxyResponse.json();assert.equal(paidCalls,0);assert.equal(captured.intent?.status,'captured');assert.equal(captured.intent?.maximum,280000);
    const draftBefore=await readDraft(ID,KEY);assert.equal(draftBefore?.revision,1);assert.equal(draftBefore?.extraction,null,'capture must not save a misleading partial extraction');
    await continueQaCase(prepare,'synthetic-admin');assert.equal(paidCalls,0,'repeating a completed prepare is idempotent');
    wireSuffix='\nSynthetic updated prompt policy';
    const changed=await continueQaCase({case:'remodel',token:captured.token,action:'approve'},'synthetic-admin');
    assert.equal(paidCalls,0);assert.notEqual(changed.intent?.requestHash,captured.intent?.requestHash);assert.match(changed.lastOutcome||'',/request changed/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM p5ds_qa_calls')).rows[0].n,0,'Changed preflight cannot create an unused permit');
    const approve={case:'remodel',token:changed.token,action:'approve'};
    const raced=await Promise.allSettled([1,2].map(()=>continueQaCase(approve,'synthetic-admin')));
    const winner=raced.find(result=>result.status==='fulfilled');assert.ok(winner&&winner.status==='fulfilled');
    const completed=winner.value;assert.equal(paidCalls,1,'Concurrent duplicate approvals admit one call');
    for(const result of raced)if(result.status==='rejected')assert.match(String(result.reason),/busy|changed|lock/);
    assert.equal(paidCalls,1);assert.equal(completed.revision,2);assert.equal(completed.qaLiability,150);
    await continueQaCase(approve,'synthetic-admin');assert.equal(paidCalls,1);assert.equal((await readDraft(ID,KEY))?.revision,2);
    const calls=(await pool.query('SELECT status,reserved_microusd,actual_microusd FROM p5ds_qa_calls')).rows;assert.equal(calls.length,1);assert.equal(calls[0].status,'settled');
    assert.equal((await pool.query('SELECT count(*)::int n FROM p5_estimator_outbox')).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM p5_estimator_work WHERE work_key LIKE 'access-key-v1:%' OR work_key LIKE 'background-v1-%' OR work_key='submit-request-v1'")).rows[0].n,0);
    assert.equal(unapprovedNetwork,0);

    await pool.query('UPDATE p5_estimator_work SET lease_token=$3,lease_until=now()+interval \'1 minute\' WHERE draft_id=$1 AND work_key=$2',[ID,QA_OPERATION_KEY,'other-operation']);
    const retained=await pool.query('SELECT payload FROM p5_estimator_drafts WHERE id=$1',[ID]);
    const {recordSubmitRequest}=await import('../lib/p5/submitEndpoint.ts');
    await assert.rejects(recordSubmitRequest(ID,2,false),/operator action/);
    const {queuedJob}=await import('../lib/p5/backgroundJobs.ts');
    await assert.rejects(queuedJob({kind:'analysis',draft:{...draftBefore,id:ID,uploads:[]} as never,text,answers}),/operator action/);
    const {saveCompletedAnalysis}=await import('../lib/p5/savedAnalysis.ts');
    const {MODEL_POLICY_VERSION}=await import('../lib/p5/modelPolicy.ts');
    await assert.rejects(saveCompletedAnalysis(ID,{text,answers,uploads:[]},{extraction,provider:'Anthropic',model:MODEL,modelPolicy:MODEL_POLICY_VERSION,analyzedAt:new Date().toISOString()} as never),/operator action/);
    await assert.rejects(saveDraft(ID,KEY,'p5',retained.rows[0].payload,2),/operator action/);
    await pool.query('UPDATE p5_estimator_work SET lease_token=NULL,lease_until=NULL WHERE draft_id=$1 AND work_key=$2',[ID,QA_OPERATION_KEY]);

    const {withQaPaidDraft,qaProviderFetch}=await import('../lib/p5/qaPaid.ts');
    const operation={draftId:ID,leaseToken:'parallel-phase',actorId:'admin',active:true,control:{mode:'capture' as const},brokerQueue:undefined as Promise<void>|undefined};
    await pool.query('UPDATE p5_estimator_work SET lease_token=$3,lease_until=now()+interval \'1 minute\' WHERE draft_id=$1 AND work_key=$2',[ID,QA_OPERATION_KEY,operation.leaseToken]);
    const wire=structuredClone((await pool.query('SELECT request FROM p5ds_qa_intents LIMIT 1')).rows[0].request);wire.system='Synthetic independent boundary';
    const beforeParallel=brokerCalls;
    const parallel=await withinQaOperation(operation,()=>withQaPaidDraft(ID,()=>Promise.allSettled([1,2].map(()=>qaProviderFetch(()=>{throw Error('Direct provider fallback is forbidden.');},'https://api.anthropic.com/v1/messages',{method:'POST',body:JSON.stringify(wire)})))));
    assert.ok(parallel.every(result=>result.status==='rejected'));assert.equal(brokerCalls-beforeParallel,1,'The first held boundary stops queued siblings');assert.equal(paidCalls,1);
    // A parser/handler failure closes the phase before queued siblings can
    // dispatch, even while an already-started broker transport finishes.
    const closing={...operation,active:true,brokerQueue:undefined,stopped:undefined};
    let started!:()=>void,release!:()=>void;const begun=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const transport=globalThis.fetch;let phaseTransports=0;const pending:Promise<Response>[]=[];
    globalThis.fetch=async()=>{phaseTransports++;started();await gate;return Response.json({synthetic:true});};
    const failedPhase=withinQaOperationPhase(closing,()=>withQaPaidDraft(ID,async()=>{
      pending.push(...[1,2].map(()=>qaProviderFetch(()=>{throw Error('No direct fallback');},'https://api.anthropic.com/v1/messages',{method:'POST',body:JSON.stringify(wire)})));
      void Promise.allSettled(pending);await begun;throw Error('Synthetic parser failure');
    }));
    await begun;await new Promise(resolve=>setImmediate(resolve));assert.equal(closing.active,false);release();
    await assert.rejects(failedPhase,/Synthetic parser failure/);const ended=await Promise.allSettled(pending);
    assert.equal(phaseTransports,1);assert.equal(ended[1].status,'rejected');globalThis.fetch=transport;
    operation.active=false;
    await assert.rejects(withinQaOperation(operation,()=>qaProviderFetch(()=>{throw Error('No direct fallback');},'https://api.anthropic.com/v1/messages',{method:'POST',body:JSON.stringify(wire)})),/phase ended/);
    assert.equal(brokerCalls-beforeParallel,1);
    operation.active=true;
    await pool.query('UPDATE p5_estimator_work SET lease_until=now()-interval \'1 second\' WHERE draft_id=$1 AND work_key=$2',[ID,QA_OPERATION_KEY]);
    await assert.rejects(withinQaOperation(operation,()=>assertQaOperationAccess(ID)),/expired operator/);
    await pool.query("DELETE FROM p5_estimator_work WHERE draft_id=$1 AND work_key='qa-bounded-provider-v1'",[ID]);
    await assert.rejects(withinQaOperation(operation,()=>withQaPaidDraft(ID,async()=>{throw Error('Must not reach a provider');})),/marker is missing/);
    await pool.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'qa-bounded-provider-v1','{\"brokerRequired\":true}')",[ID]);

    // A surviving uncertain provider reservation blocks ordinary mutation even
    // after its HTTP operation lease expires; no replay or hold is cleared.
    await pool.query("UPDATE p5ds_qa_calls SET status='unknown'");
    await assert.rejects(readDraft(ID,KEY),/unresolved provider reservation/);
    await assert.rejects(continueQaCase({case:'remodel',token:completed.token,action:'prepare'},'synthetic-admin'),/changed|Uncertain/);
    assert.equal(paidCalls,1);
  }finally{globalThis.fetch=oldFetch;globalThis.__p5Pool=oldPool;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await pool.end();}
});

test('request-scoped operator capability cannot cross cases and ordinary headers cannot create one',async()=>{
  await assert.rejects(withinQaOperation({draftId:ID,leaseToken:'synthetic-lease',actorId:'admin',active:true,control:{mode:'capture'}},()=>assertQaOperationAccess('62237df6-5a8a-4226-b5cc-ad4297bdf6d1')),/identity changed/);
  const {draftCredentials}=await import('../lib/p5/store.ts');
  assert.throws(()=>draftCredentials(new Request('https://p5homeco.com/api/p5-estimator/draft',{headers:{'x-p5-draft-id':ID,'x-p5-qa-operator':'true'}})),/Invalid draft credentials/);
  const denied=qaContinuationHandlers(async()=>{throw new DraftError('Administrator sign-in is required.',403);});
  assert.equal((await denied.GET(new Request('https://p5homeco.com/api/admin/p5-estimators/qa-continuation?case=remodel'))).status,403);
  assert.equal((await denied.POST(new Request('https://p5homeco.com/api/admin/p5-estimators/qa-continuation',{method:'POST',headers:{'x-p5-qa-operator':'true'}}))).status,403);
});

test('normal deterministic pricing saves a synthetic estimate and PDF without any delivery or provider dispatch',async()=>{
  const pool=await isolatedPool(),oldPool=globalThis.__p5Pool,oldFetch=globalThis.fetch,savedEnv={...process.env};
  globalThis.__p5Pool=pool as Pool;Object.assign(process.env,{DATABASE_URL:'postgres://offline.invalid/isolated',P5_PRICE_BOOK:'off',P5_DOCUMENT_SERVICE_MODE:'',ANTHROPIC_API_KEY:'synthetic-only'});
  let network=0;globalThis.fetch=async()=>{network++;throw Error('No transport permitted for deterministic saved/PDF acceptance.');};
  try{
    // Initialize the real schema explicitly in this isolated fixture, even if
    // another test previously initialized its own disposable database.
    // The existing service test helper owns SQL setup; reset only the cached
    // store module through a query-string import for its initialization call.
    const freshStore=await import(new URL('../lib/p5/store.ts?qa-pdf-fixture',import.meta.url).href);await freshStore.ensureSchema();
    const budget=new QaBudget({pool,transaction:async()=>{throw Error('No admission expected.');}},{});await budget.init();
    await pool.query("INSERT INTO p5ds_qa_runs(run_id,historical_microusd,historical_unknown_microusd,allowance_microusd) VALUES('p5-acceptance-20261004',3250000,390000,2000000)");
    await pool.query("INSERT INTO p5ds_qa_projects VALUES('p5homeco.com',$1,'p5-acceptance-20261004',false)",['qa-paid-'+ID]);
    const fixture=JSON.parse(await readFile(new URL('./fixtures/p5-main12-saved-failure.json',import.meta.url),'utf8')).find((row:Row)=>row.source==='work').evidence.find((row:Row)=>row.payload.input?.kind==='pricing').payload.input;
    const reviewed=structuredClone(fixture.draft.reviewed);
    const payload={text:reviewed.text,answers:reviewed.answers,extraction:reviewed.extraction,reviewed,analyzedFingerprint:scopeFingerprint(reviewed.text),contact:{name:'[QA] Saved PDF fixture',email:'',phone:''},wizard:{skipped:[],resolutions:{}}};
    await pool.query("INSERT INTO p5_estimator_drafts(id,key_hash,brand,revision,status,payload) VALUES($1,$2,'p5',1,'draft',$3)",[ID,createHash('sha256').update(KEY).digest('hex'),payload]);
    await pool.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'qa-bounded-provider-v1','{\"brokerRequired\":true}')",[ID]);
    await pool.query("INSERT INTO p5_estimator_policy(id,payload,updated_by) VALUES('current',$1,'synthetic-admin')",[fixture.configuration]);
    const before=await inspectQaContinuation('remodel');assert.equal(before.stage,'pricing');
    const done=await continueQaCase({case:'remodel',token:before.token,action:'prepare'},'synthetic-admin');
    assert.equal(done.stage,'saved');assert.equal(done.pdf,true);assert.ok(done.result);assert.equal(network,0);
    const rows=(await pool.query('SELECT destination,status FROM p5_estimator_outbox')).rows;
    assert.deepEqual(rows,[{destination:'suppressed:synthetic-qa',status:'suppressed'}]);
    const pdf=await qaSavedPdf('remodel',done.revision);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
    await assert.rejects(qaSavedPdf('remodel',done.revision+1),/exact revision/);assert.equal(network,0);
    const api=qaContinuationHandlers(async()=>({id:'synthetic-admin'}));
    const stale=await api.GET(new Request('https://p5homeco.com/api/admin/p5-estimators/qa-continuation?case=remodel&pdf=1&revision='+(done.revision+1)));assert.equal(stale.status,409);
    assert.equal((await pool.query('SELECT count(*)::int n FROM p5ds_qa_calls')).rows[0].n,0);
  }finally{globalThis.fetch=oldFetch;globalThis.__p5Pool=oldPool;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await pool.end();}
});

test('normal paid pricing advances one explicitly reviewed request at a time to a saved estimate and PDF',async()=>{
  const pool=await isolatedPool(),oldPool=globalThis.__p5Pool,oldFetch=globalThis.fetch,savedEnv={...process.env};
  globalThis.__p5Pool=pool as Pool;Object.assign(process.env,{DATABASE_URL:'postgres://offline.invalid/isolated',P5_PRICE_BOOK:'off',P5_DOCUMENT_SERVICE_MODE:'',ANTHROPIC_API_KEY:'synthetic-only',P5_DOCUMENT_SERVICE_URL:'https://p5homeco.com/api/p5-documents',P5_DOCUMENT_SERVICE_KEY:'synthetic-signature-key-00000000000000',P5_DOCUMENT_SERVICE_TENANT:'p5homeco.com'});
  const text='Change order: supply and install ten feet of base cabinetry. No other work.';
  const answers={service:'change-order',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise'};
  const reviewed={text,answers,extraction:null,uncertainFields:[],uploads:[],reviewedAt:new Date().toISOString(),corrections:[]};
  let paid=0,unexpected=0;let lines:string[]=[];
  const budget=new QaBudget({pool,transaction:async(run:(c:Row)=>Promise<unknown>)=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}},{provider:'anthropic',model:MODEL,key:'synthetic-only'},async(_url:string,init:RequestInit)=>{
    paid++;const wire=JSON.parse(String(init.body)),tool=wire.tools[0].name,input=JSON.parse(wire.messages[0].content);
    const value=tool==='record_shortlist'?{tasks:[]}:input.taskBatch?{tasks:input.taskBatch.map((task:Row)=>({...task,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]}:'priorPricingIssues' in input?{coveredTaskIds:['cabinets'],issues:[]}:{tasks:[{id:'cabinets',description:'Cabinet supply and installation',evidence:text}],issues:[]};
    return Response.json({id:'synthetic-pricing-'+paid,model:MODEL,stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic-tool-'+paid,name:tool,input:value}],usage:{input_tokens:100,output_tokens:10}},{headers:{'request-id':'synthetic-pricing-receipt-'+paid}});
  });
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==`https://p5homeco.com/api/p5-documents/v1/projects/qa-paid-${ID}/qa-provider`){unexpected++;throw Error('Unexpected external transport.');}
    const body=JSON.parse(String(init?.body));
    try{return Response.json(await budget.dispatch('p5homeco.com','qa-paid-'+ID,body.boundary,body.body,init?.signal,body.control));}
    catch(error){const held=error as Error&{code?:string;capturedIntent?:unknown};return Response.json({error:held.code||held.message,...(held.capturedIntent?{capturedIntent:held.capturedIntent}:{})},{status:422});}
  };
  try{
    const fresh=await import(new URL('../lib/p5/store.ts?qa-paid-pricing-fixture',import.meta.url).href);await fresh.ensureSchema();await budget.init();await budget.provision([{tenant:'p5homeco.com',project:'qa-paid-'+ID}]);
    const {createPlanningConfiguration,PLANNING_MODEL_VERSION}=await import('../lib/p5/planningBooks.ts');
    const configuration=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'Synthetic acceptance only',authorizedBy:'Synthetic fixture',importedAt:new Date().toISOString(),rates:['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'].map(code=>({code,description:'Synthetic cabinetry work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic test',basis:'owner-average-cost'}))});
    const {priceReviewedScope}=await import('../lib/p5/costBook.ts');lines=priceReviewedScope(reviewed,configuration).internal.lines.map(line=>line.id);assert.ok(lines.length);
    await pool.query("INSERT INTO p5_estimator_policy(id,payload,updated_by) VALUES('current',$1,'synthetic-admin')",[configuration]);
    // A verified already-read synthetic scope, ready for the normal pricing path.
    const extraction={summary:text,facts:[],conflicts:[],reviewNotes:[],missingInformation:[]};
    await pool.query("INSERT INTO p5_estimator_drafts(id,key_hash,brand,revision,status,payload) VALUES($1,$2,'p5',1,'draft',$3)",[ID,createHash('sha256').update(KEY).digest('hex'),{text,answers,extraction,reviewed,analyzedFingerprint:scopeFingerprint(text),contact:{name:'[QA] Paid pricing fixture',email:'',phone:''},wizard:{skipped:[],resolutions:{}}}]);
    await pool.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'qa-bounded-provider-v1','{\"brokerRequired\":true}')",[ID]);
    let view=await inspectQaContinuation('remodel');
    for(let step=0;step<10&&view.stage!=='saved';step++){
      const before=paid,action=view.intent?.status==='captured'||view.intent?.status==='permitted'?'approve':view.intent?'continue':'prepare';
      view=await continueQaCase({case:'remodel',token:view.token,action},'synthetic-admin');
      assert.ok(paid-before<=(action==='approve'?1:0),'Only an explicit exact approval can dispatch one request');
      const after=paid;view=await inspectQaContinuation('remodel');assert.equal(paid,after,'refresh is read-only');
    }
    assert.equal(view.stage,'saved',JSON.stringify({stage:view.stage,intent:view.intent,lastOutcome:view.lastOutcome,paid}));assert.ok(paid>=3);assert.equal(unexpected,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM p5ds_qa_calls WHERE status<>'settled'")).rows[0].n,0);
    assert.deepEqual((await pool.query('SELECT destination,status FROM p5_estimator_outbox')).rows,[{destination:'suppressed:synthetic-qa',status:'suppressed'}]);
    const pdf=await qaSavedPdf('remodel',view.revision);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');assert.equal(unexpected,0);
  }finally{globalThis.fetch=oldFetch;globalThis.__p5Pool=oldPool;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await pool.end();}
});

});
