import {DEFAULT_FINANCE} from "../lib/p5/pricing.ts";
/**
 * Guided estimator, owner decisions of 21 November 2026:
 *
 *  A. Design and engineered plans. Projects that need permit drawings ask
 *     whether the customer has plans; when they do not, the cost book's
 *     design and engineering lines are priced. Permit fees are priced for
 *     those projects. One short note under the range says what the price
 *     assumes, and it is generated from the scope and checked against it.
 *  B. Handyman one-hour minimum. No handyman visit is shown for less than one
 *     hour at the labor rate in Pricing setup, at either end of its range,
 *     and the customer is told how labor is billed.
 *
 * No network, no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
import { FLOWS, flowById } from "../app/lib/estimator/flows.ts";
import { HOURLY_MINIMUM_NOTE, narrativeProblems } from "../app/lib/estimator/narrative.ts";
import { ESTIMATOR_RULES_VERSION, HANDYMAN_HOURLY_RATE, customerEstimate, internalReport, priceEstimate, priceWithheld, type PricedEstimate } from "../app/lib/estimator/price.ts";
import { DESIGN_CODES, ENGINEERING_CODES } from "../app/lib/estimator/recipes.ts";
import { publicEstimate, type Answers, type BrandId, type CustomerEstimate, type Tier } from "../app/lib/estimator/types.ts";
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from "../app/lib/scopes/types.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const ADDRESS = "100 Example Ave, Boise, ID 83702";
const PLANS_PROJECTS = ["custom-home", "addition", "garage-shop", "adu"];
const ANSWERS = ["complete", "design", "none"] as const;

function price(project: string, answers: Answers, opts: { tier?: Tier; brand?: BrandId; settings?: ScopeSettings; address?: string | null } = {}): PricedEstimate {
  return priceEstimate(
    { brand: opts.brand ?? "p5", project, tier: opts.tier ?? "mid", answers, address: opts.address === undefined ? ADDRESS : opts.address, property: null },
    { now: NOW, settings: opts.settings, finance:{...DEFAULT_FINANCE,interestRate:0,companyTaxRate:0,netCostSource:"Illustrative all-inclusive overhead allocation"} },
  );
}

const codes = (e: PricedEstimate) => e.doc.tasks.map((t) => String(t.costCode ?? ""));
const view = (e: PricedEstimate): CustomerEstimate => customerEstimate(e, { token: "t".repeat(40), address: ADDRESS, createdAt: NOW, officialCopy: "after-review" });

/** Every first-question answer of a plans project, so each kind of building is covered. */
function variants(project: string): Answers[] {
  const flow = flowById(project)!;
  const first = flow.questions[0];
  return first.kind === "choice" ? first.options.map((o) => ({ [first.id]: o.id })) : [{}];
}

// ------------------------------------------------------------------ plans

test("projects that need permit drawings ask whether the customer has plans, and no other project does", () => {
  for (const flow of FLOWS) {
    const q = flow.questions.find((x) => x.id === "plans");
    if (!PLANS_PROJECTS.includes(flow.id)) {
      assert.equal(q, undefined, `${flow.id} should not ask about plans`);
      continue;
    }
    assert.ok(q && q.kind === "choice", `${flow.id} has no plans question`);
    assert.deepEqual(q.options.map((o) => o.id), [...ANSWERS]);
    assert.equal(q.default, "none", "an unanswered question prices design and engineering");
    assert.equal(q.showIf, undefined, "the question is always shown");
    assert.match(q.prompt, /^Do you already have design and engineered plans for the .+\?$/);
    // Every wording rule for customer copy: no em dash, no quote, no number of minutes.
    assert.doesNotMatch(JSON.stringify(q), /—|\bquote\b|minute/i);
  }
  // Second-story additions are additions, so they are covered by the addition question.
  assert.ok(flowById("addition")!.questions.some((x) => x.kind === "choice" && x.options.some((o) => o.id === "second")));
});

