/**
 * Lead confirmation wording and the Schedule now button. No mail is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import { customerConfirmation } from "../app/lib/estimator/emails.ts";
import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
import { ADJUST_NOTE, BIGGER_PLAN_QUESTION, FAMILY_BRANDS, familyNote } from "../app/lib/estimator/family.ts";
import {
  ESTIMATE_DISCLAIMER,
  ESTIMATE_NEXT,
  PRELIMINARY_ESTIMATE_PS,
  PRELIMINARY_ESTIMATE_SUBJECT,
  SCHEDULE_URL,
  decoratePreliminaryEstimateEmail,
  estimatorConfirmation,
  requestConfirmation,
  scheduleIntentFor,
} from "../app/lib/leads/scheduleEmail.ts";
import * as smtpConfig from "../app/lib/notifications/smtp-config.ts";
import { ESTIMATOR_BRAND } from "../lib/p5/brand.ts";
import { estimateEmail } from "../lib/p5/estimateEmail.ts";
import { estimateReference, issueRecord } from "../lib/p5/estimateDocument.ts";
import { safeEmailReplyTo } from "../lib/p5/emailReplyTo.ts";
import { renderIntakeEmail } from "../lib/p5/intakeEmail.ts";
import { emptyIntakeDetails, type IntakeSnapshot } from "../lib/p5/intakeContract.ts";
import { routeIntake } from "../lib/p5/intakePolicy.ts";

const BANNED = /—|Perkins 5|showroom|\bshop\b/i;

function visible(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

test("the estimator confirmation uses the approved copy and a primary schedule button", () => {
  const message = estimatorConfirmation({
    firstName: "Jared",
    brandName: "P5 Home Co",
    project: "Kitchen remodel",
    viewUrl: "https://p5homeco.com/estimator/e/token",
    accent: "#ceb391",
  });
  assert.equal(message.subject, "Your kitchen remodel estimate from P5 Home Co");
  assert.match(message.text, /^Hey Jared,/);
  assert.match(message.text, /Thanks for giving us the chance to look at your kitchen remodel\. Your estimate is saved, and you can pull it up any time\./);
  // The same invitation and question the results screen shows (owner request, 16 November 2026).
  assert.ok(message.text.includes(ADJUST_NOTE));
  assert.match(message.text, /P\.S\. Anything else on your list\? P5 Home Co is the company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co\./);
  assert.ok(message.text.trimEnd().endsWith("tell us and we'll plan it alongside this project."), "the question closes the email");
  assert.ok(visible(message.html).includes(BIGGER_PLAN_QUESTION));
  assert.match(message.text, /The next step is a home walkthrough, so we can see the property and turn this estimate into a true bid\. On the scheduling page, choose the 1 hour option\./);
  assert.match(message.text, /We work hard to make that estimate as realistic as we can, but we can't give you a true bid until we walk the property\./);
  assert.match(message.text, /Either way, we'll work with you to get you what you want, within your budget\./);
  assert.match(message.text, /call \(208\) 477-1169/);
  assert.match(message.text, /The P5 Home Co team/);
  assert.ok(message.text.includes(`Schedule now: ${SCHEDULE_URL}`));
  assert.ok(message.text.includes("View your estimate: https://p5homeco.com/estimator/e/token"));
  assert.doesNotMatch(`${message.subject}\n${message.text}\n${visible(message.html)}`, BANNED);
  assert.doesNotMatch(visible(message.html), /\$\s?\d|\bcost\b|\bmargin\b/);
  assert.match(message.html, /background-color:#383837/);
  assert.match(message.html, /color:#ffffff/);
  assert.match(message.html, /v:roundrect/);
  assert.match(message.html, /width="100%"/);
  assert.ok(message.html.indexOf(">Schedule now<") < message.html.indexOf(">View your estimate<"));
  assert.match(message.html, /#ceb391/);
});

test("a short request names the 1 hour walkthrough, and a callback names the 15 minute consult", () => {
  const project = requestConfirmation({ firstName: "Ada", brandName: "Boise Remodeling Co", intent: "walkthrough", accent: "#7d9479" });
  const callback = requestConfirmation({ firstName: "Ada", brandName: "Boise Handyman Co", intent: "consult", accent: "#c56b4a" });
  assert.equal(project.subject, "We have your request, Ada");
  assert.match(project.text, /someone from the team will follow up shortly/);
  assert.match(project.text, /choose the 1 hour option for a home walkthrough/);
  assert.match(project.text, /any estimate we share/);
  assert.match(project.text, /that first estimate/);
  assert.doesNotMatch(project.text, /View your estimate/);
  assert.match(callback.text, /choose the 15 minute option for a phone consult/);
  assert.match(callback.html, /#c56b4a/);
  assert.equal(scheduleIntentFor({ requestKind: "callback" }), "consult");
  assert.equal(scheduleIntentFor({ requestKind: "quote", form: "Quote Landing Page" }), "walkthrough");
  assert.equal(scheduleIntentFor({ form: "Site Chat" }), "consult");
  for (const message of [project, callback]) {
    assert.doesNotMatch(`${message.subject}\n${message.text}\n${visible(message.html)}`, BANNED);
    assert.ok(message.text.includes(SCHEDULE_URL));
    assert.match(message.html, /role="presentation"/);
  }
});

test("a missing first name still reads as a sentence", () => {
  const message = requestConfirmation({ firstName: "  ", brandName: "P5 Home Co", intent: "walkthrough" });
  assert.match(message.text, /^Hi there,/);
  assert.equal(message.subject, "We have your request, there");
});

test("the guided confirmation for each live brand keeps its subject and carries no figure", () => {
  for (const brand of Object.values(BRAND_CONFIGS)) {
    const message = customerConfirmation(
      {
        first_name: "Sample",
        brand: brand.id,
        customer_view: { projectName: "Bathroom remodel" },
      } as never,
      "https://p5homeco.com/estimator/e/abc",
    );
    assert.equal(message.subject, `Your bathroom remodel estimate from ${brand.name}`);
    assert.match(message.text, /Thanks for giving us the chance to look at your bathroom remodel\./);
    // Each brand's email says who is behind it and asks the same question.
    assert.ok(message.text.includes(familyNote(brand.name)), brand.name);
    assert.ok(message.text.includes(`Schedule now: ${SCHEDULE_URL}`));
    assert.doesNotMatch(visible(message.html), /\$\s?\d/);
  }
});

test("quote and short-request sends are limited to a real address on a new lead", () => {
  const quote = readFileSync("app/api/leads/intake/handler.ts", "utf8");
  assert.match(quote, /if \(isQuoteForm && quoteEmail\)/);
  assert.equal((quote.match(/sendRequestConfirmation/g) ?? []).length, 2);
  const short = readFileSync("app/api/leads/short-request/route.ts", "utf8");
  assert.match(short, /if \(submitted\.email\)/);
  assert.match(short, /submitted\.kind === "callback"/);
  const details = readFileSync("app/api/leads/short-request/details/route.ts", "utf8");
  assert.match(details, /result\.filled\.includes\("email"\)/);
  const forms = readFileSync("components/ShortRequestForm.tsx", "utf8");
  assert.doesNotMatch(forms, /Schedule now/);
});

test("the family note names the brand the customer used and the rest of the family, on the page and in the email", () => {
  // The list follows the live brands, so a new site cannot be left out or a retired one left in.
  const live = Object.values(BRAND_CONFIGS).filter((b) => b.live && b.id !== "p5").map((b) => b.name);
  assert.deepEqual([...FAMILY_BRANDS].sort(), [...live].sort());
  assert.equal(
    familyNote("Boise Cabinet Co"),
    "Boise Cabinet Co is part of P5 Home Co, the company behind Boise Construction Co, Boise Remodeling Co and Boise Handyman Co. So whether it's a few repairs, new cabinets, a full kitchen or bath remodel, an addition or a new home, tell us and we'll plan it alongside this project.",
  );
  assert.match(familyNote("P5 Home Co"), /^P5 Home Co is the company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co\./);
  for (const brand of Object.values(BRAND_CONFIGS)) {
    const words = `${ADJUST_NOTE} ${BIGGER_PLAN_QUESTION} ${familyNote(brand.name)}`;
    // House rules: no em dash, never a quote or bid, no price, no promise about how fast anyone replies.
    assert.doesNotMatch(words, /\u2014|\bquote\b|\bbid\b|\$|near me|within \d|same day|right away/i, brand.name);
    assert.equal(words.split(brand.name).length - 1, 1, `${brand.name} is named once`);
  }
  // The results screen and the saved link render the same words, outside "Understanding your estimate".
  const view = readFileSync(new URL("../components/estimator/EstimateView.tsx", import.meta.url), "utf8");
  assert.match(view, /\{ADJUST_NOTE\}/);
  assert.match(view, /\{BIGGER_PLAN_QUESTION\} \{familyNote\(estimate\.brandName\)\}/);
  assert.ok(view.indexOf("Anything to change or add?") > view.indexOf("Understanding your estimate"));
  assert.ok(view.indexOf("Anything to change or add?") < view.indexOf('aria-label="Next steps"'));
});

test("every estimate carries the booking link: the page, the saved link and the QuickBooks document", () => {
  const view = readFileSync(new URL("../components/estimator/EstimateView.tsx", import.meta.url), "utf8");
  assert.match(view, /href=\{SCHEDULE_URL\} target="_blank" rel="noopener noreferrer"/);
  assert.match(view, />\s*Schedule now\s*</);
  // One calendar everywhere.
  assert.equal(SCHEDULE_URL, "https://meetings-na2.hubspot.com/client3");
  const qbo = readFileSync(new URL("../app/lib/scopes/estimate.ts", import.meta.url), "utf8");
  assert.match(qbo, /const memo: string\[\] = \[SCHEDULE_MEMO\];/);
});

// ---------------------------------------------------------------------------
// The shared document estimator's customer email ("Your P5 Home Co preliminary
// estimate <reference>"). Its template is synced to every brand site, so the
// after-estimate wording is added to the finished message at send time.
// ---------------------------------------------------------------------------

/** Owner wording, 16 November 2026. Pinned here so a change to the constants is a deliberate one. */
const NEXT_STEP =
  "The next step is a home walkthrough, so we can see the property and turn this estimate into a true bid. On the scheduling page, choose the 1 hour option.";
