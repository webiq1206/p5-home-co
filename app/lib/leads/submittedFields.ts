/**
 * Every field a lead submission carried, as label/value pairs.
 *
 * The intake contract reads a fixed set of fields into the deal, and a brand
 * form (or a Meta Instant Form) can carry more: a budget, a custom question,
 * an answers object. Those used to be dropped. This module keeps all of them,
 * in the order they were sent, so the HubSpot note and the team email show
 * exactly what the person typed. Pure (no database), so tests run it directly.
 */

import { createHash } from "node:crypto";

export type SubmittedField = { label: string; value: string };

/** Honeypots are empty on every accepted lead, and never worth a line. */
const SKIPPED_KEYS = new Set(["website_url", "company_website"]);
const MAX_FIELDS = 200;
const MAX_VALUE = 4000;

/** Readable labels for the contract's own field names and spellings. */
const LABELS: Record<string, string> = {
  brand: "Brand",
  company: "Brand",
  name: "Name",
  fullname: "Name",
  full_name: "Name",
  firstname: "First name",
  first_name: "First name",
  lastname: "Last name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  phone_number: "Phone",
  telephone: "Phone",
  address: "Address",
  propertyaddress: "Address",
  street_address: "Address",
  city: "City",
  propertycity: "City",
  state: "State",
  province: "State",
  zip: "ZIP",
  zip_code: "ZIP",
  postal_code: "ZIP",
  postalcode: "ZIP",
  post_code: "ZIP",
  projecttype: "Project",
  project_type: "Project",
  project: "Project",
  service: "Service",
  summary: "Message",
  message: "Message",
  description: "Message",
  note: "Note",
  timeline: "Timing",
  timing: "Timing",
  budget: "Budget",
  budget_range: "Budget",
  best_time: "Best time to call",
  besttime: "Best time to call",
  contact_preference: "Preferred contact",
  contactpreference: "Preferred contact",
  preferred_contact: "Preferred contact",
  request_kind: "Request",
  requestkind: "Request",
  request_type: "Request",
  submission_kind: "Submission",
  submissionkind: "Submission",
  external_id: "Brand request id",
  externalid: "Brand request id",
  externalleadid: "Source lead id",
  external_lead_id: "Source lead id",
  form: "Form",
  originalform: "Form",
  source: "Source",
  sourcedetail: "Source detail",
  source_detail: "Source detail",
  campaign: "Campaign",
  originalcampaign: "Campaign",
  files: "File",
  filelinks: "File",
  file_links: "File",
  gclid: "Google click id (gclid)",
  gbraid: "Google click id (gbraid)",
  wbraid: "Google click id (wbraid)",
  fbclid: "Meta click id (fbclid)",
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  utm_term: "UTM term",
  utm_content: "UTM content",
  landing_page: "Landing page",
  referrer: "Referrer",
};

/** "budget_range" -> "Budget range", "howSoon" -> "How soon". */
export function humanizeKey(key: string): string {
  const known = LABELS[key.toLowerCase()];
  if (known) return known;
  const first = key.startsWith("first_") ? LABELS[key.slice(6).toLowerCase()] : undefined;
  if (first) return `First touch ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "Field";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function clean(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_VALUE);
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return clean(value) || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

/** A file entry reads as "name url", the same shape the rest of the intake uses. */
function fileLine(entry: Record<string, unknown>): string | null {
  const name = scalar(entry.name ?? entry.fileName ?? entry.filename);
  const url = scalar(entry.url ?? entry.href ?? entry.link);
  if (!name && !url) return null;
  return [name, url].filter(Boolean).join(" ");
}

function flatten(label: string, value: unknown, out: SubmittedField[], depth: number, fileKey: boolean): void {
  if (out.length >= MAX_FIELDS) return;
  const simple = scalar(value);
  if (simple !== null) {
    out.push({ label, value: simple });
    return;
  }
  if (depth > 3 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.every((item) => scalar(item) !== null)) {
      const joined = value.map((item) => scalar(item)!).join(", ");
      if (joined) out.push({ label, value: joined });
      return;
    }
    for (const item of value) {
      if (fileKey && typeof item === "object" && item !== null && !Array.isArray(item)) {
        const line = fileLine(item as Record<string, unknown>);
        if (line) out.push({ label, value: line });
        continue;
      }
      flatten(label, item, out, depth + 1, fileKey);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SKIPPED_KEYS.has(key)) continue;
      flatten(`${label}: ${humanizeKey(key)}`, inner, out, depth + 1, false);
    }
  }
}

/** Every submitted field of a JSON body, in the order sent. Honeypots excluded. */
export function submittedFieldsFromBody(body: Record<string, unknown>): SubmittedField[] {
  const out: SubmittedField[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (SKIPPED_KEYS.has(key)) continue;
    let parsed = value;
    // `files` may arrive as a JSON string; the rest of the intake accepts it.
    if (typeof value === "string" && /^(files|filelinks|file_links)$/i.test(key)) {
      try { parsed = JSON.parse(value); } catch { parsed = value; }
    }
    flatten(humanizeKey(key), parsed, out, 0, /^(files|filelinks|file_links)$/i.test(key));
  }
  return out;
}

/** Identity of one submission: the same fields twice are one submission. */
export function submittedFieldsFingerprint(channel: string, fields: readonly SubmittedField[]): string {
  return createHash("sha256").update(JSON.stringify([channel, fields.map((field) => [field.label, field.value])])).digest("hex");
}

/** What the deal knows about where the lead came from, as label/value pairs. */
export type AttributionInput = {
  source: string | null;
  sourceDetail: string | null;
  originalForm: string | null;
  originalCampaign: string | null;
  externalLeadId: string | null;
  facebookLeadId: string | null;
  utm: Record<string, string> | null;
};

const ATTRIBUTION_ORDER = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "gbraid", "wbraid", "fbclid", "landing_page", "referrer", "service",
  "meta_page_id", "meta_form_id", "meta_form_name", "meta_campaign_id", "meta_campaign_name",
  "meta_adset_id", "meta_adset_name", "meta_ad_id", "meta_ad_name", "meta_platform",
];

const META_LABELS: Record<string, string> = {
  meta_page_id: "Meta page id",
  meta_form_id: "Meta form id",
  meta_form_name: "Meta form",
  meta_campaign_id: "Meta campaign id",
  meta_campaign_name: "Meta campaign",
  meta_adset_id: "Meta ad set id",
  meta_adset_name: "Meta ad set",
  meta_ad_id: "Meta ad id",
  meta_ad_name: "Meta ad",
  meta_platform: "Meta platform",
  meta_is_organic: "Meta organic (not a paid ad)",
};

export function attributionFields(input: AttributionInput): SubmittedField[] {
  const out: SubmittedField[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) out.push({ label, value: value.trim() });
  };
  push("Source", input.source);
  push("Source detail", input.sourceDetail);
  push("Form", input.originalForm);
  push("Campaign", input.originalCampaign);
  push("Source lead id", input.externalLeadId);
  if (input.facebookLeadId && input.facebookLeadId !== input.externalLeadId) push("Meta lead id", input.facebookLeadId);
  const utm = input.utm ?? {};
  const keys = [
    ...ATTRIBUTION_ORDER.filter((key) => key in utm),
    ...Object.keys(utm).filter((key) => !ATTRIBUTION_ORDER.includes(key)).sort(),
  ];
  for (const key of keys) push(META_LABELS[key] ?? humanizeKey(key), utm[key]);
  return out;
}