test("having plans or not changes the design and engineering in the scope, and permits are always priced", () => {
  for (const project of PLANS_PROJECTS) {
    for (const base of variants(project)) {
      const [complete, design, none] = ANSWERS.map((plans) => price(project, { ...base, plans }));
      const label = `${project} ${JSON.stringify(base)}`;
      for (const e of [complete, design, none]) {
        assert.ok(codes(e).some((c) => c.startsWith("00-20")), `${label}: no permit fee is priced`);
        assert.equal(priceWithheld(e), false, `${label}: ${JSON.stringify(e.review)}`);
        assert.deepEqual(e.review.map((r) => r.code), ["budgetary"], `${label}: ${JSON.stringify(e.review)}`);
      }
      // Complete plans: neither design nor engineering is priced.
      assert.ok(!codes(complete).some((c) => DESIGN_CODES.has(c) || ENGINEERING_CODES.has(c)), `${label}: complete plans still price design or engineering`);
      // A design but no engineering: no design line.
      assert.ok(!codes(design).some((c) => DESIGN_CODES.has(c)), `${label}: the customer's own design is priced again`);
      // No plans: design is priced.
      assert.ok(codes(none).some((c) => DESIGN_CODES.has(c)), `${label}: no design priced without plans`);
      // Engineering is priced wherever the cost book has an item for it; a
      // detached garage or shop has none, so it is "not yet determined".
      for (const e of [design, none]) {
        if (project === "garage-shop") {
          assert.ok(!codes(e).some((c) => ENGINEERING_CODES.has(c)));
          assert.ok(view(e).guide.undetermined.some((s) => /^Structural engineering, if your building department requires it/.test(s)), `${label}: engineering is not listed as not yet determined`);
        } else {
          assert.ok(codes(e).some((c) => ENGINEERING_CODES.has(c)), `${label}: no engineering priced without engineered plans`);
          assert.ok(!view(e).guide.undetermined.some((s) => /^Structural engineering/.test(s)));
        }
      }
      assert.ok(!view(complete).guide.undetermined.some((s) => /^Structural engineering/.test(s)));
      // More work for the team is a higher price, never a lower one.
      assert.ok(complete.pricing.totals.basePrice <= design.pricing.totals.basePrice, label);
      assert.ok(design.pricing.totals.basePrice < none.pricing.totals.basePrice, label);
      // The design and engineering lines are priced from the cost book like every other line.
      for (const line of none.pricing.lines.filter((l) => l.division === "00")) {
        assert.equal(line.basis, "cost-book", `${label}: ${line.description}`);
        assert.ok(line.cost !== null && line.cost > 0);
      }
      // Permits are no longer listed as excluded, and neither is design.
      for (const e of [complete, design, none]) assert.ok(!view(e).guide.excluded.some((s) => /permit|^design/i.test(s)), `${label}: ${JSON.stringify(view(e).guide.excluded)}`);
    }
  }
  // A missing or unknown answer is the same as "none".
  assert.deepEqual(price("custom-home", {}).pricing.totals, price("custom-home", { plans: "none" }).pricing.totals);
  assert.deepEqual(price("custom-home", { plans: "nonsense" }).pricing.totals, price("custom-home", { plans: "none" }).pricing.totals);
});

test("the note under the range says what the price assumes about plans, and matches the scope", () => {
  const notes = (project: string, answers: Answers) => view(price(project, answers)).guide.rangeNotes;
  assert.deepEqual(notes("custom-home", { plans: "none" }), ["Includes design, engineered plans and permit fees."]);
  assert.deepEqual(notes("custom-home", { plans: "design" }), ["Includes engineering and permit fees. Assumes you provide the design drawings."]);
  assert.deepEqual(notes("custom-home", { plans: "complete" }), ["Includes permit fees. Assumes you provide complete design and engineered plans."]);
  assert.deepEqual(notes("garage-shop", { plans: "none" }), ["Includes design drawings and permit fees. Engineering, if your building needs it, is not yet determined."]);
  for (const project of PLANS_PROJECTS) {
    for (const base of variants(project)) {
      for (const plans of ANSWERS) {
        const e = price(project, { ...base, plans });
        const v = view(e);
        assert.equal(v.guide.rangeNotes?.length, 1, `${project} ${plans}`);
        const note = v.guide.rangeNotes![0];
        assert.doesNotMatch(note, /—|\$|\d/, "the note carries no dash and no figure");
        assert.ok(note.length <= 140, note);
        if (plans === "complete") assert.match(note, /Assumes you provide complete design and engineered plans\.$/);
        if (plans === "design") assert.match(note, /Assumes you provide the design drawings\./);
        if (plans === "none") assert.match(note, /^Includes design/);
        // The assumption is said in the guide too.
        if (plans !== "none") assert.ok(v.guide.assumptions.some((s) => /^You provide /.test(s)));
      }
    }
  }
  // A project that does not ask about plans has no plans note.
  for (const project of ["kitchen-remodel", "bathroom-remodel", "whole-home", "basement-finish", "flooring"]) assert.deepEqual(view(price(project, {})).guide.rangeNotes, []);
});

