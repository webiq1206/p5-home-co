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

/** Database-backed, privacy-preserving fixed-window rate limiter. */
export async function allowIntakeRequest(request: Request, now = new Date()): Promise<boolean> {
  const bucket = Math.floor(now.getTime() / WINDOW_MS);
  const key = await hash(clientAddress(request));
  await queryOne("DELETE FROM lead_intake_rate_limit WHERE expires_at < $1 RETURNING TRUE AS accepted", [now]);
  const row = await queryOne<{ accepted: boolean }>(
    `INSERT INTO lead_intake_rate_limit (client_hash, bucket, count, expires_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (client_hash, bucket) DO UPDATE
       SET count = lead_intake_rate_limit.count + 1
       WHERE lead_intake_rate_limit.count < $4
     RETURNING TRUE AS accepted`,
    [key, bucket, new Date((bucket + 2) * WINDOW_MS), MAX_SUBMISSIONS],
  );
  return row?.accepted === true;
}