const ADJUST =
  "If something is missing, or you'd like to change the scope, the finishes or the timing, tell us. It's easy to adjust, and we'd rather get it right than have you guessing.";
const DISCLAIMER_START = "We work hard to make that estimate as realistic as we can";
const FAMILY_PS =
  "P.S. Anything else on your list? P5 Home Co is the company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co. So whether it's a few repairs, new cabinets, a full kitchen or bath remodel, an addition or a new home, tell us and we'll plan it alongside this project.";
const AFTER_ESTIMATE = /Anything else on your list|P\.S\.|easy to adjust|home walkthrough|Schedule now/;
const THANKS = "Your preliminary estimate is below, and the complete estimate is attached as a PDF.";

const ESTIMATE_ID = "0f1e2d3c-4b5a-4000-8000-00000000abcd";
const ESTIMATE_SUBJECT = `Your P5 Home Co preliminary estimate ${estimateReference(ESTIMATE_ID)}`;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A saved estimate as the outbox hands it to estimateEmail(): the customer view, the contact and the internal record. */
function savedEstimate(name = "Ada Lovelace") {
  const contact = { name, email: "qa@example.invalid", phone: "(208) 555-0100" };
  const scope = {
    text: "Replace the kitchen cabinets.",
    answers: { service: "kitchen", finish: "mid-range", location: "Boise, ID" },
    uploads: [],
    uncertainFields: [] as string[],
  };
  const customer = {
    range: { low: 6800, high: 7500 },
    categoryRanges: [{ category: "Cabinets", low: 4000, high: 4400 }],
    lineItems: [],
    exclusions: ["Appliances"],
    verificationItems: ["Confirm door style."],
    issue: issueRecord({ brandId: ESTIMATOR_BRAND.id, id: ESTIMATE_ID, revision: 1, now: new Date("2026-11-16T18:00:00Z"), contact, scope }),
  };
  return { customer, contact, internal: { directCost: 4430, contractPrice: 7166, lines: [], warnings: [] } };
}

