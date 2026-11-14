// Offline lifecycle runner. Uses an in-memory database and the suite's fake fetch.
// Run from the repository root:
// node --experimental-strip-types --import ./tests/helpers/hubspot-pglite.mjs --test tests/hubspot-tasks.integration.test.ts
// Never loads .env files or connects the application's pg pool to a real server.
import '../../scripts/offline-network-guard.cjs';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
const db = new PGlite();
for (const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
 try { await db.exec(await readFile(`migrations/${file}`,'utf8')); }
 catch(e) { console.error('migration failed',file,e.message); throw e; }
}
process.env.TEST_DATABASE_URL='postgres://offline.invalid/fixture';
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
// Prevent inherited credentials from reaching any genuine provider boundary.
for (const key of Object.keys(process.env)) if (/TOKEN|SECRET|API_KEY|DATABASE_URL/.test(key) && !['TEST_DATABASE_URL','DATABASE_URL'].includes(key)) delete process.env[key];
const client={query:(sql,params=[])=>db.query(sql,params),release(){}};
globalThis.__p5Pool={...client,connect:async()=>client,end:()=>db.close()};
