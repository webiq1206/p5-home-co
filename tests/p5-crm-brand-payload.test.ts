import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrmPayload,buildBrandCrmPayload,BRAND_CRM_ADMIN_PATH,CRM_ADMIN_API_PATH,CRM_ADMIN_PAGE_PATH,CRM_PAYLOAD_MAX_BYTES,CRM_PAYLOAD_LIMIT_BYTES,CRM_PROJECTION_VERSION,CrmPayloadTooLargeError,crmPayloadBytes} from '../lib/p5/crmPayload.ts';
import {buildCrmPayload as boundedPayload} from '../lib/p5/boundedCrmPayload.ts';
import {crmPayload,assertCrmPayloadSize,CRM_PAYLOAD_HARD_BYTES,CRM_PAYLOAD_WARNING_BYTES} from '../lib/p5/deliveryPayloads.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';

const id='12345678-1234-4123-8123-123456789abc';
const record=()=>({draftId:id,revision:4,contact:{name:'TEST ONLY',email:'test@example.invalid',phone:''},
 scope:{instructions:'Install trim',answers:{service:'installation',location:'Boise'}},
 customer:{summary:'Install 100 LF of trim at $2.00/LF ($200.00 direct cost).',range:{low:350,high:450},lineItems:[{id:'trim',category:'Carpentry',description:'Trim installation',quantity:100,unit:'LF',low:350,high:450,unitLow:3.5,unitHigh:4.5,unitCost:2}],assumptions:['Overhead is 20%.','Install overhead cabinets.'],directCost:200},
 internal:{lines:[{description:'Trim installation',quantity:100,unit:'LF',unitCost:2}],directCost:200}});

test('one module serves every delivery adapter calling form',()=>{
 const source=record(),before=JSON.stringify(source);
 // Remodeling: (record,key,domain) returns the payload.
 const direct:any=buildCrmPayload({...source,brand:brand.name,estimator:'p5-policy'},'key-1',brand.domain);
 assert.equal(direct.externalLeadId,'key-1');
 assert.equal(direct.estimate.revision,4);
 // Construction: (record,key) returns the payload with its serialized form and size.
 const built=buildCrmPayload(source,'key-1');
 assert.deepEqual(built,buildBrandCrmPayload(source,'key-1'));
 assert.equal(built.body,JSON.stringify(built.payload));
 assert.equal(built.bytes,crmPayloadBytes(built.payload));
 assert.equal(built.payload.estimate.brand,brand.name);
 assert.equal(built.payload.estimate.estimator,'p5-policy');
 assert.equal(built.payload.estimate.projectionVersion,CRM_PROJECTION_VERSION);
 assert.equal(built.payload.source,brand.domain);
 // Cabinet: crmPayload(record,key) plus an explicit size assertion.
 assert.deepEqual(crmPayload(source,'key-1'),built.payload);
 assert.deepEqual(assertCrmPayloadSize(built.payload),{bytes:built.bytes,warning:false});
 assert.equal(CRM_PAYLOAD_HARD_BYTES,CRM_PAYLOAD_LIMIT_BYTES);assert.equal(CRM_PAYLOAD_MAX_BYTES,CRM_PAYLOAD_LIMIT_BYTES);
 assert.ok(CRM_PAYLOAD_WARNING_BYTES<CRM_PAYLOAD_HARD_BYTES);
 assert.throws(()=>assertCrmPayloadSize({x:'x'.repeat(CRM_PAYLOAD_HARD_BYTES)}),CrmPayloadTooLargeError);
 assert.equal(JSON.stringify(source),before,'the saved outbox record is never mutated');
});

test('the brand form sends the customer copy through the one customer projection and keeps the internal record whole',()=>{
 const {payload}=buildBrandCrmPayload(record(),'key-1');
 const customer=JSON.stringify(payload.estimate.customer);
 assert.doesNotMatch(customer,/\$2\.00|\$200\.00|unitCost|directCost|Overhead is 20%/);
 assert.match(customer,/Install 100 LF of trim\./);
 assert.match(customer,/Install overhead cabinets\./);
 assert.deepEqual(payload.estimate.customer.range,{low:350,high:450});
 assert.equal(payload.estimate.customer.lineItems[0].unitLow,3.5);
 assert.equal(payload.estimate.internal.directCost,200);
 assert.equal(payload.estimate.internal.lines[0].unitCost,2);
 const withheld=buildBrandCrmPayload({...record(),customer:{...record().customer,summary:'Direct cost is $200.00.'}},'key-1').payload;
 assert.doesNotMatch(JSON.stringify(withheld.estimate.customer)+withheld.projectScope,/\$200/);
 assert.match(withheld.projectScope,/withheld from the customer copy/);
});

test('the administrator reference is an allowlisted authenticated route for the exact revision',()=>{
 const source={...record(),brand:brand.name,estimator:'p5-policy'};
 // Every brand ships the staff page that opens a referenced estimate and revision.
 const expected=CRM_ADMIN_PAGE_PATH;
 assert.equal(BRAND_CRM_ADMIN_PATH,expected);
 for(const payload of [buildCrmPayload(source,'k',brand.domain) as any,buildBrandCrmPayload(source,'k').payload]){
  const url=new URL(payload.estimate.durableAdminRecord.url);
  assert.equal(url.origin,`https://${brand.domain}`);assert.equal(url.pathname,expected);
  assert.equal(url.searchParams.get('id'),id);assert.equal(url.searchParams.get('revision'),'4');
 }
 // The pure builder defaults to the API route, which resolves on every site.
 assert.equal(new URL((boundedPayload(source,'k','example.test') as any).estimate.durableAdminRecord.url).pathname,CRM_ADMIN_API_PATH);
 assert.equal(new URL((boundedPayload(source,'k','example.test',{adminPath:CRM_ADMIN_PAGE_PATH}) as any).estimate.durableAdminRecord.url).pathname,CRM_ADMIN_PAGE_PATH);
 assert.throws(()=>boundedPayload(source,'k','example.test',{adminPath:'/elsewhere' as any}),/administrator route/);
});
