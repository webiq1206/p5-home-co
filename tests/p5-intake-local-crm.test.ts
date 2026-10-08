/** Pure local receiver validation; no DB, CRM or email transport is called. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIntakeLocalCrm} from '../lib/p5/intakeCrmValidation.ts';
import {intakeDeliveryEnvelope} from '../lib/p5/intakeDeliveryPayload.ts';
import {emptyIntakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {routeIntake} from '../lib/p5/intakePolicy.ts';
const s:IntakeSnapshot={schema:1,projectId:'p5:12345678-1234-4234-8234-123456789abc',draftId:'12345678-1234-4234-8234-123456789abc',originSite:'p5',currentSite:'p5',revision:1,contextVersion:0,savedAt:'2099-01-02T12:00:00Z',contact:{name:'Fictional Person',email:'customer@example.invalid',phone:'',preferredContact:'either'},details:emptyIntakeDetails(),scope:{text:'Fictional work',answers:{service:'kitchen'},extraction:null,uploads:[]},routing:routeIntake('p5','kitchen'),unresolved:[]};
test('mock: actual inbound validation holds invalid phone even with a valid email, preserving raw contact',()=>{
 for(const phone of ['1234567890','2085550100123456789'])for(const email of ['customer@example.invalid','']){
  const request={...s,contact:{...s.contact,email,phone}},e=intakeDeliveryEnvelope(request,'crm','digest');assert.equal(validateIntakeLocalCrm(e),'contact-review');assert.equal(e.request?.contact.phone,phone);
 }
 assert.equal(validateIntakeLocalCrm(intakeDeliveryEnvelope({...s,contact:{...s.contact,email:'',phone:'2085550100'}},'crm','digest')),null);
});
