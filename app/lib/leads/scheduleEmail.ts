/**
 * Lead confirmation copy and the Schedule now button.
 *
 * One booking page serves every brand. The URL cannot preselect a length, so
 * the sentence above the button tells the lead which option to choose:
 * 1 hour for a home walkthrough, 15 minutes for a phone consult.
 *
 * The button is a table, with Outlook VML beside it, so Gmail, Outlook and
 * iOS Mail all show a real button without depending on a stylesheet.
 *
 * After the estimate (owner request, 16 November 2026): every email that tells
 * a customer about an estimate greets with "Hey", offers the walkthrough and
 * the Schedule now button, invites them to adjust it (above the disclaimer)
 * and ends with the family question as a P.S. The guided estimator
 * confirmation is written that way below; the shared document estimator's
 * customer email gains the same words at send time
 * (decoratePreliminaryEstimateEmail). The words live in family.ts and here.
 */

import type { Message } from "../notifications/render.ts";
import { ADJUST_NOTE, BIGGER_PLAN_QUESTION, familyNote } from "../estimator/family.ts";
import { ESTIMATOR_BRAND } from "../../../lib/p5/brand.ts";

import { SCHEDULE_URL } from "./scheduleLink.ts";

/** HubSpot meetings page, kept in scheduleLink.ts so the estimate page can use it too. */
export { SCHEDULE_URL };

export const LEAD_PHONE_DISPLAY = "(208) 477-1169";

export const BUTTON_CHARCOAL = "#383837";
export const BUTTON_WHITE = "#ffffff";
export const BUTTON_PAPER = "#fbfaf6";

export type ScheduleIntent = "walkthrough" | "consult";

/** Sits below the adjust note in every customer email about an estimate. */
export const ESTIMATE_DISCLAIMER =
  "We work hard to make that estimate as realistic as we can, but we can't give you a true bid until we walk the property. Depending on the scope and what we find, the bid may come in higher or lower than this first estimate. Either way, we'll work with you to get you what you want, within your budget.";

/** The sentence above the Schedule now button in every customer email about an estimate. */
export const ESTIMATE_NEXT =
  "The next step is a home walkthrough, so we can see the property and turn this estimate into a true bid. On the scheduling page, choose the 1 hour option.";

const SHARED_DISCLAIMER =
  "We work hard to make any estimate we share as realistic as we can, but we can't give you a true bid until we walk the property. Depending on the scope and what we find, the bid may come in higher or lower than that first estimate. Either way, we'll work with you to get you what you want, within your budget.";

export function scheduleIntentFor(input: { requestKind?: string | null; form?: string | null }): ScheduleIntent {
  const kind = (input.requestKind ?? "").trim().toLowerCase();
  const form = (input.form ?? "").trim().toLowerCase();
  if (kind === "callback" || form === "site chat" || form.includes("call you")) return "consult";
  return "walkthrough";
}

/** The words that tell the lead which length to pick on the shared booking page. */
export function durationChoice(intent: ScheduleIntent): string {
  return intent === "consult" ? "the 15 minute option for a phone consult" : "the 1 hour option for a home walkthrough";
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(value: string): string {
  const trimmed = value.trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(trimmed)) return SCHEDULE_URL;
  return trimmed;
}

function safeAccent(value: string | undefined): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? (value as string) : "#a58c72";
}

function greetingName(firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return name || "there";
}

function contactLine(phone: string | undefined): string {
  const shown = (phone ?? "").trim() || LEAD_PHONE_DISPLAY;
  return `If you have questions, just reply to this email or call ${shown}.`;
}

/**
 * A full-width button. Primary is charcoal with white text and a brand
 * accent bar. Secondary is an outline on paper, shorter, so it reads as
 * the quieter action.
 */
