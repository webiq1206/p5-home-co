import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import * as policy from '../lib/p5/estimatorNotifications.ts';
import {estimateDeliveryStates,DELIVERY_LABEL} from '../lib/p5/deliveryPresentation.ts';

test('explicit QA labels suppress automatic delivery without classifying ordinary customers',()=>{
 for(const name of ['[QA] Fixture',`SYNTHETIC QA .13 ${String.fromCharCode(0x2014)} DO NOT CONTACT`,` synthetic qa ${String.fromCharCode(0x2014)} acceptance `])
  assert.equal(policy.suppressSyntheticEstimateNotifications({contact:{name,email:'',phone:''}}),true);
 assert.equal(policy.suppressSyntheticEstimateNotifications({contact:{name:'Customer'},customer:{issue:{projectName:'SYNTHETIC QA .13'}}}),true);
 for(const name of ['Customer','Quality Homeowner','Synthetic Stone Company','QA Builders','Ordinary DO NOT CONTACT surname'])
  assert.equal(policy.suppressSyntheticEstimateNotifications({contact:{name}}),false);
});

test('delivery presentation follows receipts and never rewrites past sends as suppressed',()=>{
 assert.deepEqual(estimateDeliveryStates([{channel:'suppressed',status:'suppressed'}],false),{staffState:'suppressed',customerState:'notRequested'});
 assert.equal(estimateDeliveryStates([{channel:'admin',status:'sent'}],false).staffState,'sent');
 assert.equal(estimateDeliveryStates([{channel:'admin',status:'sent'},{channel:'admin',status:'suppressed'}],false).staffState,'partial');
 assert.equal(estimateDeliveryStates([{channel:'admin',status:'pending'}],false).staffState,'pending');
 assert.equal(estimateDeliveryStates([{channel:'customer',status:'needs-review'}],true).customerState,'review');
 assert.equal(estimateDeliveryStates([{channel:'suppressed',status:'suppressed'}],true).customerState,'suppressed');
 assert.equal(DELIVERY_LABEL.suppressed,'Not sent (test estimate)');
});

