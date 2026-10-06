import '../scripts/offline-network-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {QA_CASES} from '../lib/p5/qaCases.ts';
import {DraftError} from '../lib/p5/store.ts';
import {issueRecord,buildEstimateDocument} from '../lib/p5/estimateDocument.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {legalIdentityLine} from '../lib/p5/brandIdentity.ts';
import {customerPdf} from '../lib/p5/pdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';
import {inspectQaSavedEstimate,qaSavedEstimatePdf,savedEstimateRevision} from '../lib/p5/qaSavedEstimate.ts';
import {qaSavedEstimateHandlers} from '../lib/p5/qaSavedEstimateEndpoint.ts';
import {inspectQaContinuation} from '../lib/p5/qaContinuation.ts';
// @ts-expect-error Existing isolated PostgreSQL-compatible support is JavaScript.
import {isolatedPool} from '../services/document-service/scripts/model-qa-support.mjs';
// @ts-expect-error Existing production QA schema is JavaScript.
import {QA_DDL} from '../services/document-service/src/database-schema.mjs';

type Row=Awaited<ReturnType<typeof import('../lib/p5/database.ts').query>>[number];
const ID=QA_CASES['case-1'][0],RUN='p5-acceptance-20261004',REVISION=6,ISSUED='2026-10-05T17:00:00.000Z';
const ENDPOINT='https://p5homeco.com/api/admin/p5-estimators/qa-saved-estimate';
const headers={'sec-fetch-site':'same-origin',referer:'https://p5homeco.com/estimate/qa-saved?case=case-1&revision=6'};
let requestSequence=0;
const request=(query='case=case-1&revision=6',extra:Record<string,string>={},url=ENDPOINT)=>new Request(url+'?'+query,{headers:{...headers,'x-forwarded-for':'synthetic-'+(++requestSequence),...extra}});
const auth=async()=>({id:'synthetic-administrator'});

