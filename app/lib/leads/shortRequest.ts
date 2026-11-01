/**
 * The two shapes of the short quote form, checked the same way by the browser
 * and by /api/leads/short-request.
 *
 * - A request: name, phone and a note about the work. Photos, email, how to
 *   reach them and the type of project are optional.
 * - A callback ("Have us call you"): name and phone, plus an optional best
 *   time to call. It travels the same lead pipeline, marked as a callback in
 *   the deal summary so the team sees it at a glance.
 *
 * Email is optional in both because the lead pipeline accepts a phone alone
 * (validateInboundLead needs an email or a phone, and the phone is required
 * here). It becomes required only when the visitor asks to be emailed.
 *
 * Pure on purpose: no React, no database, so tests can run it directly.
 */

import { normalizeEmail, normalizePhone } from "./normalize.ts";

export const CONTACT_PREFERENCES = [
  { value: "call", label: "Call me" },
  { value: "text", label: "Text me" },
  { value: "email", label: "Email me" },
] as const;

export type ContactPreference = (typeof CONTACT_PREFERENCES)[number]["value"];

/** The value the form sends as request_type when the visitor asks for a call. */
export const CALLBACK_REQUEST = "callback";

export type ShortRequestKind = "request" | "callback";

export type ShortRequestValues = {
  kind: ShortRequestKind;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
  project: string | null;
  contactPreference: ContactPreference;
  bestTime: string | null;
};

export type ShortRequestField = "name" | "phone" | "email" | "note";

export type ShortRequestCheck =
  | { ok: true; value: ShortRequestValues }
  | { ok: false; field: ShortRequestField; error: string };

/** Server messages. The route tests pin the email and note wording. */
export const SHORT_REQUEST_ERRORS = {
  name: "Enter a name.",
  phone: "Enter a phone number so we can respond.",
  emailMissing: "Enter an email address so we can reply by email.",
  emailInvalid: "That email address does not look right.",
  note: "Add a short note about the project.",
} as const;

function text(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function contactPreferenceFrom(value: unknown): ContactPreference {
  return CONTACT_PREFERENCES.some((option) => option.value === value) ? (value as ContactPreference) : "call";
}

export function contactPreferenceLabel(value: ContactPreference): string {
  return CONTACT_PREFERENCES.find((option) => option.value === value)?.label ?? "Call me";
}

/**
 * Read and check a submission. `get` is FormData.get or any lookup with the
 * same field names: name, phone, email, note, project, request_type,
 * contact_preference, best_time.
 */
export function readShortRequest(get: (key: string) => unknown): ShortRequestCheck {
  const kind: ShortRequestKind = text(get("request_type")) === CALLBACK_REQUEST ? "callback" : "request";
  const name = text(get("name"), 120);
  const phone = text(get("phone"), 30);
  const email = text(get("email"), 200);
  const note = text(get("note"));
  const project = text(get("project"), 120);
  // A callback is a request to be called, whatever the radio said.
  const contactPreference = kind === "callback" ? "call" : contactPreferenceFrom(text(get("contact_preference")));
  const bestTime = kind === "callback" ? text(get("best_time"), 120) : null;

  if (!name) return { ok: false, field: "name", error: SHORT_REQUEST_ERRORS.name };
  if (!phone || !normalizePhone(phone)) return { ok: false, field: "phone", error: SHORT_REQUEST_ERRORS.phone };
  if (email && !normalizeEmail(email)) return { ok: false, field: "email", error: SHORT_REQUEST_ERRORS.emailInvalid };
  if (!email && contactPreference === "email") return { ok: false, field: "email", error: SHORT_REQUEST_ERRORS.emailMissing };
  if (kind === "request" && !note) return { ok: false, field: "note", error: SHORT_REQUEST_ERRORS.note };

  return {
    ok: true,
    value: {
      kind,
      name,
      phone,
      email,
      note,
      project,
      contactPreference,
      bestTime,
    },
  };
}

/**
 * The deal summary the team reads in the admin view and the new-lead email.
 * A callback opens with "Callback request" so it cannot be mistaken for a
 * request that is missing its note.
 */
export function shortRequestSummary(value: ShortRequestValues, fileNames: readonly string[] = []): string {
  if (value.kind === "callback") {
    return [
      "Callback request: call this person back.",
      value.bestTime ? `Best time to call: ${value.bestTime}.` : "",
      value.project ? `Project: ${value.project}.` : "",
      value.note ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    value.project ? `Project: ${value.project}.` : "",
    `Preferred contact: ${contactPreferenceLabel(value.contactPreference)}.`,
    value.note ?? "",
    fileNames.length ? `Files: ${fileNames.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Step 2 timing chips, in the words the visitor picks. */
export const TIMING_OPTIONS = ["Soon", "1 to 3 months", "3 to 6 months", "Just planning"] as const;

export type ShortRequestDetails = {
  project: string | null;
  address: string | null;
  timing: string | null;
  bestTime: string | null;
  email: string | null;
};

export type ShortRequestDetailsCheck =
  | { ok: true; value: ShortRequestDetails }
  | { ok: false; field: "email" | "details"; error: string };

export const SHORT_REQUEST_DETAILS_ERRORS = {
  empty: "Add at least one detail, or skip this step.",
  email: SHORT_REQUEST_ERRORS.emailInvalid,
} as const;

/**
 * Read Step 2 ("Help us prepare"). Every field is optional and nothing here
 * can overwrite a Step 1 answer: the merge fills only what is empty. A project
 * or timing outside the lists is dropped rather than refused.
 */
export function readShortRequestDetails(
  get: (key: string) => unknown,
  knownProjects: readonly string[],
): ShortRequestDetailsCheck {
  const projectRaw = text(get("project"), 120);
  const timingRaw = text(get("timing"), 40);
  const email = text(get("email"), 200);
  const value: ShortRequestDetails = {
    project: projectRaw && knownProjects.includes(projectRaw) ? projectRaw : null,
    address: text(get("address"), 300),
    timing: timingRaw && (TIMING_OPTIONS as readonly string[]).includes(timingRaw) ? timingRaw : null,
    bestTime: text(get("best_time"), 120),
    email,
  };
  if (email && !normalizeEmail(email)) return { ok: false, field: "email", error: SHORT_REQUEST_DETAILS_ERRORS.email };
  if (!value.project && !value.address && !value.timing && !value.bestTime && !value.email) {
    return { ok: false, field: "details", error: SHORT_REQUEST_DETAILS_ERRORS.empty };
  }
  return { ok: true, value };
}
