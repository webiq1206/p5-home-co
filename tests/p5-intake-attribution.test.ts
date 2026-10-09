import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAttribution,sourceFromAttribution} from '../app/lib/leads/attribution.ts';
import {emptyIntakeDetails,intakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {intakeDraftContext} from '../lib/p5/intakeDraft.ts';
import {intakeLocalCrmRecord,intakeDeliveryEnvelope,intakeLeadKey} from '../lib/p5/intakeDeliveryPayload.ts';
import {validateIntakeLocalCrm} from '../lib/p5/intakeCrmValidation.ts';
import {routeIntake} from '../lib/p5/intakePolicy.ts';
import type {Draft} from '../lib/p5/store.ts';
const contact={name:'Test Customer',email:'qa@example.invalid',phone:'',preferredContact:'either' as const};
const attribution={gclid:'google-click',utm_campaign:'cabinet-search',first_gclid:'original-click',landing_page:'/estimate?gclid=google-click',first_landing_page:'/estimate?gclid=original-click'};
test('paid attribution survives draft validation, cross-brand snapshot, and CRM projection',()=>{
 const details=intakeDetails({...emptyIntakeDetails(),attribution});
 const prior=intakeDraftContext('12345678-1234-4234-8234-123456789abc','p5',null,details,contact);
 const next=intakeDraftContext('12345678-1234-4234-8234-123456789abc','cabinet',{intake:prior,revision:2} as Draft,{...details,attribution:{utm_medium:'social'}},contact);
 assert.deepEqual(next.attribution,attribution);assert.equal(next.originSite,'p5');
 const snapshot:IntakeSnapshot={schema:1,projectId:prior.projectId,draftId:'12345678-1234-4234-8234-123456789abc',originSite:next.originSite,currentSite:next.currentSite,revision:3,contextVersion:2,contact,details:next,scope:{text:'Cabinet project',answers:{service:'kitchen'},extraction:null,uploads:[]},routing:routeIntake(next.currentSite,'kitchen'),unresolved:[],savedAt:'2026-10-09T14:00:00Z'};
 const record=intakeLocalCrmRecord(snapshot);
 assert.deepEqual(record.attribution,attribution);assert.equal(record.brand,'Boise Cabinet Co');
 assert.equal(sourceFromAttribution(collectAttribution(record.attribution||{})),'Paid Search');
 assert.equal(validateIntakeLocalCrm(intakeDeliveryEnvelope(snapshot,'crm','digest')),null);
 assert.equal(intakeLeadKey(snapshot.projectId),intakeLeadKey(prior.projectId));
});
test('untrusted acquisition context excludes arbitrary fields, tokens and referrer paths',()=>{
 const clean=collectAttribution({gclid:'click',email:'private@example.com',token:'secret',landing_page:'/estimate?gclid=click&email=private%40example.com&t=secret#secret',referrer:'https://search.example/private?token=secret',first_landing_page:'https://evil.example/private',first_referrer:'javascript:alert(1)'});
 assert.deepEqual(clean,{gclid:'click',landing_page:'/estimate?gclid=click',referrer:'https://search.example'});
 for(const attribution of [null,[],true,'oops'])assert.equal(intakeDetails({...emptyIntakeDetails(),attribution}).attribution,undefined);
});
test('unattributed legacy drafts remain valid and source classification handles paid identifiers',()=>{
 assert.equal(intakeDetails(emptyIntakeDetails()).attribution,undefined);
 assert.equal(sourceFromAttribution(null),'Organic Website');
 for(const key of ['gclid','gbraid','wbraid'])assert.equal(sourceFromAttribution({[key]:'click'}),'Paid Search');
 assert.equal(sourceFromAttribution({utm_medium:'paid_social'}),'Social Media');
});
