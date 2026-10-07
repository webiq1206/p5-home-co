// Test-process preload only. The production application never imports this file.
// Run a local production Next server with:
// NODE_ENV=production DATABASE_URL=postgres://offline.invalid/isolated \
//   NEXT_PHASE=phase-production-build WATCHDOG_IN_PROCESS=false FINANCE_JOB_IN_PROCESS=false \
//   node --import ./scripts/p5-qa-saved-auth-fixture.mjs node_modules/next/dist/bin/next start
// Browser contract: p5_session=p5-qa-saved-layout-synthetic-session.
import './offline-network-guard.cjs';
import {createHash} from 'node:crypto';

if (process.env.NODE_ENV !== 'production' || process.env.DATABASE_URL !== 'postgres://offline.invalid/isolated') {
  throw new Error('Saved QA auth fixture requires production mode and its exact synthetic database URL.');
}
// Reuse existing startup guards only in this disposable test process. The
// production server still renders compiled pages, but cannot start schedulers.
if (process.env.NEXT_PHASE !== 'phase-production-build' || process.env.WATCHDOG_IN_PROCESS !== 'false'
  || process.env.FINANCE_JOB_IN_PROCESS !== 'false' || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
  throw new Error('Saved QA auth fixture requires disabled schedulers and absent provider credentials.');
}
if (globalThis.__p5Pool !== undefined) {
  throw new Error('Saved QA auth fixture refuses to replace an existing database pool.');
}

// Reuse the existing PostgreSQL-compatible in-memory test pool. No directory,
// database connection, real account or credentials are used.
const {isolatedPool} = await import('../services/document-service/scripts/model-qa-support.mjs');
const pool = await isolatedPool();
const cookieHash = createHash('sha256').update('p5-qa-saved-layout-synthetic-session').digest('hex');
const normalize = statement => statement.replace(/\s+/g, ' ').trim();
const sessionSelect = normalize(`SELECT u.id, u.email, u.full_name, u.role, u.is_active
  FROM user_session s
  JOIN app_user u ON u.id = s.user_id
  WHERE s.id = $1 AND s.expires_at > now()`);

try {
  await pool.query('CREATE TABLE app_user (id integer PRIMARY KEY, email text NOT NULL, full_name text NOT NULL, role text NOT NULL, is_active boolean NOT NULL)');
  await pool.query('CREATE TABLE user_session (id text PRIMARY KEY, user_id integer NOT NULL REFERENCES app_user(id), expires_at timestamptz NOT NULL)');
  await pool.query('INSERT INTO app_user VALUES ($1, $2, $3, $4, $5)', [1, 'synthetic-admin@example.invalid', 'Synthetic layout administrator', 'administrator', true]);
  await pool.query("INSERT INTO user_session VALUES ($1, $2, now() + interval '1 hour')", [cookieHash, 1]);
} catch (error) {
  await pool.end();
  throw error;
}

let closePromise;
const close = () => closePromise ||= pool.end();
const fixturePool = Object.freeze({
  async query(statement, parameters) {
    if (typeof statement !== 'string' || normalize(statement) !== sessionSelect
      || !Array.isArray(parameters) || parameters.length !== 1 || parameters[0] !== cookieHash) {
      throw new Error('Saved QA auth fixture permits only its exact synthetic session lookup.');
    }
    return pool.query(statement, parameters);
  },
  async connect() {
    throw new Error('Saved QA auth fixture does not permit connections or transactions.');
  },
  end: close,
});
// The application sees only the read-only wrapper, never the seeding pool.
Object.defineProperty(globalThis, '__p5Pool', {value: fixturePool, writable: false, configurable: false});

process.once('beforeExit', () => {
  void close().catch(() => { process.exitCode = 1; });
});
for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    // Let Next own its server shutdown when it has registered a handler.
    // A standalone fixture process still retains the usual signal exit code.
    const nextOwnsShutdown = process.listenerCount(signal) > 0;
    void close().catch(() => { process.exitCode = 1; }).finally(() => {
      if (!nextOwnsShutdown) process.exit(status);
    });
  });
}
