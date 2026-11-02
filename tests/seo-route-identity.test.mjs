import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalAuditRoute} from '../scripts/seo-route-identity.mjs';
const origin='http://127.0.0.1:5000';
test('intentional estimate redirect is audited as its quote target',()=>{
 assert.equal(canonicalAuditRoute('/estimate',origin+'/quote',origin),'/quote');
 assert.equal(canonicalAuditRoute('/quote',origin+'/quote',origin),'/quote');
});
test('distinct pages retain separate identities',()=>{
 assert.equal(canonicalAuditRoute('/privacy',origin+'/privacy',origin),'/privacy');
 assert.equal(canonicalAuditRoute('/',origin+'/',origin),'/');
});
test('unexpected and cross-origin redirects cannot bypass metadata checks',()=>{
 assert.throws(()=>canonicalAuditRoute('/privacy',origin+'/quote',origin));
 assert.throws(()=>canonicalAuditRoute('/estimate',origin+'/',origin));
 assert.throws(()=>canonicalAuditRoute('/estimate','https://example.invalid/quote',origin));
});