test("the narrative check refuses a note that the scope does not support", () => {
  const e = price("custom-home", { plans: "complete" });
  const base = e.pricing.lines.filter((l) => !l.optional);
  const pricedCodes = codes(e);
  assert.deepEqual(narrativeProblems(e.guide, e.divisions, e.range, base, e.divisionShares, pricedCodes), []);
  const claim = (note: string) => narrativeProblems({ ...e.guide, rangeNotes: [note] }, e.divisions, e.range, base, e.divisionShares, pricedCodes);
  assert.ok(claim("Includes design, engineered plans and permit fees.").some((p) => /no design line/.test(p)));
  assert.ok(claim("Includes engineering and permit fees. Assumes you provide the design drawings.").some((p) => /no engineering line/.test(p)));
  const none = price("custom-home", { plans: "none" });
  const noneBase = none.pricing.lines.filter((l) => !l.optional);
  assert.ok(
    narrativeProblems({ ...none.guide, rangeNotes: ["Includes permit fees. Assumes you provide complete design and engineered plans."] }, none.divisions, none.range, noneBase, none.divisionShares, codes(none)).some((p) =>
      /design or engineering is priced/.test(p),
    ),
  );
  // Without permit lines a permit claim is refused.
  const kitchen = price("kitchen-remodel", { scope: "refresh" });
  const kBase = kitchen.pricing.lines.filter((l) => !l.optional);
  assert.ok(narrativeProblems({ ...kitchen.guide, rangeNotes: ["Includes permit fees. Assumes you provide complete design and engineered plans."] }, kitchen.divisions, kitchen.range, kBase, kitchen.divisionShares, codes(kitchen)).some((p) => /no permit line/.test(p)));
});

test("the note reaches the saved link, and estimates saved before it read without one", () => {
  const v = view(price("adu", { type: "detached", plans: "none" }));
  assert.deepEqual(publicEstimate(v).guide.rangeNotes, ["Includes design, engineered plans and permit fees."]);
  const old = JSON.parse(JSON.stringify(v)) as CustomerEstimate;
  delete old.guide.rangeNotes;
  assert.deepEqual(publicEstimate(old).guide.rangeNotes, []);
  // The customer's estimate page shows it under the range.
  const page = readFileSync(path.join(import.meta.dirname, "../components/estimator/EstimateView.tsx"), "utf8");
  assert.match(page, /guide\.rangeNotes/);
  // A withheld estimate shows no note.
  const withheld = customerEstimate({ ...price("adu", { plans: "none" }), review: [{ code: "cross-check", message: "x" }] }, { token: "t".repeat(40), address: null, createdAt: NOW, officialCopy: "after-review" });
  assert.deepEqual(withheld.guide.rangeNotes, []);
});

test("the team sees the plans answer in the selections", () => {
  const e = price("addition", { type: "suite", plans: "design" });
  assert.ok(e.summary.includes("I have a design but not engineered plans"));
  const report = internalReport(e);
  assert.ok(report.lines.some((l) => l.code === "00-10-18"));
  assert.ok(!report.lines.some((l) => l.code === "00-10-08"));
});

test("design, engineering and permit lines are cost book codes in recipes, never a dollar figure", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../app/lib/estimator/recipes.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\$\s?\d/);
  for (const code of ["00-10-04", "00-10-06", "00-10-07", "00-10-08", "00-10-12", "00-10-18", "00-20-01", "00-20-02", "00-20-03", "00-20-04", "00-20-05", "00-20-06"]) {
    assert.match(source, new RegExp(`"${code}"`), `${code} is not used`);
  }
  assert.equal(ESTIMATOR_RULES_VERSION, "P5-NET15-2026-11-24.2026-11-25.handyman-toilet-removal", "the version identifies both the pricing policy and current recipe");
});

// ------------------------------------------------------- handyman minimum

const HANDYMAN_TASKS = (() => {
  const q = flowById("handyman")!.questions[0];
  return q.kind === "tasks" ? q.options : [];
})();

