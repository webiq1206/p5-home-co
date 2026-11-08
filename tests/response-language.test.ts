import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Owner instruction (November 2026): say that we answer, and never promise a
 * response window on any site. This guard scans every customer-facing and
 * staff-facing source surface (pages, components, shared lib text, email and
 * callback templates, machine-readable llms files, brand docs) after
 * collapsing whitespace and JSX spacers, so a phrase split across lines or
 * JSX nodes cannot slip through.
 *
 * Out of scope on purpose: contract text (cancellation notice, warranty-report
 * acknowledgement, payment timing), internal SLA timers, rate caps and clock
 * formats. Those never promise a reply to a homeowner's question.
 */

const ROOTS = ["app", "components", "lib", "public", "docs/brand-profile.md", "README.md"];
const EXTENSIONS = /\.(?:ts|tsx|js|mjs|cjs|md|txt|json|html)$/;
// Signed contract templates describe warranty notice and payment timing, not inquiry replies.
const EXCLUDED = [/^app\/lib\/contracts\//, /^public\/p5-estimate\/LICENSE/];

const PROHIBITED: ReadonlyArray<[string, RegExp]> = [
  ["one or next business day", /\b(?:one|1|next)[\s-]+business[\s-]+days?\b/i],
  ["business day(s) to reply", /business[\s-]+days?\s+to\s+(?:reply|respond|answer|call)/i],
  ["within 24 hours", /\bwithin\s+(?:24|twenty[\s-]four)[\s-]*(?:hours?|hrs?|h)\b/i],
  ["24-hour reply", /\b(?:24|twenty[\s-]four)[\s-]*hours?\s+(?:reply|response|callback|call\s?back|turnaround)/i],
  [
    "reply or answer in minutes",
    /\b(?:reply|replies|respond|responds|answer|answers|call|calls|text|texts)\b[^.]{0,40}\b(?:in|within)\s+(?:(?:a|one|a\s+few|\d+)\s+)?minutes?\b/i,
  ],
  ["same-day reply", /\bsame[\s-]day\s+(?:reply|response|callback|call\s?back|answer)/i],
];

function walk(path: string): string[] {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return EXTENSIONS.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (name === "node_modules" || name.startsWith(".") ? [] : walk(join(path, name))));
}

function normalize(source: string): string {
  return source.replace(/\{\s*["'`]\s*["'`]\s*\}/g, " ").replace(/\s+/g, " ");
}

const files = ROOTS.flatMap(walk).filter((file) => !EXCLUDED.some((rule) => rule.test(file)));

test("the response-language guard scans the real public surfaces", () => {
  for (const required of [
    "app/HomePageClient.tsx",
    "app/quote/ThanksMessage.tsx",
    "app/quote/AbandonmentPrompt.tsx",
    "app/estimate/page.tsx",
    "app/lib/leads/estimatorSessions.ts",
    "components/SiteChat.tsx",
    "components/ShortRequestForm.tsx",
    "public/llms.txt",
    "public/llms-full.txt",
  ]) {
    assert.ok(files.includes(required), `${required} must be scanned`);
  }
});

test("no source promises a response window", () => {
  const hits: string[] = [];
  for (const file of files) {
    const text = normalize(readFileSync(file, "utf8"));
    for (const [label, pattern] of PROHIBITED) {
      const match = text.match(pattern);
      if (match) hits.push(`${file}: ${label}: "${match[0]}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the guard catches split and numeral variants", () => {
  const samples = [
    "We reply within one\n business day.",
    'The right team replies within one{" "}\n business day.',
    "1 business day to reply",
    "one-business-day reply",
    "We respond within 24 hours.",
    "A quick call or text answers most questions in a minute.",
    "We reply in minutes during business hours.",
  ];
  for (const sample of samples) {
    const text = normalize(sample);
    assert.ok(PROHIBITED.some(([, pattern]) => pattern.test(text)), sample);
  }
});

test("the guard leaves unrelated timing alone", () => {
  for (const sample of [
    "Sign-in links expire within minutes of being issued.",
    "It works once and expires in 15 minutes.",
    "Cancel with 24-hour notice.",
    "Saturday is a business day and Sunday is not.",
  ]) {
    const text = normalize(sample);
    assert.equal(PROHIBITED.some(([, pattern]) => pattern.test(text)), false, sample);
  }
});

test("the homepage and request flows say that we answer", () => {
  const home = normalize(readFileSync("app/HomePageClient.tsx", "utf8"));
  assert.match(home, /We answer questions and connect you with the right P5 specialist/);
  assert.doesNotMatch(home, /business day to reply/);
  for (const file of ["components/ShortRequestForm.tsx", "app/quote/ThanksMessage.tsx", "public/llms.txt"]) {
    assert.match(normalize(readFileSync(file, "utf8")), /answers? your questions/, file);
  }
});

/**
 * Owner decisions, 8 November 2026 (release 2). Public source must not claim
 * the companies are bonded (D2), must not promise one contract or one invoice
 * (D3), and must not promise an instant or same-day estimate or financing
 * approval (D4). Brand docs are left out: they record the decision itself.
 */
const PUBLIC_CLAIM_FILES = files.filter((file) => !/^(?:docs\/|README\.md$)/.test(file));
// Internal finance and admin code counts real invoices; that is not a customer promise.
const INTERNAL = [/^app\/lib\/finance\//, /^app\/admin\//, /^app\/api\/admin\//];

const PROHIBITED_CLAIMS: ReadonlyArray<[string, RegExp, boolean]> = [
  ["bonded", /\bbonded\b/i, false],
  ["one contract", /\b(?:one|single)\s+contract\b/i, true],
  ["one invoice", /\b(?:one|single)\s+invoice\b/i, true],
  ["instant estimate", /\binstant(?:ly)?\s+(?:online\s+)?(?:estimates?|estimator|prices?|pricing|quotes?|ranges?)\b/i, false],
  ["estimate in minutes", /\b(?:estimates?|prices?|quotes?|ranges?)\b[^.]{0,40}\bin\s+(?:a\s+few\s+|\d+\s+)?minutes\b/i, false],
  ["same-day financing", /\bsame[\s-]day\s+(?:financing|approval|approvals|credit)\b/i, false],
];

test("no public source claims bonded, one contract or invoice, or an instant estimate", () => {
  const hits: string[] = [];
  for (const file of PUBLIC_CLAIM_FILES) {
    const text = normalize(readFileSync(file, "utf8"));
    for (const [label, pattern, publicOnly] of PROHIBITED_CLAIMS) {
      if (publicOnly && INTERNAL.some((rule) => rule.test(file))) continue;
      const match = text.match(pattern);
      if (match) hits.push(`${file}: ${label}: "${match[0]}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the claims guard catches the removed phrases", () => {
  for (const sample of [
    "Bonded and insured",
    "licensed, bonded and insured",
    "One contract, one project manager, one invoice.",
    "under one contract",
    "a single invoice for the whole job",
    "Get an instant estimate",
    "Instant price range",
    "See your estimate in minutes",
    "Same-day financing approval",
  ]) {
    const text = normalize(sample);
    assert.ok(PROHIBITED_CLAIMS.some(([, pattern]) => pattern.test(text)), sample);
  }
  for (const sample of ["Insured; certificate on request.", "One accountable company and one point of contact for your project."]) {
    assert.equal(PROHIBITED_CLAIMS.some(([, pattern]) => pattern.test(normalize(sample))), false, sample);
  }
});
