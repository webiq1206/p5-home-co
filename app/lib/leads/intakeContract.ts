import {resolveProjectServiceLine,assertProjectServiceSet,type ProjectServiceCode,type ProjectServiceItemId} from "../../../lib/p5/projectServices.ts";
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
  /**
   * Lines a brand site wants in the team email only (its own planning range,
   * the parcel it looked up, a link to its dashboard). Printed in the email
   * under "From the website" and not stored on the lead. The email itself is
   * copied into HubSpot by the inbox sync, so a line that names a cost or a
   * margin is withheld (`readTeamNotes`): those stay out of HubSpot.
   */
  teamNotes: string[];
  /**
   * The brand site's INTERNAL lines: its cost, margin and pricing checks for a
   * planning range. They are printed in the team email under "Internal
   * pricing", and their presence changes the email's subject to "Lead and
   * pricing: ...", which the inbox sync does not copy into HubSpot (only a
   * subject starting "New lead" is copied). Never stored on the lead.
   */
  teamInternalNotes: string[];
  /**
   * The caller waits for the team email and is told whether it went
   * (`alert` in the response). A brand site asks for this so it can skip its
   * own team email, and send it after all when this one did not go.
   */
  confirmAlert: boolean;
  /**
   * `team_alert: "site"`: the calling site says it has already emailed the
   * team about this submission. Honoured only for the document estimator's two
   * forms (`siteSentTeamEmail`), so a malformed post still gets its email.
   */
  siteAlert: boolean;
  /**
   * `request_external_id`: the id of the project request this submission
   * belongs to. The lead that holds it is the lead (one lead per project).
   */
  requestExternalId: string | null;
};

export const MAX_TEAM_NOTES = 40;
export const MAX_TEAM_INTERNAL_NOTES = 60;
export const MAX_TEAM_NOTE_LENGTH = 300;

/**
 * Internal figures that must not reach HubSpot. The "New lead" email is
 * copied there with its whole body (inbox-policy.ts), so a team note that
 * names one of these is withheld here, whatever site sent it.
 */
const INTERNAL_FIGURE = /\b(?:costs?|margins?|mark-?ups?|profits?|contingenc(?:y|ies)|overheads?)\b/i;

/**
 * Plain single lines, capped. Anything that is not a non-empty string is
 * dropped. A line naming a cost or a margin is withheld and counted, so the
 * team can see something was left out and look on the site's own dashboard.
 */
export function readTeamNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const notes: string[] = [];
  let withheld = 0;
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const line = item.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEAM_NOTE_LENGTH);
    if (!line) continue;
    if (INTERNAL_FIGURE.test(line)) { withheld++; continue; }
    if (notes.length < MAX_TEAM_NOTES) notes.push(line);
  }
  if (withheld) notes.push(`Withheld: ${withheld} internal ${withheld === 1 ? "line" : "lines"} (not emailed; see the site's own record)`);
  return notes;
}

/**
 * The site's internal lines (cost, margin, pricing checks). Plain single
 * lines, capped; nothing is withheld, because an email that carries them is
 * sent under a subject the inbox sync never copies into HubSpot.
 */
export function readTeamInternalNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const notes: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const line = item.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEAM_NOTE_LENGTH);
    if (line) notes.push(line);
    if (notes.length >= MAX_TEAM_INTERNAL_NOTES) break;
  }
  return notes;
}

// ---------------------------------------------------------------------------
// `estimate`: a price a website gave the visitor (site estimates into QuickBooks)
// ---------------------------------------------------------------------------

export const SITE_ESTIMATE_KINDS = ["planning-range", "document"] as const;
/** Which tool gave the price: a request form's planning range, or the document estimator. */
export type SiteEstimateKind = (typeof SITE_ESTIMATE_KINDS)[number];

export type SiteEstimateLine = {
  sku?:ProjectServiceCode;
  /** Derived from the SKU on P5; a supplied ID is only a consistency hint. */
  qboItemId?:ProjectServiceItemId;
  title: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  /** What the customer pays for this line, to the cent. Never a cost. */
  amount: number;
  /** A trade, a room or a two-digit division code, as the site names it. */
  division: string | null;
};