test("handyman: no visit is shown for less than one hour at the Handyman Co rate, at either end of the range", () => {
  for (const laborRate of [120, 125, 250, 400]) {
    const settings: ScopeSettings = { ...DEFAULT_SCOPE_SETTINGS, laborRate };
    for (const address of [ADDRESS, null]) {
      for (const task of HANDYMAN_TASKS) {
        const e = price("handyman", { tasks: { [task.id]: 1 } }, { settings, address, brand: "handyman" });
        // Handyman Co bills $95/hour whatever the general labor setting (owner, 24 November 2026).
        assert.ok(e.range.low >= HANDYMAN_HOURLY_RATE, `${task.id} at $${laborRate}/hr starts at ${e.range.low}`);
        assert.ok(e.pricing.totals.basePrice >= HANDYMAN_HOURLY_RATE);
        assert.equal(priceWithheld(e), false, `${task.id} at $${laborRate}: ${JSON.stringify(e.review)}`);
        assert.deepEqual(e.review, [], `${task.id} at $${laborRate}: ${JSON.stringify(e.review)}`);
        assert.notEqual(e.pricing.totals.baseCost, null, "the minimum keeps its cost known");
        // The trip charge still nets to zero.
        assert.equal(Math.round(e.pricing.lines.filter((l) => l.basis === "trip-charge").reduce((s, l) => s + l.price * 100, 0)), 0);
      }
    }
  }
  // The general labor setting no longer moves a handyman job: Handyman Co bills
  // $95/hour, so the $135 book minimum service charge is the floor (owner, 24 November 2026).
  const high = price("handyman", { tasks: { "hang-art": 1 } }, { settings: { ...DEFAULT_SCOPE_SETTINGS, laborRate: 400 } });
  const balance = high.pricing.lines.find(l => l.taskId === "gmin");
  assert.equal(balance?.cost,0);
  assert.equal(balance?.description,"Balance to the minimum service charge");
  const work = high.pricing.lines
    .filter((l) => l.basis === "cost-book" || l.basis === "trip-charge")
    .reduce((s, l) => s + l.price, 0);
  assert.ok(work >= 135 && work < 137.5, `work+minimum ${work}`);
  assert.ok(high.pricing.totals.basePrice >= 135, `minimum ${high.pricing.totals.basePrice}`);
  // A long list is never padded.
  const long = price("handyman", { tasks: { faucet: 3, "paint-room": 2 } }, { settings: { ...DEFAULT_SCOPE_SETTINGS, laborRate: 400 } });
  assert.ok(!long.pricing.lines.some((l) => l.taskId === "gmin"));
});

test("handyman: at today's rate the cost book minimum already exceeds one hour, so no single job moves", () => {
  for (const laborRate of [120, 125]) {
    for (const task of HANDYMAN_TASKS) {
      const e = price("handyman", { tasks: { [task.id]: 1 } }, { settings: { ...DEFAULT_SCOPE_SETTINGS, laborRate } });
      const balance = e.doc.tasks.find((t) => t.id === "gmin");
      assert.ok(!balance || balance.title === "Minimum service charge, balance", `${task.id} moved at $${laborRate}/hr`);
    }
  }
});

test("handyman: the customer sees how the visit minimum applies", () => {
  assert.equal(HOURLY_MINIMUM_NOTE, "Handyman labor is billed by the hour. The visit minimum is included in the total.");
  for (const brand of ["handyman", "p5"] as BrandId[]) {
    const v = view(price("handyman", { tasks: { faucet: 1 } }, { brand }));
    assert.deepEqual(v.guide.rangeNotes, [HOURLY_MINIMUM_NOTE]);
  }
  // The other projects a handyman site offers are priced per room or per square foot, well over an hour.
  for (const project of BRAND_CONFIGS.handyman.projects.filter((p) => p !== "handyman")) {
    const flow = flowById(project)!;
    const smallest: Answers = Object.fromEntries(flow.questions.map((q) => [q.id, q.kind === "number" ? q.min : q.kind === "choice" ? q.default : {}]));
    const e = price(project, smallest, { brand: "handyman", settings: { ...DEFAULT_SCOPE_SETTINGS, laborRate: 120 } });
    assert.ok(e.range.low >= 120, `${project} starts at ${e.range.low}`);
  }
});
