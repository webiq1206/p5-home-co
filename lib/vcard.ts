import {
  PUBLIC_EMAIL,
  PUBLIC_PHONE_DISPLAY,
  PUBLIC_REPRESENTATIVE,
  SCHEMA_LEGAL_NAME,
  CONTRACTOR_REGISTRATION,
} from "@/app/publicIdentity";
import { ESTIMATOR_BRAND } from "@/lib/p5/brand";

/** Escape special characters per vCard 3.0 (RFC 2426). */
function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatTelE164(tel: string): string {
  const digits = tel.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return tel;
}

const textEncoder = new TextEncoder();

function octetLength(value: string): number {
  return textEncoder.encode(value).length;
}

/** Fold one logical line so every physical line is at most 75 octets. */
function foldLine(line: string, max = 75): string {
  if (octetLength(line) <= max) return line;
  const parts: string[] = [];
  let remaining = line;
  let budget = max;
  while (octetLength(remaining) > budget) {
    let take = 0;
    let used = 0;
    for (const char of remaining) {
      const size = octetLength(char);
      if (used + size > budget) break;
      used += size;
      take += char.length;
    }
    if (take === 0) break;
    parts.push(remaining.slice(0, take));
    remaining = remaining.slice(take);
    budget = max - 1;
  }
  if (remaining) parts.push(remaining);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

/** Build a vCard 3.0 payload from brand constants (Phase 11). */
export function buildBusinessVCard(): string {
  const tel = formatTelE164(PUBLIC_PHONE_DISPLAY);
  const note = [
    "The parent company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co.",
    `A P5 Home Co company (${SCHEMA_LEGAL_NAME}, Idaho Registered Contractor #${CONTRACTOR_REGISTRATION}).`,
    "Serving Boise and the Treasure Valley. Meridian, ID 83646.",
  ].join(" ");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    foldLine(`N:Perkins;Nick;;;`),
    foldLine(`FN:${escapeVCard(PUBLIC_REPRESENTATIVE)}`),
    foldLine(`ORG:${escapeVCard(ESTIMATOR_BRAND.name)}`),
    foldLine("TITLE:Founder"),
    foldLine(`TEL;TYPE=WORK,VOICE:${tel}`),
    foldLine(`EMAIL;TYPE=WORK:${escapeVCard(PUBLIC_EMAIL)}`),
    foldLine(`URL:https://${ESTIMATOR_BRAND.domain}`),
    foldLine("ADR;TYPE=WORK:;;;Meridian;ID;83646;USA"),
    foldLine(`NOTE:${escapeVCard(note)}`),
    "END:VCARD",
  ];

  return `${lines.join("\r\n")}\r\n`;
}

export const BUSINESS_VCARD_PATH = "/contact.vcf";
export const BUSINESS_VCARD_FILENAME = "p5-home-co.vcf";
