import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentServiceEligible,documentServiceHeaders,remoteDocumentId,validateDocumentServiceReadiness} from '../lib/p5/documentServiceClient.ts';
const pdf:any={id:'file',name:'scope.pdf',type:'application/pdf',size:1000,sha256:'a'.repeat(64),status:'stored'};
test('shared service is off by default and never changes legacy mixed-format inputs',()=>{
 assert.equal(documentServiceEligible([pdf],{}),false);
 assert.equal(documentServiceEligible([pdf],{P5_DOCUMENT_SERVICE_MODE:'remote'}),true);
 assert.equal(documentServiceEligible([pdf,{...pdf,type:'image/png'}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),false);
  assert.equal(documentServiceEligible([{...pdf,size:250*1024*1024}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),true);
  assert.equal(documentServiceEligible([{...pdf,size:250*1024*1024+1}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),false);
 assert.equal(documentServiceEligible([{...pdf,size:0}],{P5_DOCUMENT_SERVICE_MODE:'remote'}),false);
 assert.throws(()=>documentServiceEligible([pdf],{P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_MAX_BYTES:'invalid'}),/configuration/);
});
test('cross-site and cross-project source identities cannot collide',()=>{
 assert.notEqual(remoteDocumentId('p5homeco.com','one',pdf.sha256),remoteDocumentId('boiseconstruction.co','one',pdf.sha256));
 assert.notEqual(remoteDocumentId('p5homeco.com','one',pdf.sha256),remoteDocumentId('p5homeco.com','two',pdf.sha256));
});
test('signed source requests bind body, method and path',()=>{
 const a=documentServiceHeaders('POST','/v1/projects/one/documents','p5homeco.com','test-secret',Buffer.from('pdf'),1700000000000,'test-nonce');
 const b=documentServiceHeaders('POST','/v1/projects/two/documents','p5homeco.com','test-secret',Buffer.from('pdf'),1700000000000,'test-nonce');
 assert.notEqual(a['x-p5-signature'],b['x-p5-signature']);
 assert.equal(a['x-p5-body-sha256'].length,64);
});
test('readiness requires authenticated v1 service and shared effective limits',()=>{
 const value={ok:true,protocol:'v1',tenant:'p5homeco.com',pdf:true,maxBytes:250*1024*1024,maxPages:250,
  provider:{configured:true,ready:true,health:'configured'},service:{healthy:true,database:'ok'}};
 assert.equal(validateDocumentServiceReadiness(value).protocol,'v1');
 assert.throws(()=>validateDocumentServiceReadiness({...value,maxPages:249}),/not compatible/);
 assert.throws(()=>validateDocumentServiceReadiness({...value,tenant:'other.example'}),/not compatible/);
});