/**
 * One price a website showed a visitor, as QuickBooks will hold it: the range
 * they saw and ONE figure (`base`) for the estimate's total. Customer amounts
 * only: nothing here is a cost or a margin, and it must stay that way.
 */
export type SiteEstimate = {
  kind: SiteEstimateKind;
  low: number;
  high: number;
  base: number;
  label: string | null;
  lines: SiteEstimateLine[];
  /** True only when the site recomputed the figures on its own server. */
  verified: boolean;
  /** What was adjusted while reading it (for the audit trail). */
  notes: string[];
};

export const MAX_SITE_ESTIMATE_LINES = 60;
/** No estimate above this is written to the books from a web form, whoever sent it. */
export const SITE_ESTIMATE_CEILING = 5_000_000;
/** Figures that came from the visitor's browser, not the site's server, stop here. */
export const SITE_ESTIMATE_UNVERIFIED_CEILING = 500_000;

const toCents = (value: number) => Math.round(value * 100) / 100;
const wholeDollars = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/** A finite number above zero, from a number or a plain numeric string. Null otherwise. */
function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One trimmed line of text without control characters, capped. Null when empty or not a string. */
function plainText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = [...value].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function siteEstimateKind(value: unknown): SiteEstimateKind | null {
  const raw = plainText(value, 40)?.toLowerCase().replace(/[_\s]+/g, "-");
  if (raw === "planning-range" || raw === "range") return "planning-range";
  if (raw === "document" || raw === "document-estimate") return "document";
  return null;
}

/**
 * Read the `estimate` a submission carries. Forgiving in what it accepts and
 * strict in what it passes on: anything malformed means "no estimate", never
 * a refused lead. `problem` says why an estimate that was sent is not used
 * (null when none was sent), so the reason can go on the lead's audit trail.
 *
 * The total is the lines' total whenever lines are sent. A `base` that
 * disagrees with them by more than a cent is replaced by their sum and noted.
 */
