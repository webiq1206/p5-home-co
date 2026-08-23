/**
 * AES-256-GCM encryption for QuickBooks OAuth tokens at rest (S171, S201).
 *
 * Key comes from QBO_TOKEN_KEY: 32 bytes, base64. Generate one with
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Ciphertext format: base64url(iv || authTag || ciphertext). A fresh random IV
 * per encryption; GCM authenticates so tampered rows fail closed on decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.QBO_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "QBO_TOKEN_KEY is not set. Generate 32 random bytes (base64) and add it to the environment.",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("QBO_TOKEN_KEY must decode to exactly 32 bytes.");
  }
  return buf;
}

export function isTokenKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function decryptSecret(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
