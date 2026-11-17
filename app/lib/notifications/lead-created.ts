/**
 * One-shot team notice when a public form or a Meta Instant Form creates a lead.
 *
 * Intake, the short request and the Meta webhook call this after a created
 * deal. The path is independent of P5_LEAD_ALERT_EMAILS_ENABLED. That flag
 * only gates the SLA escalation dispatcher. A send failure is logged and must
 * not change the HTTP status.
 *
 * The email is built to be acted on from a phone: a big tap-to-call button,
 * text and email links, the address with a maps link, every submitted field,
 * where the lead came from, and links to the HubSpot contact, the HubSpot deal
 * and the P5 admin. The plain-text part keeps exactly one "Name:", "Email:"
 * and "Phone:" line at the start of a line, because the inbox sync reads a
 * "New lead" email by those lines (inbox-policy.ts) and refuses ambiguity.
 */

import { phoneHref } from "../../../lib/p5/phoneHref.ts";
import { PUBLIC_EMAIL } from "../../publicIdentity.ts";
import { SYNTHETIC_ESTIMATOR_FORM } from "../leads/synthetic-qa.ts";
import { activeTransport, type Transport } from "./transport.ts";

/** HubSpot portal 247066159 (hello@p5homeco.com), app-na2. */
export const HUBSPOT_APP = "https://app-na2.hubspot.com";
export const HUBSPOT_PORTAL = "247066159";

export function hubspotContactUrl(id: string): string {
  return `${HUBSPOT_APP}/contacts/${HUBSPOT_PORTAL}/record/0-1/${encodeURIComponent(id)}`;
}
export function hubspotDealUrl(id: string): string {
  return `${HUBSPOT_APP}/contacts/${HUBSPOT_PORTAL}/record/0-3/${encodeURIComponent(id)}`;
}

type Field = { label: string; value: string };

export type LeadCreatedNotifyInput = {
  testLead?: boolean;
  dealId: number;
  brand: string;
  projectType: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  propertyCity: string | null;
  propertyAddress: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
  summary: string | null;
  source: string | null;
  originalForm: string | null;
  /** Request kind, contact preference, best time and file links, when sent. */
  extraLines?: readonly string[];
  /**
   * Lines the brand site sent for the team only (its planning range, the
   * parcel it looked up, its dashboard link). Shown under "From the website".
   */
  teamNotes?: readonly string[];
  /**
   * The brand site's internal lines: cost, margin, pricing checks. When any
   * are present the subject is "Lead and pricing: ..." instead of "New lead:
   * ...", so the inbox sync does not copy this email into HubSpot.
   */
  internalNotes?: readonly string[];
  /** Every field the submission carried, in the order sent. */
  submittedFields?: readonly Field[];
  /** Source, campaign, click ids, landing page, Meta form and ad ids. */
  attribution?: readonly Field[];
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  /**
   * Runs first, when given: waits (bounded) for the inline HubSpot sync and
   * reads the saved lead back, so the email carries the HubSpot links.
   */
  prepare?: () => Promise<LeadCreatedNotifyInput>;
};