export function readSiteEstimate(raw: unknown): { estimate: SiteEstimate | null; problem: string | null } {
  if (raw === undefined || raw === null || raw === "") return { estimate: null, problem: null };
  const refuse = (problem: string) => ({ estimate: null, problem });
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return refuse("The estimate could not be read.");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse("The estimate could not be read.");
  const body = value as Record<string, unknown>;

  const kind = siteEstimateKind(body.kind);
  if (!kind) return refuse("The estimate does not say which tool it came from.");
  const low = positiveNumber(body.low);
  const high = positiveNumber(body.high);
  if (low === null || high === null) return refuse("The estimate has no usable range.");
  if (low > high) return refuse("The estimate's range is reversed.");

  const notes: string[] = [];
  const lines: SiteEstimateLine[] = [];
  if (body.lines !== undefined && body.lines !== null) {
    if (!Array.isArray(body.lines)) return refuse("The estimate's lines could not be read.");
    if (body.lines.length > MAX_SITE_ESTIMATE_LINES) return refuse(`The estimate has more than ${MAX_SITE_ESTIMATE_LINES} lines.`);
    let empty = 0;
    for (const entry of body.lines) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return refuse("An estimate line could not be read.");
      const item = entry as Record<string, unknown>;
      let service:ReturnType<typeof resolveProjectServiceLine>;
      try{service=resolveProjectServiceLine(item);}
      catch(error){return refuse(error instanceof Error?error.message:"Invalid project-service line.");}
      // A line priced at nothing adds nothing to the total: it is left out, not fatal.
      if (item.amount === 0 || item.amount === "0") {
        empty++;
        continue;
      }
      const amount = positiveNumber(item.amount);
      if (amount === null) return refuse("An estimate line has no usable amount.");
      const description = plainText(item.description, 1000);
      const title = plainText(item.title, 200) ?? description?.slice(0, 200) ?? null;
      if (!title) return refuse("An estimate line has no title.");
      const rounded = toCents(amount);
      if (rounded <= 0) {
        empty++;
        continue;
      }
      lines.push({
        ...(service?{sku:service.sku,qboItemId:service.qboItemId}:{}),
        title,
        description: description && description !== title ? description : null,
        quantity: service?service.quantity:positiveNumber(item.quantity),
        unit: service?service.unit:plainText(item.unit, 20),
        amount: rounded,
        division: plainText(item.division, 80),
      });
    }
    if (empty) notes.push(`${empty} ${empty === 1 ? "line" : "lines"} with no amount left out`);
  }
  try{assertProjectServiceSet(lines);}catch(error){return refuse(error instanceof Error?error.message:"Invalid project-service set.");}

  const baseSent = body.base !== undefined && body.base !== null && body.base !== "";
  const stated = baseSent ? positiveNumber(body.base) : null;
  if (baseSent && stated === null) return refuse("The estimate's total could not be read.");
  let base: number;
  if (lines.length) {
    base = toCents(lines.reduce((sum, line) => sum + line.amount, 0));
    if (stated !== null && Math.abs(toCents(stated) - base) > 0.01) {
      notes.push(`The total sent (${wholeDollars(stated)}) did not equal the lines (${wholeDollars(base)}); the lines were kept`);
    }
  } else {
    base = toCents(stated ?? (low + high) / 2);
  }
  if (!(base > 0)) return refuse("The estimate has no usable total.");

  const verified = body.verified === true;
  if (base > SITE_ESTIMATE_CEILING) {
    return refuse(`The estimate's total (${wholeDollars(base)}) is above the ${wholeDollars(SITE_ESTIMATE_CEILING)} ceiling for an estimate from a web form.`);
  }
  if (!verified && base > SITE_ESTIMATE_UNVERIFIED_CEILING) {
    return refuse(
      `The estimate's total (${wholeDollars(base)}) was not verified by the site's server and is above the ${wholeDollars(SITE_ESTIMATE_UNVERIFIED_CEILING)} ceiling for unverified figures.`,
    );
  }
  // A total nowhere near the range the customer was shown is not that estimate.
  if (base < low / 2 || base > high * 2) {
    return refuse(`The estimate's total (${wholeDollars(base)}) does not belong to its range (${wholeDollars(low)} to ${wholeDollars(high)}).`);
  }

  return {
    estimate: { kind, low: toCents(low), high: toCents(high), base, label: plainText(body.label, 200), lines, verified, notes },
    problem: null,
  };
}

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
    teamNotes: readTeamNotes(pick(body, ["team_notes", "teamNotes"])),
    teamInternalNotes: readTeamInternalNotes(pick(body, ["team_internal_notes", "teamInternalNotes"])),
    confirmAlert: pick(body, ["team_alert", "teamAlert"]) === "confirm",
    siteAlert: pick(body, ["team_alert", "teamAlert"]) === "site",
    requestExternalId: text(pick(body, ["request_external_id", "requestExternalId"]), MAX_EXTERNAL_ID),
  };
}

/** The form a published document estimate is filed under (lib/p5/p5LeadIntake.ts). */
export const DOCUMENT_ESTIMATE_FORM = "p5-estimator";
/** The form a visitor's unpriced project request from the document estimator is filed under. */
export const PROJECT_REQUEST_FORM = "p5-project-request";

/**
 * Has the calling site already emailed the team about this submission, so
 * that none is sent from here? (`team_alert: "site"`; owner, 17 and 18
 * November 2026: one team email, not two.) True only for the document
 * estimator, whose own delivery emails the team before it posts here:
 *
 *   - a published estimate: form `p5-estimator` AND a readable `estimate` of
 *     kind `document` (the site emailed its internal estimate record);
 *   - a visitor's project request: form `p5-project-request` (the site's team
 *     channel emailed the whole request with its files).
 *
 * Anything else that says "site" is not believed and the email goes as
 * usual: a lead must never end with no team email because of a malformed
 * post. The intake has no caller authentication, so this is the site's word.
 * All it can do is withhold an email: the lead is still saved, still reaches
 * HubSpot's first stage, and an estimate is still held to its ceilings.
 */
export function siteSentTeamEmail(
  form: unknown,
  extras: Pick<IntakeExtras, "siteAlert">,
  site: { estimate: Pick<SiteEstimate, "kind"> | null },
): boolean {
  if (!extras.siteAlert) return false;
  const name = typeof form === "string" ? form.trim() : "";
  if (name === PROJECT_REQUEST_FORM) return true;
  return name === DOCUMENT_ESTIMATE_FORM && site.estimate?.kind === "document";
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
