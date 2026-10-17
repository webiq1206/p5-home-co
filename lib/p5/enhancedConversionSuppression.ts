import { createHash } from "node:crypto";

import { query } from "./database.ts";

/**
 * Hashed suppression list for Google enhanced conversions.
 *
 * Only SHA-256 hashes are stored. Emails are trimmed and lowercased. Phones
 * are stored only as E.164 +1XXXXXXXXXX when they contain exactly 10 digits.
 * Brand sites that do not opt in never call this module.
 */

export type SuppressionKind = "email" | "phone";

export type SuppressionRecord = {
  kind: SuppressionKind;
  valueHash: string;
};

export type SuppressionContact = {
  email?: string | null;
  phone?: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emailHash(value: string | null | undefined): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email ? sha256(email) : null;
}

function phoneHash(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 10 ? sha256(`+1${digits}`) : null;
}

/** Normalized hashes for the contact fields that can be suppressed. No raw values. */
export function suppressionRecords(contact: SuppressionContact | null | undefined): SuppressionRecord[] {
  if (!contact) return [];
  const records: SuppressionRecord[] = [];
  const email = emailHash(contact.email);
  const phone = phoneHash(contact.phone);
  if (email) records.push({ kind: "email", valueHash: email });
  if (phone) records.push({ kind: "phone", valueHash: phone });
  return records;
}

async function findSuppressionMatch(records: SuppressionRecord[]): Promise<boolean> {
  if (!records.length) return false;
  const values: string[] = [];
  const clauses = records.map((record, index) => {
    values.push(record.kind, record.valueHash);
    return `($${index * 2 + 1}, $${index * 2 + 2})`;
  });
  const rows = await query(
    `SELECT 1 AS matched FROM enhanced_conversion_suppression WHERE (kind, value_hash) IN (${clauses.join(", ")}) LIMIT 1`,
    values,
  );
  return rows.length > 0;
}

/**
 * True when neither the normalized email nor the E.164 phone is suppressed.
 * A lookup failure leaves enhanced conversions allowed, so a missing table
 * does not change the conversion.
 */
export async function allowEnhancedConversions(
  contact: SuppressionContact | null | undefined,
  findMatch: (records: SuppressionRecord[]) => Promise<boolean> = findSuppressionMatch,
): Promise<boolean> {
  const records = suppressionRecords(contact);
  if (!records.length) return true;
  try {
    return !(await findMatch(records));
  } catch {
    return true;
  }
}

/** Hash on insert. The writer receives hashes only. */
export async function insertSuppression(
  contact: SuppressionContact,
  write: (records: SuppressionRecord[]) => Promise<void> = writeSuppression,
): Promise<SuppressionRecord[]> {
  const records = suppressionRecords(contact);
  if (!records.length) return [];
  await write(records);
  return records;
}

async function writeSuppression(records: SuppressionRecord[]): Promise<void> {
  for (const record of records) {
    await query(
      `INSERT INTO enhanced_conversion_suppression (kind, value_hash) VALUES ($1, $2) ON CONFLICT (kind, value_hash) DO NOTHING`,
      [record.kind, record.valueHash],
    );
  }
}

type EstimatorPayload = {
  document?: { customer?: { email?: string; phone?: string } };
  allowEnhancedConversions?: boolean;
};

/** Add the flag to a successful estimator response. Pricing fields are copied through unchanged. */
export async function decorateEstimatorSubmission(
  response: Response,
  enabled = false,
  allow: typeof allowEnhancedConversions = allowEnhancedConversions,
): Promise<Response> {
  if (!enabled) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("json") || !response.ok) return response;
  const copy = response.clone();
  try {
    const payload = (await response.json()) as EstimatorPayload;
    const customer = payload?.document?.customer;
    const allowEnhancedConversionsFlag = await allow({ email: customer?.email, phone: customer?.phone });
    const headers = new Headers(copy.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify({ ...payload, allowEnhancedConversions: allowEnhancedConversionsFlag }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return copy;
  }
}
