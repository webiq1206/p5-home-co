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

/**
 * Check the database is actually reachable and migrated.
 *
 * Returns a diagnosis rather than throwing, so the admin panel can explain
 * itself instead of rendering a bare 500. A connection string that exists but
 * points somewhere unreachable is the failure most likely to be met during
 * setup, and "ENOTFOUND helium" on screen is worth far more to whoever is
 * fixing it than a blank error page.
 */
export async function checkDatabase(): Promise<
  { ok: true } | { ok: false; problem: string; detail: string }
> {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      problem: "No database is configured.",
      detail: "DATABASE_URL is not set in this environment.",
    };
  }

  try {
    await query("SELECT 1");
  } catch (error) {
    const message = (error as Error).message;
    const code = (error as { code?: string }).code;

    if (code === "ENOTFOUND" || /getaddrinfo/.test(message)) {
      const host = message.replace(/^.*ENOTFOUND\s*/, "").trim();
      return {
        ok: false,
        problem: `The database host "${host}" cannot be resolved from here.`,
        detail:
          "This usually means DATABASE_URL holds an internal hostname that only " +
          "works inside the development workspace. The deployment needs the " +
          "external connection string for the same database.",
      };
    }
    if (code === "ECONNREFUSED") {
      return { ok: false, problem: "The database refused the connection.", detail: message };
    }
    if (/password|authentication/i.test(message)) {
      return { ok: false, problem: "The database rejected these credentials.", detail: message };
    }
    return { ok: false, problem: "Could not reach the database.", detail: message };
  }

  try {
    await query("SELECT 1 FROM app_user LIMIT 1");
  } catch (error) {
    const message = (error as Error).message;
    if (/relation .* does not exist/i.test(message)) {
      return {
        ok: false,
        problem: "The database is reachable but has no schema.",
        detail: "Run: npm run db:migrate -- --seed-admin you@p5homeco.com \"Your Name\"",
      };
    }
    return { ok: false, problem: "The schema is not usable.", detail: message };
  }

  return { ok: true };
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

/**
 * True when the error is Postgres 42P01 - a query naming a table that does not
 * exist. In practice that means a migration has not been applied yet, not that
 * anything is broken in the code.
 */
export function isMissingRelation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: string }).code;
  if (code === "42P01") return true;
  return /relation .* does not exist/i.test((error as Error).message ?? "");
}

/**
 * Turn an error thrown by a page query into something a person can act on.
 *
 * checkDatabase only proves migration 001 ran, so a panel section added by a
 * later migration can still meet a missing table on a partially migrated
 * database. That must read as "run the migrations", not as a bare 500.
 */
export function describeSchemaError(error: unknown): { problem: string; detail: string } {
  const message = (error as Error)?.message ?? String(error);
  if (isMissingRelation(error)) {
    const table = /relation "([^"]+)"/i.exec(message)?.[1] ?? "a table this page needs";
    return {
      problem: `The database is missing ${table}.`,
      detail:
        "A migration has not been applied to this database yet. Run: npm run db:migrate",
    };
  }
  return { problem: "This section could not read its data.", detail: message };
}