async function fixture(){
  const pool=await isolatedPool();
  const previousPool=globalThis.__p5Pool,previousUrl=process.env.DATABASE_URL;
  // Only this test initializes schema, in its disposable in-memory database.
  globalThis.__p5Pool=pool as Pool;process.env.DATABASE_URL='postgres://offline.invalid/isolated';
  try{
    const store=await import(new URL('../lib/p5/store.ts?qa-saved-estimate-'+randomUUID(),import.meta.url).href);
    await store.ensureSchema();
    for(const statement of QA_DDL.split(';').map((s:string)=>s.trim()).filter(Boolean))await pool.query(statement);
  }finally{globalThis.__p5Pool=previousPool;if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;}
  const contact={name:'[QA] Synthetic saved estimate fixture',email:'',phone:''};
  const scope={text:'Replace three interior door levers.',answers:{service:'handyman',location:'Boise',fixtureCount:'3'},uploads:[],uncertainFields:[]};
  const issue=issueRecord({brandId:'p5',id:ID,revision:REVISION,now:new Date(ISSUED),contact,scope});
  const customer={summary:'Replace three interior door levers.',range:{low:360,high:420},
    categoryRanges:[{category:'Carpentry',low:360,high:420}],
    lineItems:[{id:'fixture-1',category:'Carpentry',description:'Install owner-supplied door levers',quantity:3,unit:'EA',low:360,high:420,unitLow:120,unitHigh:140,providerEvidence:'PRIVATE_PROVIDER_EVIDENCE'}],
    exclusions:['Door painting'],assumptions:['Existing holes are compatible.'],issue,
    source:'PRIVATE_CUSTOMER_SOURCE',internal:{evidence:'PRIVATE_FINANCIAL_EVIDENCE'}};
  const payload={text:'PRIVATE_RAW_DRAFT_SOURCE',answers:scope.answers,contact,reviewed:{...scope,reviewedAt:ISSUED},uploads:[],privateSource:'PRIVATE_DRAFT_PAYLOAD'};
  const outbox={draftId:ID,revision:REVISION,brand:'P5 Home Co',contact,customer,scope,internal:{provider:'PRIVATE_OUTBOX_PROVIDER'}};
  await pool.query("INSERT INTO p5_estimator_drafts(id,key_hash,brand,revision,status,payload,customer_estimate,internal_estimate,submitted_at) VALUES($1,'PRIVATE_DRAFT_KEY_HASH','p5',$2,'submitted',$3,$4,$5,$6)",[ID,REVISION,payload,customer,{private:'PRIVATE_INTERNAL_ESTIMATE'},ISSUED]);
  await pool.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'qa-bounded-provider-v1','{\"brokerRequired\":true}'),($1,'existing-pricing-checkpoint','{\"private\":\"PRIVATE_PROVIDER_CHECKPOINT\"}')",[ID]);
  await pool.query('INSERT INTO p5ds_qa_runs(run_id,historical_microusd,historical_unknown_microusd,allowance_microusd,liability_microusd) VALUES($1,3250000,390000,2000000,150)',[RUN]);
  await pool.query('INSERT INTO p5ds_qa_projects VALUES($1,$2,$3,false)',['p5homeco.com','qa-paid-'+ID,RUN]);
  await pool.query("INSERT INTO p5ds_qa_intents(request_hash,run_id,tenant,project,boundary,request,maximum_microusd) VALUES($1,$2,'p5homeco.com',$3,'synthetic-saved','{\"private\":\"PRIVATE_PROVIDER_REQUEST\"}',280000)",['a'.repeat(64),RUN,'qa-paid-'+ID]);
  await pool.query("INSERT INTO p5ds_qa_calls(slot,run_id,request_hash,review_note,status,reserved_microusd,actual_microusd,response) VALUES('synthetic-saved',$1,$2,'Synthetic saved fixture','settled',280000,150,'{\"private\":\"PRIVATE_PROVIDER_RESPONSE\"}')",[RUN,'a'.repeat(64)]);
  await pool.query("INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload,status) VALUES($1,$2,$3,'suppressed:synthetic-qa',$4,'suppressed')",[randomUUID(),ID,REVISION,outbox]);
  await pool.query("INSERT INTO p5_pricing_ledger(fingerprint,provider,amount,state) VALUES('synthetic-preserved-hold','synthetic',0.1,'unknown')");
  await pool.query("INSERT INTO p5_pricing_ledger_requests(fingerprint,sequence,state) VALUES('synthetic-preserved-hold',1,'unknown')");
  const statements:string[]=[];
  const read=async(statement:string,values:unknown[]=[])=>{statements.push(statement);return (await pool.query(statement,values)).rows as Row[];};
  const operations={inspect:(name:unknown,revision:unknown)=>inspectQaSavedEstimate(name,revision,read),pdf:(name:unknown,revision:unknown)=>qaSavedEstimatePdf(name,revision,read)};
  const tables=['p5_estimator_drafts','p5_estimator_files','p5_estimator_work','p5_estimator_outbox','p5ds_qa_runs','p5ds_qa_projects','p5ds_qa_calls','p5ds_qa_intents','p5_pricing_ledger','p5_pricing_ledger_requests','p5_estimator_policy'];
  const preserved=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pool.query('SELECT * FROM '+table)).rows])));
  return {pool,read,operations,statements,preserved,customer,payload,outbox};
}

function onlyReads(statements:string[]){
  assert.ok(statements.length>0);
  for(const statement of statements){
    assert.match(statement,/^SELECT\b/);
    assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|FOR UPDATE|key_hash|access-key-v1|internal_estimate)\b/i);
  }
}
function privateHeaders(response:Response){
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive, nosnippet');
}

