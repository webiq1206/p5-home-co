/**
 * The Google review request (owner decision, 20 November 2026): when a job is
 * complete, the customer gets one short email from the brand that did the
 * work, with one button to the P5 Home Co Google profile.
 *
 * THE WORDS LIVE HERE, AND ONLY HERE. The owner approves them before the
 * switch goes on (`REVIEW_REQUEST=on`); change this file to change the email.
 *
 * Google's rules, which the wording must keep to (tests/review-request.test.ts):
 *   - No incentive of any kind: nothing offered for a review.
 *   - No gating: every finished customer gets the same email, and it never
 *     asks whether they were happy first or steers anyone away from Google.
 *   - No stars, no rating asked for, no promise of when someone replies.
 *
 * Pure: no database and no network. The sending, the once-per-lead record and
 * the delay are in reviewRequestSend.ts.
 */

import { P5_GBP_PLACE_ID } from "../../publicIdentity.ts";
import { BRAND_CONFIGS } from "../estimator/brands.ts";
import type { Message } from "../notifications/render.ts";
import { LEAD_PHONE_DISPLAY, bulletproofButton, paragraph, wrapHtml } from "./scheduleEmail.ts";
import { SYNTHETIC_ESTIMATOR_FORM } from "./synthetic-qa.ts";

/** The parent company, whose Google profile every brand's reviews go on. */
export const REVIEW_PROFILE_NAME = "P5 Home Co";

/** Google's "write a review" page for the P5 Home Co Business Profile. */
export const GOOGLE_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${P5_GBP_PLACE_ID}`;

/** The button, and the label beside the link in the text version. */
export const REVIEW_BUTTON_LABEL = "Leave a Google review";

/** Hours between the job being recorded complete and the email, when nothing is set. */
export const DEFAULT_REVIEW_DELAY_HOURS = 24;
/** A longer setting is treated as a mistake: a fortnight is the most it waits. */
const MAX_REVIEW_DELAY_HOURS = 14 * 24;

/** Off unless `REVIEW_REQUEST` is exactly "on" (any letter case). Off means nothing is queued or sent. */
export function reviewRequestEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.REVIEW_REQUEST ?? "").trim().toLowerCase() === "on";
}

/** `REVIEW_REQUEST_DELAY_HOURS`: 0 sends on the spot; unset or unreadable is 24; at most 336. */
export function reviewRequestDelayHours(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.REVIEW_REQUEST_DELAY_HOURS ?? "").trim();
  if (!raw) return DEFAULT_REVIEW_DELAY_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return DEFAULT_REVIEW_DELAY_HOURS;
  return Math.min(hours, MAX_REVIEW_DELAY_HOURS);
}

/** The brand that did the job: its name and accent from BRAND_CONFIGS. Anything unknown signs as P5 Home Co. */
export function reviewBrand(brandName: string | null | undefined): { name: string; accent: string } {
  const wanted = (brandName ?? "").trim();
  const brand = Object.values(BRAND_CONFIGS).find((b) => b.name === wanted) ?? BRAND_CONFIGS.p5;
  return { name: brand.name, accent: brand.accent };
}

export type ReviewLead = {
  stage: string | null;
  originalForm: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Closed as removed or merged, in HubSpot or QuickBooks (a won deal deleted elsewhere stays won, so this is read from the audit trail). */
  removed: boolean;
};

/** A test lead: the estimator's synthetic QA form, a "[QA]" name, or a reserved test address. */
export function isTestLead(lead: Pick<ReviewLead, "originalForm" | "firstName" | "lastName" | "email">): boolean {
  if (lead.originalForm === SYNTHETIC_ESTIMATOR_FORM) return true;
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  if (/^\[QA\](?:\s|$)/i.test(name)) return true;
  return /@example\.invalid$/i.test((lead.email ?? "").trim());
}

const usableEmail = (raw: string | null | undefined) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((raw ?? "").trim());

/** Why this lead gets no review request, or null when it may get one. Checked when it is queued and again before it is sent. */
export function reviewRequestBlocker(lead: ReviewLead): string | null {
  if (lead.stage !== "Closed Won") return "The lead is not Closed Won.";
  if (lead.removed) return "The lead was removed or merged, so it is not asked for a review.";
  if (isTestLead(lead)) return "A test lead is never asked for a review.";
  if (!usableEmail(lead.email)) return "The lead has no usable email address.";
  return null;
}

function firstNameOf(raw: string | null | undefined): string {
  // A first name only, as typed. Brackets and angle marks never reach a subject line.
  return (raw ?? "").trim().split(/\s+/)[0]?.replace(/[<>[\]]/g, "") ?? "";
}

/** Says where the review goes: the brand is part of P5 Home Co, whose profile it is. */
function profileSentence(brandName: string): string {
  if (brandName === REVIEW_PROFILE_NAME) {
    return `Reviews for our work go on the ${REVIEW_PROFILE_NAME} Google profile.`;
  }
  return `${brandName} is part of ${REVIEW_PROFILE_NAME}, our parent company, so the review goes on the ${REVIEW_PROFILE_NAME} Google profile.`;
}

export type ReviewRequestInput = { firstName: string | null; brandName: string | null };

/** The email: subject, text and HTML. Same words for every customer; only the name and the brand change. */
export function reviewRequestEmail(input: ReviewRequestInput): Message {
  const first = firstNameOf(input.firstName);
  const brand = reviewBrand(input.brandName);
  const subject = first ? `How did we do, ${first}?` : "How did we do?";
  const greeting = `Hi ${first || "there"},`;
  const thanks = `Thank you for choosing ${brand.name}. Now that your project is finished, we would like to hear how it went.`;
  const ask = `If you have a minute, would you leave us a review on Google? ${profileSentence(brand.name)}`;
  const honest = "Say whatever you think. An honest review helps other homeowners decide who to trust with their home, and it helps us do better work.";
  const contact = `If you have questions, just reply to this email or call ${LEAD_PHONE_DISPLAY}.`;
  const thankYou = "Thank you,";
  const signoff = `The ${brand.name} team`;

  const text = [
    greeting,
    "",
    thanks,
    "",
    ask,
    "",
    `${REVIEW_BUTTON_LABEL}: ${GOOGLE_REVIEW_URL}`,
    "",
    honest,
    "",
    contact,
    "",
    thankYou,
    signoff,
  ].join("\n");

  const html = wrapHtml(
    [
      paragraph(greeting),
      paragraph(thanks),
      paragraph(ask),
      bulletproofButton({ href: GOOGLE_REVIEW_URL, label: REVIEW_BUTTON_LABEL, variant: "primary", accent: brand.accent }),
      `<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>`,
      paragraph(honest),
      paragraph(contact),
      `<p style="margin:0 0 16px;">${thankYou}<br>${signoff.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
    ].join(""),
  );
  return { subject, text, html };
}
