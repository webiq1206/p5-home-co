import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {assertAdditiveSql, verifyMigrationFiles} from '../scripts/p5-schema-safety.mjs';
import {estimatorSchemaStatements} from '../scripts/p5-schema-statements.mjs';
import {prepareEstimatorDatabase, main} from '../scripts/p5-prepare-database.mjs';

test('destructive and dynamic migrations are rejected before execution', () => {
  for (const sql of [
    'DROP TABLE p5_estimator_review_requests CASCADE;', 'drop /* hidden */ table anything;',
    'TRUNCATE TABLE customer;', 'ALTER TABLE customer DROP COLUMN email;',
    'ALTER TABLE customer RENAME TO old_customer;', 'DELETE FROM customer;',
    'CREATE TABLE IF NOT EXISTS ok(id int); DROP SCHEMA public CASCADE;',
    'DO $$ BEGIN EXECUTE \'DROP TABLE customer\'; END $$;',
    'CREATE OR REPLACE FUNCTION bad() RETURNS void AS $$ DROP TABLE t $$ LANGUAGE sql;',
    'CREATE TABLE IF NOT EXISTS copy AS SELECT dangerous_function();',
    'ALTER TABLE t ADD COLUMN IF NOT EXISTS x int, DROP COLUMN email;',
  ]) assert.throws(() => assertAdditiveSql(sql), /prohibited|permitted|unsupported/);
  assert.doesNotThrow(() => assertAdditiveSql("-- DROP TABLE is forbidden\nCREATE TABLE IF NOT EXISTS keep(id uuid, note text DEFAULT 'DROP TABLE;');"));
  verifyMigrationFiles();
});

test('all runtime estimator table creation is covered before publishing', () => {
  const normalized = sql => sql.replace(/\s+/g, ' ').trim();
  const snapshot = new Set(estimatorSchemaStatements.map(normalized));
  for (const file of readdirSync('lib/p5').filter(name => name.endsWith('.ts'))) {
    const ast = ts.createSourceFile(file, readFileSync(`lib/p5/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isStringLiteralLike(node) && /^CREATE TABLE IF NOT EXISTS\s/.test(node.text.trim())) {
        assert.ok(snapshot.has(normalized(node.text)), `Add runtime DDL from ${file} to the additive setup snapshot`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.ok(estimatorSchemaStatements.some(sql => /CREATE TABLE IF NOT EXISTS p5_estimator_policy_imports\b/.test(sql)));
});

test('fresh setup and repeated setup preserve review records and unrelated tables', async () => {
  const db = new PGlite();
  try {
    await prepareEstimatorDatabase(db);
    await db.exec("CREATE TABLE customer_legacy(id integer PRIMARY KEY, note text); INSERT INTO customer_legacy VALUES(1, 'keep me');");
    await db.query("INSERT INTO p5_estimator_review_requests(draft_id,revision,contact,scope,status) VALUES($1,1,$2,$3,'sent')",
      ['00000000-0000-4000-8000-000000000001', {name:'Preserved QA'}, {text:'Original scope'}]);
    const before = (await db.query('SELECT * FROM p5_estimator_review_requests')).rows;
    const tablesBefore = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    await prepareEstimatorDatabase(db);
    await prepareEstimatorDatabase(db);
    assert.deepEqual((await db.query('SELECT * FROM p5_estimator_review_requests')).rows, before);
    assert.deepEqual((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows, tablesBefore);
    assert.deepEqual((await db.query('SELECT * FROM customer_legacy')).rows, [{id:1,note:'keep me'}]);
  } finally { await db.close(); }
});

test('a database setup failure rolls back and prevents success', async () => {
  const calls = [];
  await assert.rejects(prepareEstimatorDatabase({query: async sql => {
    calls.push(sql);
    if (sql.startsWith('CREATE TABLE')) throw new Error('test failure');
  }}), /test failure/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('COMMIT'));
});

test('missing Replit connection and force flags fail closed', async () => {
  await assert.rejects(main([], {}), /DATABASE_URL/);
  await assert.rejects(main(['--optional'], {REPL_ID:'test'}), /DATABASE_URL/);
  await assert.rejects(main(['--force'], {}), /Unsupported/);
});

test('development, merge and build hooks retain database safety', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.predev, /db:prepare/);
  assert.match(pkg.scripts.prebuild, /verify:db-safety/);
  assert.match(pkg.scripts['db:push'], /db:prepare/);
  for (const command of Object.values(pkg.scripts)) assert.doesNotMatch(command, /drizzle-kit\s+push/);
  const hook = readFileSync('scripts/post-merge.sh', 'utf8');
  assert.match(hook, /db:prepare/);
  assert.doesNotMatch(hook, /db:push|drizzle-kit/);
  assert.match(readFileSync('.replit', 'utf8'), /\[postMerge\]/);
  if (existsSync('tools/migrate.ts')) assert.match(readFileSync('tools/migrate.ts', 'utf8'), /verifyMigrationFiles/);
});
