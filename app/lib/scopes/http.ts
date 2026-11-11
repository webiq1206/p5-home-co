/**
 * Request helpers for the scope platform's API routes.
 *
 * Every route requires a signed-in, active account: a P5 employee, or a
 * scopes-only account (a contractor an administrator added). Scopes-only
 * accounts never see internal cost, margin or setup, and cannot reach the
 * admin panel at all (see getSessionUser in app/lib/auth.ts).
 */

import { NextResponse } from "next/server";

import { can, getScopeUser, type ScopeUser } from "../auth.ts";
import { isDatabaseConfigured } from "../db.ts";
import { getProject, type ProjectRow } from "./store.ts";

export type Guarded = { user: ScopeUser } | { response: NextResponse };

export async function requireEmployee(): Promise<Guarded> {
  if (!isDatabaseConfigured()) return { response: NextResponse.json({ ok: false, error: "The database is not configured." }, { status: 503 }) };
  const user = await getScopeUser();
  if (!user) return { response: NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 }) };
  return { user };
}

export async function requireProject(idParam: string): Promise<{ user: ScopeUser; project: ProjectRow } | { response: NextResponse }> {
  const g = await requireEmployee();
  if ("response" in g) return g;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return { response: NextResponse.json({ ok: false, error: "Not found." }, { status: 404 }) };
  const project = await getProject(id);
  if (!project) return { response: NextResponse.json({ ok: false, error: "Not found." }, { status: 404 }) };
  return { user: g.user, project };
}

/** Internal cost, margin and markup are for P5 employees only. */
export function seesInternal(user: ScopeUser): boolean {
  return !user.scopesOnly;
}

export function canManagePricing(user: ScopeUser): boolean {
  return !user.scopesOnly && can(user.role, "manage_settings");
}

/** Who may add or remove scopes-only accounts. */
export function canManagePeople(user: ScopeUser): boolean {
  return !user.scopesOnly && can(user.role, "manage_users");
}

export function fail(error: unknown, status = 400): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function ok(body: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: true, ...body });
}
