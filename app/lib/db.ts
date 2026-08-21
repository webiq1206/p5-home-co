/**
 * PostgreSQL access for the lead manager.
 *
 * Server-only. The pool is cached on globalThis so Next's dev-mode module
 * reloading does not open a new pool on every edit, and so a warm serverless
 * instance reuses connections between requests.
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg";

if (typeof window !== "undefined") {
  throw new Error("app/lib/db.ts was imported in the browser. It is server-only.");
}

declare global {
  var __p5Pool: Pool | undefined;
}

/**
 * True when a database is configured. Every caller must handle the false case:
 * the marketing site has to keep building and serving even with no database,
 * and the admin panel should say so plainly rather than crash.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it in Replit Secrets (or your host's environment) and restart.",
    );
  }

  if (!globalThis.__p5Pool) {
    globalThis.__p5Pool = new Pool({
      connectionString,
      // Autoscale runs many short-lived instances; a small pool per instance
      // avoids exhausting the database's connection limit under burst traffic.
      max: Number(process.env.PGPOOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: connectionString.includes("sslmode=disable")
        ? undefined
        : { rejectUnauthorized: false },
    });

    // A pool-level error must not take down the process.
    globalThis.__p5Pool.on("error", (err) => {
      console.error("[db] idle client error", err.message);
    });
  }

  return globalThis.__p5Pool;
}

/** Run a parameterized query. Never interpolate values into SQL. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Run a query expecting at most one row. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction, rolling back on any throw.
 *
 * Intake uses this so a lead is never half-created: contact, deal, first task,
 * and audit entry all land together or not at all.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; the pool will discard it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Postgres unique-violation code, used to turn a race into a clean dedupe. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}