export function bulletproofButton(options: {
  href: string;
  label: string;
  variant: "primary" | "secondary";
  accent?: string;
}): string {
  const href = esc(safeHref(options.href));
  const label = esc(options.label);
  const accent = safeAccent(options.accent);
  if (options.variant === "secondary") {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 18px;">
<tr>
<td align="center" bgcolor="${BUTTON_PAPER}" style="background-color:${BUTTON_PAPER};border:2px solid ${BUTTON_CHARCOAL};">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:520px;" arcsize="4%" strokecolor="${BUTTON_CHARCOAL}" fillcolor="${BUTTON_PAPER}">
<w:anchorlock/>
<center style="color:${BUTTON_CHARCOAL};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${href}" target="_blank" style="display:block;padding:12px 20px;background-color:${BUTTON_PAPER};color:${BUTTON_CHARCOAL};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-align:center;text-decoration:none;border:0;mso-hide:all;">${label}</a>
<!--<![endif]-->
</td>
</tr>
</table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:8px 0 0;">
<tr>
<td align="center" bgcolor="${BUTTON_CHARCOAL}" style="background-color:${BUTTON_CHARCOAL};">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:56px;v-text-anchor:middle;width:520px;" arcsize="4%" strokecolor="${BUTTON_CHARCOAL}" fillcolor="${BUTTON_CHARCOAL}">
<w:anchorlock/>
<center style="color:${BUTTON_WHITE};font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${href}" target="_blank" style="display:block;padding:16px 24px;background-color:${BUTTON_CHARCOAL};color:${BUTTON_WHITE};font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;border:0;mso-hide:all;">${label}</a>
<!--<![endif]-->
</td>
</tr>
<tr>
<td bgcolor="${accent}" style="background-color:${accent};height:4px;font-size:0;line-height:0;">&nbsp;</td>
</tr>
</table>`;
}

function wrapHtml(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:${BUTTON_CHARCOAL};max-width:560px;font-size:16px;line-height:1.6;">${inner}</div>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;">${esc(text)}</p>`;
}

export type EstimatorConfirmationInput = {
  firstName: string | null;
  brandName: string;
  project: string;
  viewUrl: string;
  phone?: string;
  accent?: string;
};

/**
 * The guided estimator confirmation. Subject stays "Your {project} estimate
 * from {brand}". No price, cost or margin belongs in this message.
 */
export function estimatorConfirmation(input: EstimatorConfirmationInput): Message {
  const first = greetingName(input.firstName);
  const brandName = input.brandName.trim() || "P5 Home Co";
  const project = input.project.trim().toLowerCase() || "project";
  const phone = contactLine(input.phone);
  const viewUrl = safeHref(input.viewUrl);
  const subject = `Your ${project} estimate from ${brandName}`;
  const thanks = `Thanks for giving us the chance to look at your ${project}. Your estimate is saved, and you can pull it up any time.`;
  const postscript = `P.S. ${BIGGER_PLAN_QUESTION} ${familyNote(brandName)}`;
  const next = ESTIMATE_NEXT;
  const signoff = `The ${brandName} team`;
  const text = [
    `Hey ${first},`,
    "",
    thanks,
    "",
    next,
    "",
    `Schedule now: ${SCHEDULE_URL}`,
    "",
    `View your estimate: ${viewUrl}`,
    "",
    ADJUST_NOTE,
    "",
    ESTIMATE_DISCLAIMER,
    "",
    phone,
    "",
    signoff,
    "",
    postscript,
  ].join("\n");
  const html = wrapHtml(
    [
      paragraph(`Hey ${first},`),
      paragraph(thanks),
      paragraph(next),
      bulletproofButton({ href: SCHEDULE_URL, label: "Schedule now", variant: "primary", accent: input.accent }),
      `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>`,
      bulletproofButton({ href: viewUrl, label: "View your estimate", variant: "secondary" }),
      paragraph(ADJUST_NOTE),
      paragraph(ESTIMATE_DISCLAIMER),
      paragraph(phone),
      paragraph(signoff),
      paragraph(postscript),
    ].join(""),
  );
  return { subject, text, html };
}

export type RequestConfirmationInput = {
  firstName: string | null;
  brandName: string;
  intent: ScheduleIntent;
  phone?: string;
  accent?: string;
};

/** Short request, quote form, and the same note when an email arrives on step 2. */
export function requestConfirmation(input: RequestConfirmationInput): Message {
  const first = greetingName(input.firstName);
  const brandName = input.brandName.trim() || "P5 Home Co";
  const phone = contactLine(input.phone);
  const subject = `We have your request, ${first}`;
  const thanks = `Thanks for reaching out to ${brandName}. We have your request, and someone from the team will follow up shortly.`;
  const next = `If you would like to get on the calendar now, use the button below and choose ${durationChoice(input.intent)}.`;
  const signoff = `The ${brandName} team`;
  const text = [
    `Hi ${first},`,
    "",
    thanks,
    "",
    next,
    "",
    `Schedule now: ${SCHEDULE_URL}`,
    "",
    SHARED_DISCLAIMER,
    "",
    phone,
    "",
    signoff,
  ].join("\n");
  const html = wrapHtml(
    [
      paragraph(`Hi ${first},`),
      paragraph(thanks),
      paragraph(next),
      bulletproofButton({ href: SCHEDULE_URL, label: "Schedule now", variant: "primary", accent: input.accent }),
      `<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>`,
      paragraph(SHARED_DISCLAIMER),
      paragraph(phone),
      paragraph(signoff),
    ].join(""),
  );
  return { subject, text, html };
}

/**
 * The shared document estimator's customer email (lib/p5/estimateEmail.ts,
 * subject "Your P5 Home Co preliminary estimate <reference>"). That template
 * is synced to every brand site and cannot change here, so the after-estimate
 * wording is added to the finished message at send time.
 */
export const PRELIMINARY_ESTIMATE_SUBJECT = `Your ${ESTIMATOR_BRAND.name} preliminary estimate`;

/** The last paragraph of that email. A question, never a pitch. */
export const PRELIMINARY_ESTIMATE_PS = `P.S. ${BIGGER_PLAN_QUESTION} ${familyNote(ESTIMATOR_BRAND.name)}`;

/** The end of the template's opening thank-you paragraph. */
const ESTIMATE_THANKS_MARKER = "Your preliminary estimate is below, and the complete estimate is attached as a PDF.</p>";

const ESTIMATE_VIEW_ANCHOR = ">View or update your estimate online</a>";

/** The template opens "Hi <first>," directly above its thank-you line. "Hello," (no name) is left alone. */
const ESTIMATE_GREETING = />Hi ([^<>]+,)<\/p>(?=<p [^>]*>Thank you for using the )/;

/**
 * Where the template ends its letter and starts its footer (the row with the
 * brand name, phone, email and legal line).
 */
const ESTIMATE_FOOTER_START = '</td></tr>\n <tr><td class="pad" style="padding:18px 28px 22px;border-top:';

/** A paragraph in the type the estimate template sets its own letter in. */
function letterParagraph(text: string, margin: string, size = 16): string {
  return `<p style="margin:${margin};font-size:${size}px;line-height:1.6;color:${BUTTON_CHARCOAL};">${esc(text)}</p>`;
}

function insertAt(source: string, at: number, addition: string): string {
  return source.slice(0, at) + addition + source.slice(at);
}

/**
 * Closes the letter: directly above the brand footer in the template, or at
 * the end of the body of any other markup.
 */
function closeLetter(html: string, addition: string): string {
  const footer = html.lastIndexOf(ESTIMATE_FOOTER_START);
  const at = footer >= 0 ? footer : html.lastIndexOf("</body>");
  return at >= 0 ? insertAt(html, at, addition) : html + addition;
}

function decorateEstimateHtml(source: string): string {
  const schedule =
    letterParagraph(ESTIMATE_NEXT, "0 0 16px") +
    bulletproofButton({ href: SCHEDULE_URL, label: "Schedule now", variant: "primary", accent: ESTIMATOR_BRAND.accent }) +
    `<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>`;
  const closing = letterParagraph(ADJUST_NOTE, "0 0 16px") + letterParagraph(ESTIMATE_DISCLAIMER, "0 0 20px");
  const postscript = letterParagraph(PRELIMINARY_ESTIMATE_PS, "20px 0 0", 14);

  const thanks = source.indexOf(ESTIMATE_THANKS_MARKER);
  // Markup this does not recognise keeps every byte and gains the whole block where its letter ends.
  if (thanks < 0) return closeLetter(source, schedule + closing + postscript);

  let html = source.replace(ESTIMATE_GREETING, (_match, name: string) => `>Hey ${name}</p>`);
  const afterThanks = html.indexOf(ESTIMATE_THANKS_MARKER) + ESTIMATE_THANKS_MARKER.length;
  html = insertAt(html, afterThanks, schedule);
  // After the "View or update your estimate online" button when the email has one, else after the schedule block.
  let closingAt = afterThanks + schedule.length;
  const view = html.indexOf(ESTIMATE_VIEW_ANCHOR, closingAt);
  if (view >= 0) {
    const tableEnd = html.indexOf("</table>", view);
    if (tableEnd >= 0) closingAt = tableEnd + "</table>".length;
  }
  html = insertAt(html, closingAt, closing);
  return closeLetter(html, postscript);
}

function decorateEstimateText(source: string): string {
  const lead = `${ESTIMATE_NEXT}\n\nSchedule now: ${SCHEDULE_URL}`;
  const after = `${ADJUST_NOTE}\n\n${ESTIMATE_DISCLAIMER}`;
  const view = /^View or update your estimate online:[^\n]*$/m.exec(source);
  let body: string;
  if (view) {
    const end = view.index + view[0].length;
    body = `${source.slice(0, view.index)}${lead}\n\n${view[0]}\n\n${after}${source.slice(end)}`;
  } else {
    // No link: the block follows the heading lines, where the link would have been.
    const gap = source.indexOf("\n\n");
    body = gap >= 0 ? insertAt(source, gap, `\n\n${lead}\n\n${after}`) : `${source}\n\n${lead}\n\n${after}`;
  }
  return `${body.replace(/\s+$/, "")}\n\n${PRELIMINARY_ESTIMATE_PS}`;
}

/**
 * Adds the after-estimate wording to the document estimator's customer email,
 * and to nothing else: the "Hey" greeting, the walkthrough sentence and the
 * Schedule now button under the thank-you line, the adjust note and the
 * disclaimer under the "View or update your estimate online" button, and the
 * family P.S. as the last paragraph of the letter. Every other message (team
 * record, delivery alert, project request, review request) is returned as the
 * same object, byte for byte. Nothing the template wrote is removed, and no
 * price, cost or margin is added. A message that already carries the booking
 * link is left alone, so a second pass cannot repeat the block.
 */
export function decoratePreliminaryEstimateEmail<T extends { subject: string; text: string; html?: string }>(input: T): T {
  try {
    if (typeof input.subject !== "string" || !input.subject.startsWith(PRELIMINARY_ESTIMATE_SUBJECT)) return input;
    if (input.text.includes(SCHEDULE_URL) || (input.html ?? "").includes(SCHEDULE_URL)) return input;
    const html = input.html ? decorateEstimateHtml(input.html) : input.html;
    return { ...input, text: decorateEstimateText(input.text), html };
  } catch (error) {
    // The estimate itself matters more than the added wording: send what the template built.
    console.error("[p5-delivery] estimate email wording not added:", error instanceof Error ? error.message : error);
    return input;
  }
}
