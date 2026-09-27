import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('deployment schema retains the runtime project-review table and its exact constraints',async(t)=>{
  if(!existsSync('drizzle.config.ts')){t.skip('This brand does not use a Drizzle deployment schema.');return;}
  const {getTableConfig,PgDialect}=await import('drizzle-orm/pg-core');
  const config=readFileSync('drizzle.config.ts','utf8');
  const schemaPath=config.match(/schema:\s*["']([^"']+)["']/)?.[1];
  assert.ok(schemaPath,'a deployment schema must be configured');
  assert.ok(existsSync(schemaPath));
  const schema=await import(pathToFileURL(resolve(schemaPath)).href);
  const table=schema.p5EstimatorReviewRequests;
  assert.ok(table,'deployment schema must export p5EstimatorReviewRequests, or publishing can propose DROP TABLE');
  const definition=getTableConfig(table);
  assert.equal(definition.name,'p5_estimator_review_requests');
  assert.deepEqual(definition.columns.map(c=>[c.name,c.getSQLType(),c.notNull]),[
    ['draft_id','uuid',true],['revision','integer',true],['contact','jsonb',true],
    ['scope','jsonb',true],['status','text',true],['created_at','timestamp with time zone',true],
  ]);
  assert.equal(definition.columns.find(c=>c.name==='status').default,'saved');
  const created=definition.columns.find(c=>c.name==='created_at');
  assert.equal(new PgDialect().sqlToQuery(created.default).sql,'now()');
  assert.deepEqual(definition.primaryKeys.map(key=>[key.getName(),key.columns.map(c=>c.name)]),[
    ['p5_estimator_review_requests_pkey',['draft_id','revision']],
  ]);
  assert.equal(definition.foreignKeys.length,0,'do not invent a foreign key absent from the runtime table');
  const runtime=readFileSync('lib/p5/reviewRequest.ts','utf8');
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS p5_estimator_review_requests/);
});