/** Builds the real email with the signed link present or absent, then restores the environment. */
function withLinkSecret<T>(present: boolean, build: () => T): T {
  const keys = ["P5_LINK_SECRET", "DATABASE_URL", "REPLIT_DB_URL"] as const;
  const saved = keys.map((key) => process.env[key]);
  const error = console.error;
  try {
    for (const key of keys) delete process.env[key];
    if (present) process.env.P5_LINK_SECRET = "offline-test-only";
    // The template logs that no link could be signed; that is the case under test, not a failure.
    else console.error = () => {};
    return build();
  } finally {
    console.error = error;
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
}

/** Schedule block, adjust note above the disclaimer, one booking link, the exact P.S. last. */
function assertAfterEstimateWording(message: { text: string; html?: string }): void {
  const html = message.html ?? "";
  for (const copy of html ? [message.text, html] : [message.text]) {
    for (const words of [NEXT_STEP, ADJUST, FAMILY_PS]) assert.equal(count(copy, words), 1, words);
    assert.equal(count(copy, DISCLAIMER_START), 1);
    assert.equal(count(copy, SCHEDULE_URL) > 0, true);
    assert.ok(copy.indexOf(NEXT_STEP) < copy.indexOf(SCHEDULE_URL), "the walkthrough sentence introduces the booking link");
    assert.ok(copy.indexOf(SCHEDULE_URL) < copy.indexOf(ADJUST), "the adjust note follows the schedule block");
    assert.ok(copy.indexOf(ADJUST) < copy.indexOf(DISCLAIMER_START), "the adjust note sits above the disclaimer");
    assert.ok(copy.indexOf(DISCLAIMER_START) < copy.indexOf(FAMILY_PS), "the P.S. comes after the disclaimer");
  }
  // One booking link in the text, on its own line.
  assert.equal(count(message.text, SCHEDULE_URL), 1);
  assert.ok(message.text.includes(`\n\n${NEXT_STEP}\n\nSchedule now: ${SCHEDULE_URL}\n\n`));
  assert.ok(message.text.endsWith(`\n\n${FAMILY_PS}`), "the P.S. is the last paragraph of the text");
  if (html) {
    // One button: its Outlook drawing and its link share one booking URL and one label.
    assert.equal(count(html, ">Schedule now<"), 2);
    assert.equal(count(html, `href="${SCHEDULE_URL}"`), 2);
    assert.equal(count(html, SCHEDULE_URL), 2);
    assert.equal(count(html, "<v:roundrect"), 1);
    assert.match(html, /background-color:#383837/);
    assert.ok(html.includes(`bgcolor="${ESTIMATOR_BRAND.accent}"`), "the accent bar is this brand's");
  }
  const words = `${message.text}\n${visible(html)}`;
  assert.doesNotMatch(words, BANNED);
  assert.doesNotMatch(words, /near me|\bquote\b|within \d|same day|right away/i);
}

test("the after-estimate wording for the document estimator is the owner's and is reused, not retyped", () => {
  assert.equal(ESTIMATE_NEXT, NEXT_STEP);
  assert.equal(ADJUST_NOTE, ADJUST);
  assert.ok(ESTIMATE_DISCLAIMER.startsWith(DISCLAIMER_START));
  assert.equal(PRELIMINARY_ESTIMATE_PS, FAMILY_PS);
  assert.equal(PRELIMINARY_ESTIMATE_PS, `P.S. ${BIGGER_PLAN_QUESTION} ${familyNote("P5 Home Co")}`);
  assert.equal(PRELIMINARY_ESTIMATE_SUBJECT, `Your ${ESTIMATOR_BRAND.name} preliminary estimate`);
  assert.ok(ESTIMATE_SUBJECT.startsWith(PRELIMINARY_ESTIMATE_SUBJECT));
  // Each sentence is written once: the guided confirmation and the decorator read the same constants.
  const source = readFileSync("app/lib/leads/scheduleEmail.ts", "utf8");
  assert.equal(count(source, "The next step is a home walkthrough"), 1);
  assert.equal(count(source, DISCLAIMER_START), 1);
  assert.equal(count(source, "easy to adjust"), 0);
  assert.equal(count(source, "Anything else on your list"), 0);
  // The synced template and the adapter carry none of the words; the adapter only calls the decorator.
  for (const file of ["lib/p5/estimateEmail.ts", "lib/p5/intakeEmail.ts", "lib/p5/outbox.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), AFTER_ESTIMATE, file);
  }
  assert.doesNotMatch(readFileSync("lib/p5/deliveryAdapter.ts", "utf8"), /Anything else on your list|P\.S\.|easy to adjust|home walkthrough|meetings-na2/);
  // The template still has the three places the wording is fitted to.
  const template = readFileSync("lib/p5/estimateEmail.ts", "utf8");
  assert.ok(template.includes(THANKS));
  assert.ok(template.includes("View or update your estimate online"));
  assert.ok(template.includes("`Hi ${first},`"));
  assert.ok(readFileSync("lib/p5/outbox.ts", "utf8").includes("`Your ${brand.name} preliminary estimate ${estimateReference("));
});

test("the document estimator's customer email is sent with the greeting, the schedule button, the adjust note and the P.S.", () => {
  const record = savedEstimate();
  for (const withLink of [true, false]) {
    const original = withLinkSecret(withLink, () => estimateEmail(ESTIMATE_ID, record, false));
    assert.equal(original.html.includes("View or update your estimate online"), withLink);
    assert.equal(original.text.includes("View or update your estimate online:"), withLink);
    assert.match(original.html, />Hi Ada,<\/p>/);
    assert.doesNotMatch(`${original.text}\n${original.html}`, AFTER_ESTIMATE);

    const sent = decoratePreliminaryEstimateEmail({ subject: ESTIMATE_SUBJECT, ...original });
    assert.equal(sent.subject, ESTIMATE_SUBJECT);
    assertAfterEstimateWording(sent);

    // 1. "Hey", directly above the thank-you line. The plain text has no greeting, and gains none.
    assert.match(sent.html, />Hey Ada,<\/p><p [^>]*>Thank you for using the P5 Home Co online estimator\./);
    assert.doesNotMatch(sent.html, />Hi Ada,</);
    assert.equal(count(sent.html, "Hey "), 1);
    assert.doesNotMatch(sent.text, /^(?:Hi|Hey|Hello)\b/m);

    // 2. The walkthrough sentence and the button directly follow the thank-you paragraph.
    assert.match(sent.html, new RegExp(`${THANKS.replace(/\./g, "\\.")}</p><p [^>]*>The next step is a home walkthrough`));
    assert.match(sent.html, /choose the 1 hour option\.<\/p><table role="presentation"[^>]*>\s*<tr>\s*<td align="center" bgcolor="#383837"/);

    // 3. Adjust note, then the disclaimer: under the view button when there is one, else under the schedule block.
    const closing = /<p [^>]*>If something is missing[^<]*<\/p><p [^>]*>We work hard to make that estimate[^<]*<\/p><table role="presentation"[^>]*><tr><td style="padding:18px 20px/;
    assert.match(sent.html, closing, "the adjust note and the disclaimer sit together, directly above the estimate total");
    if (withLink) {
      assert.ok(sent.html.indexOf(">Schedule now<") < sent.html.indexOf(">View or update your estimate online<"));
      assert.match(sent.html, />View or update your estimate online<\/a><\/td><\/tr><\/table><p [^>]*>If something is missing/);
      assert.ok(sent.text.indexOf("Schedule now:") < sent.text.indexOf("View or update your estimate online:"));
      assert.match(sent.text, /\nView or update your estimate online: https:\/\/[^\n]+\n\nIf something is missing/);
    } else {
      assert.match(sent.html, /<\/table><div style="height:16px;line-height:16px;font-size:0;">&nbsp;<\/div><p [^>]*>If something is missing/);
      assert.ok(sent.text.includes(`Schedule now: ${SCHEDULE_URL}\n\n${ADJUST}`));
    }
    assert.ok(sent.text.indexOf(DISCLAIMER_START) < sent.text.indexOf("ESTIMATED PROJECT RANGE"), "the wording sits above the estimate in the text too");

    // 4. The P.S. closes the letter: last in the text, and directly above the brand footer row in the HTML.
    assert.ok(sent.text.endsWith(`Your complete estimate is attached as a PDF.\n\n${FAMILY_PS}`));
    assert.ok(sent.html.includes(`${FAMILY_PS}</p></td></tr>\n <tr><td class="pad" style="padding:18px 28px 22px;border-top:`));
    assert.match(sent.html, /No payment or signature is required now\.<\/p><p [^>]*>P\.S\. /, "the P.S. follows the last paragraph of the letter");
    const afterPs = visible(sent.html.slice(sent.html.indexOf(FAMILY_PS) + FAMILY_PS.length)).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    assert.equal(afterPs, "P5 Home Co | (208) 477-1169 | hello@p5homeco.com | p5homeco.com P5 Home Co is operated by P5 Home Co, LLC.", "only the brand footer follows the P.S.");
    assert.ok(sent.html.endsWith("</table></td></tr></table></body></html>"));

    // Nothing the template wrote was removed or reordered: taking the additions back out gives the original bytes.
    let at = 0;
    for (const line of original.text.split("\n").filter(Boolean)) {
      const found = sent.text.indexOf(line, at);
      assert.ok(found >= 0, `kept in order: ${line}`);
      at = found + line.length;
    }
    const added = [...sent.html.matchAll(/<p style="margin:[^"]*;font-size:1[46]px;line-height:1\.6;color:#383837;">[^<]*<\/p>/g)].map((m) => m[0]);
    assert.equal(added.length, 4, "walkthrough sentence, adjust note, disclaimer, P.S.");
    let restored = sent.html.replace(">Hey Ada,</p>", ">Hi Ada,</p>");
    for (const paragraph of added) restored = restored.replace(paragraph, "");
    const button = restored.slice(restored.indexOf(`${THANKS}</p>`) + `${THANKS}</p>`.length);
    const spacer = `<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>`;
    restored = restored.replace(button.slice(0, button.indexOf(spacer) + spacer.length), "");
    assert.equal(restored, original.html, "the original markup is intact around the additions");
    for (const kept of ["$6,800 to $7,500", "Appliances", "Confirm door style.", "Preliminary estimate, not a contract."]) {
      assert.equal(count(sent.html, kept), count(original.html, kept), kept);
      assert.equal(count(sent.text, kept), count(original.text, kept), kept);
    }

    // The disclosure wall holds: the additions carry no figure, and nothing internal appears.
    assert.equal(count(`${sent.text}\n${sent.html}`, "$"), count(`${original.text}\n${original.html}`, "$"));
    assert.doesNotMatch(`${sent.text}\n${sent.html}`, /4,430|7,166|Direct project cost|Contract price/i);
    for (const word of ["margin", "cost"]) {
      assert.equal(count(`${sent.text}\n${visible(sent.html)}`, word), count(`${original.text}\n${visible(original.html)}`, word), word);
    }

    // A second pass cannot repeat the block.
    const again = decoratePreliminaryEstimateEmail(sent);
    assert.equal(again.text, sent.text);
    assert.equal(again.html, sent.html);
  }
});

test("a customer with no name keeps the template's Hello, and still gets the wording", () => {
  const original = withLinkSecret(true, () => estimateEmail(ESTIMATE_ID, savedEstimate(""), false));
  assert.match(original.html, />Hello,<\/p>/);
  const sent = decoratePreliminaryEstimateEmail({ subject: ESTIMATE_SUBJECT, ...original });
  assert.match(sent.html, />Hello,<\/p><p [^>]*>Thank you for using the P5 Home Co online estimator\./);
  assert.doesNotMatch(sent.html, /Hey /);
  assertAfterEstimateWording(sent);
});

test("team, alert, project-request and review-request emails pass through unchanged", () => {
  const record = savedEstimate();
  const ref = ESTIMATE_ID.slice(0, 8);
  const admin = withLinkSecret(true, () => estimateEmail(ESTIMATE_ID, record, true));
  const snapshot: IntakeSnapshot = {
    schema: 1,
    projectId: "p5:12345678-1234-4234-8234-123456789abc",
    draftId: "12345678-1234-4234-8234-123456789abc",
    originSite: "p5",
    currentSite: "p5",
    revision: 1,
    contextVersion: 0,
    savedAt: "2099-01-02T12:00:00Z",
    contact: { name: "Ada Lovelace", email: "qa@example.invalid", phone: "2085550100", preferredContact: "either" },
    details: emptyIntakeDetails(),
    scope: { text: "Fictional scope", answers: { service: "handyman" }, extraction: null, uploads: [] },
    routing: routeIntake("p5", "handyman"),
    unresolved: [],
  };
  const intakeCustomer = renderIntakeEmail(snapshot, false, []);
  const intakeTeam = renderIntakeEmail(snapshot, true, []);
  assert.match(intakeCustomer.subject, /^P5 Home Co: Your project request /);
  assert.match(intakeTeam.subject, /^P5 Home Co: Project request /);
  const messages: { subject: string; text: string; html?: string }[] = [
    // The subjects lib/p5/outbox.ts gives the team record and the delivery alert.
    { subject: `P5 Home Co: internal estimate record (ref ${ref})`, ...admin },
    {
      subject: `P5 Home Co: estimate delivery needs attention (ref ${ref})`,
      text: `Estimate ${ESTIMATE_ID} needs delivery review. Synthetic failure\nOpen https://p5homeco.com/admin/p5-estimators to inspect the saved record. Do not resubmit the lead to retry delivery.`,
      html: undefined,
    },
    intakeCustomer,
    intakeTeam,
    { subject: `Project review requested: ${estimateReference(ESTIMATE_ID)}`, text: "P5 Home Co: customer requested a project review." },
    // A team email that happens to hold the customer template's markers is still not the customer email.
    { subject: `P5 Home Co: internal estimate record (ref ${ref})`, text: "Contract price", html: `<p>Hi Ada,</p><p>Thank you for using the ${THANKS}</p>` },
    { subject: "Re: Your P5 Home Co preliminary estimate P5-0F1E2D3C", text: "A reply", html: "<p>A reply</p>" },
  ];
  for (const message of messages) {
    const frozen = JSON.parse(JSON.stringify(message));
    const sent = decoratePreliminaryEstimateEmail(message);
    assert.equal(sent, message, `${message.subject} is returned as the same object`);
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), frozen, `${message.subject} keeps every byte`);
    assert.doesNotMatch(`${sent.text}\n${sent.html ?? ""}`, AFTER_ESTIMATE, message.subject);
    assert.ok(!`${sent.text}\n${sent.html ?? ""}`.includes(SCHEDULE_URL), message.subject);
  }
  // The team record keeps its figures; the customer copy of the same estimate never gains them.
  assert.match(admin.text, /Contract price: \$7,166/);
});

test("markup the decorator does not recognise keeps its content and still gets the whole block", () => {
  // The frame without the opening paragraph: everything goes where the letter ends, above the footer.
  const footer = `</td></tr>\n <tr><td class="pad" style="padding:18px 28px 22px;border-top:1px solid #E1E5DD"><p>P5 Home Co | footer</p></td></tr></table></body></html>`;
  const framed = decoratePreliminaryEstimateEmail({
    subject: "Your P5 Home Co preliminary estimate EST-1",
    text: "P5 Home Co\nTotal",
    html: `<html><body><table><tr><td><p>Total</p>${footer}`,
  });
  assertAfterEstimateWording(framed);
  assert.ok(framed.html.startsWith("<html><body><table><tr><td><p>Total</p><p "));
  assert.ok(framed.html.endsWith(`${FAMILY_PS}</p>${footer}`));

  const plain = decoratePreliminaryEstimateEmail({ subject: "Your P5 Home Co preliminary estimate EST-2", text: "P5 Home Co\n\nTotal", html: "<html><body><p>Total</p></body></html>" });
  assertAfterEstimateWording(plain);
  assert.ok(plain.html.startsWith("<html><body><p>Total</p><p "));
  assert.ok(plain.html.endsWith(`${FAMILY_PS}</p></body></html>`));
  assert.ok(plain.text.startsWith(`P5 Home Co\n\n${NEXT_STEP}`) && plain.text.includes("\n\nTotal\n\n"));

  const fragment = decoratePreliminaryEstimateEmail({ subject: "Your P5 Home Co preliminary estimate EST-3", text: "Total", html: "<p>Total</p>" });
  assertAfterEstimateWording(fragment);
  assert.ok(fragment.html.startsWith("<p>Total</p>") && fragment.html.endsWith(`${FAMILY_PS}</p>`));
  assert.ok(fragment.text.startsWith("Total\n\n"));

  // The thank-you line with neither greeting nor view button: the closing follows the schedule block.
  const bare = decoratePreliminaryEstimateEmail({ subject: "Your P5 Home Co preliminary estimate EST-4", text: "Total", html: `<p>Hello,</p><p>Thank you. ${THANKS}</p><p>Total</p>` });
  assertAfterEstimateWording(bare);
  assert.ok(bare.html.startsWith(`<p>Hello,</p><p>Thank you. ${THANKS}</p><p style=`));
  assert.ok(bare.html.indexOf(DISCLAIMER_START) < bare.html.indexOf("<p>Total</p>"));

  const textOnly = decoratePreliminaryEstimateEmail({ subject: "Your P5 Home Co preliminary estimate EST-5", text: "Total" });
  assert.equal(textOnly.html, undefined);
  assertAfterEstimateWording(textOnly);

  // It never throws: a message it cannot read is sent as it was built.
  const error = console.error;
  console.error = () => {};
  try {
    const broken = { subject: "Your P5 Home Co preliminary estimate EST-6", text: undefined as unknown as string, html: "<p>Total</p>" };
    assert.equal(decoratePreliminaryEstimateEmail(broken), broken);
  } finally {
    console.error = error;
  }
});

/** Runs the real lib/p5/deliveryAdapter.ts against a transport double, with this site's decorator in place. */
function adapterWithDecorator() {
  const calls: { subject: string; text: string; html?: string; to: string; attachments: unknown; messageId: string }[] = [];
  const exports: { sendEmail?: (input: Record<string, unknown>) => Promise<string> } = {};
  const deps: Record<string, unknown> = {
    "./leadAttribution.ts": {},
    "./emailReplyTo.ts": { safeEmailReplyTo },
    "./brand.ts": { ESTIMATOR_BRAND },
    nodemailer: {
      createTransport: () => ({
        sendMail: async (body: (typeof calls)[number]) => {
          calls.push(body);
          return { accepted: [body.to], rejected: [], messageId: body.messageId };
        },
      }),
    },
    "../../app/lib/notifications/smtp-config.ts": {
      getSmtpConfig: () => ({ from: "P5 Home Co <hello@p5homeco.com>", replyTo: "hello@p5homeco.com", options: {} }),
      assertSmtpAccepted: smtpConfig.assertSmtpAccepted,
      decoratePreliminaryEstimateEmail: smtpConfig.decoratePreliminaryEstimateEmail,
    },
    "../../app/lib/notifications/dispatch.ts": {},
    "../../app/lib/leads/intake.ts": {},
    "../../app/lib/leads/synthetic-qa.ts": {},
    "../../app/lib/leads/settings.ts": {},
  };
  const compiled = ts.transpileModule(readFileSync("lib/p5/deliveryAdapter.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(deps, name), `Unexpected adapter dependency: ${name}`);
      return deps[name];
    },
    Buffer,
    process: { env: {} },
  });
  return { sendEmail: exports.sendEmail!, calls };
}

test("the delivery adapter decorates the customer estimate email as it sends it, and only that one", async () => {
  // The decorator the adapter imports is this site's, passed on by the one mail module the shared transport test allows.
  assert.equal(smtpConfig.decoratePreliminaryEstimateEmail, decoratePreliminaryEstimateEmail);
  const source = readFileSync("lib/p5/deliveryAdapter.ts", "utf8");
  assert.match(source, /import \{[^}]*\bdecoratePreliminaryEstimateEmail\b[^}]*\} from "\.\.\/\.\.\/app\/lib\/notifications\/smtp-config\.ts";/);
  assert.match(source, /const message=typeof decoratePreliminaryEstimateEmail==="function"\?decoratePreliminaryEstimateEmail\(input\):input;/);
  assert.match(source, /subject:message\.subject,text:message\.text,html:message\.html,attachments:input\.attachments/);

  const record = savedEstimate();
  const customer = withLinkSecret(true, () => estimateEmail(ESTIMATE_ID, record, false));
  const admin = withLinkSecret(true, () => estimateEmail(ESTIMATE_ID, record, true));
  const adapter = adapterWithDecorator();
  const attachments = [{ filename: "estimate.pdf", content: Buffer.from("pdf") }];

  await adapter.sendEmail({ to: "qa@example.invalid", subject: ESTIMATE_SUBJECT, ...customer, attachments, key: "customer-key" });
  const sent = adapter.calls.at(-1)!;
  const expected = decoratePreliminaryEstimateEmail({ subject: ESTIMATE_SUBJECT, ...customer });
  assert.equal(sent.subject, ESTIMATE_SUBJECT);
  assert.equal(sent.text, expected.text);
  assert.equal(sent.html, expected.html);
  assertAfterEstimateWording(sent);
  assert.match(sent.html ?? "", />Hey Ada,<\/p>/);
  assert.equal(sent.to, "qa@example.invalid");
  assert.equal(sent.attachments, attachments, "the PDF is sent as it was built");
  assert.equal(sent.messageId, "<customer-key@p5homeco.com>");

  const adminSubject = `P5 Home Co: internal estimate record (ref ${ESTIMATE_ID.slice(0, 8)})`;
  await adapter.sendEmail({ to: "team@example.invalid", subject: adminSubject, ...admin, attachments, key: "admin-key" });
  const team = adapter.calls.at(-1)!;
  assert.equal(team.subject, adminSubject);
  assert.equal(team.text, admin.text);
  assert.equal(team.html, admin.html);

  const alert = { to: "team@example.invalid", subject: `P5 Home Co: estimate delivery needs attention (ref ${ESTIMATE_ID.slice(0, 8)})`, text: "Estimate needs delivery review.", html: undefined, attachments: [], key: "alert-key" };
  await adapter.sendEmail(alert);
  assert.equal(adapter.calls.at(-1)!.text, alert.text);
  assert.equal(adapter.calls.at(-1)!.html, undefined);
});

