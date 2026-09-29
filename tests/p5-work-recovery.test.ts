import test from 'node:test';
import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {PGlite} from '@electric-sql/pglite';
import {SAVED_WORK_REPLY_QUERY} from '../lib/p5/workStore.ts';

test('durable recovery finds the exact completed reply across jobs, behind newer empty markers and within its own draft',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE p5_estimator_work (draft_id text, work_key text, payload jsonb, updated_at timestamptz)');
  const complete={value:{rates:[{taskId:'screws'}]},sourceUrls:['https://example.test/screws']};
  const report={value:null,sourceReport:'Saved cited source report',sourceUrls:['https://example.test/shims']};
  const save=async(draft:string,job:string,replies:unknown,stamp:string)=>db.query('INSERT INTO p5_estimator_work VALUES ($1,$2,$3::jsonb,$4::timestamptz)',[draft,job,JSON.stringify({replies}),stamp]);
  await save('mine','old',{'content-v1:exact':complete,'content-v1:report':report},'2026-09-29T10:00:00Z');
  await save('mine','new',{'content-v1:exact':{value:null,sourceUrls:[]},'content-v1:report':{...report,timedOut:true}},'2026-09-29T11:00:00Z');
  await save('other','other',{'content-v1:exact':{value:{wrong:true},sourceUrls:[]}},'2026-09-29T12:00:00Z');
  assert.deepEqual((await db.query(SAVED_WORK_REPLY_QUERY,['mine',JSON.stringify(['content-v1:exact'])])).rows,[{reply:complete}]);
  // Exercise the Drizzle adapter used by three brands as well as the native
  // PostgreSQL adapter. A raw JS array becomes a SQL record in Drizzle.
  const parameters=['mine',JSON.stringify(['content-v1:exact','legacy-hash'])];
  const pieces=SAVED_WORK_REPLY_QUERY.split(/\$(\d+)/g);
  const compiled=new PgDialect().sqlToQuery(sql.join(pieces.map((piece,index)=>index%2?sql`${parameters[Number(piece)-1]}`:sql.raw(piece)),sql.raw('')));
  assert.deepEqual((await db.query(compiled.sql,compiled.params)).rows,[{reply:complete}]);

  assert.deepEqual((await db.query(SAVED_WORK_REPLY_QUERY,['mine',JSON.stringify(['content-v1:report'])])).rows,[{reply:report}]);
  assert.deepEqual((await db.query(SAVED_WORK_REPLY_QUERY,['mine',JSON.stringify(['different-input'])])).rows,[]);
  await save('mine','limited',{'limited':{...complete,outputLimited:true},'timed':{...complete,timeouts:1},'noUrls':{value:1}},'2026-09-29T13:00:00Z');
  assert.deepEqual((await db.query(SAVED_WORK_REPLY_QUERY,['mine',JSON.stringify(['limited','timed','noUrls'])])).rows,[]);
 }finally{await db.close();}
});
