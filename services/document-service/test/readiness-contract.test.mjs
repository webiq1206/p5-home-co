import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeServer} from '../src/server.mjs';
import {signedHeaders} from '../src/core.mjs';

const tenant='boiseremodeling.co',secret='readiness-fixture-not-a-production-secret-123456789';
async function fixture(overrides={},databaseReady=true){
 const config={tenants:{[tenant]:secret},provider:'anthropic',key:'fixture-only',model:'fixture-model',maxBytes:10*1024*1024,maxPages:200,...overrides};
 const store={nonce:async()=>true,pool:{query:async()=>{if(!databaseReady)throw new Error('fixture database unavailable');return {rows:[{value:1}]};}}};
 const server=makeServer(store,{},config);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/readyz`;
 return {config,get:()=>fetch(url,{headers:signedHeaders(secret,'GET','/readyz',tenant)}),close:()=>new Promise(resolve=>server.close(resolve))};
}

test('authenticated HTTP readiness supports both adapters and reports actual lower limits',async()=>{
 const f=await fixture();
 try{
  const response=await f.get(),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.tenant,tenant);assert.equal(body.protocol,'v1');
  assert.equal(body.ok,true);assert.equal(body.pdf,true);assert.equal(body.capabilities.pdf,true);
  assert.equal(body.maxBytes,f.config.maxBytes);assert.equal(body.limits.maxFileBytes,f.config.maxBytes);
  assert.equal(body.maxPages,f.config.maxPages);assert.equal(body.limits.maxPages,f.config.maxPages);
  assert.equal(body.providerConfigured,true);assert.equal(body.provider.configured,true);assert.equal(body.service.database,'ok');
  assert.ok(!JSON.stringify(body).includes(secret));assert.ok(!JSON.stringify(body).includes('fixture-only'));
 }finally{await f.close();}
});

for(const [name,overrides,databaseReady] of [['missing provider',{key:''},true],['unavailable database',{},false]]){
 test('readiness never advertises compatibility with '+name,async()=>{
  const f=await fixture(overrides,databaseReady);
  try{const response=await f.get(),body=await response.json();assert.equal(response.status,503);assert.notEqual(body.ok,true);assert.equal(body.capabilities,undefined);}finally{await f.close();}
 });
}
