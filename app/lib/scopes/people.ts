/**
 * Scopes-only accounts: people (usually contractors) who may use the scope
 * platform and nothing else. Server only.
 *
 * They live in app_user so the existing Google sign-in and sessions work, but
 * with scopes_only = true, which makes every admin page and admin API treat
 * them as not signed in. This module never reads or changes an employee
 * account: every statement is restricted to scopes_only rows.
 */

import { query, queryOne } from "../db.ts";

export type ScopePerson = { id: number; email: string; fullName: string; active: boolean; createdAt: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function listPeople(): Promise<ScopePerson[]> {
  const rows = await query<{ id: string; email: string; full_name: string; is_active: boolean; created_at: Date }>(
    "SELECT id, email, full_name, is_active, created_at FROM app_user WHERE scopes_only ORDER BY is_active DESC, lower(full_name)",
  );
  return rows.map((r) => ({ id: Number(r.id), email: r.email, fullName: r.full_name, active: r.is_active, createdAt: new Date(r.created_at).toISOString() }));
}

async function audit(actorId: number, personId: number, action: string, detail: unknown): Promise<void> {
  await query(
    `INSERT INTO audit_log (user_id, record_type, record_id, action, new_value, action_source)
     VALUES ($1, 'app_user', $2, $3, $4::jsonb, 'admin_ui')`,
    [actorId, String(personId), action, JSON.stringify(detail)],
  ).catch(() => undefined);
}

export async function addPerson(emailRaw: string, nameRaw: string, actorId: number): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const name = nameRaw.trim().slice(0, 120);
  if (!EMAIL.test(email) || email.length > 200) throw new Error("Enter a valid email address.");
  if (!name) throw new Error("Enter the person's name.");

  const existing = await queryOne<{ id: string; scopes_only: boolean }>(
    "SELECT id, scopes_only FROM app_user WHERE lower(email) = $1",
    [email],
  );
  if (existing && !existing.scopes_only) {
    throw new Error("That email belongs to a P5 employee account, which already has access to Scopes.");
  }
  if (existing) {
    await query("UPDATE app_user SET is_active = true, full_name = $2, updated_at = now() WHERE id = $1 AND scopes_only", [existing.id, name]);
    await audit(actorId, Number(existing.id), "scopes_access_restored", { email });
    return;
  }
  // The role column only accepts employee roles; the least privileged one is
  // stored, and scopes_only is what actually governs access.
  const row = await queryOne<{ id: string }>(
    "INSERT INTO app_user (email, full_name, role, scopes_only) VALUES ($1, $2, 'project_manager', true) RETURNING id",
    [email, name],
  );
  await audit(actorId, Number(row!.id), "scopes_access_granted", { email });
}

/** Turn access off (and end any signed-in sessions) or back on. */
export async function setPersonActive(id: number, active: boolean, actorId: number): Promise<void> {
  const rows = await query("UPDATE app_user SET is_active = $2, updated_at = now() WHERE id = $1 AND scopes_only RETURNING id", [id, active]);
  if (!rows.length) throw new Error("That person was not found.");
  if (!active) await query("DELETE FROM user_session WHERE user_id = $1", [id]);
  await audit(actorId, id, active ? "scopes_access_restored" : "scopes_access_removed", {});
}
