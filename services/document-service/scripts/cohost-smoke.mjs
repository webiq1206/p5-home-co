// Infrastructure smoke only: disposable database, synthetic credentials, zero AI calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {signedHeaders} from '../src/core.mjs';
const pool=new pg.Pool({connectionString:process.env.DOCUMENT_TEST_DATABASE_URL});
const key='CI-only-cohost-secret-no-production-use-123456789';
await pool.query('CREATE DATABASE p5_cohost_smoke');
const database=new URL(process.env.DOCUMENT_TEST_DATABASE_URL);database.pathname='/p5_cohost_smoke';
const shared=new pg.Pool({connectionString:database.href});
await shared.query('CREATE TABLE website_sentinel(value text); INSERT INTO website_sentinel VALUES(\'preserved\')');
const child=spawn(process.execPath,['services/document-service/src/cohost.mjs'],{stdio:'inherit',env:{...process.env,PORT:'5090',P5_DOCUMENT_HOST_ENABLED:'true',P5_DOCUMENT_WEB_PORT:'5091',P5_DOCUMENT_WORKER_PORT:'5092',DATABASE_URL:database.href,DOCUMENT_DATABASE_URL:'',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({'p5homeco.com':key}),DOCUMENT_MODEL:'ci-placeholder-no-provider-calls',DOCUMENT_PROVIDER:'anthropic',ANTHROPIC_API_KEY:'ci-placeholder-no-provider-calls'}});
const exited=once(child,'exit');
try{
 let ready=false;
 for(let n=0;n<60;n++){
  if(child.exitCode!==null)throw Error('cohost exited before readiness');
  try{const r=await fetch('http://127.0.0.1:5090/api/p5-documents/readyz',{headers:signedHeaders(key,'GET','/readyz','smoke-test')});if(r.ok){const web=await fetch('http://127.0.0.1:5090/');await web.arrayBuffer();if(web.ok){ready=true;break;}}}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(ready,'cohost database readiness');
 assert.equal((await fetch('http://127.0.0.1:5090/api/p5-documents/readyz')).status,401);
 const web=await fetch('http://127.0.0.1:5090/');assert.equal(web.status,200);await web.arrayBuffer();
 assert.equal((await shared.query('SELECT value FROM website_sentinel')).rows[0].value,'preserved');
 assert.ok((await shared.query("SELECT to_regclass('p5ds_jobs') AS name")).rows[0].name);
 console.log('PASS: actual Next production + private worker, existing database reuse, authenticated gateway and preserved website table. No AI qualification claimed.');
}finally{
 child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),40000);await exited;clearTimeout(timer);await shared.end();await pool.end();
}
