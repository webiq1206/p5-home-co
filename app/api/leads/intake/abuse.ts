import { queryOne } from "../../../lib/db.ts";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS = 5;

export function clientAddress(request: Request): string {
  // Replit's trusted edge appends the actual peer address. Reading the
  // rightmost value prevents a caller-supplied leftmost value bypassing limits.
  return request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

async function hash(value: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for intake rate limiting.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Follow-ups to a lead already captured (Step 2 details, file uploads) count
 * in their own window, so adding photos never uses up the allowance for new
 * requests, and new requests never block adding details to one.
 */
export const FOLLOW_UP_SCOPE = { name: "follow-up", max: 40 } as const;

/**
 * Database-backed, privacy-preserving fixed-window counter. Keys are HMACs, so
 * neither an address nor a phone number is stored in the clear.
 */
async function take(key: string, max: number, now: Date): Promise<boolean> {
  const bucket = Math.floor(now.getTime() / WINDOW_MS);
  await queryOne("DELETE FROM lead_intake_rate_limit WHERE expires_at < $1 RETURNING TRUE AS accepted", [now]);
  const row = await queryOne<{ accepted: boolean }>(
    `INSERT INTO lead_intake_rate_limit (client_hash, bucket, count, expires_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (client_hash, bucket) DO UPDATE
       SET count = lead_intake_rate_limit.count + 1
       WHERE lead_intake_rate_limit.count < $4
     RETURNING TRUE AS accepted`,
    [await hash(key), bucket, new Date((bucket + 2) * WINDOW_MS), max],
  );
  return row?.accepted === true;
}

/**
 * Per connecting address. Used by P5's own short-request routes, which the
 * visitor's browser calls directly, so the address is the visitor's.
 */
export async function allowIntakeRequest(
  request: Request,
  now = new Date(),
  scope: { name: string; max: number } | null = null,
): Promise<boolean> {
  const address = clientAddress(request);
  return take(scope ? `${scope.name}:${address}` : address, scope ? scope.max : MAX_SUBMISSIONS, now);
}

/**
 * /api/leads/intake limits. A brand server forwards EVERY visitor's lead from
 * its own address, so an address-only limit refused real leads in a busy
 * hour. Limits are therefore keyed on the lead itself, with a generous
 * per-address ceiling kept only as a spam backstop:
 *
 * - a new request: 5 per hour per brand + person (normalised phone, else
 *   email), so one person or one forged identity cannot flood a brand;
 * - a Step 2 post: 20 per hour per brand + external_id;
 * - every post: a ceiling per connecting address AND brand (120 new, 240
 *   Step 2 per hour), so a brand's forwards are counted apart from P5's own
 *   browser posts and from the other brands, and the log names the brand and
 *   sourceDetail when a ceiling is met.
 */
export const INTAKE_LIMITS = {
  identity: MAX_SUBMISSIONS,
  addressCeiling: 120,
  detailsPerRequest: 20,
  detailsAddressCeiling: 240,
} as const;

/** Phone digits (US country code dropped), else a lowercased email, else null. */
export function leadIdentity(phone: string | null, email: string | null): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length >= 7) return `tel:${digits}`;
  const mail = (email ?? "").trim().toLowerCase();
  return mail.includes("@") ? `mail:${mail}` : null;
}

export type IntakeLimitVerdict = { ok: true } | { ok: false; reason: "identity" | "address" };

export async function allowLeadIntake(
  request: Request,
  lead:
    | { kind: "new"; brand: string; phone: string | null; email: string | null }
    | { kind: "details"; brand: string; externalId: string },
  now = new Date(),
): Promise<IntakeLimitVerdict> {
  const address = clientAddress(request);
  if (lead.kind === "details") {
    if (!(await take(`details-ceiling:${lead.brand}:${address}`, INTAKE_LIMITS.detailsAddressCeiling, now))) {
      return { ok: false, reason: "address" };
    }
    return (await take(`details:${lead.brand}:${lead.externalId}`, INTAKE_LIMITS.detailsPerRequest, now))
      ? { ok: true }
      : { ok: false, reason: "identity" };
  }
  if (!(await take(`ceiling:${lead.brand}:${address}`, INTAKE_LIMITS.addressCeiling, now))) {
    return { ok: false, reason: "address" };
  }
  // No phone or email: the lead cannot be told apart from another, so it
  // falls back to the address (ingestLead refuses most of these anyway).
  const identity = leadIdentity(lead.phone, lead.email) ?? `address:${address}`;
  return (await take(`identity:${lead.brand}:${identity}`, INTAKE_LIMITS.identity, now))
    ? { ok: true }
    : { ok: false, reason: "identity" };
}
