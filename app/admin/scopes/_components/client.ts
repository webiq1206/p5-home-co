"use client";

/** Small browser helpers shared by the scope workspace components. */

import type { Workspace } from "../../../lib/scopes/workspace.ts";

export type { Workspace };

export async function api<T = Record<string, unknown>>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  let body: { ok?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    throw new Error(res.status === 401 ? "Your session ended. Sign in again." : `The server returned ${res.status}.`);
  }
  if (!res.ok || body.ok === false) throw new Error(body.error || `The server returned ${res.status}.`);
  return body as T;
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "Unknown" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function newKey(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export const SCOPE_LABEL: Record<string, string> = {
  in_progress: "In progress",
  needs_information: "Needs information",
  ready: "Ready",
};

export const CERTAINTY_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  suggested: "Suggested",
  assumed: "Assumption",
  conflict: "Conflicting",
  undecided: "Undecided",
};

export const BUCKET_LABEL: Record<string, string> = {
  approved: "Approved scope",
  optional: "Optional upgrades",
  considering: "Ideas being considered",
  future: "Future work",
};

export const MEASURE_LABEL: Record<string, string> = {
  documented: "Documented",
  confirmed: "Confirmed",
  stated: "Stated in meeting",
  estimated: "Estimate, not confirmed",
  missing: "Missing",
};

export const SERVICES: [string, string][] = [
  ["kitchen", "Kitchen remodel"],
  ["bathroom", "Bathroom remodel"],
  ["remodel", "Remodel"],
  ["whole-home", "Whole-home remodel"],
  ["addition", "Addition"],
  ["adu", "ADU"],
  ["new-construction", "New construction"],
  ["handyman", "Handyman"],
  ["re10", "RE-10 repairs"],
  ["cabinet-product", "Cabinets, product only"],
  ["cabinet-install", "Cabinets, installed"],
];
