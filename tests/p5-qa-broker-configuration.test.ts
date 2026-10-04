import test from 'node:test';
import assert from 'node:assert/strict';
import {qaBrokerEnvironment} from '../lib/p5/qaBrokerConfiguration.ts';
const key='synthetic-p5-resident-tenant-key-123456789';
const env={P5_DOCUMENT_HOST_ENABLED:'true',P5_DOCUMENT_SERVICE_MODE:'legacy',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':key,'boiseconstruction.co':'synthetic-other-key-123456789012345'})};
test('legacy P5 QA resolves its resident cohost without enabling ordinary remote reads',()=>{
 const resolved=qaBrokerEnvironment(env,'p5homeco.com');
 assert.equal(resolved.P5_DOCUMENT_SERVICE_URL,'https://p5homeco.com/api/p5-documents');
 assert.equal(resolved.P5_DOCUMENT_SERVICE_KEY,key);
 assert.equal(resolved.P5_DOCUMENT_SERVICE_TENANT,'p5homeco.com');
 assert.equal(resolved.P5_DOCUMENT_SERVICE_MODE,'legacy');
 assert.equal('P5_DOCUMENT_SERVICE_KEY' in env,false);
});
test('QA never supplies a resident key to an explicit URL or another tenant',()=>{
 for(const url of ['https://external.example','https://p5homeco.com/api/p5-documents']){
  const explicit={...env,P5_DOCUMENT_SERVICE_URL:url};assert.equal(qaBrokerEnvironment(explicit,'p5homeco.com'),explicit);
 }
 assert.equal(qaBrokerEnvironment(env,'boiseconstruction.co'),env);
 const wrong={...env,P5_DOCUMENT_SERVICE_TENANT:'boiseconstruction.co'};assert.equal(qaBrokerEnvironment(wrong,'p5homeco.com'),wrong);
});
test('missing cohost authorization or missing and malformed credentials fail closed',()=>{
 for(const patch of [{P5_DOCUMENT_HOST_ENABLED:'false'},{P5_DOCUMENT_TENANTS_JSON:'{}'},{P5_DOCUMENT_TENANTS_JSON:'bad json'},{P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':'weak'})}]){
  const invalid={...env,...patch};assert.equal(qaBrokerEnvironment(invalid,'p5homeco.com'),invalid);
 }
 const explicit={...env,P5_DOCUMENT_SERVICE_KEY:'explicit-resident-service-key-123456789'};
 assert.equal(qaBrokerEnvironment(explicit,'p5homeco.com').P5_DOCUMENT_SERVICE_KEY,explicit.P5_DOCUMENT_SERVICE_KEY);
});
