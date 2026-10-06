import '../scripts/offline-network-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {qaSavedReadingHandlers} from '../lib/p5/qaSavedReadingEndpoint.ts';
import {qaContinuationHandlers} from '../lib/p5/qaContinuationEndpoint.ts';
import {DraftError} from '../lib/p5/store.ts';

const origin='https://p5homeco.com';
const auth=async()=>({id:'synthetic-admin'});
function request(path:string,headers:Record<string,string>,url='http://0.0.0.0:3000'){
 return new Request(url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(path.endsWith('qa-recovery')?{case:'remodel',revision:5,operation:'a'.repeat(64)}:{case:'not-a-case',token:'a'.repeat(64),action:'prepare'})});
}
const forwarded={origin,host:'0.0.0.0:3000','x-forwarded-host':'p5homeco.com','x-forwarded-proto':'https'};

test('authenticated recovery accepts the configured public origin behind the production proxy',async()=>{
 let applied=0;
 const handlers=qaSavedReadingHandlers(auth,{inspect:async()=>{throw Error('No inspection expected');},apply:async()=>{applied++;return {case:'remodel',label:'Synthetic',id:'synthetic',revision:6,checkedAt:'synthetic',eligible:false,applied:true,reason:null};}});
 for(const headers of [forwarded,{...forwarded,'x-forwarded-host':'p5homeco.com:443'},{...forwarded,'x-forwarded-host':'p5homeco.com, internal.invalid'},{origin,host:'p5homeco.com'}])assert.equal((await handlers.POST(request('/api/admin/p5-estimators/qa-recovery',headers))).status,200);
 assert.equal(applied,4);
});

test('a configured deployment origin is accepted while an unconfigured forwarded origin is refused',async()=>{
 const previous=process.env.REPLIT_DEV_DOMAIN;
 try{
  process.env.REPLIT_DEV_DOMAIN='p5-qa-origin-fixture.replit.dev';
  const headers={origin:'https://p5-qa-origin-fixture.replit.dev',host:'0.0.0.0:3000','x-forwarded-host':'p5-qa-origin-fixture.replit.dev','x-forwarded-proto':'https'};
  assert.equal((await qaContinuationHandlers(auth).POST(request('/api/admin/p5-estimators/qa-continuation',headers))).status,404);
  delete process.env.REPLIT_DEV_DOMAIN;
  assert.equal((await qaContinuationHandlers(auth).POST(request('/api/admin/p5-estimators/qa-continuation',headers))).status,403);
 }finally{if(previous===undefined)delete process.env.REPLIT_DEV_DOMAIN;else process.env.REPLIT_DEV_DOMAIN=previous;}
});

test('continuation resolves the proxy origin before validating the synthetic action, without database access',async()=>{
 const handlers=qaContinuationHandlers(auth);
 assert.equal((await handlers.POST(request('/api/admin/p5-estimators/qa-continuation',forwarded))).status,404);
 assert.equal((await handlers.POST(request('/api/admin/p5-estimators/qa-continuation',{origin},origin))).status,404);
});

test('missing/cross-site origins and forged forwarded hosts fail before application work',async()=>{
 let applied=0;
 const handlers=qaSavedReadingHandlers(auth,{inspect:async()=>{throw Error('No reads');},apply:async()=>{applied++;throw Error('No writes');}});
 const bad=[
  {...forwarded,origin:''}, {...forwarded,origin:'null'}, {...forwarded,origin:'https://evil.invalid'},
  {...forwarded,origin:'https://evil.invalid','x-forwarded-host':'evil.invalid'},
  {...forwarded,'x-forwarded-host':'evil.invalid'}, {...forwarded,'x-forwarded-proto':'http'},
  {origin,host:'0.0.0.0:3000'}, {...forwarded,origin:origin+'/path'},
 ];
 for(const headers of bad){assert.equal((await handlers.POST(request('/api/admin/p5-estimators/qa-recovery',headers))).status,403);assert.equal((await qaContinuationHandlers(auth).POST(request('/api/admin/p5-estimators/qa-continuation',headers))).status,403);}
 assert.equal((await handlers.POST(request('/api/admin/p5-estimators/qa-recovery',{origin:'https://evil.invalid'},'https://evil.invalid'))).status,403);
 assert.equal(applied,0);
});

test('administrator authentication remains mandatory before accepting a proxy origin',async()=>{
 const denied=async()=>{throw new DraftError('Administrator sign-in is required.',403);};
 assert.equal((await qaSavedReadingHandlers(denied).POST(request('/api/admin/p5-estimators/qa-recovery',forwarded))).status,403);
 assert.equal((await qaContinuationHandlers(denied).POST(request('/api/admin/p5-estimators/qa-continuation',forwarded))).status,403);
});
