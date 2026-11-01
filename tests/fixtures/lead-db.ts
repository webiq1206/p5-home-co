/**
 * A migrated lead database for tests: PGlite with every migration applied (the
 * deferred 017 excepted, as the startup migrator does), installed as the app's
 * pool so db.ts, intake.ts and the HubSpot sync run their real SQL.
 */
import { readdirSync, readFileSync } from "node:fs";

import { isolatedDatabase, type IsolatedDatabase } from "./p5-pglite.ts";
import { migrationDeferred } from "../../scripts/p5-migration-state.mjs";

type Row = Record<string, unknown>;

export async function leadDatabase(): Promise<IsolatedDatabase & { rows: <T = Row>(sql: string, values?: unknown[]) => Promise<T[]> }> {
  const db = await isolatedDatabase();
  for (const name of readdirSync("migrations").filter((file) => file.endsWith(".sql")).sort()) {
    if (migrationDeferred(name)) continue;
    await db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const run = (sql: string, values: unknown[] = []) => db.query(sql, values);
  // One connection: BEGIN/COMMIT from db.transaction() run on it in order.
  (globalThis as { __p5Pool?: unknown }).__p5Pool = {
    query: run,
    connect: async () => ({ query: run, release: () => undefined }),
    on: () => undefined,
  };
  // Always the synthetic marker, never `??=`: CI exports DATABASE_URL as an
  // empty string, which `??=` keeps and db.ts then reads as "no database".
  // The value is never dialled; getPool() returns the PGlite pool above.
  process.env.DATABASE_URL = "postgres://synthetic.invalid/offline";
  return { ...db, rows: async <T = Row>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows as T[] };
}
