/**
 * Lead confirmation copy and the Schedule now button.
 *
 * One booking page serves every brand. The URL cannot preselect a length, so
 * the sentence above the button tells the lead which option to choose:
 * 1 hour for a home walkthrough, 15 minutes for a phone consult.
 *
 * The button is a table, with Outlook VML beside it, so Gmail, Outlook and
 * iOS Mail all show a real button without depending on a stylesheet.
 */

import type { Message } from "../notifications/render.ts";
import { ESTIMATOR_BRAND } from "../../../lib/p5/brand.ts";
import { BRAND_CONFIGS } from "../estimator/brands.ts";
import { SCHEDULE_URL, button as kitButton, layout, tierNextStep, type EmailBrand } from "../../../lib/p5/emailKit.ts";

export { SCHEDULE_URL };

export const LEAD_PHONE_DISPLAY = "(208) 477-1169";

export const BUTTON_CHARCOAL = "#383837";
export const BUTTON_WHITE = "#ffffff";
export const BUTTON_PAPER = "#fbfaf6";

export type ScheduleIntent = "walkthrough" | "consult";

const ESTIMATE_DISCLAIMER =
  "We work hard to make that estimate as realistic as we can, but we can't give you a true bid until we walk the property. Depending on the scope and what we find, the bid may come in higher or lower than this first estimate. Either way, we'll work with you to get you what you want, within your budget.";

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
  return /^https:\/\/[^\s"'<>]+$/.test(trimmed) ? trimmed : SCHEDULE_URL;
}

function safeAccent(value: string | undefined): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? (value as string) : ESTIMATOR_BRAND.accent;
}

function skin(name: string | undefined, accent: string | undefined): EmailBrand {
  const known = Object.values(BRAND_CONFIGS).find((brand) => brand.name === (name ?? "").trim());
  return {
    name: (name ?? "").trim() || known?.name || "",
    accent: safeAccent(accent ?? (known?.id === ESTIMATOR_BRAND.id || known?.id === "adu" ? ESTIMATOR_BRAND.accent : known?.accent)),
    charcoal: "#383837",
    logoUrl: known?.logoUrl || "",
    siteUrl: known?.site || "",
    phoneDisplay: "(208) 477-1169",
    phoneTel: "+12084771169",
    cityLine: "Meridian, ID 83646",
    replyTo: known?.site ? `hello@${known.site.replace(/^https:\/\//, "")}` : "",
  };
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
  return kitButton({ href: options.href, label: options.label, variant: options.variant, accent: safeAccent(options.accent) });
}

function wrapHtml(inner: string, name?: string, accent?: string): string {
  const brand = skin(name, accent);
  return layout({
    brand,
    preheader: `${brand.name}. ${LEAD_PHONE_DISPLAY}`,
    title: brand.name,
    body: inner,
  });
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
  const thanks = `Thanks for thinking of ${brandName} for your ${project}. Your estimate is saved, and you can pull it up any time.`;
  const next = tierNextStep(null);
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
    `View your estimate: ${viewUrl}`,
    "",
    ESTIMATE_DISCLAIMER,
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
      `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>`,
      bulletproofButton({ href: viewUrl, label: "View your estimate", variant: "secondary" }),
      paragraph(ESTIMATE_DISCLAIMER),
      paragraph(phone),
      paragraph(signoff),
    ].join(""),
    brandName,
    input.accent,
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
    brandName,
    input.accent,
  );
  return { subject, text, html };
}