export type LeadCreatedNotifyOptions = {
  transport?: Transport;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function adminDealUrl(dealId: number): string {
  const base = (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
  return `${base}/admin/lead/${dealId}`;
}

function fullAddress(input: LeadCreatedNotifyInput): string {
  const street = input.propertyAddress?.trim() ?? "";
  const tail = [input.propertyCity, input.propertyState].map((part) => part?.trim()).filter(Boolean).join(", ");
  const zip = input.propertyZip?.trim() && !street.includes(input.propertyZip.trim()) ? input.propertyZip.trim() : "";
  return [street, [tail, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * The subject's first words decide whether the inbox sync copies the email
 * into HubSpot: "New lead" is copied, anything else from our own address to
 * our own inbox is ignored (inbox-policy.ts). An email that carries internal
 * pricing must not be copied, so it does not start with "New lead".
 */
export const LEAD_SUBJECT = "New lead";
export const LEAD_WITH_PRICING_SUBJECT = "Lead and pricing";

/** "New lead: Boise ADU Co | Detached ADU | Ada Lovelace | Boise". Blank parts are left out. */
export function leadAlertSubject(input: LeadCreatedNotifyInput): string {
  const name = oneLine([input.firstName, input.lastName].filter(Boolean).join(" ")) || "Unnamed contact";
  const parts = [oneLine(input.brand) || "P5 Home Co", oneLine(input.projectType ?? ""), name, oneLine(input.propertyCity ?? "")];
  const lead = input.internalNotes?.length ? LEAD_WITH_PRICING_SUBJECT : LEAD_SUBJECT;
  return `${input.testLead ? "TEST LEAD — " : ""}${lead}: ${parts.filter(Boolean).join(" | ")}`.slice(0, 250);
}

export type LeadAlertMessage = { subject: string; text: string; html: string };

export function renderLeadAlert(input: LeadCreatedNotifyInput): LeadAlertMessage {
  const name = oneLine([input.firstName, input.lastName].filter(Boolean).join(" ")) || "Unnamed contact";
  const brand = oneLine(input.brand) || "P5 Home Co";
  const subject = leadAlertSubject(input);
  const phone = input.phone ? oneLine(input.phone) : "";
  const email = input.email ? oneLine(input.email) : "";
  const tel = phone ? phoneHref(phone, "tel") : "";
  const sms = phone ? phoneHref(phone, "sms") : "";
  const address = fullAddress(input);
  const maps = address ? mapsUrl(address) : "";
  const admin = adminDealUrl(input.dealId);
  const contactUrl = input.hubspotContactId ? hubspotContactUrl(input.hubspotContactId) : "";
  const dealUrl = input.hubspotDealId ? hubspotDealUrl(input.hubspotDealId) : "";
  const fields = input.submittedFields ?? [];
  const attribution = input.attribution?.length
    ? input.attribution
    : [input.source ? { label: "Source", value: input.source } : null, input.originalForm ? { label: "Form", value: input.originalForm } : null]
        .filter((field): field is Field => Boolean(field));

  // Plain text. Field lines are indented so a submitted value can never pose
  // as the one "Name:", "Email:" or "Phone:" line the inbox sync reads.
  const text = [
    `New lead for ${brand}`,
    "",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    `Brand: ${input.brand}`,
    `Project: ${input.projectType ?? "(not specified)"}`,
    `City: ${input.propertyCity ?? ""}`,
    `Address: ${input.propertyAddress ?? ""}`,
    `Source: ${input.source ?? ""}`,
    `Deal id: ${input.dealId}`,
    ...(input.extraLines ?? []).map(oneLine),
    "",
    tel ? `Call: ${tel}` : "",
    sms ? `Text: ${sms}` : "",
    maps ? `Map: ${maps}` : "",
    "",
    input.summary ?? "",
    "",
    input.teamNotes?.length ? "From the website:" : "",
    ...(input.teamNotes ?? []).map((line) => `  ${oneLine(line)}`),
    "",
    input.internalNotes?.length ? "Internal pricing (this email is not copied into HubSpot):" : "",
    ...(input.internalNotes ?? []).map((line) => `  ${oneLine(line)}`),
    "",
    fields.length ? "Everything submitted:" : "",
    ...fields.map((field) => `  ${oneLine(field.label)}: ${oneLine(field.value)}`),
    "",
    attribution.length ? "Source and attribution:" : "",
    ...attribution.map((field) => `  ${oneLine(field.label)}: ${oneLine(field.value)}`),
    "",
    contactUrl ? `HubSpot contact: ${contactUrl}` : "HubSpot contact: syncing (the watchdog retries)",
    dealUrl ? `HubSpot deal: ${dealUrl}` : "",
    "Open the admin deals view to follow up.",
    admin,
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");

  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(href)}" style="display:block;margin:0 0 10px;padding:16px 18px;text-align:center;font-size:${primary ? 20 : 16}px;font-weight:700;text-decoration:none;${primary ? "background:#383837;color:#fbfaf6;border-bottom:4px solid #b08a5a" : "background:#fbfaf6;color:#20231f;border:1px solid rgba(32,35,31,.3)"}">${escapeHtml(label)}</a>`;
  const row = (label: string, value: string, href?: string) =>
    `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;color:#4a4f49;font-size:13px;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;color:#20231f;overflow-wrap:anywhere;word-break:break-word">${href ? `<a href="${escapeHtml(href)}" style="color:#20231f">${escapeHtml(value)}</a>` : escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`;
  const linked = (value: string) => (/^https:\/\/\S+$/.test(value) ? value : undefined);
  const fileRow = (field: Field) => {
    const match = /^(.*) (https:\/\/\S+)$/.exec(field.value);
    return match ? row(field.label, match[1], match[2]) : row(field.label, field.value, linked(field.value));
  };
  // "Label: value" lines become a labelled row; anything else is a "Detail".
  const labelled = (line: string): Field => {
    const at = line.indexOf(": ");
    return at > 0 && at <= 40 ? { label: line.slice(0, at), value: line.slice(at + 2) } : { label: "Detail", value: line };
  };
  const table = (items: readonly Field[]) =>
    `<table role="presentation" style="width:100%;border-collapse:collapse">${items.map(fileRow).join("")}</table>`;
  const section = (title: string, body: string) =>
    `<h2 style="margin:26px 0 10px;padding-top:16px;border-top:1px solid rgba(32,35,31,.15);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#4a4f49">${escapeHtml(title)}</h2>${body}`;
  // The same layout as the team estimate email (owner, 17 November 2026):
  // one filled Call button, Text and Email beside each other, then the
  // records grouped by the system they live in, never a stack of buttons.
  const EDGE = "rgba(32,35,31,.35)";
  const action = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="display:block;padding:14px 6px;text-align:center;font-size:17px;font-weight:700;line-height:1.2;text-decoration:none;background:#fbfaf6;color:#20231f;border:2px solid #383837">${escapeHtml(label)}</a>`;
  const tile = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="display:block;padding:13px 6px;text-align:center;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;background:#fbfaf6;color:#20231f;border:1px solid ${EDGE}">${escapeHtml(label)}</a>`;
  const waiting = (label: string) =>
    `<span style="display:block;padding:13px 6px;text-align:center;font-size:14px;line-height:1.2;color:#4a4f49;border:1px dashed ${EDGE}">${escapeHtml(label)}</span>`;
  const side = (cells: string[]) =>
    cells.length
      ? `<table role="presentation" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 8px"><tr>${cells
          .map((c, i) => `<td style="padding:0 ${i < cells.length - 1 ? 4 : 0}px 0 ${i > 0 ? 4 : 0}px;vertical-align:top">${c}</td>`)
          .join("")}</tr></table>`
      : "";
  const group = (system: string, about: string, tiles: string[], note: string) =>
    `<div style="margin:0 0 16px"><p style="margin:0 0 7px;font-size:13px;color:#4a4f49"><strong style="font-size:15px;color:#20231f">${escapeHtml(system)}</strong> &middot; ${escapeHtml(about)}</p>${side(tiles)}${note ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#4a4f49">${note}</p>` : ""}</div>`;
  const records = [
    group(
      "HubSpot",
      "follow-up and pipeline",
      [dealUrl ? tile(dealUrl, "Deal") : waiting("Deal: syncing"), contactUrl ? tile(contactUrl, "Contact") : waiting("Contact: syncing")],
      dealUrl && contactUrl ? "" : "Still syncing to HubSpot. The watchdog retries if it did not finish, and the P5 lead links to it once it is there.",
    ),
    group("P5", "the lead record", [tile(admin, "Lead")], ""),
  ].join("");

  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f1ede4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#20231f">
<div style="max-width:600px;margin:0 auto;background:#fbfaf6;padding:20px;border:1px solid rgba(32,35,31,.15)">
<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#4a4f49">${input.internalNotes?.length ? LEAD_WITH_PRICING_SUBJECT : LEAD_SUBJECT}: ${escapeHtml(brand)}</p>
<h1 style="margin:0 0 4px;font-size:24px;font-weight:700">${escapeHtml(name)}</h1>
<p style="margin:0 0 16px;font-size:15px">${escapeHtml(input.projectType ?? "Project not specified")}${input.propertyCity ? ` in ${escapeHtml(input.propertyCity)}` : ""}</p>
${tel ? button(tel, `Call ${phone}`, true) : ""}
${side([sms ? action(sms, "Text") : "", email ? action(`mailto:${email}`, "Email") : ""].filter(Boolean))}
${email ? `<p style="margin:6px 0 0;font-size:15px"><a href="mailto:${escapeHtml(email)}" style="color:#20231f">${escapeHtml(email)}</a></p>` : ""}
${address ? `<p style="margin:4px 0 0;font-size:15px"><a href="${escapeHtml(maps)}" style="color:#20231f">${escapeHtml(address)}</a> (open in maps)</p>` : ""}
${section("Records", records)}
${input.summary ? section("Message", `<p style="margin:0;font-size:15px;line-height:1.5">${escapeHtml(input.summary).replace(/\n/g, "<br>")}</p>`) : ""}
${input.teamNotes?.length ? section("From the website", table(input.teamNotes.map(labelled))) : ""}
${input.internalNotes?.length ? section("Internal pricing", `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#4a4f49">For the team only. This email is not copied into HubSpot.</p>${table(input.internalNotes.map(labelled))}`) : ""}
${section("Lead", table([
  { label: "Brand", value: input.brand },
  { label: "Project", value: input.projectType ?? "(not specified)" },
  ...(phone ? [{ label: "Phone", value: phone }] : []),
  ...(email ? [{ label: "Email", value: email }] : []),
  ...(address ? [{ label: "Address", value: address }] : []),
  ...(input.extraLines ?? []).map(labelled),
  { label: "Deal id", value: String(input.dealId) },
]))}
${fields.length ? section("Everything submitted", table(fields)) : ""}
${attribution.length ? section("Source and attribution", table(attribution)) : ""}
</div></body></html>`;

  return { subject, text, html };
}

/** Resolves true only when the transport accepted the message. Never throws. */
export async function notifyLeadCreated(
  input: LeadCreatedNotifyInput,
  options: LeadCreatedNotifyOptions = {},
): Promise<boolean> {
  if (input.originalForm === SYNTHETIC_ESTIMATOR_FORM) return false;
  try {
    let lead = input;
    if (input.prepare) {
      try {
        lead = { ...(await input.prepare()), prepare: undefined };
      } catch (error) {
        console.error("[intake-notify] alert context not prepared:", (error as Error).message);
      }
    }
    const message = renderLeadAlert(lead);
    const transport = options.transport ?? activeTransport();
    const result = await transport.send(PUBLIC_EMAIL, message);
    if (!result.ok) {
      console.error(`[intake-notify] send to ${PUBLIC_EMAIL} failed: ${result.error}`);
    }
    return result.ok;
  } catch (error) {
    console.error("[intake-notify]", (error as Error).message);
    return false;
  }
}

export type LeadFollowUpNotifyInput = {
  dealId: number;
  brand: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  /** One line per detail or file, already formatted. */
  lines: readonly string[];
  reroutedFrom?: string | null;
  /** Team-only lines from the brand site, as on the "New lead" email. */
  teamNotes?: readonly string[];
};

/**
 * Short follow-up when a visitor adds details or files to a request already
 * emailed: "Details added: {name}". Same mailbox, same fail-open rule.
 */
export async function notifyLeadDetailsAdded(
  input: LeadFollowUpNotifyInput,
  options: LeadCreatedNotifyOptions & { subjectPrefix?: string } = {},
): Promise<boolean> {
  try {
    const name =
      oneLine([input.firstName, input.lastName].filter(Boolean).join(" ")) || "Unnamed contact";
    const subject = `${options.subjectPrefix ?? "Details added"}: ${name} · ${oneLine(input.brand) || "P5 Home Co"}`;
    const lines = [
      `Name: ${name}`,
      `Phone: ${input.phone ?? ""}`,
      `Email: ${input.email ?? ""}`,
      input.reroutedFrom ? `Routed from ${input.reroutedFrom} to ${input.brand} by the project type.` : "",
      `Deal id: ${input.dealId}`,
      "",
      ...input.lines,
      "",
      input.teamNotes?.length ? "From the website:" : "",
      ...(input.teamNotes ?? []).map((line) => `  ${oneLine(line)}`),
      "",
      adminDealUrl(input.dealId),
    ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
    const text = lines.join("\n");
    const html = `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
    const transport = options.transport ?? activeTransport();
    const result = await transport.send(PUBLIC_EMAIL, { subject, text, html });
    if (!result.ok) {
      console.error(`[intake-notify] follow-up to ${PUBLIC_EMAIL} failed: ${result.error}`);
    }
    return result.ok;
  } catch (error) {
    console.error("[intake-notify]", (error as Error).message);
    return false;
  }
}
