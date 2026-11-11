/**
 * Request helpers for the scope platform's API routes. Every route requires a
 * signed-in, active employee (the existing Google sign-in and app_user roles).
 */

import { NextResponse } from "next/server";

import { can, getSessionUser, type SessionUser } from "../auth.ts";
import { isDatabaseConfigured } from "../db.ts";
import { getProject, type ProjectRow } from "./store.ts";

export type Guarded = { user: SessionUser } | { response: NextResponse };

export async function requireEmployee(): Promise<Guarded> {
  if (!isDatabaseConfigured()) return { response: NextResponse.json({ ok: false, error: "The database is not configured." }, { status: 503 }) };
  const user = await getSessionUser();
  if (!user) return { response: NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 }) };
  return { user };
}

export async function requireProject(idParam: string): Promise<{ user: SessionUser; project: ProjectRow } | { response: NextResponse }> {
  const g = await requireEmployee();
  if ("response" in g) return g;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return { response: NextResponse.json({ ok: false, error: "Not found." }, { status: 404 }) };
  const project = await getProject(id);
  if (!project) return { response: NextResponse.json({ ok: false, error: "Not found." }, { status: 404 }) };
  return { user: g.user, project };
}

export function canManagePricing(user: SessionUser): boolean {
  return can(user.role, "manage_settings");
}

export function fail(error: unknown, status = 400): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function ok(body: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: true, ...body });
}