test('saved Case1 JSON and PDF use the same verified saved result with SELECT only and no network',async()=>{
  const f=await fixture(),oldFetch=globalThis.fetch;let network=0;
  globalThis.fetch=async()=>{network++;throw Error('No network is allowed for saved previews.');};
  try{
    const before=await f.preserved(),handlers=qaSavedEstimateHandlers(auth,f.operations);
    const response=await handlers.GET(request());assert.equal(response.status,200);privateHeaders(response);
    const view=await response.json();assert.equal(view.case,'case-1');assert.equal(view.id,ID);assert.equal(view.revision,REVISION);
    assert.deepEqual(view.delivery,[{channel:'suppressed',status:'suppressed'}]);
    assert.deepEqual(view.document,buildEstimateDocument({id:ID,result:f.customer,brand:ESTIMATOR_BRAND,submittedAt:ISSUED,legalLine:legalIdentityLine()}));
    assert.doesNotMatch(JSON.stringify(view),/PRIVATE_|key_hash|providerEvidence|draftKey|requestHash|leaseToken|destination|brokerRequired|sourceText/);
    assert.equal(view.result.issue,undefined,'Only the projected customer result crosses the result boundary');
    assert.deepEqual(Object.keys(view).sort(),['case','delivery','document','id','label','result','revision']);
    assert.equal(f.statements.length,1,'All checks and suppression evidence share one snapshot');
    const pdf=await handlers.GET(request('case=case-1&revision=6&pdf=1'));assert.equal(pdf.status,200);privateHeaders(pdf);
    assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.match(pdf.headers.get('content-disposition')||'',/P5-84FE60EE/);
    const data=Buffer.from(await pdf.arrayBuffer());assert.equal(data.subarray(0,5).toString(),'%PDF-');
    const actual=(await pdfTextLayers(data)).join('\n'),expected=(await pdfTextLayers(await customerPdf(ID,f.customer,ISSUED))).join('\n');
    assert.equal(actual,expected);assert.match(actual,/October 5, 2026/);assert.match(actual,/P5-84FE60EE/);assert.doesNotMatch(actual,/PRIVATE_/);
    assert.equal(f.statements.length,2);onlyReads(f.statements);assert.deepEqual(await f.preserved(),before);assert.equal(network,0);
    // Repeated explicit reads reuse persisted state and never create work.
    assert.equal((await handlers.GET(request())).status,200);assert.deepEqual(await f.preserved(),before);assert.equal(network,0);
  }finally{globalThis.fetch=oldFetch;await f.pool.end();}
});

