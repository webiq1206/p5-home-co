import test from 'node:test';
import assert from 'node:assert/strict';
import {protectRequest} from '../lib/p5/http.ts';
import {missingScopeFields} from '../lib/p5/missingFields.ts';

const put=(project:string,address:string)=>new Request('https://example.test/api/p5-estimator/draft',{method:'PUT',headers:{'x-p5-draft-id':project,'x-forwarded-for':address}});

test('one customer answering many questions is never rate limited',()=>{
  const project='11111111-1111-4111-8111-111111111111';
  for(let i=0;i<400;i++)protectRequest(put(project,'198.51.100.7'));
});

test('customers behind one shared address do not consume each other\'s allowance',()=>{
  for(let customer=0;customer<8;customer++){const project=`2222222${customer}-2222-4222-8222-222222222222`;for(let i=0;i<300;i++)protectRequest(put(project,'203.0.113.9'));}
});

test('a single project hammering the endpoint is still stopped, with a calm message',()=>{
  const project='33333333-3333-4333-8333-333333333333';
  assert.throws(()=>{for(let i=0;i<700;i++)protectRequest(put(project,'198.51.100.8'));},(error:any)=>error.status===429&&/saved/i.test(error.message)&&!/too many requests/i.test(error.message));
});

test('a spoofed leading forwarded address does not create a fresh allowance',()=>{
  assert.throws(()=>{for(let i=0;i<200;i++)protectRequest(new Request('https://example.test/api/p5-estimator/draft',{method:'GET',headers:{'x-forwarded-for':`10.0.0.${i}, 198.51.100.99`}}));},(error:any)=>error.status===429);
});

test('missing details are listed in the order a person would be asked',()=>{
  const fields=missingScopeFields(['Missing quantity: cabinetTallLf for tall cabinets','Missing quantity: garageSqft for garage slab','Missing quantity: sqft']).map(item=>item.field);
  assert.deepEqual(fields,['sqft','garageSqft','cabinetTallLf']);
  assert.deepEqual(missingScopeFields(['Missing quantity: cabinetTallLf','Missing quantity: cabinetUpperLf','Missing quantity: cabinetBaseLf']).map(item=>item.field),['cabinetBaseLf','cabinetUpperLf','cabinetTallLf']);
});
