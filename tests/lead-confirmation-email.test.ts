/**
 * Lead confirmation wording and the Schedule now button. No mail is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { customerConfirmation } from "../app/lib/estimator/emails.ts";
import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
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
  assert.match(message.text, /^Hi Jared,/);
  assert.match(message.text, /Thanks for thinking of P5 Home Co for your kitchen remodel\. Your estimate is saved, and you can pull it up any time\./);
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
    assert.match(message.text, new RegExp(`Thanks for thinking of ${brand.name}`));
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