test('every unsafe saved-state variant blocks both JSON and PDF without changing any state',async t=>{
  const f=await fixture(),oldFetch=globalThis.fetch;let network=0;
  globalThis.fetch=async()=>{network++;throw Error('No network is allowed.');};
  const sql=(statement:string,values:unknown[]=[])=>f.pool.query(statement,values);
  const patchSaved=async(path:string,value:unknown)=>sql('UPDATE p5_estimator_drafts SET customer_estimate=jsonb_set(customer_estimate,$1::text[],$2::jsonb)',[path,JSON.stringify(value)]);
  const mutations:[string,()=>Promise<unknown>][]=[
    ['missing draft',()=>sql('UPDATE p5_estimator_drafts SET id=$1',[randomUUID()])],
    ['wrong brand',()=>sql("UPDATE p5_estimator_drafts SET brand='cabinet'")],
    ['not submitted',()=>sql("UPDATE p5_estimator_drafts SET status='draft'")],
    ['stale revision',()=>sql('UPDATE p5_estimator_drafts SET revision=8')],
    ['missing binding',()=>sql('DELETE FROM p5ds_qa_projects')],
    ['different binding',()=>sql("UPDATE p5ds_qa_projects SET project='another-project'")],
    ['blocked run',()=>sql('UPDATE p5ds_qa_runs SET blocked=true')],
    ['unknown charge',()=>sql("UPDATE p5ds_qa_calls SET status='unknown'")],
    ['in-flight charge',()=>sql("UPDATE p5ds_qa_calls SET status='in_flight'")],
    ['reserved charge',()=>sql("UPDATE p5ds_qa_calls SET status='permitted'")],
    ['missing bounded marker',()=>sql("DELETE FROM p5_estimator_work WHERE work_key='qa-bounded-provider-v1'")],
    ['deterministic-only marker',()=>sql("INSERT INTO p5_estimator_work(draft_id,work_key) VALUES($1,'qa-no-provider-v1')",[ID])],
    ['active case lease',()=>sql("INSERT INTO p5_estimator_work(draft_id,work_key,lease_until) VALUES($1,'qa-operator-lease-v1',now()+interval '1 hour')",[ID])],
    ['active checkpoint lease',()=>sql("UPDATE p5_estimator_work SET lease_until=now()+interval '1 hour' WHERE work_key='existing-pricing-checkpoint'")],
    ['queued background work',()=>sql("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'background-v1-fixture','{\"state\":\"queued\"}')",[ID])],
    ['pending submission',()=>sql("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'submit-request-v1','{\"state\":\"pending\"}')",[ID])],
    ['notification email',()=>sql("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'submit-request-v1','{\"notifyEmail\":\"fixture@example.invalid\"}')",[ID])],
    ['notification boolean',()=>sql("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'submit-request-v1','{\"notifyEmail\":true}')",[ID])],
    ['real contact name',()=>sql("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{contact,name}','\"Unlabelled contact\"')")],
    ['real contact email',()=>sql("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{contact,email}','\"fixture@example.invalid\"')")],
    ['real contact phone',()=>sql("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{contact,phone}','\"2085550100\"')")],
    ['typed case contains upload',()=>sql("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{uploads}','[{\"name\":\"test.pdf\"}]')")],
    ['typed review contains upload',()=>sql("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{reviewed,uploads}','[{\"name\":\"test.pdf\"}]')")],
    ['stored file',()=>sql("INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,'test.pdf','application/pdf',1,'test','AA==')",[randomUUID(),ID])],
    ['missing customer result',()=>sql('UPDATE p5_estimator_drafts SET customer_estimate=NULL')],
    ['unpriced customer result',()=>patchSaved('{range}',null)],
    ['malformed saved range',()=>patchSaved('{range}',{low:'360',high:420})],
    ['inverted saved range',()=>patchSaved('{range}',{low:420,high:360})],
    ['missing issue',()=>patchSaved('{issue}',null)],
    ['wrong issue brand',()=>patchSaved('{issue,brandId}','cabinet')],
    ['wrong issue revision',()=>patchSaved('{issue,revision}',8)],
    ['wrong issue reference',()=>patchSaved('{issue,reference}','P5-OTHER')],
    ['missing issue date',()=>patchSaved('{issue,issuedAt}','')],
    ['missing submitted date',()=>sql('UPDATE p5_estimator_drafts SET submitted_at=NULL')],
    ['mismatched synthetic issue name',()=>patchSaved('{issue,contact,name}','[QA] Another fixture')],
    ['real issue email',()=>patchSaved('{issue,contact,email}','fixture@example.invalid')],
    ['real issue phone',()=>patchSaved('{issue,contact,phone}','2085550100')],
    ['hidden contact on result',()=>patchSaved('{contact}',{name:'Unlabelled',email:'fixture@example.invalid',phone:''})],
    ['saved document source',()=>patchSaved('{issue,sources}',['test.pdf'])],
    ['missing suppression receipt',()=>sql('DELETE FROM p5_estimator_outbox')],
    ['old revision suppression receipt',()=>sql('UPDATE p5_estimator_outbox SET revision=5')],
    ['pending suppression receipt',()=>sql("UPDATE p5_estimator_outbox SET status='pending'")],
    ['sent receipt',()=>sql("UPDATE p5_estimator_outbox SET status='sent'")],
    ['real destination',()=>sql("UPDATE p5_estimator_outbox SET destination='customer:fixture@example.invalid'")],
    ['receipt dispatch attempt',()=>sql('UPDATE p5_estimator_outbox SET attempts=1')],
    ['receipt provider id',()=>sql("UPDATE p5_estimator_outbox SET provider_id='synthetic-id'")],
    ['receipt sent timestamp',()=>sql('UPDATE p5_estimator_outbox SET sent_at=now()')],
    ['receipt active lock',()=>sql("UPDATE p5_estimator_outbox SET locked_until=now()+interval '1 hour'")],
    ['receipt different customer',()=>sql("UPDATE p5_estimator_outbox SET payload=jsonb_set(payload,'{customer,summary}','\"Another result\"')")],
    ['receipt real contact',()=>sql("UPDATE p5_estimator_outbox SET payload=jsonb_set(payload,'{contact,email}','\"fixture@example.invalid\"')")],
  ];
  try{
    for(const [name,mutate]of mutations)await t.test(name,async()=>{
      await sql('BEGIN');
      try{
        if(name==='missing draft')await sql('SET CONSTRAINTS ALL DEFERRED');
        if(name==='missing draft')await sql('DELETE FROM p5_estimator_outbox');
        if(name==='missing draft')await sql('DELETE FROM p5_estimator_work');
        await mutate();const before=await f.preserved();f.statements.length=0;
        const handlers=qaSavedEstimateHandlers(auth,f.operations);
        for(const query of ['case=case-1&revision=6','case=case-1&revision=6&pdf=1']){
          const response=await handlers.GET(request(query));assert.equal(response.status,409,name);privateHeaders(response);
          assert.doesNotMatch(await response.text(),/PRIVATE_|fixture@example/);
        }
        onlyReads(f.statements);assert.deepEqual(await f.preserved(),before);assert.equal(network,0);
      }finally{await sql('ROLLBACK');}
    });
  }finally{globalThis.fetch=oldFetch;await f.pool.end();}
});

