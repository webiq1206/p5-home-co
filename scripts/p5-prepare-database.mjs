import {pathToFileURL} from 'node:url';
import {estimatorSchemaStatements} from './p5-schema-statements.mjs';
import {assertAdditiveSql} from './p5-schema-safety.mjs';

export async function prepareEstimatorDatabase(client) {
  // Validate the entire plan BEFORE any database query.
  for (const sql of estimatorSchemaStatements) assertAdditiveSql(sql, 'estimator setup');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock(503202609)');
    for (const sql of estimatorSchemaStatements) await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.some(arg => arg !== '--optional')) throw new Error('Unsupported database setup option. Force and destructive modes do not exist.');
  if (!env.DATABASE_URL) {
    if (args.includes('--optional') && !env.REPL_ID && env.NODE_ENV !== 'production') {
      console.log('No local DATABASE_URL: skipped database setup. Do not publish until db:prepare succeeds in Replit.');
      return;
    }
    throw new Error('DATABASE_URL is required. Database setup did not run; do not publish.');
  }
  const {Client} = await import('pg');
  // pg supports both local Replit PostgreSQL and Neon via the URL's SSL options.
  // Never substitute a production or legacy connection URL for the current DB.
  const client = new Client({connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000});
  try {
    await client.connect();
    await prepareEstimatorDatabase(client);
    console.log('Estimator database ready: additive setup complete; existing tables and rows preserved.');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Driver errors can contain credentials or customer data. Do not log them.
    console.error('Database preparation failed. Check the configured DATABASE_URL and database access. Do not republish until npm run db:prepare succeeds.');
    process.exitCode = 1;
  });
}
