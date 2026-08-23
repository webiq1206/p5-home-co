/**
 * Portal authentication (S151/S152): passwordless magic links.
 *
 * External vendors and clients never get passwords here. An administrator
 * invites a contact; the contact requests a sign-in link; a one-time token
 * (15 minutes, single use, hash-stored) exchanges for a 30-day portal session
 * in its own cookie. Mirrors the admin session model: only SHA-256 hashes are
 * persisted, so a database dump hands over no live credentials.
 */

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { query, queryOne } from "../db.ts";

export const PORTAL_COOKIE = "p5_portal";
const LINK_MINUTES = 15;
const SESSION_DAYS = 30;

export type PortalContact = {
  id: number;
  kind: "vendor" | "client";
  vendorId: number | null;
  projectId: number | null;
  email: string;
  fullName: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a one-time login token for every active contact matching the email.
 * Returns the raw tokens for mailing. Deliberately silent about whether the
 * email exists - the request endpoint must not confirm addresses to strangers.
 */
export async function createLoginTokens(
  email: string,
): Promise<{ contact: PortalContact; token: string }[]> {
  const contacts = await query<{
    id: string;
    kind: "vendor" | "client";
    vendor_id: string | null;
    project_id: string | null;
    email: string;
    full_name: string;
  }>(
    `SELECT id, kind, vendor_id, project_id, email, full_name
     FROM portal_contact WHERE lower(email) = lower($1) AND is_active`,
    [email],
  );

  const out: { contact: PortalContact; token: string }[] = [];
  for (const c of contacts) {
    const token = randomBytes(32).toString("base64url");
    await query(
      `INSERT INTO portal_login_token (id, contact_id, expires_at)
       VALUES ($1, $2, $3)`,
      [hashToken(token), c.id, new Date(Date.now() + LINK_MINUTES * 60_000)],
    );
    out.push({
      contact: {
        id: Number(c.id),
        kind: c.kind,
        vendorId: c.vendor_id ? Number(c.vendor_id) : null,
        projectId: c.project_id ? Number(c.project_id) : null,
        email: c.email,
        fullName: c.full_name,
      },
      token,
    });
  }
  return out;
}

/**
 * Consume a login token: single use, unexpired, contact still active.
 * Returns the new session cookie token, or null when the link is not valid -
 * callers show one generic message either way.
 */
export async function consumeLoginToken(
  rawToken: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ sessionToken: string; contact: PortalContact } | null> {
  const row = await queryOne<{
    contact_id: string;
    kind: "vendor" | "client";
    vendor_id: string | null;
    project_id: string | null;
    email: string;
    full_name: string;
  }>(
    `UPDATE portal_login_token t
     SET used_at = now()
     FROM portal_contact c
     WHERE t.id = $1
       AND t.contact_id = c.id
       AND t.used_at IS NULL
       AND t.expires_at > now()
       AND c.is_active
     RETURNING t.contact_id, c.kind, c.vendor_id, c.project_id, c.email, c.full_name`,
    [hashToken(rawToken)],
  );
  if (!row) return null;

  const sessionToken = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO portal_session (id, contact_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      hashToken(sessionToken),
      row.contact_id,
      new Date(Date.now() + SESSION_DAYS * 86_400_000),
      meta.userAgent ?? null,
      meta.ip ?? null,
    ],
  );
  await query(`UPDATE portal_contact SET last_login_at = now() WHERE id = $1`, [
    row.contact_id,
  ]);

  return {
    sessionToken,
    contact: {
      id: Number(row.contact_id),
      kind: row.kind,
      vendorId: row.vendor_id ? Number(row.vendor_id) : null,
      projectId: row.project_id ? Number(row.project_id) : null,
      email: row.email,
      fullName: row.full_name,
    },
  };
}

/** Resolve the signed-in portal contact from the cookie, or null. */
export async function getPortalContact(): Promise<PortalContact | null> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<{
    id: string;
    kind: "vendor" | "client";
    vendor_id: string | null;
    project_id: string | null;
    email: string;
    full_name: string;
  }>(
    `SELECT c.id, c.kind, c.vendor_id, c.project_id, c.email, c.full_name
     FROM portal_session s
     JOIN portal_contact c ON c.id = s.contact_id
     WHERE s.id = $1 AND s.expires_at > now() AND c.is_active`,
    [hashToken(token)],
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    kind: row.kind,
    vendorId: row.vendor_id ? Number(row.vendor_id) : null,
    projectId: row.project_id ? Number(row.project_id) : null,
    email: row.email,
    fullName: row.full_name,
  };
}

export async function destroyPortalSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (token) {
    await query(`DELETE FROM portal_session WHERE id = $1`, [hashToken(token)]);
  }
  store.delete(PORTAL_COOKIE);
}
