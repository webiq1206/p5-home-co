import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../src/core.mjs';
import {Reader} from '../src/provider.mjs';
import {Store,DDL} from '../src/store.mjs';
import {PGlite} from '@electric-sql/pglite';
const env={OPENAI_API_KEY:'synthetic',DOCUMENT_DATABASE_URL:'postgres://synthetic',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':'synthetic-key-not-a-real-credential-123456789'}),DOCUMENT_PROVIDER:'anthropic',DOCUMENT_MODEL:'gpt-4.1-mini',DOCUMENT_VERIFY_MODEL:'claude-sonnet-5'};
test('production worker pins full GPT-4.1 for reads and independent verification',()=>{
 const c=readConfig(env);assert.equal(c.provider,'openai');assert.equal(c.model,'gpt-4.1');assert.equal(c.verifyModel,'gpt-4.1');
 assert.throws(()=>readConfig({...env,OPENAI_API_KEY:undefined,ANTHROPIC_API_KEY:'synthetic'}),/missing-provider/);
});
test('actual response identities are recorded and a missing or substituted model fails',async()=>{
 for(const model of ['gpt-4.1-2025-04-14',undefined,'gpt-4.1-mini']){
  const events=[];let calls=0,releases=0;
  const reader=new Reader(readConfig(env),{reserve:async()=> 'slot',release:async()=>{releases++;},metric:async(_job,stage,_ms,detail)=>events.push({stage,detail})},async(url,options)=>{
   calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(options.body).model,'gpt-4.1');
   return Response.json({model,status:'completed',output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]});
  });
  const call=()=>reader.call({kind:'read',attempts:1},'Synthetic fixture',{},[],{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},new AbortController().signal);
  if(model==='gpt-4.1-2025-04-14')assert.deepEqual(await call(),{ok:true});else await assert.rejects(call(),/provider-model-unverified/);
  assert.equal(calls,1);assert.equal(releases,1);assert.equal(events.at(-1).detail.responseModel,model||null);
 }
});
test('SQL model evidence does not attest configuration or jobs with missing successful requests',async()=>{
 const pool=new PGlite();await pool.exec(DDL);const store=new Store(pool,readConfig(env));
 const job={id:'review',tenant:'p5homeco.com',project:'synthetic',payload:{documents:[]}};
 try{
  await pool.query("INSERT INTO p5ds_jobs(id,tenant,project,kind,state,payload) VALUES($1,$2,$3,'review','complete','{}')",[job.id,job.tenant,job.project]);
  assert.equal((await store.modelEvidence(job)).verified,false);
  await store.metric(job,'reconciliation-provider',3,{provider:'openai',model:'gpt-4.1',responseModel:'gpt-4.1-2025-04-14'});
  assert.deepEqual(await store.modelEvidence(job),{verified:true,requestedModel:'gpt-4.1',responseModels:['gpt-4.1-2025-04-14'],calls:1});
  await store.metric(job,'read-provider',2,{provider:'openai',model:'gpt-4.1',responseModel:'gpt-4.1-mini'});
  assert.equal((await store.modelEvidence(job)).verified,false);
 }finally{await pool.close();}
});
