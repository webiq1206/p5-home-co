import '../scripts/offline-network-guard.cjs';
import test,{describe} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {Draft} from '../lib/p5/store.ts';
import type {QaReadingInspection} from '../lib/p5/qaSavedReading.ts';
type Row=Awaited<ReturnType<typeof import('../lib/p5/database.ts').query>>[number];
interface TestDatabase {
  query<T=Row>(statement:string,values?:unknown[]):Promise<{rows:T[]}>;
  exec(statement:string):Promise<unknown>;
  transaction<T>(run:(db:Pick<TestDatabase,'query'>)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
async function isolatedDatabase():Promise<TestDatabase>{
  const connectionString=process.env.QA_RECOVERY_TEST_DATABASE_URL;
  if(!connectionString)return new PGlite();
  const target=new URL(connectionString);
  if(process.env.CI!=='true'||target.hostname!=='127.0.0.1'||target.pathname!=='/p5_test')throw Error('Only the disposable CI PostgreSQL service is supported.');
  const {Pool}=await import('pg');
  const owner=new Pool({connectionString});
  const schema='qa_recovery_'+randomUUID().replaceAll('-','');
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema},public`});
  return {
    query:async<T>(statement:string,values:unknown[]=[])=>({rows:(await pool.query(statement,values)).rows as T[]}),
    exec:statement=>pool.query(statement),
    transaction:async run=>{
      const client=await pool.connect();
      try{await client.query('BEGIN');const result=await run({query:async<T>(statement:string,values:unknown[]=[])=>({rows:(await client.query(statement,values)).rows as T[]})});await client.query('COMMIT');return result;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    close:async()=>{await pool.end();try{await owner.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await owner.end();}},
  };
}

// Each Node test file has its own process. Exercise the actual production policy.
describe('QA saved reading recovery',async()=>{
process.env.P5_ESTIMATOR_PROVIDER='anthropic';
const {inspectQaSavedReading,applyQaSavedReading}=await import('../lib/p5/qaSavedReading.ts');
const {qaSavedReadingHandlers}=await import('../lib/p5/qaSavedReadingEndpoint.ts');
const {analysisWorkKey}=await import('../lib/p5/analysisWork.ts');
const {MODEL_POLICY_VERSION}=await import('../lib/p5/modelPolicy.ts');
const {DraftError}=await import('../lib/p5/store.ts');
// @ts-expect-error The existing service schema is plain JavaScript.
const {QA_DDL}=await import('../services/document-service/src/database-schema.mjs');
const RUN='p5-acceptance-20261004',ID='4b984f15-af82-41ff-b181-e16696ea779a',KITCHEN='62237df6-5a8a-4226-b5cc-ad4297bdf6d1';
const MODEL='claude-haiku-4-5-20251001',HASH='a'.repeat(64),URL='https://p5homeco.com/api/admin/p5-estimators/qa-recovery';
const text='Remodel a 120 SF living room in Boise. Paint all walls (44 LF perimeter). Retain the existing floor and all doors/windows.';
const original={sqft:'120',service:'remodel',location:'Boise'};

async function fixture({id=ID,scope=text,answers=original,trim=true,readerShape=false}={}){
  const db=await isolatedDatabase();
  await db.exec(QA_DDL+`
    CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,key_hash text,brand text,revision int,status text,payload jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,lease_until timestamptz,PRIMARY KEY(draft_id,work_key));
    CREATE TABLE p5_estimator_files(id uuid PRIMARY KEY,draft_id uuid REFERENCES p5_estimator_drafts(id));
    CREATE TABLE p5_estimator_outbox(id text PRIMARY KEY,payload jsonb);
    CREATE TABLE p5_pricing_ledger(fingerprint text PRIMARY KEY,state text,amount numeric);
    CREATE TABLE p5ds_jobs(id text PRIMARY KEY,state text);
  `);
  const allAnswers={...answers,...(trim?{trimLf:'44'}:{})};
  const extraction={summary:scope,facts:Object.entries(allAnswers).map(([field,value])=>({field,value,confidence:1,source:'typed scope',basis:'stated',evidence:field==='trimLf'?'44 LF perimeter':field==='cabinetBaseLf'||field==='countertopSqft'?scope:field==='service'?answers.service:value})),conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{complete:true,expectedPages:0,pages:[]}};
  let analysis={provider:'Anthropic',model:MODEL,modelPolicy:MODEL_POLICY_VERSION,analyzedAt:'2026-10-05T04:07:00Z',extraction};
  const payload={text:scope,answers:allAnswers,extraction,reviewed:null,contact:{name:'[QA] Synthetic recovery fixture',email:'',phone:''},customPreserved:{note:'synthetic private source marker'}};
  const draft={...payload,id,revision:5,status:'draft',brand:'p5',uploads:[]} as unknown as Draft;
  const workKey=analysisWorkKey(draft,scope,answers,'remote');
  let request:Row={model:MODEL,max_tokens:16000,system:'SYNTHETIC PRIVATE PROMPT',messages:[{role:'user',content:[{type:'text',text:JSON.stringify({submittedScope:scope,previousAnswers:answers})}]}],tools:[{name:'record_scope_analysis',input_schema:{type:'object'}}],tool_choice:{type:'tool',name:'record_scope_analysis'},stream:false,service_tier:'standard_only'};
  const response={model:MODEL,stop_reason:'tool_use',content:[{type:'tool_use',name:'record_scope_analysis',input:extraction}],usage:{input_tokens:100,output_tokens:10}};
  if(readerShape){
    const {analyzeBatch}=await import('../lib/p5/extraction.ts');
    const oldKey=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY='synthetic-offline-only';
    try{
      // Exercise the real typed reader and capture only its request body. The
      // transport is an in-process fixture; no provider connection is made.
      analysis=await analyzeBatch(scope,[],answers,async(_url,init)=>{
        request={...JSON.parse(String(init?.body)),stream:false,service_tier:'standard_only'};
        return Response.json(response);
      }) as typeof analysis;
      assert.equal(analysis.provider,'Anthropic');
    }finally{if(oldKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldKey;}
  }
  const checkpoint={prepared:0,units:[],notes:[],textDone:analysis};
  await db.query('INSERT INTO p5_estimator_drafts VALUES($1,$2,$3,5,$4,$5,now())',[id,'never-read-this-key-hash','p5','draft',payload]);
  await db.query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3),($1,$4,$5)',[id,workKey,checkpoint,'qa-bounded-provider-v1',{brokerRequired:true}]);
  await db.query('INSERT INTO p5ds_qa_runs(run_id,historical_microusd,historical_unknown_microusd,allowance_microusd,liability_microusd) VALUES($1,3250000,390000,2000000,150)',[RUN]);
  await db.query('INSERT INTO p5ds_qa_projects VALUES($1,$2,$3,false)',['p5homeco.com','qa-paid-'+id,RUN]);
  await db.query('INSERT INTO p5ds_qa_intents(request_hash,run_id,tenant,project,boundary,request,maximum_microusd) VALUES($1,$2,$3,$4,$5,$6,280000)',[HASH,RUN,'p5homeco.com','qa-paid-'+id,'site:'+createHash('sha256').update(JSON.stringify(request.system)).digest('hex'),request]);
  await db.query("INSERT INTO p5ds_qa_calls(slot,run_id,request_hash,review_note,status,reserved_microusd,actual_microusd,response,provider_request_id) VALUES('synthetic-settled',$1,$2,'Synthetic isolated reviewed request','settled',280000,150,$3,'never-return-provider-id')",[RUN,HASH,response]);
  await db.query("INSERT INTO p5_pricing_ledger VALUES('synthetic-unknown','unknown',0)");
  const statements:string[]=[];
  const read=async(s:string,v:unknown[]=[])=>{statements.push(s);return (await db.query(s,v)).rows as Row[];};
  const dependencies={read,transact:async<T>(run:(q:typeof read)=>Promise<T>)=>db.transaction(async tx=>run(async(s,v=[])=>{statements.push(s);return (await tx.query(s,v)).rows as Row[];}))};
  const preserved=async()=>Object.fromEntries(await Promise.all(['p5ds_qa_runs','p5ds_qa_projects','p5ds_qa_intents','p5ds_qa_calls','p5_estimator_outbox','p5_pricing_ledger','p5ds_jobs'].map(async table=>[table,(await db.query('SELECT * FROM '+table)).rows])));
  return {db,id,payload,analysis,checkpoint,workKey,request,response,dependencies,statements,preserved};
}

test('QA recovery inspects with SELECT only and applies the real deterministic fix once',async()=>{
  const f=await fixture({readerShape:true});const priorFetch=globalThis.fetch;let network=0;
  globalThis.fetch=async()=>{network++;throw Error('No provider or other network request is allowed.');};
  try{
    const before=await f.preserved();
    const inspected=await inspectQaSavedReading('remodel',f.dependencies);
    assert.equal(inspected.eligible,true);assert.ok(inspected.changedFields?.includes('trimLf'));
    assert.equal(f.statements.length,1);assert.ok(f.statements.every(s=>s.startsWith('SELECT')));
    assert.doesNotMatch(JSON.stringify(inspected),/SYNTHETIC PRIVATE|120 SF|never-read|never-return|input_schema|previousAnswers/);
    const results=await Promise.all([1,2].map(()=>applyQaSavedReading('remodel',5,inspected.operation,'synthetic-admin',f.dependencies)));
    assert.ok(results.every(r=>r.applied&&r.revision===6));
    const [{payload,revision,key_hash}]=(await f.db.query<Row>('SELECT * FROM p5_estimator_drafts WHERE id=$1',[ID])).rows;
    assert.equal(revision,6);assert.equal(payload.answers.trimLf,undefined);assert.equal(payload.answers.sqft,'120');assert.deepEqual(payload.customPreserved,f.payload.customPreserved);assert.equal(key_hash,'never-read-this-key-hash');
    const work=(await f.db.query<Row>('SELECT * FROM p5_estimator_work')).rows;
    assert.equal(work.length,3);assert.deepEqual(work.find(w=>w.work_key===f.workKey).payload,f.checkpoint);
    assert.equal(f.statements.filter(s=>s.startsWith('UPDATE')).length,1);
    assert.equal(f.statements.filter(s=>s.startsWith('INSERT')).length,1);
    assert.deepEqual(await f.preserved(),before);assert.equal(network,0);
    const next=await inspectQaSavedReading('remodel',f.dependencies);assert.equal(next.applied,true);assert.equal(next.eligible,false);
  }finally{globalThis.fetch=priorFetch;await f.db.close();}
});

test('Kitchen retains verified cabinet quantities without a provider request',async()=>{
  const f=await fixture({id:KITCHEN,scope:'Remodel a kitchen in Boise. Supply 20 LF base cabinets and 30 SF countertops.',answers:{service:'kitchen',location:'Boise',sqft:'120',cabinetBaseLf:'20',countertopSqft:'30'} as typeof original,trim:false});
  try{
    const before=await f.preserved(),inspected=await inspectQaSavedReading('kitchen',f.dependencies);
    assert.equal(inspected.eligible,true);await applyQaSavedReading('kitchen',5,inspected.operation,'synthetic-admin',f.dependencies);
    const [{payload}]=(await f.db.query<Row>('SELECT payload FROM p5_estimator_drafts')).rows;
    assert.equal(payload.answers.cabinetBaseLf,'20');assert.equal(payload.answers.countertopSqft,'30');assert.deepEqual(await f.preserved(),before);
  }finally{await f.db.close();}
});

test('the applied payload uses the verified normalized reading, preserving finish and completed work',async()=>{
  const scope='Remodel a kitchen in Boise with premium finishes. Existing cabinets are removed. Supply and install 20 LF base cabinets.';
  const answers={service:'kitchen',location:'Boise',cabinetBaseLf:'20'};
  const f=await fixture({id:KITCHEN,scope,answers:answers as typeof original,trim:false});
  try{
    const {retainedTypedReceipt}=await import('../lib/p5/extraction.ts');
    const {validateExtraction}=await import('../lib/p5/scope.ts');
    const raw={summary:'Remove existing cabinets and supply and install new cabinets.',facts:Object.entries(answers).map(([field,value])=>({field,value,confidence:1,basis:'stated',source:'typed scope',evidence:field==='cabinetBaseLf'?'20 LF base cabinets':value})),conflicts:[],missingInformation:[],reviewNotes:[]};
    const response={...f.response,content:[{type:'tool_use',name:'record_scope_analysis',input:raw}]};
    const checkpoint={...f.checkpoint,textDone:{...f.analysis,extraction:validateExtraction(raw)}};
    await f.db.query('UPDATE p5ds_qa_calls SET response=$1',[response]);
    await f.db.query('UPDATE p5_estimator_work SET payload=$1 WHERE work_key=$2',[checkpoint,f.workKey]);
    await f.db.query('UPDATE p5_estimator_drafts SET payload=$1',[{...f.payload,answers,extraction:retainedTypedReceipt(response,scope,answers)}]);
    const inspected=await inspectQaSavedReading('kitchen',f.dependencies);assert.equal(inspected.eligible,true);
    await applyQaSavedReading('kitchen',5,inspected.operation,'synthetic-admin',f.dependencies);
    const [{payload}]=(await f.db.query<Row>('SELECT payload FROM p5_estimator_drafts')).rows;
    assert.equal(payload.answers.finish,'high-end');assert.match(payload.extraction.summary,/already completed/i);
    const [{payload:retained}]=(await f.db.query<Row>('SELECT payload FROM p5_estimator_work WHERE work_key=$1',[f.workKey])).rows;
    assert.deepEqual(retained,checkpoint);
  }finally{await f.db.close();}
});

test('QA recovery blocks unsafe state before any application write',async t=>{
  const mutations:[string,(f:Awaited<ReturnType<typeof fixture>>)=>Promise<unknown>][]=[
    ['missing binding',f=>f.db.query('DELETE FROM p5ds_qa_projects')],
    ['missing marker',f=>f.db.query("DELETE FROM p5_estimator_work WHERE work_key='qa-bounded-provider-v1'")],
    ['deterministic-only marker',f=>f.db.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'qa-no-provider-v1','{}')",[ID])],
    ['blocked run',f=>f.db.query('UPDATE p5ds_qa_runs SET blocked=true')],
    ['unknown QA charge',f=>f.db.query("UPDATE p5ds_qa_calls SET status='unknown'")],
    ['active permit',f=>f.db.query("UPDATE p5ds_qa_calls SET status='permitted'")],
    ['active checkpoint',f=>f.db.query('UPDATE p5_estimator_work SET lease_until=now()+interval \'1 hour\' WHERE work_key=$1',[f.workKey])],
    ['pending submission',f=>f.db.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'submit-request-v1','{\"state\":\"pending\"}')",[ID])],
    ['customer email',f=>f.db.query("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{contact,email}','\"synthetic@example.invalid\"')")],
    ['not synthetic',f=>f.db.query("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{contact,name}','\"Unlabelled\"')")],
    ['submitted case',f=>f.db.query("UPDATE p5_estimator_drafts SET status='submitted'")],
    ['wrong brand',f=>f.db.query("UPDATE p5_estimator_drafts SET brand='cabinet'")],
    ['uploaded file',f=>f.db.query('INSERT INTO p5_estimator_files VALUES($1,$2)',['11111111-1111-4111-8111-111111111111',ID])],
    ['source changed',f=>f.db.query("UPDATE p5_estimator_drafts SET payload=jsonb_set(payload,'{text}','\"Different source\"')")],
    ['manual answer changed',f=>f.db.query("UPDATE p5_estimator_drafts SET payload=jsonb_set(jsonb_set(payload,'{answers,sqft}','\"240\"'),'{wizard}','{\"skipped\":[],\"resolutions\":{\"sqft\":\"240\"}}')")],
    ['missing settled response',f=>f.db.query('UPDATE p5ds_qa_calls SET response=NULL')],
    ['missing checkpoint',f=>f.db.query('DELETE FROM p5_estimator_work WHERE work_key=$1',[f.workKey])],
    ['conflicting completed reading',f=>f.db.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,'completed-analysis-v1-conflict',$2)",[ID,{state:'complete',input:{kind:'analysis',text,answers:original,draft:{uploads:[]}},result:{analysis:{...f.analysis,extraction:{...f.analysis.extraction,summary:'Conflicting retained result'}}}}])],
    ['unsettled usage evidence',f=>f.db.query('UPDATE p5ds_qa_calls SET actual_microusd=151')],
    ['unpriced server-tool usage',f=>f.db.query("UPDATE p5ds_qa_calls SET response=jsonb_set(response,'{usage,server_tool_use}','{\"web_search_requests\":1}')")],
    ['invalid cache accounting',f=>f.db.query("UPDATE p5ds_qa_calls SET response=jsonb_set(response,'{usage,cache_read_input_tokens}','\"unknown\"')")],
    ['invalid paid output',f=>f.db.query("UPDATE p5ds_qa_calls SET response=jsonb_set(response,'{content}','[{\"type\":\"text\",\"text\":\"No valid extraction exists in this paid response\"}]')")],
    ['edited paid output',f=>f.db.query("UPDATE p5ds_qa_calls SET response=jsonb_set(response,'{content,0,input,summary}','\"Different paid reading\"')")],
    ['edited checkpoint output',f=>f.db.query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{textDone,extraction,summary}','\"Different checkpoint reading\"') WHERE work_key=$1",[f.workKey])],
    ['unverified model',f=>f.db.query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{textDone,model}','\"different-model\"') WHERE work_key=$1",[f.workKey])],
    ['noncanonical provider provenance',f=>f.db.query("UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{textDone,provider}','\"anthropic\"') WHERE work_key=$1",[f.workKey])],
  ];
  for(const [name,mutate]of mutations)await t.test(name,async()=>{
    const f=await fixture();try{
      const inspected=await inspectQaSavedReading('remodel',f.dependencies);await mutate(f);f.statements.length=0;
      await assert.rejects(applyQaSavedReading('remodel',5,inspected.operation,'synthetic-admin',f.dependencies));
      assert.ok(f.statements.every(s=>s.startsWith('SELECT')),name);
    }finally{await f.db.close();}
  });
});

test('revision changes, evidence changes, replicas and unknown cases fail closed',async()=>{
  const f=await fixture();try{
    const inspected=await inspectQaSavedReading('remodel',f.dependencies);
    await f.db.query("UPDATE p5ds_qa_calls SET response=response||'{\"syntheticReceiptNote\":\"edited after inspection\"}'::jsonb");
    const changed=await inspectQaSavedReading('remodel',f.dependencies);
    assert.equal(changed.eligible,true);assert.notEqual(changed.operation,inspected.operation,'Exact retained response changes invalidate an earlier inspected operation');
    await assert.rejects(applyQaSavedReading('remodel',5,inspected.operation,'admin',f.dependencies),/evidence changed/);
    await assert.rejects(applyQaSavedReading('remodel',4,inspected.operation,'admin',f.dependencies),/changed/);
    await assert.rejects(applyQaSavedReading('remodel',5,'b'.repeat(64),'admin',f.dependencies),/evidence changed/);
    await assert.rejects(inspectQaSavedReading(ID,f.dependencies),/Unknown QA/);
    const replica={...f.dependencies,read:async(s:string,v:unknown[]=[])=>{const rows=await f.dependencies.read(s,v);return rows.map(r=>({...r,replica:true}));}};
    await assert.rejects(inspectQaSavedReading('remodel',replica),/primary database/);
    assert.ok(f.statements.every(s=>s.startsWith('SELECT')));
  }finally{await f.db.close();}
});

test('administrator authentication and same-origin action precede recovery access',async()=>{
  let reads=0,writes=0;
  const operations={inspect:async()=>{reads++;return {} as QaReadingInspection;},apply:async()=>{writes++;return {} as QaReadingInspection;}};
  const denied=qaSavedReadingHandlers(async()=>{throw new DraftError('Administrator sign-in is required.',403);},operations);
  assert.equal((await denied.GET(new Request(URL+'?case=remodel'))).status,403);
  assert.equal((await denied.POST(new Request(URL,{method:'POST'}))).status,403);
  assert.equal(reads+writes,0);
  const allowed=qaSavedReadingHandlers(async()=>({id:'admin'}),operations);
  for(const origin of [undefined,'https://other.invalid'])assert.equal((await allowed.POST(new Request(URL,{method:'POST',headers:origin?{origin}:{},body:'{}'}))).status,403);
  assert.equal((await allowed.POST(new Request(URL,{method:'POST',headers:{origin:'https://p5homeco.com'},body:JSON.stringify({case:'remodel',revision:5,operation:HASH,permit:true})}))).status,400);
  assert.equal(writes,0);
});

});
