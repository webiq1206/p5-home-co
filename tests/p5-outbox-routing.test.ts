import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

// Execute the production outbox against in-memory PostgreSQL. All delivery,
// PDF, CRM and schema boundaries are captured stubs; no socket is available.
test('outbox preserves test and customer alert routing through failure and worker recovery',async()=>{
 const db=new PGlite();
 const sent:any[]=[];let fail=false;let crmCalls=0;let recipients=['brand@example.invalid'];
 const env:Record<string,string>={P5_CRM_DELIVERY:'on'};
 const modules:Record<string,any>={
  './estimateEmail.ts':{estimateEmail:()=>({html:'<p>Fixture</p>',text:'Fixture'})},
  './emailKit.ts':{emailBrandFrom:(b:any)=>({...b,siteUrl:'https://example.invalid'}),estimatorTestMode:(name:string,e:any)=>/test/i.test(name)||/^(on|true|1|yes)$/i.test(e.ESTIMATOR_TEST_MODE||''),internalDeliveryTo:()=> 'hello@p5homeco.com',renderEmail:()=>({html:'<p>Alert</p>',text:'Alert'})},
  './estimatorNotifications.ts':{suppressSyntheticEstimateNotifications:(r:any)=>Boolean(r?.synthetic)},
  './estimateDocument.ts':{estimateReference:()=> 'FIXTURE'},
  './savedCustomerCopy.ts':{restoreSavedCustomerCopy:(c:any)=>c},
  'node:crypto':{randomUUID,createHash},
  './database.ts':{query:async(sql:string,params:any[]=[])=> (await db.query(sql,params)).rows},
  './store.ts':{ensureSchema:async()=>{}},
  './deliveryAdapter.ts':{adminRecipients:async()=>recipients,EMAIL_SUPPORTS_IDEMPOTENCY:false,syncCrm:async()=>{crmCalls++;return 'captured';},sendEmail:async(input:any)=>{sent.push(input);if(fail)throw new Error('Synthetic failure');return 'captured';}},
  './pdf.ts':{customerPdf:async()=>Buffer.from('fixture'),administrativePdf:async()=>Buffer.from('fixture'),pdfFilename:()=> 'fixture.pdf'},
  './brand.ts':{ESTIMATOR_BRAND:{name:'Fixture Brand',domain:'example.invalid'}},
  './qaOperationContext.ts':{qaOperationContext:()=>null},
  './qaOperationFence.ts':{withQaWriteFence:(_id:string,fn:()=>any)=>fn()},
 };
 const module={exports:{} as any};
 const source=readFileSync(new URL('../lib/p5/outbox.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,require:(id:string)=>{assert.ok(id in modules,`Unexpected dependency ${id}`);return modules[id];},process:{env},console:{error:()=>{}},Buffer,Date,URL});
 const {enqueueSubmission,processOutbox}=module.exports;
 await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision integer,status text,submitted_at timestamptz,internal_estimate jsonb,customer_estimate jsonb);
 CREATE TABLE p5_estimator_outbox(id uuid PRIMARY KEY,draft_id uuid,revision integer,destination text,payload jsonb,status text DEFAULT 'pending',attempts integer DEFAULT 0,created_at timestamptz DEFAULT now(),next_attempt_at timestamptz DEFAULT now(),locked_until timestamptz,last_error text,provider_id text,sent_at timestamptz,UNIQUE(draft_id,revision,destination));`);
 const record=(name='Ada')=>({contact:{name,email:'customer@example.invalid'},customer:{},internal:{}});
 const reset=async()=>{await db.exec('TRUNCATE p5_estimator_outbox,p5_estimator_drafts');sent.length=0;fail=false;recipients=['brand@example.invalid'];delete env.ESTIMATOR_TEST_MODE;};
 const add=async(destination:string,payload:any,status='pending',draftId=randomUUID())=>{
  await db.query("INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload,status,locked_until) VALUES($1,$2,1,$3,$4::jsonb,$5,CASE WHEN $5='sending' THEN now()-interval '5 minutes' ELSE NULL END)",[randomUUID(),draftId,destination,JSON.stringify(payload),status]);return draftId;
 };
 const alerts=async()=> (await db.query("SELECT destination FROM p5_estimator_outbox WHERE destination LIKE 'alert:%' ORDER BY destination")).rows.map((r:any)=>r.destination);
 try{
  await reset();recipients=[];const id=randomUUID();await db.query("INSERT INTO p5_estimator_drafts(id,revision,status) VALUES($1,1,'draft')",[id]);
  assert.equal(await enqueueSubmission(id,1,record('Test Ada')),true);
  assert.deepEqual((await db.query('SELECT destination FROM p5_estimator_outbox ORDER BY destination')).rows.map((r:any)=>r.destination),['admin:hello@p5homeco.com','customer:hello@p5homeco.com']);

  for(const [destination,name] of [['admin:brand@example.invalid','Test Ada'],['customer:customer@example.invalid','Ada']]){
   await reset();fail=true;await add(destination,record(name));await processOutbox();
   assert.deepEqual(await alerts(),['alert:hello@p5homeco.com']);
   assert.equal(sent[0].to,name.includes('Test')?'hello@p5homeco.com':'customer@example.invalid');
   assert.equal(sent[0].suppressFailureAlert,true);
   fail=false;await processOutbox();assert.equal(sent.at(-1).to,'hello@p5homeco.com');
  }

  for(const [destination,name,mode] of [['customer:customer@example.invalid','Ada',''],['admin:brand@example.invalid','Test Ada',''],['admin:brand@example.invalid','Ada','on'],['admin:brand@example.invalid','Ada','']]){
   await reset();env.ESTIMATOR_TEST_MODE=mode;const id=await add(destination,record(name),'sending');
   await processOutbox({draftId:id,revision:1});
   const expected=destination.startsWith('customer:')||name.includes('Test')||mode==='on'?'hello@p5homeco.com':'brand@example.invalid';
   assert.deepEqual(await alerts(),['alert:'+expected]);await processOutbox({draftId:id,revision:1});assert.equal(sent.at(-1).to,expected);
  }

  await reset();await add('crm',record('Test Ada'));await processOutbox();assert.equal(crmCalls,0);assert.equal((await db.query('SELECT status FROM p5_estimator_outbox')).rows[0].status,'suppressed');
  await reset();await add('admin:brand@example.invalid',{...record(),synthetic:true});await processOutbox();assert.equal(sent.length,0);
 }finally{await db.close();}
});
