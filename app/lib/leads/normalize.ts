/**
 * Normalization and duplicate detection.
 *
 * Duplicate contacts, deals, tasks, and notifications are the failure mode that
 * makes a lead system untrustworthy, so identity is computed here once and
 * reused everywhere. Every comparison runs on normalized values, never on raw
 * user input.
 */

import type { Brand, InboundLead } from "./types.ts";

/** Lowercase and trim an email. Returns null when it cannot be an address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  // Deliberately permissive: one @, no spaces, a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Normalize a North American phone number to E.164 (+1XXXXXXXXXX).
 *
 * Returns null for anything that cannot be a dialable NANP number, so a
 * malformed value never becomes a silent duplicate-matching key.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Preserve an explicit non-US country code rather than mangling it.
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  // NANP: area code and exchange both start 2-9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;

  return `+1${national}`;
}

/** Format an E.164 US number for display: +12084771169 -> (208) 477-1169. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}

/** Collapse whitespace and trim. Returns null for empty input. */
export function normalizeText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, " ").trim();
  return text || null;
}

/** Normalize a street address for comparison only, never for display. */
export function addressKey(raw: string | null | undefined): string | null {
  const text = normalizeText(raw);
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(north|n)\b/g, "n")
    .replace(/\b(south|s)\b/g, "s")
    .replace(/\b(east|e)\b/g, "e")
    .replace(/\b(west|w)\b/g, "w")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The key that identifies a *person*.
 *
 * Email wins when present because it is the more stable identifier; phone is
 * the fallback. Returns null when we have neither, which means the lead cannot
 * be safely deduplicated and must go to the review queue rather than silently
 * creating a new contact.
 */
export function contactIdentityKey(lead: {
  email: string | null;
  phone: string | null;
}): string | null {
  const email = normalizeEmail(lead.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(lead.phone);
  if (phone) return `phone:${phone}`;
  return null;
}

/**
 * The key that identifies a specific *opportunity*.
 *
 * One person may legitimately have several open deals across brands, so brand
 * is part of the key. Property address distinguishes two projects for the same
 * person and brand at different addresses.
 */
export function dealIdentityKey(lead: {
  email: string | null;
  phone: string | null;
  brand: Brand;
  projectType: string | null;
  propertyAddress: string | null;
}): string | null {
  const contact = contactIdentityKey(lead);
  if (!contact) return null;

  const parts = [contact, lead.brand.toLowerCase()];
  const address = addressKey(lead.propertyAddress);
  if (address) parts.push(`addr:${address}`);
  const project = normalizeText(lead.projectType);
  if (project) parts.push(`type:${project.toLowerCase()}`);

  return parts.join("|");
}

/**
 * Window within which an identical submission is treated as an accidental
 * resubmit (double-clicked form, retried webhook) rather than a new project.
 */
export const RESUBMIT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Whether an incoming lead should be treated as a duplicate of an existing one.
 *
 * `externalLeadId` is authoritative when both sides have one: Facebook and
 * webhook retries carry a stable id, and honoring it makes intake idempotent.
 */
export function isDuplicateSubmission(
  incoming: { externalLeadId: string | null; dealKey: string | null; receivedAt: Date },
  existing: { externalLeadId: string | null; dealKey: string | null; receivedAt: Date },
): boolean {
  if (incoming.externalLeadId && existing.externalLeadId) {
    return incoming.externalLeadId === existing.externalLeadId;
  }
  if (!incoming.dealKey || !existing.dealKey) return false;
  if (incoming.dealKey !== existing.dealKey) return false;

  const delta = Math.abs(incoming.receivedAt.getTime() - existing.receivedAt.getTime());
  return delta <= RESUBMIT_WINDOW_MS;
}

/** Problems that make a submission unusable as a lead. */
export type ValidationError = { field: string; message: string };

/**
 * Validate an inbound lead.
 *
 * A lead with no reachable contact method is rejected rather than stored as an
 * unreachable record, because the system's core promise is a timely human
 * response and there is nothing to respond to.
 */
export function validateInboundLead(lead: InboundLead): ValidationError[] {
  const errors: ValidationError[] = [];

  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);

  if (!email && !phone) {
    errors.push({
      field: "contact",
      message: "Enter an email address or a phone number so we can respond.",
    });
  }
  if (lead.email && !email) {
    errors.push({ field: "email", message: "That email address does not look right." });
  }
  if (lead.phone && !phone) {
    errors.push({ field: "phone", message: "That phone number does not look right." });
  }
  if (!normalizeText(lead.firstName) && !normalizeText(lead.lastName)) {
    errors.push({ field: "name", message: "Enter a name." });
  }

  return errors;
}

/** Deal name: "Last Name | Brand | Project Type | City". */
export function dealName(lead: {
  firstName: string | null;
  lastName: string | null;
  brand: Brand;
  projectType: string | null;
  propertyCity: string | null;
}): string {
  const last = normalizeText(lead.lastName) ?? normalizeText(lead.firstName) ?? "Unknown";
  const parts = [last, lead.brand];
  const project = normalizeText(lead.projectType);
  if (project) parts.push(project);
  const city = normalizeText(lead.propertyCity);
  if (city) parts.push(city);
  return parts.join(" | ");
}