test('replicas and invalid current snapshot fail closed before rendering',async()=>{
  const f=await fixture();try{
    for(const change of [{replica:true},{draft:null},{run:null},{held:null},{busy:true}]){
      const read=async(sql:string,values?:unknown[])=>(await f.read(sql,values)).map(row=>({...row,...change}));
      await assert.rejects(inspectQaSavedEstimate('case-1',6,read),DraftError);
      await assert.rejects(qaSavedEstimatePdf('case-1',6,read),DraftError);
    }
    for(const change of [{allowance:2000001},{historical:0},{unknown:0},{liability:-1},{liability:2000001},{run_id:'different-run'}]){
      const read=async(sql:string,values?:unknown[])=>(await f.read(sql,values)).map(row=>({...row,run:{...row.run,...change}}));
      await assert.rejects(inspectQaSavedEstimate('case-1',6,read),DraftError);
      await assert.rejects(qaSavedEstimatePdf('case-1',6,read),DraftError);
    }
    onlyReads(f.statements);
  }finally{await f.pool.end();}
});

test('the existing and new inspections reject both notification booleans and addresses before any other read',async()=>{
  const f=await fixture(),previousPool=globalThis.__p5Pool,previousUrl=process.env.DATABASE_URL,previousFetch=globalThis.fetch;
  let network=0;
  globalThis.__p5Pool={query:async(statement:string,values:unknown[]=[])=>({rows:await f.read(statement,values)})} as unknown as Pool;
  process.env.DATABASE_URL='postgres://offline.invalid/isolated';
  globalThis.fetch=async()=>{network++;throw Error('No network is allowed.');};
  try{
    for(const notifyEmail of [true,'fixture@example.invalid']){
      await f.pool.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'submit-request-v1',$2) ON CONFLICT(draft_id,work_key) DO UPDATE SET payload=EXCLUDED.payload",[ID,{notifyEmail}]);
      const before=await f.preserved();f.statements.length=0;
      await assert.rejects(inspectQaContinuation('case-1'),/Synthetic contact safeguards failed/);
      await assert.rejects(inspectQaSavedEstimate('case-1',REVISION,f.read),/Synthetic contact safeguards failed/);
      assert.equal(f.statements.length,2);onlyReads(f.statements);assert.deepEqual(await f.preserved(),before);assert.equal(network,0);
    }
    for(const notifyEmail of [null,'']){
      await f.pool.query("UPDATE p5_estimator_work SET payload=$2 WHERE draft_id=$1 AND work_key='submit-request-v1'",[ID,{notifyEmail}]);
      const before=await f.preserved();f.statements.length=0;
      assert.equal((await inspectQaContinuation('case-1')).stage,'saved');
      assert.equal((await inspectQaSavedEstimate('case-1',REVISION,f.read)).revision,REVISION);
      await assert.rejects(inspectQaSavedEstimate('case-1',REVISION+1,f.read),/Only the existing saved/);
      await assert.rejects(inspectQaSavedEstimate('remodel',REVISION,f.read),/Only the existing/);
      onlyReads(f.statements);assert.deepEqual(await f.preserved(),before);assert.equal(network,0);
      // Null/empty notification state cannot bypass the existing binding or
      // bounded synthetic case safeguards, even on this otherwise valid save.
      for(const statement of ["DELETE FROM p5ds_qa_projects","DELETE FROM p5_estimator_work WHERE work_key='qa-bounded-provider-v1'"]){
        await f.pool.query('BEGIN');
        try{
          await f.pool.query(statement);
          await assert.rejects(inspectQaContinuation('case-1'),/accounting and bindings/);
          await assert.rejects(inspectQaSavedEstimate('case-1',REVISION,f.read),/accounting and bindings/);
        }finally{await f.pool.query('ROLLBACK');}
      }
    }
  }finally{
    globalThis.__p5Pool=previousPool;globalThis.fetch=previousFetch;
    if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
    await f.pool.end();
  }
});

