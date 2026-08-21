/**
 * Apply database migrations.
 *
 *   npm run db:migrate           # apply anything not yet applied
 *   npm run db:migrate -- --dry  # show what would run, change nothing
 *   npm run db:migrate -- --seed-admin you@p5homeco.com "Your Name"
 *
 * Idempotent: each file is recorded in schema_migration and skipped next time,
 * and the schema itself uses IF NOT EXISTS throughout, so a re-run is safe even
 * if the tracking table is lost.
 *
 * Reads DATABASE_URL from the environment and never prints it.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

const DRY = process.argv.includes("--dry");
const MIGRATIONS = path.join(process.cwd(), "migrations");

/** --seed-admin <email> [full name] */
function seedAdminArgs(): { email: string; name: string } | null {
  const i = process.argv.indexOf("--seed-admin");
  if (i === -1) return null;
  const email = process.argv[i + 1];
  if (!email || email.startsWith("--")) {
    throw new Error("--seed-admin needs an email address");
  }
  const name = process.argv[i + 2] && !process.argv[i + 2].startsWith("--")
    ? process.argv[i + 2]
    : email.split("@")[0];
  return { email, name };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "On Replit it comes from the attached database; locally put it in .env.local.",
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("sslmode=disable")
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`Could not connect to the database: ${(error as Error).message}`);
    process.exit(1);
  }

  try {
    // The tracking table has to exist before it can be consulted, and it is
    // also created by 001, so create it here independently.
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migration (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    const applied = new Set(
      (await client.query<{ version: string }>("SELECT version FROM schema_migration")).rows.map(
        (r) => r.version,
      ),
    );

    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
    if (!files.length) {
      console.log("No migration files found.");
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip   ${file}  (already applied)`);
        continue;
      }
      if (DRY) {
        console.log(`  would apply ${file}`);
        ran += 1;
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS, file), "utf8");
      // Each migration is one transaction, so a failure part-way leaves the
      // schema untouched rather than half-built.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  applied ${file}`);
        ran += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  FAILED  ${file}: ${(error as Error).message}`);
        process.exit(1);
      }
    }

    const tables = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    console.log(`\n${DRY ? "Dry run. " : ""}${ran} migration(s), ${tables.rows[0].n} tables present.`);

    const seed = seedAdminArgs();
    if (seed && !DRY) {
      const res = await client.query(
        `INSERT INTO app_user (email, full_name, role)
         VALUES ($1, $2, 'administrator')
         ON CONFLICT (email) DO UPDATE SET role = 'administrator', is_active = TRUE
         RETURNING id`,
        [seed.email, seed.name],
      );
      console.log(`Administrator ready: ${seed.email} (user id ${res.rows[0].id})`);
    } else if (!DRY) {
      const admins = await client.query<{ n: string }>(
        "SELECT count(*) AS n FROM app_user WHERE role = 'administrator' AND is_active",
      );
      if (admins.rows[0].n === "0") {
        console.log(
          "\nNo administrator exists yet. Nobody can use the panel until one does:\n" +
            '  npm run db:migrate -- --seed-admin you@p5homeco.com "Your Name"',
        );
      }
    }
  } finally {
    await client.end();
  }
}

await main();

// Makes this file a module, which top-level await requires.
export {};
