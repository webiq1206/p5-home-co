/**
 * The short-lived key a visitor's browser holds after Step 1 of the quote form.
 *
 * It lets that browser, and only for a while, add details and files to the
 * request it just sent, without ever reading anything back. Format:
 * "<dealId>.<expiresAtSeconds>.<HMAC-SHA256(SESSION_SECRET, "lead-request:<dealId>.<expires>")>"
 * in base64url. Nothing is stored: a token is valid when its signature matches
 * and it has not expired.
 *
 * SESSION_SECRET is the secret the intake rate limiter already requires, so a
 * deployment that accepts leads already has it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Long enough to add details and photos on the success screen, short enough to be worthless later. */
export const REQUEST_TOKEN_TTL_SECONDS = 2 * 60 * 60;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required to issue request tokens.");
  return value;
}

function sign(dealId: number, expires: number): string {
  return createHmac("sha256", secret()).update(`lead-request:${dealId}.${expires}`).digest("base64url");
}

export function issueRequestToken(dealId: number, now: Date = new Date()): string {
  if (!Number.isInteger(dealId) || dealId <= 0) throw new Error("A request token needs a saved lead.");
  const expires = Math.floor(now.getTime() / 1000) + REQUEST_TOKEN_TTL_SECONDS;
  return `${dealId}.${expires}.${sign(dealId, expires)}`;
}

export type TokenCheck = { ok: true; dealId: number } | { ok: false; reason: "malformed" | "expired" | "invalid" };

/** Check a token. When `dealId` is given the token must be for that lead. */
export function verifyRequestToken(token: unknown, dealId?: unknown, now: Date = new Date()): TokenCheck {
  if (typeof token !== "string" || token.length > 200) return { ok: false, reason: "malformed" };
  const match = /^(\d{1,15})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return { ok: false, reason: "malformed" };
  const id = Number(match[1]);
  const expires = Number(match[2]);
  if (dealId !== undefined && dealId !== null && dealId !== "" && Number(dealId) !== id) {
    return { ok: false, reason: "invalid" };
  }
  const expected = Buffer.from(sign(id, expires));
  const given = Buffer.from(match[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  if (Math.floor(now.getTime() / 1000) > expires) return { ok: false, reason: "expired" };
  return { ok: true, dealId: id };
}
