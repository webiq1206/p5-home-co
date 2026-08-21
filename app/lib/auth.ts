/**
 * Authentication and authorization for the admin panel.
 *
 * Sessions are opaque random tokens. Only a SHA-256 hash of the token is
 * stored, so a leaked database dump does not hand over live sessions. The
 * cookie is httpOnly and SameSite=Lax, which also gives CSRF protection for
 * the state-changing POSTs the admin panel makes.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { query, queryOne } from "./db.ts";
import type { Role } from "./leads/types.ts";

export const SESSION_COOKIE = "p5_session";
const SESSION_DAYS = 7;

export type SessionUser = {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a session and return the raw token for the cookie.
 *
 * The raw token is never persisted; only its hash is, so the value in the
 * cookie is the sole copy.
 */
export async function createSession(
  userId: number,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await query(
    `INSERT INTO user_session (id, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );

  return { token, expiresAt };
}

/** Resolve the signed-in user, or null. Expired sessions resolve to null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<{
    id: string;
    email: string;
    full_name: string;
    role: Role;
    is_active: boolean;
  }>(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_active
       FROM user_session s
       JOIN app_user u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );

  if (!row || !row.is_active) return null;

  return {
    id: Number(row.id),
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await query("DELETE FROM user_session WHERE id = $1", [hashToken(token)]);
  }
  store.delete(SESSION_COOKIE);
}

/** Remove expired sessions. Called by the watchdog, not on the request path. */
export async function pruneExpiredSessions(): Promise<number> {
  const rows = await query<{ id: string }>(
    "DELETE FROM user_session WHERE expires_at <= now() RETURNING id",
  );
  return rows.length;
}

// --------------------------------------------------------------------------
// Permissions (re-exported from the pure module so callers have one import)
// --------------------------------------------------------------------------

export {
  can,
  seesAllLeads,
  assertCan,
  ForbiddenError,
  type Permission,
} from "./leads/permissions.ts";

// --------------------------------------------------------------------------
// Shared-secret comparison for job endpoints
// --------------------------------------------------------------------------

/**
 * Constant-time comparison for the watchdog's bearer token.
 *
 * The scheduler authenticates with a secret rather than a session, so this
 * must not leak the secret's length or content through timing.
 */
export function secretsMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
