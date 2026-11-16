/**
 * Lead confirmation wording and the Schedule now button. No mail is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { customerConfirmation } from "../app/lib/estimator/emails.ts";
import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
import { ADJUST_NOTE, BIGGER_PLAN_QUESTION, FAMILY_BRANDS, familyNote } from "../app/lib/estimator/family.ts";
import { SCHEDULE_URL, estimatorConfirmation, requestConfirmation, scheduleIntentFor } from "../app/lib/leads/scheduleEmail.ts";

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
  // The same invitation and question the results screen shows (owner request, 17 November 2026).
  assert.ok(message.text.includes(ADJUST_NOTE));
  assert.match(message.text, /P\.S\. Is this the whole project, or one piece of something bigger\? P5 Home Co is the company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co\./);
  assert.ok(message.text.trimEnd().endsWith("tell us and we'll plan it together."), "the question closes the email");
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
    "Boise Cabinet Co is part of P5 Home Co, the company behind Boise Construction Co, Boise Remodeling Co and Boise Handyman Co. If a full kitchen or bath remodel, an addition, a new home or a repair list is on your mind too, tell us and we'll plan it together.",
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