test('canonical revision and Case1 are mandatory before any saved-state read',async()=>{
  let reads=0;
  const read=async()=>{reads++;throw Error('Must not read');};
  for(const revision of [null,undefined,'','0','-1','1.5','6x',' 6','6 ','06','+6','6e0','0x6','9007199254740992',0,-1,1.5,NaN,Infinity,{},[]]){
    assert.throws(()=>savedEstimateRevision(revision),DraftError);
    await assert.rejects(inspectQaSavedEstimate('case-1',revision,read),DraftError);
  }
  for(const name of [null,undefined,'',ID,'remodel','case-4','CASE-1'])await assert.rejects(inspectQaSavedEstimate(name,6,read),DraftError);
  assert.equal(savedEstimateRevision('6'),6);assert.equal(savedEstimateRevision(6),6);
  for(const revision of [1,5,7,8,'5','7','8']){
    assert.throws(()=>savedEstimateRevision(revision),DraftError);
    await assert.rejects(inspectQaSavedEstimate('case-1',revision,read),DraftError);
    await assert.rejects(qaSavedEstimatePdf('case-1',revision,read),DraftError);
  }
  assert.equal(reads,0);
});

test('even a fully matching future Case1 revision 7 is outside this release and causes no read',async()=>{
  const f=await fixture();try{
    const customer={...f.customer,issue:{...f.customer.issue,revision:7}};
    await f.pool.query('UPDATE p5_estimator_drafts SET revision=7,customer_estimate=$1',[customer]);
    await f.pool.query('UPDATE p5_estimator_outbox SET revision=7,payload=$1',[{...f.outbox,revision:7,customer}]);
    const before=await f.preserved(),handlers=qaSavedEstimateHandlers(auth,f.operations);
    for(const query of ['case=case-1&revision=7','case=case-1&revision=7&pdf=1']){
      const response=await handlers.GET(request(query));assert.equal(response.status,409);privateHeaders(response);
    }
    await assert.rejects(inspectQaSavedEstimate('case-1',7,f.read),/Only the existing saved case 1 revision 6/);
    await assert.rejects(qaSavedEstimatePdf('case-1',7,f.read),/Only the existing saved case 1 revision 6/);
    assert.deepEqual(f.statements,[]);assert.deepEqual(await f.preserved(),before);
  }finally{await f.pool.end();}
});

test('administrator authorization precedes all guards and saved-state reads',async()=>{
  let reads=0;
  const operations={inspect:async()=>{reads++;throw Error('No reads');},pdf:async()=>{reads++;throw Error('No PDF');}};
  const handlers=qaSavedEstimateHandlers(async()=>{throw new DraftError('Administrator sign-in is required.',403);},operations);
  for(const query of ['case=case-1&revision=6','case=case-1&revision=6&pdf=1','case=wrong']){
    const response=await handlers.GET(new Request(ENDPOINT+'?'+query));assert.equal(response.status,403);privateHeaders(response);
    assert.match(await response.text(),/Administrator sign-in/);
  }
  assert.equal(reads,0);
  const route=await readFile(new URL('../app/api/admin/p5-estimators/qa-saved-estimate/route.ts',import.meta.url),'utf8');
  assert.match(route,/qaSavedEstimateHandlers\(requireEstimatorAdmin\)/);assert.match(route,/export const \{GET\}/);
  assert.doesNotMatch(route,/\b(?:POST|PUT|PATCH|DELETE)\b/);
});