test('real outbox SQL saves synthetic results atomically with a terminal suppression receipt and no sends',async()=>{
 const db=new PGlite();const attempts:string[]=[];let lookups=0;
 try{
  await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision int,status text,submitted_at timestamptz,internal_estimate jsonb,customer_estimate jsonb);
   CREATE TABLE p5_estimator_outbox(id uuid PRIMARY KEY,draft_id uuid,revision int,destination text,payload jsonb,status text DEFAULT 'pending',attempts int DEFAULT 0,provider_id text,last_error text,locked_until timestamptz,next_attempt_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),sent_at timestamptz,UNIQUE(draft_id,revision,destination));`);
  const query=async(sql:string,params:any[]=[]) => (await db.query(sql,params)).rows;
  const exports:any={};
  const dependencies:Record<string,unknown>={
   'node:crypto':crypto,'./database.ts':{query},'./qaOperationContext.ts':await import('../lib/p5/qaOperationContext.ts'),'./qaOperationFence.ts':await import('../lib/p5/qaOperationFence.ts'),'./store.ts':{ensureSchema:async()=>{}},'./estimatorNotifications.ts':policy,
   './estimateEmail.ts':{estimateEmail:()=>({text:'Isolated fixture'})},'./estimateDocument.ts':{estimateReference:()=> 'P5-FIXTURE'},
   './savedCustomerCopy.ts':{restoreSavedCustomerCopy:(customer:any)=>customer},'./brand.ts':{ESTIMATOR_BRAND:{name:'Fixture',domain:'fixture.invalid'}},
   './pdf.ts':{customerPdf:async()=>Buffer.from('fixture'),administrativePdf:async()=>Buffer.from('fixture'),pdfFilename:()=> 'fixture.pdf'},
   './deliveryAdapter.ts':{EMAIL_SUPPORTS_IDEMPOTENCY:false,adminRecipients:async()=>{lookups++;return ['admin@example.invalid'];},sendEmail:async(input:any)=>{attempts.push(input.to);return 'mock-ack';},syncCrm:async()=>{attempts.push('crm');return 'mock-crm-ack';}},
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/p5/outbox.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];},process:{env:{P5_CRM_DELIVERY:'on'}},console,Date});
  const id=crypto.randomUUID(),record={contact:{name:`SYNTHETIC QA .13 ${String.fromCharCode(0x2014)} DO NOT CONTACT`,email:'',phone:''},internal:{directCost:285},customer:{range:{low:450,high:555}}};
  await query("INSERT INTO p5_estimator_drafts VALUES($1,1,'draft',null,null,null)",[id]);
  assert.equal(await exports.enqueueSubmission(id,1,record),true);
  assert.equal(await exports.enqueueSubmission(id,1,record),false);
  assert.equal(lookups,0,'a synthetic save does not require an administrator or lookup recipients');
  const receipts:any[]=await query('SELECT * FROM p5_estimator_outbox');assert.equal(receipts.length,1);
  assert.equal(receipts[0].status,'suppressed');assert.equal(receipts[0].destination,'suppressed:synthetic-qa');
  assert.equal((await query('SELECT status FROM p5_estimator_drafts'))[0].status,'submitted');
  await exports.processOutbox({draftId:id,revision:1});assert.deepEqual(attempts,[]);
  assert.deepEqual(JSON.parse(JSON.stringify(await exports.deliveryStatus(id))),[{channel:'suppressed',status:'suppressed'}]);
  // A pending row from the old version is stopped; a previously sent row is
  // left intact. No fake provider acknowledgement or failure alert is created.
  await query("INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload,status,provider_id) VALUES($1,$2,2,'admin:old@example.invalid',$3,'pending',null),($4,$2,2,'customer:old@example.invalid',$3,'sent','old-real-ack')",[crypto.randomUUID(),id,JSON.stringify(record),crypto.randomUUID()]);
  await query("INSERT INTO p5_estimator_outbox(id,draft_id,revision,destination,payload) VALUES($1,$2,2,'alert:old@example.invalid',$3)",[crypto.randomUUID(),id,JSON.stringify({error:'Prior fixture failure',failedDestination:'admin:old@example.invalid'})]);
  await exports.processOutbox({draftId:id,revision:2});assert.deepEqual(attempts,[]);
  const historical:any[]=await query('SELECT destination,status,provider_id FROM p5_estimator_outbox WHERE revision=2 ORDER BY destination');
  assert.equal(historical[0].status,'suppressed');assert.equal(historical[0].provider_id,null);
  assert.equal(historical[1].status,'suppressed');assert.equal(historical[1].provider_id,null);
  assert.equal(historical[2].status,'sent');assert.equal(historical[2].provider_id,'old-real-ack');
  // Ordinary customer delivery still uses the existing adapters and records
  // their acknowledgements. All adapters are local stubs in this test.
  const realId=crypto.randomUUID();await query("INSERT INTO p5_estimator_drafts VALUES($1,1,'draft',null,null,null)",[realId]);
  assert.equal(await exports.enqueueSubmission(realId,1,{...record,contact:{name:'Ordinary Customer',email:'customer@example.invalid',phone:''}}),true);
  await exports.processOutbox({draftId:realId,revision:1});assert.deepEqual(attempts.sort(),['admin@example.invalid','crm','customer@example.invalid'].sort());
  // Failed queue creation must roll back the saved/submitted state as well.
  const failed=crypto.randomUUID();await query("INSERT INTO p5_estimator_drafts VALUES($1,99,'draft',null,null,null)",[failed]);
  await db.exec('ALTER TABLE p5_estimator_outbox ADD CONSTRAINT reject_fixture_revision CHECK (revision<>99)');
  await assert.rejects(exports.enqueueSubmission(failed,99,record));
  assert.equal((await query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[failed]))[0].status,'draft');
 }finally{await db.close();}
});
