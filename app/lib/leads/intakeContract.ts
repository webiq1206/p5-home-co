/**
 * The optional fields of the lead intake contract (docs/lead-intake-contract.md).
 *
 * The brand sites post to /api/leads/intake from separate codebases, so every
 * field here is optional and read forgivingly: a missing or unrecognised value
 * is dropped, never a reason to refuse the lead. A brand that sends none of
 * these gets exactly the behaviour it had before.
 *
 * Pure on purpose (no database), so tests can run it directly. Server only.
 */

import { createHash } from "node:crypto";

import {
  LEAD_CONTACT_PREFERENCES,
  type LeadContactPreference,
  type LeadFileLink,
  type RequestKind,
} from "./types.ts";

export const MAX_LINKED_FILES = 20;
const MAX_EXTERNAL_ID = 200;

export type SubmissionKind = "initial" | "details";

export type IntakeExtras = {
  submissionKind: SubmissionKind;
  externalId: string | null;
  requestKind: RequestKind | null;
  contactPreference: LeadContactPreference | null;
  bestTime: string | null;
  timeline: string | null;
  files: LeadFileLink[];
  /** File entries dropped because they had no usable https link or name. */
  filesDropped: number;
};

/** What a Step 2 ("add details") post may add to an existing lead. */
export type LeadDetails = {
  projectType: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  timeline: string | null;
  bestTime: string | null;
  contactPreference: LeadContactPreference | null;
  email: string | null;
  note: string | null;
  files: LeadFileLink[];
};

function text(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** First present value among several accepted spellings of one field. */
function pick(body: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") return body[key];
  }
  return undefined;
}

export function submissionKindFrom(value: unknown): SubmissionKind {
  const raw = text(value, 40)?.toLowerCase();
  return raw === "details" || raw === "detail" ? "details" : "initial";
}

export function requestKindFrom(value: unknown): RequestKind | null {
  const raw = text(value, 40)?.toLowerCase();
  if (!raw) return null;
  if (raw === "callback" || raw === "call_back" || raw === "call-back") return "callback";
  if (raw === "quote" || raw === "request") return "quote";
  return null;
}

export function contactPreferenceValue(value: unknown): LeadContactPreference | null {
  const raw = text(value, 40)?.toLowerCase();
  if (!raw) return null;
  if (raw === "phone" || raw === "call me") return "call";
  if (raw === "sms" || raw === "text me") return "text";
  if (raw === "email me") return "email";
  return (LEAD_CONTACT_PREFERENCES as readonly string[]).includes(raw) ? (raw as LeadContactPreference) : null;
}

/** A file name is a label, never a path. */
function fileLabel(value: unknown): string | null {
  const raw = text(value, 400);
  if (!raw) return null;
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = [...base].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim().slice(0, 160);
  return cleaned || null;
}

/** Only absolute https links are kept: they go into an email and HubSpot. */
function fileUrl(value: unknown): string | null {
  const raw = text(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Read `files`: an array of {name, url, contentType, size}. Bad entries are dropped. */
export function readFileLinks(value: unknown): { files: LeadFileLink[]; dropped: number } {
  let list: unknown = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return { files: [], dropped: 1 };
    }
  }
  if (!Array.isArray(list)) return { files: [], dropped: list === undefined || list === null ? 0 : 1 };
  const files: LeadFileLink[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) {
      dropped += 1;
      continue;
    }
    const item = entry as Record<string, unknown>;
    const url = fileUrl(item.url ?? item.href ?? item.link);
    const name = fileLabel(item.name ?? item.fileName ?? item.filename) ?? (url ? fileLabel(new URL(url).pathname) : null);
    if (!url || !name || files.length >= MAX_LINKED_FILES) {
      dropped += 1;
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const size = Number(item.size ?? item.sizeBytes ?? item.size_bytes);
    files.push({
      name,
      url,
      contentType: text(item.contentType ?? item.content_type ?? item.type ?? item.mimeType, 120),
      size: Number.isFinite(size) && size >= 0 ? Math.round(size) : null,
    });
  }
  return { files, dropped };
}

export function readIntakeExtras(body: Record<string, unknown>): IntakeExtras {
  const { files, dropped } = readFileLinks(pick(body, ["files", "fileLinks", "file_links"]));
  return {
    submissionKind: submissionKindFrom(pick(body, ["submission_kind", "submissionKind"])),
    externalId: text(pick(body, ["external_id", "externalId"]), MAX_EXTERNAL_ID),
    requestKind: requestKindFrom(pick(body, ["request_kind", "requestKind", "request_type"])),
    contactPreference: contactPreferenceValue(pick(body, ["contact_preference", "contactPreference", "preferred_contact"])),
    bestTime: text(pick(body, ["best_time", "bestTime"]), 120),
    timeline: text(pick(body, ["timeline", "timing"]), 120),
    files,
    filesDropped: dropped,
  };
}

/** Street address, with a ZIP appended when it was sent separately. */
export function composeAddress(address: unknown, zip: unknown): string | null {
  const street = text(address, 300);
  const postal = text(zip, 20);
  if (!street) return postal;
  if (!postal || street.includes(postal)) return street;
  return `${street}, ${postal}`;
}

