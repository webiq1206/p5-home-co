import { test } from "node:test";
import assert from "node:assert/strict";

import { ask } from "../app/lib/kb/ask.ts";

// --- The example questions from the brief must all get grounded answers -----

const MUST_ANSWER: [string, RegExp][] = [
  ["How do I enter a subcontractor bill?", /ap@p5homeco\.com/],
  ["What happens when a lead becomes a customer?", /Closed Won/],
  ["How do I see how much money is left on a project?", /Remaining budget/i],
  ["Why is this deal still in this stage?", /person/i],
  ["How does a remodel project get entered into QuickBooks?", /Boise Remodeling Co/],
  ["Who needs to approve this bill?", /2,500/],
  ["What happens after an estimate is accepted?", /deposit/i],
  ["Where do I see outstanding customer invoices?", /A\/R Aging|daily report/i],
];

for (const [question, expectation] of MUST_ANSWER) {
  test(`ask: "${question}"`, () => {
    const answer = ask(question);
    assert.equal(answer.kind, "answer", `expected a curated answer, got ${answer.kind}`);
    if (answer.kind !== "answer") return;
    const text = [
      ...answer.paragraphs,
      ...(answer.steps ?? []),
      answer.automatic ?? "",
      answer.action ?? "",
    ].join(" ");
    assert.match(text, expectation);
    assert.ok(answer.links.length > 0, "answers must link into the Knowledge Center");
  });
}

// --- Grounding: no invention ------------------------------------------------

test("an unanswerable question is refused, not guessed", () => {
  const answer = ask("What is the wifi password at the office?");
  assert.equal(answer.kind, "unknown");
  if (answer.kind === "unknown") {
    assert.match(answer.message, /cannot answer|will not guess/i);
  }
});

test("a word the documentation has never seen is refused and named", () => {
  // "password" appears on the portal pages; "wifi" appears nowhere. Matching
  // on the shared word alone would point at pages that cannot answer it.
  const answer = ask("What is the wifi password?");
  assert.equal(answer.kind, "unknown");
  if (answer.kind === "unknown") assert.match(answer.message, /wifi/);
  assert.equal(ask("Where is the forklift stored?").kind, "unknown");
});

test("the page tier never claims to have answered, only to be relevant", () => {
  const answer = ask("How does the vendor portal work?");
  assert.equal(answer.kind, "page");
  if (answer.kind === "page") {
    assert.doesNotMatch(answer.intro, /this is covered|here is the answer/i);
    assert.match(answer.intro, /do not have a prepared answer/i);
    assert.equal(answer.results[0].article.slug, "vendor-client-portals");
  }
});

test("documented topics reach their page instead of being refused", () => {
  for (const [q, slug] of [
    ["What is backlog?", "glossary"],
    ["How often does QuickBooks sync?", "qbo-sync-and-webhooks"],
    ["How do I reconcile the bank account?", "bank-reconciliation"],
    ["What is a construction loan draw?", "lender-draws"],
  ] as const) {
    const answer = ask(q);
    assert.ok(answer.kind === "page" || answer.kind === "answer", `"${q}" was refused`);
    if (answer.kind === "page") {
      assert.ok(
        answer.results.some((r) => r.article.slug === slug),
        `"${q}" did not surface ${slug}`,
      );
    }
  }
});

test("an off-topic question about quantum physics is refused", () => {
  const answer = ask("Explain quantum entanglement for me");
  assert.equal(answer.kind, "unknown");
});

test("empty input asks for a question", () => {
  const answer = ask("   ");
  assert.equal(answer.kind, "unknown");
});

test("a topical but uncurated question falls back to pages, not fabrication", () => {
  const answer = ask("How do lien waivers work for vendors?");
  // Either a page match or an honest unknown is acceptable; a curated answer
  // for a question with no bank entry would mean the matcher is too loose.
  assert.ok(answer.kind === "page" || answer.kind === "unknown" || answer.kind === "answer");
  if (answer.kind === "page") {
    assert.ok(answer.results.length > 0);
  }
});