test('GET accepts absent Origin only with same-origin browser metadata and a configured proxy origin',async()=>{
  let reads=0;
  const operations={inspect:async()=>{reads++;return {} as Awaited<ReturnType<typeof inspectQaSavedEstimate>>;},pdf:async()=>{reads++;return new Response('synthetic pdf');}};
  const handlers=qaSavedEstimateHandlers(auth,operations);
  const proxyUrl='http://0.0.0.0:3000/api/admin/p5-estimators/qa-saved-estimate';
  for(const extra of [{},{origin:'https://p5homeco.com'},{host:'p5homeco.com'},{'x-forwarded-host':'p5homeco.com','x-forwarded-proto':'https'},{'x-forwarded-host':'p5homeco.com:443','x-forwarded-proto':'https'}] as Record<string,string>[]){
    const response=await handlers.GET(request('case=case-1&revision=6',extra,extra['x-forwarded-host']?proxyUrl:ENDPOINT));assert.equal(response.status,200);privateHeaders(response);
  }
  assert.equal((await handlers.GET(request('case=case-1&revision=6&pdf=1'))).status,200);assert.equal(reads,6);
  const previous=process.env.REPLIT_DEV_DOMAIN;
  try{
    process.env.REPLIT_DEV_DOMAIN='saved-preview-fixture.replit.dev';
    const extra={referer:'https://saved-preview-fixture.replit.dev/estimate/qa-saved','x-forwarded-host':'saved-preview-fixture.replit.dev','x-forwarded-proto':'https'};
    assert.equal((await handlers.GET(request('case=case-1&revision=6',extra,proxyUrl))).status,200);
    delete process.env.REPLIT_DEV_DOMAIN;
    assert.equal((await handlers.GET(request('case=case-1&revision=6',extra,proxyUrl))).status,403);
  }finally{if(previous===undefined)delete process.env.REPLIT_DEV_DOMAIN;else process.env.REPLIT_DEV_DOMAIN=previous;}
});

test('cross-site, null, absent or forged GET origin evidence is refused before reading',async()=>{
  let reads=0;const operations={inspect:async()=>{reads++;throw Error('No reads');},pdf:async()=>{reads++;throw Error('No PDF');}};
  const handlers=qaSavedEstimateHandlers(auth,operations);
  const bad:Record<string,string>[]=[
    {'sec-fetch-site':''},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'none'},
    {referer:''},{referer:'null'},{referer:'/estimate/qa-saved'},{referer:'https://other.invalid/estimate/qa-saved'},
    {referer:'https://p5homeco.com@other.invalid/'},{referer:'https://user@p5homeco.com/'},{referer:'data:text/plain,p5homeco.com'},
    {origin:''},{origin:'null'},{origin:'https://other.invalid'},{origin:'https://p5homeco.com/path'},
    {'x-forwarded-host':'other.invalid'},{'x-forwarded-host':'p5homeco.com','x-forwarded-proto':'http'},
    {'x-forwarded-host':'user@p5homeco.com'},{'x-forwarded-host':'p5homeco.com/path'},{host:'other.invalid'},
    {referer:'https://other.invalid/','x-forwarded-host':'other.invalid',origin:'https://other.invalid'},
  ];
  for(const extra of bad)for(const query of ['case=case-1&revision=6','case=case-1&revision=6&pdf=1']){
    const response=await handlers.GET(request(query,extra));assert.equal(response.status,403,JSON.stringify(extra));privateHeaders(response);
  }
  assert.equal((await handlers.GET(new Request(ENDPOINT+'?case=case-1&revision=6'))).status,403);
  assert.equal((await handlers.GET(request('case=case-1&revision=6',{},'https://other.invalid/api/test'))).status,403);
  assert.equal(reads,0);
});

test('ambiguous query parameters and mutation methods cannot dispatch saved reads',async()=>{
  let reads=0;const operations={inspect:async()=>{reads++;throw Error('No reads');},pdf:async()=>{reads++;throw Error('No PDF');}};
  const handlers=qaSavedEstimateHandlers(auth,operations);
  for(const query of ['case=case-1','revision=6','case=case-1&revision=6&revision=8','case=case-1&case=case-1&revision=6','case=case-1&revision=07','case=case-1&revision=6&pdf=0','case=case-1&revision=6&pdf=1&pdf=1','case=case-1&revision=6&id='+ID,'case=case-1&revision=6&permit=true']){
    assert.equal((await handlers.GET(request(query))).status,400,query);
  }
  assert.equal((await handlers.GET(request('case=remodel&revision=6'))).status,404);
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])assert.equal((await handlers.GET(new Request(ENDPOINT,{method,headers}))).status,405);
  for(const query of ['case=case-1&revision=7','case=case-1&revision=7&pdf=1','case=case-1&revision=5'])assert.equal((await handlers.GET(request(query))).status,409);
  assert.deepEqual(Object.keys(handlers),['GET']);assert.equal(reads,0);
});
