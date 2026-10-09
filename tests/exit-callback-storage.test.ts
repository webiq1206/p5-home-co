import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

test('explicit callbacks freeze their phone, deduplicate concurrent retries and retain failed notifications',async()=>{
  const pg=new PGlite();
  const oldPool=globalThis.__p5Pool,oldUrl=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgres://synthetic.invalid/offline';
  globalThis.__p5Pool={query:async(sql:string,values:unknown[]=[])=>{
    if(/FROM app_user/i.test(sql))return {rows:[{email:'manager@example.invalid'}]};
    return pg.query(sql,values);
  }} as never;
  const svc=await import('../app/lib/leads/estimatorSessions.ts');
  const sent:string[]=[];let fail=false;
  svc.installEstimatorSessionsSender(async(_to,message)=>{if(fail)throw Error('synthetic unavailable');sent.push(message.text);});
  try {
    const request={sessionId:'aaaaaaaa-0000-4000-8000-000000000001',flow:'p5-exit',phone:'2085550100',note:'Explicit callback consent; no marketing.',pagePath:'/estimate?private=excluded'};
    await Promise.all([svc.recordCallbackRequest(request),svc.recordCallbackRequest(request)]);
    assert.equal(sent.length,1);assert.doesNotMatch(sent[0],/private=excluded/);
    const conflict=await svc.recordCallbackRequest({...request,phone:'2085550101'});
    assert.equal(conflict.error,'callback_conflict');assert.equal(conflict.stored,false);
    const row=(await pg.query<{contact_phone:string}>('SELECT contact_phone FROM estimator_sessions WHERE id=$1',[request.sessionId])).rows[0];
    assert.equal(row.contact_phone,request.phone);assert.equal(sent.length,1);
    fail=true;
    const second={...request,sessionId:'aaaaaaaa-0000-4000-8000-000000000002'};
    const failed=await svc.recordCallbackRequest(second);
    assert.equal(failed.stored,true);assert.equal(failed.notified,false);
    fail=false;assert.equal((await svc.recordCallbackRequest(second)).notified,true);assert.equal(sent.length,2);
    const {POST}=await import('../app/api/recovery/callback/route.ts');
    for(const [i,body] of [{...request,callbackConsent:false},{...request,callbackConsent:true,phone:'2085550100123'}].entries()){
      const response=await POST(new Request('http://localhost/api/recovery/callback',{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':`192.0.2.${i}`},body:JSON.stringify(body)}));
      assert.equal(response.status,400);
    }
    assert.equal(sent.length,2);
  } finally {svc.installEstimatorSessionsSender(null);globalThis.__p5Pool=oldPool;if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;await pg.close();}
});
