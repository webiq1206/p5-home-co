
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ingestLead} from '../app/lib/leads/intake.ts';
import {DEFAULT_SETTINGS} from '../app/lib/leads/settings.ts';
import {estimatorDeliveryMode} from '../app/lib/leads/synthetic-qa.ts';

test('QA mode requires an explicit test name and authorized mailbox; ordinary customers stay live',()=>{
 assert.equal(estimatorDeliveryMode('Customer','authorized@example.com','authorized@example.com'),'live');
 assert.equal(estimatorDeliveryMode('[QA] Acceptance','authorized@example.com','authorized@example.com'),'synthetic_qa');
 assert.throws(()=>estimatorDeliveryMode('[QA] Acceptance','unapproved@example.com','authorized@example.com'),/authorized test mailbox/);
});

test('real SQL intake isolates QA identities, preserves customer data and exact estimate replay',async()=>{
 const db=new PGlite();await db.waitReady;
 const oldPool=globalThis.__p5Pool,oldUrl=process.env.DATABASE_URL,oldFetch=globalThis.fetch;
 process.env.DATABASE_URL='isolated-pglite-not-a-network-database';
 const query=async(sql:string,params:unknown[]=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 globalThis.__p5Pool={query,connect:async()=>({query,release(){}})} as any;
 let network=0;globalThis.fetch=async()=>{network++;throw Error('No external requests allowed');};
 try{
  for(const name of ['001_init.sql','002_gmail.sql','013_lead_alert_tasks.sql','013_estimator_sessions.sql'])await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const lead=(key:string,qa=false)=>({firstName:qa?'[QA]':'Existing',lastName:qa?'Acceptance':'Customer',email:'same@example.invalid',phone:null,
   brand:'P5 Home Co' as const,projectType:'Trim installation',source:'Organic Website' as const,sourceDetail:'p5-estimator:test',
   propertyAddress:'Synthetic address',propertyCity:'Boise',summary:'20 LF owner-supplied trim',externalLeadId:key,originalForm:'p5-estimator',originalCampaign:null,utm:null,receivedAt:new Date()});
  const real=await ingestLead(lead('real-1'),DEFAULT_SETTINGS,null,{estimatorDeliveryMode:'live'});
  assert.equal(real.status,'created');
  const qa=await ingestLead(lead('qa-test-1',true),DEFAULT_SETTINGS,null,{estimatorDeliveryMode:'synthetic_qa'});
  assert.equal(qa.status,'created');
  assert.notEqual(qa.contactId,real.contactId);assert.notEqual(qa.dealId,real.dealId);
  const contacts=await db.query<any>('SELECT * FROM contact ORDER BY id');
  assert.equal(contacts.rows[0].first_name,'Existing');assert.equal(contacts.rows[0].last_name,'Customer');
  assert.equal(contacts.rows[1].identity_key,'synthetic:qa-test-1');
  const qaDeal=(await db.query<any>('SELECT * FROM deal WHERE id=$1',[qa.dealId])).rows[0];
  assert.equal(qaDeal.original_form,'p5-estimator-synthetic-qa');assert.equal(qaDeal.owner_user_id,null);assert.equal(qaDeal.next_action,null);
  assert.equal((await db.query('SELECT * FROM task WHERE deal_id=$1',[qa.dealId])).rows.length,0);
  const replay=await ingestLead(lead('qa-test-1',true),DEFAULT_SETTINGS,null,{estimatorDeliveryMode:'synthetic_qa'});
  assert.equal(replay.status,'duplicate');assert.equal(replay.dealId,qa.dealId);
  const second=await ingestLead(lead('real-2'),DEFAULT_SETTINGS,null,{estimatorDeliveryMode:'live'});
  assert.equal(second.status,'created');assert.notEqual(second.dealId,real.dealId);
  const audit=(await db.query<any>("SELECT new_value FROM audit_log WHERE record_id=$1 AND action='lead_created'",[String(qa.dealId)])).rows[0];
  assert.equal(audit.new_value.downstreamSuppressed,true);
  assert.equal((await db.query('SELECT * FROM task WHERE deal_id=$1',[real.dealId])).rows.length,1,'ordinary intake still creates its first-contact task');
  // Only QA records belong in this automation assertion. Real fixture deals
  // legitimately attempt HubSpot sync when the host has a configured token.
  // Remove those two isolated fixtures, retaining the contacts we verified.
  await db.query('DELETE FROM deal WHERE id=ANY($1::bigint[])',[[real.dealId,second.dealId]]);
  const {runWatchdog}=await import('../app/lib/leads/watchdog.ts');
  const result=await runWatchdog();assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.dealsProcessed,0);
  assert.equal((await db.query('SELECT * FROM alert WHERE deal_id=$1',[qa.dealId])).rows.length,0);
  assert.equal(network,0);
 }finally{globalThis.__p5Pool=oldPool;globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;await db.close();}
});