export function readLeadDetails(body: Record<string, unknown>, extras: IntakeExtras = readIntakeExtras(body)): LeadDetails {
  const details: LeadDetails = {
    projectType: text(pick(body, ["projectType", "project_type", "project"]), 120),
    propertyAddress: composeAddress(
      pick(body, ["address", "propertyAddress", "street_address"]),
      pick(body, ["zip", "postal_code", "postalCode"]),
    ),
    propertyCity: text(pick(body, ["city", "propertyCity"]), 120),
    timeline: extras.timeline,
    bestTime: extras.bestTime,
    contactPreference: extras.contactPreference,
    email: text(body.email, 200),
    note: text(pick(body, ["summary", "message", "description", "note"])),
    files: extras.files,
  };
  if (details.note && noteOnlyRestatesDetails(details.note, details)) details.note = null;
  return details;
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * The brand sites send their own "Details added" block as the summary of a
 * Step 2 post, which only repeats the fields beside it ("DETAILS ADDED (ref
 * 4316f6cea2de) Address: 123 Main St Timing: Just planning"). Printed as a
 * "Note:" line it doubled every detail in the deal summary and in HubSpot.
 * The note is dropped only when nothing in it is the visitor's own words:
 * after the heading, reference tags and "Label:" prefixes are removed, every
 * remaining word must appear in a field already listed or in a file link.
 */
export function noteOnlyRestatesDetails(note: string, details: LeadDetails): boolean {
  const known = new Set(
    [
      details.projectType,
      details.propertyAddress,
      details.propertyCity,
      details.timeline,
      details.bestTime,
      details.contactPreference ? CONTACT_PREFERENCE_LABELS[details.contactPreference] : null,
      details.contactPreference,
      details.email,
      ...details.files.flatMap((file) => [file.name, file.url]),
    ].flatMap((value) => (value ? words(value) : [])),
  );
  const stripped = note
    .replace(/\((?:ref|reference)\b[^)]*\)/gi, " ")
    .replace(/details added/gi, " ")
    .replace(/\b[A-Za-z][A-Za-z /]{0,30}:/g, " ");
  const left = words(stripped);
  return left.length === 0 || left.every((word) => known.has(word));
}

export function hasAnyDetail(details: LeadDetails): boolean {
  return Boolean(
    details.projectType ||
      details.propertyAddress ||
      details.propertyCity ||
      details.timeline ||
      details.bestTime ||
      details.contactPreference ||
      details.email ||
      details.note ||
      details.files.length,
  );
}

/** "Not sure" style answers do not count as a project type a later answer must respect. */
export function isUnsureProject(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  return !raw || raw.includes("not sure") || raw === "something else" || raw === "other" || raw === "unsure";
}

export const CONTACT_PREFERENCE_LABELS: Record<LeadContactPreference, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
};

/**
 * A callback must read as one in every place the team looks: the deal summary,
 * the new-lead email and the HubSpot description all start "Callback request".
 */
export function composeIntakeSummary(summary: string | null, extras: Pick<IntakeExtras, "requestKind" | "bestTime">): string | null {
  if (extras.requestKind !== "callback") return summary;
  if (summary && /^callback request/i.test(summary.trim())) return summary;
  const head = ["Callback request: call this person back.", extras.bestTime ? `Best time to call: ${extras.bestTime}.` : ""]
    .filter(Boolean)
    .join(" ");
  return summary ? `${head}\n\n${summary}` : head;
}

/** One line per detail, for the summary, the activity log, the email and the HubSpot note. */
export function detailLines(details: LeadDetails): string[] {
  return [
    details.projectType ? `Project: ${details.projectType}` : "",
    details.propertyAddress ? `Address: ${details.propertyAddress}` : "",
    details.propertyCity ? `City: ${details.propertyCity}` : "",
    details.timeline ? `Timing: ${details.timeline}` : "",
    details.bestTime ? `Best time to call: ${details.bestTime}` : "",
    details.contactPreference ? `Preferred contact: ${CONTACT_PREFERENCE_LABELS[details.contactPreference]}` : "",
    details.email ? `Email: ${details.email}` : "",
    details.note ? `Note: ${details.note}` : "",
    ...details.files.map((file) => `File: ${file.name} ${file.url}`),
  ].filter(Boolean);
}

export function detailsBlock(details: LeadDetails, heading = "Details added:"): string {
  return [heading, ...detailLines(details)].join("\n");
}

/**
 * Identity of one details submission. Order of files and letter case do not
 * matter; any change in content makes a new submission.
 */
export function detailsFingerprint(details: LeadDetails): string {
  const canonical = {
    p: details.projectType?.toLowerCase() ?? null,
    a: details.propertyAddress?.toLowerCase() ?? null,
    c: details.propertyCity?.toLowerCase() ?? null,
    t: details.timeline?.toLowerCase() ?? null,
    b: details.bestTime?.toLowerCase() ?? null,
    r: details.contactPreference,
    e: details.email?.toLowerCase() ?? null,
    n: details.note ?? null,
    f: details.files.map((file) => file.url).sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Extra lines for the new-lead email: what kind of request, how to reach them, the files. */
export function intakeNoticeLines(extras: Pick<IntakeExtras, "requestKind" | "contactPreference" | "bestTime" | "timeline" | "files">): string[] {
  return [
    extras.requestKind === "callback" ? "Request: Callback request" : extras.requestKind === "quote" ? "Request: Quote request" : "",
    extras.contactPreference ? `Preferred contact: ${CONTACT_PREFERENCE_LABELS[extras.contactPreference]}` : "",
    extras.bestTime ? `Best time to call: ${extras.bestTime}` : "",
    extras.timeline ? `Timing: ${extras.timeline}` : "",
    ...extras.files.map((file) => `File: ${file.name} ${file.url}`),
  ].filter(Boolean);
}
