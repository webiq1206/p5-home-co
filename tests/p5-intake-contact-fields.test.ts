import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeContact,IntakeContactError} from '../lib/p5/intakeContract.ts';
const valid={name:'Fictional Person',email:'person@example.invalid',phone:'2085550100',preferredContact:'either'};
test('contact validation identifies the precise correction fields without changing qualification',()=>{
 for(const [patch,fields] of [[{name:''},['name']],[{email:'invalid'},['email']],[{phone:'123'},['phone']],[{email:'',phone:''},['email','phone']],[{email:'',preferredContact:'email'},['email']],[{phone:'',preferredContact:'phone'},['phone']],[{preferredContact:'fax'},['preferredContact']],[{name:'x'.repeat(121)},['name']],[{email:'x'.repeat(201)},['email']],[{phone:'x'.repeat(41)},['phone']]] as const){
  assert.throws(()=>intakeContact({...valid,...patch}),error=>{assert.ok(error instanceof IntakeContactError);assert.deepEqual(error.fields,fields);return true;});
 }
 for(const contact of [valid,{...valid,email:'',preferredContact:'phone'},{...valid,phone:'',preferredContact:'email'}])assert.deepEqual(intakeContact(contact),contact);
 assert.equal(intakeContact({name:'',email:'invalid',phone:'1'},false).email,'invalid','draft qualification stays unchanged');
});
