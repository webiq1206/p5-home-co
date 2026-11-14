import { beforeEach, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { query, getPool } from '../app/lib/db.ts';
import { correctHeldEmail } from '../app/lib/leads/correct-held-email.ts';
import { emailFingerprint } from '../app/lib/integrations/hubspot-lead-review.ts';
import { ingestLead } from '../app/lib/leads/intake.ts';
import { DEFAULT_SETTINGS } from '../app/lib/leads/settings.ts';
import type { InboundLead } from '../app/lib/leads/types.ts';
const bad='a'.repeat(65)+'@example.com';
const admin={id:1,role:'administrator',isActive:true};
const input=()=>({dealId:1,email:'corrected@example.com',expectedFingerprint:emailFingerprint(bad)});
describe('Held email correction', {skip:process.env.TEST_DATABASE_URL?false:'Isolated test database required'},()=>{
 beforeEach(async()=>{
  await query('TRUNCATE contact,deal,app_user,audit_log,hubspot_lead_review RESTART IDENTITY CASCADE');
  await query("INSERT INTO app_user(email,full_name,role) VALUES('admin@example.com','Admin','administrator')");
  await query("INSERT INTO contact(identity_key,email) VALUES($1,$2)",['email:'+bad,bad]);
  await query("INSERT INTO deal(contact_id,name,brand,lead_source,stage,received_at,integration_sync_status) VALUES(1,'Offline fixture','P5 Home Co','Organic Website','New Lead',now(),'failed')");
  await query("INSERT INTO hubspot_lead_review(deal_id,reason,input_fingerprint) VALUES(1,'invalid_email',$1)",[emailFingerprint(bad)]);
 });
 after(async()=>{await getPool().end();});
 test('rejects missing, manager and inactive actors without a mutation',async()=>{
  for(const actor of [null,{...admin,role:'manager'},{...admin,isActive:false}]) assert.equal((await correctHeldEmail(actor,input())).ok,false);
  assert.equal((await query('SELECT email FROM contact WHERE id=1'))[0].email,bad);
 });
 test('rechecks database authority after actor was resolved',async()=>{
  await query("UPDATE app_user SET role='manager' WHERE id=1");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
 });
 test('rejects malformed and overlong local parts',async()=>{
  for(const email of ['not-an-email',bad,'x'.repeat(255)+'@example.com']) assert.equal((await correctHeldEmail(admin,{...input(),email})).ok,false);
 });
 test('rejects stale hold, altered contact and same rejected address',async()=>{
  assert.equal((await correctHeldEmail(admin,{...input(),expectedFingerprint:'0'.repeat(64)})).ok,false);
  await query("UPDATE contact SET email='other@example.com' WHERE id=1");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
  await query("UPDATE contact SET email='rejected@example.com' WHERE id=1");
  await query('UPDATE hubspot_lead_review SET input_fingerprint=$1',[emailFingerprint('rejected@example.com')]);
  assert.equal((await correctHeldEmail(admin,{dealId:1,email:'rejected@example.com',expectedFingerprint:emailFingerprint('rejected@example.com')})).ok,false);
 });
 test('refuses an occupied identity or normalized email without overwriting it',async()=>{
  await query("INSERT INTO contact(identity_key,email) VALUES('phone:+12085550123',' Corrected@Example.COM ')");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
  assert.equal((await query('SELECT count(*)::text AS n FROM audit_log'))[0].n,'0');
 });
 test('refuses active delivery leases',async()=>{
  await query("UPDATE deal SET hubspot_sync_lease_until=now()+interval '1 minute' WHERE id=1");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
 });
 test('requires open invalid-email hold, not archived-contact or released review',async()=>{
  await query("UPDATE hubspot_lead_review SET reason='archived_contact'");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
  await query("UPDATE hubspot_lead_review SET reason='invalid_email',released_at=now()");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
 });
 test('matches Facebook normalized provider input and updates the shared contact only',async()=>{
  const raw=' '+bad.toUpperCase()+' ';
  await query('UPDATE contact SET email=$1 WHERE id=1',[raw]);
  await query("UPDATE deal SET lead_source='Facebook Lead Ad' WHERE id=1");
  await query("INSERT INTO deal(contact_id,name,brand,lead_source,stage,received_at,integration_sync_status,hubspot_deal_id) VALUES(1,'Shared offline fixture','P5 Home Co','Organic Website','New Lead',now(),'failed','300')");
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  const rows=await query('SELECT c.email,d.hubspot_deal_id FROM deal d JOIN contact c ON c.id=d.contact_id ORDER BY d.id');
  assert.deepEqual(rows,[{email:'corrected@example.com',hubspot_deal_id:null},{email:'corrected@example.com',hubspot_deal_id:'300'}]);
  assert.equal((await query('SELECT count(*)::text AS n FROM contact'))[0].n,'1');
 });
 test('refuses an active lease on another lead sharing the contact',async()=>{
  await query("INSERT INTO deal(contact_id,name,brand,lead_source,stage,received_at,hubspot_sync_lease_until) VALUES(1,'Busy offline fixture','P5 Home Co','Organic Website','New Lead',now(),now()+interval '1 minute')");
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
  assert.equal((await query('SELECT email FROM contact WHERE id=1'))[0].email,bad);
 });
 function incoming(overrides: Partial<InboundLead>={}): InboundLead {
  return {firstName:'Offline',lastName:'Fixture',email:'corrected@example.com',phone:null,brand:'P5 Home Co',projectType:null,source:'Organic Website',sourceDetail:null,propertyAddress:null,propertyCity:null,summary:null,externalLeadId:null,originalForm:null,originalCampaign:null,utm:null,receivedAt:new Date(),...overrides};
 }
 test('ordinary same-identity duplicate refreshes nonnull name and phone',async()=>{
  await query("UPDATE deal SET external_lead_id='offline-ordinary' WHERE id=1");
  const result=await ingestLead(incoming({email:bad,externalLeadId:'offline-ordinary',firstName:'Updated',lastName:'Name',phone:'2085550142'}),DEFAULT_SETTINGS);
  assert.equal(result.status,'duplicate');
  const [row]=await query('SELECT first_name,last_name,phone,email FROM contact WHERE id=1');
  assert.deepEqual(row,{first_name:'Updated',last_name:'Name',phone:'+12085550142',email:bad});
  assert.equal((await query('SELECT count(*)::text AS n FROM contact'))[0].n,'1');
 });
 test('ordinary mismatched event identity does not create or overwrite a contact',async()=>{
  await query("UPDATE deal SET external_lead_id='offline-ordinary' WHERE id=1");
  assert.equal((await ingestLead(incoming({externalLeadId:'offline-ordinary',firstName:'Wrong'}),DEFAULT_SETTINGS)).status,'duplicate');
  assert.equal((await query('SELECT email FROM contact WHERE id=1'))[0].email,bad);
  assert.equal((await query('SELECT count(*)::text AS n FROM contact'))[0].n,'1');
 });
 test('old event replay after correction does not create an orphan or revert the contact',async()=>{
  await query("UPDATE deal SET external_lead_id='offline-original' WHERE id=1");
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  const result=await ingestLead(incoming({email:bad,externalLeadId:'offline-original'}),DEFAULT_SETTINGS);
  assert.equal(result.status,'duplicate');
  assert.equal((await query('SELECT count(*)::text AS n FROM contact'))[0].n,'1');
  assert.equal((await query('SELECT email FROM contact WHERE id=1'))[0].email,'corrected@example.com');
 });
 test('corrected email resubmission reuses same open opportunity without rewriting its key',async()=>{
  await query("UPDATE deal SET dedup_key=$1 WHERE id=1",['email:'+bad+'|p5 home co']);
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  const result=await ingestLead(incoming(),DEFAULT_SETTINGS);
  assert.equal(result.status,'duplicate');
  assert.equal((await query('SELECT count(*)::text AS n FROM deal'))[0].n,'1');
  assert.equal((await query('SELECT dedup_key FROM deal WHERE id=1'))[0].dedup_key,'email:'+bad+'|p5 home co');
 });
 test('correction fallback preserves different projects and brands and closed opportunities',async()=>{
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  assert.equal((await ingestLead(incoming({projectType:'Kitchen'}),DEFAULT_SETTINGS)).status,'created');
  assert.equal((await ingestLead(incoming({brand:'Boise ADU Co'}),DEFAULT_SETTINGS)).status,'created');
  await query("UPDATE deal SET stage='Closed Lost' WHERE id=1");
  assert.equal((await ingestLead(incoming(),DEFAULT_SETTINGS)).status,'created');
 });
 test('distinct estimator source events remain distinct after correction',async()=>{
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  for(const externalLeadId of ['offline-estimator-one','offline-estimator-two']) {
    assert.equal((await ingestLead(incoming({externalLeadId,originalForm:'p5-estimator'}),DEFAULT_SETTINGS,null,{estimatorDeliveryMode:'live'})).status,'created');
  }
 });
 test('old address replay without event ID also preserves the corrected contact',async()=>{
  await query('UPDATE deal SET dedup_key=$1 WHERE id=1',['email:'+bad+'|p5 home co']);
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  assert.equal((await ingestLead(incoming({email:bad}),DEFAULT_SETTINGS)).status,'duplicate');
  assert.equal((await query('SELECT count(*)::text AS n FROM contact'))[0].n,'1');
 });
 test('existing estimator opportunities do not capture ordinary corrected-contact inquiries',async()=>{
  await query("UPDATE deal SET original_form='p5-estimator',dedup_key='p5-estimator:offline' WHERE id=1");
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  assert.equal((await ingestLead(incoming(),DEFAULT_SETTINGS)).status,'created');
 });
 test('ambiguous corrected contact opportunities reject instead of adding a third deal',async()=>{
  assert.equal((await correctHeldEmail(admin,input())).ok,true);
  await query("INSERT INTO deal(contact_id,name,brand,lead_source,stage,received_at) VALUES(1,'Other offline fixture','P5 Home Co','Organic Website','New Lead',now())");
  assert.equal((await ingestLead(incoming(),DEFAULT_SETTINGS)).status,'rejected');
  assert.equal((await query('SELECT count(*)::text AS n FROM deal'))[0].n,'2');
 });
 test('saves explicit correction once with audit, preserving hold, lead state and provider references',async()=>{
  await query("UPDATE contact SET hubspot_contact_id='200' WHERE id=1");
  assert.equal((await correctHeldEmail(admin,{...input(),email:' Corrected@Example.COM '})).ok,true);
  const [contact]=await query('SELECT email,identity_key,hubspot_contact_id FROM contact WHERE id=1');
  assert.deepEqual(contact,{email:'corrected@example.com',identity_key:'email:corrected@example.com',hubspot_contact_id:'200'});
  assert.equal((await query('SELECT released_at FROM hubspot_lead_review WHERE deal_id=1'))[0].released_at,null);
  assert.equal((await query('SELECT integration_sync_status FROM deal WHERE id=1'))[0].integration_sync_status,'failed');
  assert.equal((await query('SELECT count(*)::text AS n FROM audit_log'))[0].n,'1');
  assert.equal((await correctHeldEmail(admin,input())).ok,false);
 });
});
