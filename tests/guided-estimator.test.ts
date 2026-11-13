/**
 * Guided estimator: every guard that keeps a wrong or leaked number away
 * from a customer. No network, no database.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
import { customerConfirmation, teamReport } from "../app/lib/estimator/emails.ts";
import { FLOWS, TRADES, estimatorEntry, flowById } from "../app/lib/estimator/flows.ts";
import {
  CROSS_CHECK_BAND,
  MARGIN_FLOOR,
  customerEstimate,
  internalReport,
  priceEstimate,
  priceWithheld,
  qualify,
  type PricedEstimate,
} from "../app/lib/estimator/price.ts";
import { qboAction, qboMode, rangeNote } from "../app/lib/estimator/deliver.ts";
import { BANNED_WORDING, SHARE_NOTE, narrativeProblems } from "../app/lib/estimator/narrative.ts";
import { fromCountyProfile, fromRentCast, mergeProperty } from "../app/lib/estimator/property.ts";
import { buildRecipe, recipeProjects } from "../app/lib/estimator/recipes.ts";
import { shareProfileCodes, splitByDivision } from "../app/lib/estimator/shares.ts";
import type { GuidedRow } from "../app/lib/estimator/store.ts";
import { handleSubmit } from "../app/lib/estimator/submit.ts";
import { resolveAnswers, type Answers, type BrandId, type Tier } from "../app/lib/estimator/types.ts";
import { costBookEntry } from "../app/lib/scopes/costbook.ts";
import { buildEstimatePayload } from "../app/lib/scopes/estimate.ts";
import { P5_ITEMS } from "../app/lib/scopes/qbo.ts";
import type { ItemKey } from "../app/lib/scopes/types.ts";

const NOW = new Date("2026-11-13T12:00:00Z");
const TIERS: Tier[] = ["builder", "mid", "high", "luxury"];
const cents = (n: number) => Math.round(n * 100);

/** Every distinct set of resolved answers for a flow: all choices, numbers at min, default and max. */
function combinations(projectId: string): Answers[] {
  const flow = flowById(projectId)!;
  let list: Answers[] = [{}];
  for (const q of flow.questions) {
    const values: Answers[string][] =
      q.kind === "choice" ? q.options.map((o) => o.id) : q.kind === "number" ? [q.min, q.default, q.max] : [{ [q.options[0].id]: 1 }, Object.fromEntries(q.options.map((o) => [o.id, o.max]))];
    list = list.flatMap((a) => values.map((v) => ({ ...a, [q.id]: v })));
  }
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = JSON.stringify(resolveAnswers(flow, a));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function price(project: string, answers: Answers, tier: Tier = "mid", brand: BrandId = "p5"): PricedEstimate {
  return priceEstimate({ brand, project, tier, answers, address: "100 Example Ave, Boise, ID 83702", property: null }, { now: NOW });
}

const ALL: { project: string; tier: Tier; estimate: PricedEstimate }[] = [];
for (const flow of FLOWS) {
  for (const tier of flow.usesFinish ? TIERS : (["mid"] as Tier[])) {
    for (const answers of combinations(flow.id)) ALL.push({ project: flow.id, tier, estimate: price(flow.id, answers, tier) });
  }
}

test("every brand offers only projects that exist, and every project has a recipe", () => {
  const recipes = new Set(recipeProjects());
  for (const flow of FLOWS) assert.ok(recipes.has(flow.id), `${flow.id} has no recipe`);
  for (const brand of Object.values(BRAND_CONFIGS)) {
    assert.ok(brand.projects.length > 0, `${brand.id} has no projects`);
    for (const id of brand.projects) assert.ok(flowById(id), `${brand.id} lists unknown project ${id}`);
  }
  assert.equal(recipes.size, FLOWS.length, "a recipe exists for a project that has no flow");
});

test("recipes carry cost book codes and quantities, never a dollar figure", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../app/lib/estimator/recipes.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\$\s?\d/, "a dollar amount is written into a recipe");
  assert.doesNotMatch(code, /unitCost|unitPrice|\bprice\s*:/, "a recipe sets a price");
});

test("every recipe line is a real, priceable cost book line with a positive quantity", () => {
  assert.ok(ALL.length > 3000, `expected the full matrix, got ${ALL.length}`);
  for (const { project, tier, estimate } of ALL) {
    const recipe = buildRecipe(project, { answers: estimate.answers, tier, property: null })!;
    assert.ok(recipe.lines.length > 0, `${project} ${JSON.stringify(estimate.answers)} produced no work`);
    for (const line of recipe.lines) {
      const entry = costBookEntry(line.code);
      assert.ok(entry, `${project}: ${line.code} is not in the cost book`);
      assert.equal(entry.percentage, false, `${project}: ${line.code} is a percentage line`);
      assert.ok(Number.isFinite(line.qty) && line.qty > 0, `${project}: ${line.code} has quantity ${line.qty}`);
      assert.doesNotMatch(line.text, /\d{2}-\d{2}-\d{2}|—/, `${project}: customer text carries a code or an em dash`);
    }
    // Nothing the customer selected may silently vanish between recipe and price.
    const priced = estimate.pricing.lines.filter((l) => l.basis === "cost-book" && l.taskId !== "gmin").length;
    assert.equal(priced, recipe.lines.length, `${project} ${JSON.stringify(estimate.answers)}: ${recipe.lines.length - priced} line(s) were not priced`);
  }
});

test("no work is charged twice in one estimate", () => {
  for (const { project, estimate } of ALL) {
    const codes = estimate.doc.tasks.map((t) => t.costCode);
    assert.equal(new Set(codes).size, codes.length, `${project} ${JSON.stringify(estimate.answers)} repeats a cost book line`);
  }
});

test("division ranges reconcile with the total range and with the priced lines", () => {
  for (const { project, estimate } of ALL) {
    if (priceWithheld(estimate)) continue;
    const view = customerEstimate(estimate, { token: "t".repeat(40), address: null, createdAt: NOW, officialCopy: "after-review" });
    assert.ok(view.range && view.range.low > 0 && view.range.high > view.range.low, `${project}: not a range`);
    assert.equal(view.divisions.reduce((s, d) => s + d.low, 0), view.range.low, `${project}: division lows do not add up`);
    assert.equal(view.divisions.reduce((s, d) => s + d.high, 0), view.range.high, `${project}: division highs do not add up`);
    // The base price the team sees always sits inside the customer's range.
    const base = estimate.pricing.totals.basePrice;
    assert.ok(view.range.low <= base && base <= view.range.high, `${project}: base ${base} outside ${view.range.low} to ${view.range.high}`);
    // Every priced line is in exactly one division, and nothing else is.
    const shown = view.divisions.flatMap((d) => d.items).length;
    const priced = estimate.pricing.lines.filter((l) => !l.optional && l.basis !== "trip-charge").length;
    if (estimate.divisionShares.length === 0) assert.equal(shown, priced, `${project}: ${priced - shown} priced line(s) missing from the divisions`);
    else {
      // A whole-project price is spread across divisions; the priced lines are still named to the customer.
      const named = new Set(view.guide.included.flatMap((g) => g.items));
      for (const l of estimate.pricing.lines) if (!l.optional && l.basis !== "trip-charge") assert.ok(named.has(l.description), `${project}: "${l.description}" is priced but not named`);
      assert.ok(view.divisionNote, `${project}: shares shown without saying they are shares`);
    }
    for (const d of view.divisions) assert.match(d.code, /^\d{2}$/);
    const report = internalReport(estimate);
    assert.equal(report.groups.reduce((s, g) => s + cents(g.price), 0), cents(report.totalPrice));
    assert.equal(report.lines.reduce((s, l) => s + cents(l.price), 0), cents(report.totalPrice));
  }
});

test("the range width follows the owner's band rule and the project's real risks", () => {
  const firm = price("handyman", { tasks: { faucet: 2 } });
  assert.deepEqual(firm.risks, [], "a counted handyman list at a known address carries no risk flag");
  assert.equal(firm.rangeWidth, 0.05);
  const bath = price("bathroom-remodel", { bath: "hall", scope: "relocate" });
  assert.ok(bath.risks.includes("hidden-conditions") && bath.risks.includes("incomplete-plans") && bath.risks.includes("unknown-utilities"));
  assert.equal(bath.rangeWidth, 0.08, "itemized estimates never exceed the 8% book band");
  const home = price("custom-home", {}, "mid", "construction");
  assert.ok(home.rangeWidth >= 0.2 && home.rangeWidth <= 0.5, "a budgetary figure gets the wider band");
  const unaddressed = priceEstimate({ brand: "p5", project: "handyman", tier: "mid", answers: { tasks: { faucet: 2 } }, address: null, property: null }, { now: NOW });
  assert.ok(unaddressed.risks.includes("jurisdiction-uncertain"));
  assert.ok(unaddressed.rangeWidth > firm.rangeWidth, "an unknown address widens the range");
});

test("the explanation is generated from the priced scope and never contradicts it", () => {
  for (const { project, estimate } of ALL) {
    if (priceWithheld(estimate)) continue;
    const view = customerEstimate(estimate, { token: "t".repeat(40), address: "100 Example Ave, Boise, ID 83702", createdAt: NOW, officialCopy: "after-review" });
    const priced = new Set([...estimate.pricing.lines.map((l) => l.description), ...estimate.divisionShares]);
    for (const group of view.guide.included) {
      assert.match(group.division, estimate.divisionShares.length ? /^(Division \d{2}: |Priced as a whole project$)/ : /^Division \d{2}: /);
      for (const item of group.items) assert.ok(priced.has(item), `${project}: "${item}" is described as included but is not priced`);
    }
    const included = new Set(view.guide.included.flatMap((g) => g.items));
    for (const text of [...view.guide.excluded, ...view.guide.undetermined]) assert.ok(!included.has(text), `${project}: "${text}" is both included and not included`);
    for (const text of view.guide.excluded) assert.ok(!view.guide.undetermined.includes(text), `${project}: "${text}" is both excluded and undetermined`);
    assert.ok(view.guide.overview.length >= 3 && view.guide.outcome.length >= 1 && view.guide.verification.length >= 1, `${project}: a guide section is empty`);
    assert.equal(view.guide.disclaimer.length, 4);
    assert.ok(view.guide.overview.some((s) => s.includes(`$${view.range!.low.toLocaleString("en-US")}`)), `${project}: the overview does not state the range`);
    const words = JSON.stringify(view.guide);
    assert.doesNotMatch(words, BANNED_WORDING, `${project}: unprofessional wording`);
    assert.doesNotMatch(words, /\u2014/);
    assert.deepEqual(estimate.review.filter((r) => r.code === "narrative"), []);
  }
  // A project never talks about another project's work.
  const kitchen = customerEstimate(price("kitchen-remodel", { size: "medium", scope: "replace" }), { token: "t".repeat(40), address: null, createdAt: NOW, officialCopy: "after-review" });
  assert.doesNotMatch(JSON.stringify(kitchen.guide), /basement|bathtub|egress/i);
  // Plumbing that is not moved is not described as moved.
  assert.doesNotMatch(JSON.stringify(kitchen.guide.included), /Move the kitchen plumbing/);
});

test("the narrative check catches a contradiction, a broken range and vague wording", () => {
  const e = price("bathroom-remodel", { bath: "hall", scope: "full" });
  const base = e.pricing.lines.filter((l) => !l.optional);
  assert.deepEqual(narrativeProblems(e.guide, e.divisions, e.range, base), []);
  const invented = { ...e.guide, included: [{ division: "Division 22: Plumbing", items: ["Re-pipe the whole house"] }] };
  assert.ok(narrativeProblems(invented, e.divisions, e.range, base).some((p) => /no priced line/.test(p)));
  assert.ok(narrativeProblems(e.guide, e.divisions, { low: e.range.low + 10, high: e.range.high }, base).some((p) => /do not add up/.test(p)));
  const contradiction = { ...e.guide, excluded: [...e.guide.excluded, e.guide.included[0].items[0]] };
  assert.ok(narrativeProblems(contradiction, e.divisions, e.range, base).some((p) => /both included and not included/.test(p)));
  const vague = { ...e.guide, outcome: ["A new bathroom down there."] };
  assert.ok(narrativeProblems(vague, e.divisions, e.range, base).some((p) => /wording/.test(p)));
});

test("every question is specific, and none uses a vague reference", () => {
  for (const flow of FLOWS) {
    for (const q of flow.questions) {
      assert.match(q.prompt, /\?$/, `${flow.id}: "${q.prompt}" is not a question`);
      assert.ok(q.prompt.split(" ").length >= 4, `${flow.id}: "${q.prompt}" is too terse to be clear`);
      assert.doesNotMatch(`${q.prompt} ${q.help ?? ""}`, BANNED_WORDING, `${flow.id}: "${q.prompt}"`);
      assert.doesNotMatch(q.prompt, /\b(too|with that)\?$/i, `${flow.id}: "${q.prompt}" leans on an earlier question`);
      if (q.kind === "choice") for (const o of q.options) assert.doesNotMatch(`${o.label} ${o.hint ?? ""}`, BANNED_WORDING);
    }
  }
  // Basement questions appear only in the basement project.
  for (const flow of FLOWS) if (flow.id !== "basement-finish" && flow.id !== "custom-home") assert.doesNotMatch(JSON.stringify(flow.questions), /basement/i, `${flow.id} asks about a basement`);
});

test("the QuickBooks estimate carries the same lines and descriptions the customer saw", () => {
  const itemIds = Object.fromEntries(P5_ITEMS.map((item, i) => [item, String(100 + i)])) as Record<ItemKey, string>;
  for (const { project, estimate } of ALL) {
    if (priceWithheld(estimate)) continue;
    const view = customerEstimate(estimate, { token: "t".repeat(40), address: null, createdAt: NOW, officialCopy: "after-review" });
    const payload = buildEstimatePayload({ customerId: "1", pricing: estimate.pricing, itemIds, taxable: [], exclusions: estimate.doc.exclusions, privateNote: "test" });
    const sales = payload.Line.filter((l) => l.DetailType === "SalesItemLineDetail" && (l.Amount ?? 0) !== 0 && !/^Trip charge/.test(l.Description));
    const shown = new Set([...view.divisions.flatMap((d) => d.items).map((i) => i.text), ...view.guide.included.flatMap((g) => g.items)]);
    for (const line of sales) {
      assert.ok(shown.has(line.Description), `${project}: QuickBooks line "${line.Description}" was not shown to the customer`);
      assert.ok(line.SalesItemLineDetail!.ItemRef.value, `${project}: a line has no QuickBooks item`);
    }
    // The QuickBooks total is the base price, which sits inside the customer's range.
    const total = payload.Line.reduce((s, l) => s + (l.Amount ?? 0), 0);
    assert.ok(view.range!.low <= total + 0.01 && total - 0.01 <= view.range!.high, `${project}: QuickBooks total outside the range shown`);
  }
});

test("the customer's view cannot carry a cost, a margin or a cost code", () => {
  const forbiddenKeys = /"(unitCost|cost|totalCost|margin|grossMargin|grossProfit|source|basis|costCode|item|policy|overheadRate|profitRate|unitPrice|price|taskId|crossCheck|review|risks|rangeWidth)"\s*:/;
  for (const { project, estimate } of ALL) {
    const view = customerEstimate(estimate, { token: "t".repeat(40), address: "100 Example Ave", createdAt: NOW, officialCopy: "after-review" });
    const json = JSON.stringify(view);
    assert.doesNotMatch(json, forbiddenKeys, `${project}: an internal field reached the customer view`);
    assert.doesNotMatch(json, /\b\d{2}-\d{2}-\d{2}\b|PB-|P5 Cost Database|overhead|markup|gross margin/i, `${project}: internal wording reached the customer view`);
    // No numeric check against the internal cost: a division bound rounded to $10 can equal
    // it by coincidence. The guarantee is structural: the view has no cost field to carry one.
  }
});

test("a withheld estimate shows the customer no figure at all", () => {
  const withheld = ALL.filter((x) => priceWithheld(x.estimate));
  assert.ok(withheld.length > 0, "the matrix should include estimates the cross-check holds back");
  for (const { estimate } of withheld) {
    const view = customerEstimate(estimate, { token: "t".repeat(40), address: null, createdAt: NOW, officialCopy: "after-review" });
    assert.equal(view.range, null);
    assert.deepEqual(view.divisions, []);
    assert.deepEqual(view.guide.included, []);
    assert.doesNotMatch(JSON.stringify(view), /"(low|high)":/);
    assert.ok(estimate.review.length > 0);
  }
});

test("every estimate a customer can see holds the margin floor", () => {
  for (const { project, estimate } of ALL) {
    if (priceWithheld(estimate)) continue;
    assert.ok(estimate.pricing.totals.margin !== null && estimate.pricing.totals.margin >= MARGIN_FLOOR, `${project}: margin ${estimate.pricing.totals.margin}`);
    assert.ok(estimate.pricing.totals.basePrice > 0);
  }
});

test("qualify refuses a margin under the floor, an unknown cost and anything outside the cross-check band", () => {
  const good = price("bathroom-remodel", { bath: "hall", scope: "full", bathing: "combo" });
  assert.deepEqual(good.review, []);
  const thin = { ...good.pricing, totals: { ...good.pricing.totals, margin: MARGIN_FLOOR - 0.001 } };
  assert.ok(qualify(thin, "preliminary", good.crossCheck, 5).some((r) => r.code === "margin-floor"));
  const unknown = { ...good.pricing, totals: { ...good.pricing.totals, margin: null } };
  assert.ok(qualify(unknown, "preliminary", good.crossCheck, 5).some((r) => r.code === "margin-unknown"));
  const far = { ...good.crossCheck!, within: false };
  assert.ok(qualify(good.pricing, "preliminary", far, 5).some((r) => r.code === "cross-check"));
  assert.ok(qualify(good.pricing, "preliminary", good.crossCheck, good.pricing.lines.length + 1).some((r) => r.code === "unpriced-lines"));
  assert.ok(CROSS_CHECK_BAND.low < 1 && CROSS_CHECK_BAND.high > 1);
});

test("budgetary projects never qualify as an official estimate without a person", () => {
  for (const { project, estimate } of ALL) {
    if (flowById(project)!.estimateClass !== "budgetary") continue;
    assert.ok(estimate.review.some((r) => r.code === "budgetary"), `${project} would be sent automatically`);
    // The customer still sees the budget; it is the official copy that waits.
    assert.equal(priceWithheld(estimate), false);
    // QuickBooks gets an unsent draft, and is never told to email it.
    const row = { review: estimate.review, price_withheld: false };
    assert.equal(qboAction(row, "create"), "create");
    assert.equal(qboAction(row, "send"), "create", `${project} would be emailed from QuickBooks without a person`);
  }
});

test("every submitted estimate becomes an unsent QuickBooks estimate by default, and nothing else", () => {
  assert.equal(qboMode({}), "create");
  assert.equal(qboMode({ ESTIMATOR_QBO: "off" }), "off");
  assert.equal(qboMode({ ESTIMATOR_QBO: "send" }), "send");
  assert.equal(qboMode({ ESTIMATOR_QBO: "anything else" }), "create");
  assert.equal(qboAction({ review: [], price_withheld: false }, "create"), "create");
  assert.equal(qboAction({ review: [], price_withheld: false }, "send"), "send");
  // A price the customer was not shown is never written to the books.
  assert.equal(qboAction({ review: [{ code: "margin-floor", message: "" }], price_withheld: true }, "send"), "off");
  assert.equal(qboAction({ review: [{ code: "budgetary", message: "" }, { code: "cross-check", message: "" }], price_withheld: true }, "create"), "off");
  // The range travels as words; the figure is the base price.
  const note = rangeNote({ customer_view: { range: { low: 80000, high: 120000 } } as never, total: "100000.00" });
  assert.match(note, /\$80,000 to \$120,000/);
  assert.match(note, /\$100,000/);
  // Only the estimate endpoint is written. No invoice, payment or project is created from a web form.
  const source = readFileSync(new URL("../app/lib/estimator/deliver.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["'`/]invoice|\/payment|salesreceipt/i);
});

test("a whole-project price is spread across divisions without changing it", () => {
  let seen = 0;
  for (const { project, estimate } of ALL) {
    if (flowById(project)!.estimateClass !== "budgetary" || priceWithheld(estimate)) continue;
    seen += 1;
    assert.ok(estimate.divisions.length >= 3, `${project}: still one lump (${estimate.divisions.map((d) => d.code).join(",")})`);
    assert.ok(!estimate.divisions.some((d) => d.code === "90"), `${project}: a whole-project division is still shown`);
    // The pieces are the price: before widening and rounding they add back to the base to the cent.
    const base = estimate.pricing.totals.basePrice;
    const mid = estimate.divisions.reduce((s, d) => s + (d.low + d.high) / 2, 0);
    assert.ok(Math.abs(mid - base) <= 10 * estimate.divisions.length, `${project}: divisions centre on ${mid}, base is ${base}`);
    assert.ok(estimate.range.low <= base && base <= estimate.range.high);
    assert.ok(estimate.guide.overview.includes(SHARE_NOTE), `${project}: the shares are not explained`);
  }
  assert.ok(seen > 0);
  for (const code of shareProfileCodes()) {
    for (const tier of ["builder", "mid", "high", "luxury"] as const) {
      const pieces = splitByDivision(code, 123456.78, tier, "new-construction");
      assert.ok(pieces, `${code} ${tier}: a component has no cost book price`);
      assert.equal(pieces!.reduce((s, p) => s + Math.round(p.price * 100), 0), 12345678, `${code} ${tier}: pieces do not add up`);
      assert.ok(pieces!.every((p) => p.price > 0 && /^\d{2}$/.test(p.division) && p.division !== "90"));
    }
  }
  assert.equal(splitByDivision("12-31-01", 1000, "mid", "kitchen"), null, "an ordinary line must not be split");
});

test("an out-of-date cost book stops prices instead of quoting stale ones", () => {
  const stale = priceEstimate({ brand: "p5", project: "flooring", tier: "mid", answers: {}, address: null, property: null }, { now: new Date("2028-06-01T00:00:00Z") });
  assert.ok(stale.review.some((r) => r.code === "outdated-price"));
  assert.equal(priceWithheld(stale), true);
});

test("selections change the scope the way a customer would expect", () => {
  const same = price("kitchen-remodel", { size: "medium", scope: "replace" });
  const redesign = price("kitchen-remodel", { size: "medium", scope: "redesign" });
  const codes = (e: PricedEstimate) => new Set(e.doc.tasks.map((t) => t.costCode));
  // Keeping the layout leaves relocation work out; a new layout brings it in.
  assert.ok(!codes(same).has("90-20-05") && !codes(same).has("00-20-02"));
  assert.ok(codes(redesign).has("90-20-05") && codes(redesign).has("90-20-04") && codes(redesign).has("00-20-02"));
  assert.ok(redesign.pricing.totals.basePrice > same.pricing.totals.basePrice);
  // A walk-in shower brings its pan, waterproofing, tile, glass and valve with it.
  const walkin = codes(price("bathroom-remodel", { bath: "hall", scope: "full", bathing: "walkin" }));
  for (const code of ["02-41-04", "09-30-05", "09-30-10", "09-30-04", "08-83-01", "22-41-12", "22-42-09"]) assert.ok(walkin.has(code), `walk-in shower is missing ${code}`);
  assert.ok(!walkin.has("22-41-26"), "a walk-in shower should not include a bathtub");
  // Finish level moves the price, and every tier is dearer than the one below.
  const byTier = TIERS.map((t) => price("kitchen-remodel", { size: "medium", scope: "replace" }, t).pricing.totals.basePrice);
  assert.deepEqual([...byTier].sort((a, b) => a - b), byTier);
  // Bigger is dearer.
  assert.ok(price("flooring", { sqft: 1000 }).pricing.totals.basePrice > price("flooring", { sqft: 500 }).pricing.totals.basePrice);
});

test("an answer to a question that is not shown changes nothing", () => {
  const plain = price("kitchen-remodel", { size: "medium", scope: "refresh" });
  const stray = price("kitchen-remodel", { size: "medium", scope: "refresh", island: "yes" });
  assert.equal(stray.pricing.totals.basePrice, plain.pricing.totals.basePrice);
  assert.equal("island" in stray.answers, false);
  const junk = price("bathroom-remodel", { bath: "nope", scope: 7 as unknown as string, extra: "x" });
  assert.deepEqual(junk.answers, resolveAnswers(flowById("bathroom-remodel")!, {}));
});

test("pricing is deterministic", () => {
  const a = price("bathroom-remodel", { bath: "primary", scope: "full", bathing: "both", vanity: "double" }, "high");
  const b = price("bathroom-remodel", { bath: "primary", scope: "full", bathing: "both", vanity: "double" }, "high");
  assert.deepEqual(a.pricing, b.pricing);
  assert.equal(a.versions.costBook, b.versions.costBook);
  assert.ok(a.versions.rules && a.versions.costBook);
});

test("handyman: the minimum service charge is enforced and the trip charge nets to zero", () => {
  const small = price("handyman", { tasks: { "hang-art": 1 } });
  const minimum = price("handyman", { tasks: { faucet: 1 } });
  const balance = small.pricing.lines.find((l) => l.taskId === "gmin");
  assert.ok(balance, "a job under the minimum should carry the balance line");
  assert.ok(!minimum.pricing.lines.some((l) => l.taskId === "gmin"), "a job over the minimum should not");
  const trip = small.pricing.lines.filter((l) => l.basis === "trip-charge");
  assert.equal(trip.reduce((s, l) => s + cents(l.price), 0), 0);
  // The small job costs the minimum, within a cent of rounding the balance quantity up.
  const one = price("handyman", { tasks: { "hang-art": 1 } }).pricing.totals.baseCost!;
  assert.ok(one >= 135 && one < 136.4, `direct cost ${one}`);
  assert.equal(small.estimateClass, "quote");
  assert.deepEqual(small.review, []);
});

test("a brand cannot price a project it does not offer", () => {
  assert.throws(() => price("custom-home", {}, "mid", "handyman"), /does not offer/);
  assert.doesNotThrow(() => price("custom-home", {}, "mid", "construction"));
});

test("Boise ADU Co is configured but not public", () => {
  assert.equal(BRAND_CONFIGS.adu.live, false);
  assert.doesNotThrow(() => price("adu", { type: "detached" }, "mid", "adu"));
});

test("a home built before 1978 adds lead-safe work; an unknown year states the assumption", () => {
  const input = { brand: "p5" as BrandId, project: "bathroom-remodel", tier: "mid" as Tier, answers: { bath: "hall", scope: "full" }, address: null };
  const old = priceEstimate({ ...input, property: { source: "county tax records", yearBuilt: 1962 } }, { now: NOW });
  const recent = priceEstimate({ ...input, property: { source: "county tax records", yearBuilt: 2004 } }, { now: NOW });
  const unknown = priceEstimate({ ...input, property: null }, { now: NOW });
  assert.ok(old.doc.tasks.some((t) => t.costCode === "02-82-03"));
  assert.ok(!recent.doc.tasks.some((t) => t.costCode === "02-82-03"));
  assert.ok(unknown.recipe.assumptions.some((a) => /1978/.test(a)));
  assert.ok(!recent.recipe.assumptions.some((a) => /1978/.test(a)));
  assert.match(old.doc.siteConditions.join(" "), /not a site measurement/i);
});

test("property records are read defensively and never invented", () => {
  assert.equal(fromRentCast(null), null);
  assert.equal(fromRentCast([]), null);
  assert.equal(fromRentCast([{ squareFootage: 12, yearBuilt: 1200 }]), null);
  const facts = fromRentCast([{ squareFootage: 2412, yearBuilt: 1998, lotSize: 8712, assessorID: "R1234", city: "Boise", features: { floorCount: 2, garageSpaces: 2 } }])!;
  assert.deepEqual({ sqft: facts.livingSqft, year: facts.yearBuilt, lot: facts.lotAcres, stories: facts.stories }, { sqft: 2412, year: 1998, lot: 0.2, stories: 2 });
  assert.match(facts.source, /records/);
  // A county profile without a matched parcel is no record at all.
  assert.equal(fromCountyProfile({ profile: { county: "ada", city: "Boise" } }), null);
  assert.equal(fromCountyProfile({ profile: { parcelId: "R1", county: "gem" } }), null);
  const county = fromCountyProfile({ profile: { parcelId: "R1234567890", county: "ada", jurisdiction: "City of Boise", permittingAuthority: "City of Boise Planning and Development Services", zoning: "R-1C", lotSizeAcres: 0.21, squareFootage: 2400, yearBuilt: 1999 } })!;
  assert.deepEqual({ parcel: county.parcel, county: county.county, zoning: county.zoning, lot: county.lotAcres }, { parcel: "R1234567890", county: "Ada", zoning: "R-1C", lot: 0.21 });
  // The parcel layer publishes nothing about the building, so nothing about the building is read from it.
  assert.equal(county.livingSqft, undefined);
  assert.equal(county.yearBuilt, undefined);
  const merged = mergeProperty(county, facts)!;
  assert.equal(merged.livingSqft, 2412);
  assert.equal(merged.parcel, "R1234567890");
  assert.match(merged.buildingSource ?? "", /RentCast/);
  assert.equal(mergeProperty(null, null), null);
});

// --------------------------------------------------------------- submit route

function submitRequest(body: Record<string, unknown>): Request {
  return new Request("https://p5homeco.com/api/estimator/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const VALID = {
  brand: "remodeling",
  project: "bathroom-remodel",
  tier: "mid",
  answers: { bath: "hall", scope: "full", bathing: "walkin" },
  address: "100 Example Ave, Boise, ID 83702",
  contact: { firstName: "Sample", lastName: "Customer", email: "Sample@Example.com", phone: "208-555-0100", marketingConsent: false },
  clientKey: "abcdef0123456789abcdef0123456789",
};
function memoryStore() {
  const rows = new Map<string, GuidedRow>();
  const store = async (input: Parameters<NonNullable<Parameters<typeof handleSubmit>[1]>["store"] & object>[0]) => {
    const key = `${input.submission.brand}:${input.submission.clientKey}`;
    const existing = rows.get(key);
    if (existing) return { row: existing, created: false };
    const row = {
      id: rows.size + 1,
      token: input.customerView.token,
      brand: input.submission.brand,
      client_key: input.submission.clientKey,
      project: input.estimate.project,
      tier: input.estimate.tier,
      first_name: input.submission.contact.firstName,
      last_name: input.submission.contact.lastName,
      email: input.submission.contact.email,
      phone: input.submission.contact.phone,
      marketing_consent: input.submission.contact.marketingConsent,
      address: input.submission.address,
      property: null,
      total: String(input.estimate.pricing.totals.basePrice),
      price_withheld: input.priceWithheld,
      review: input.estimate.review,
      customer_view: input.customerView,
      internal_report: input.internal,
      rules_version: input.estimate.versions.rules,
      cost_book_version: input.estimate.versions.costBook,
      estimate_class: input.estimate.estimateClass,
      delivery: {},
    } as unknown as GuidedRow;
    rows.set(key, row);
    return { row, created: true };
  };
  return { rows, store };
}
const deps = (extra: Record<string, unknown> = {}) => ({ loadContext: async () => ({ now: NOW }), ...extra });

test("submit returns only the customer's view, and a retry is the same estimate", async () => {
  const memory = memoryStore();
  let delivered = 0;
  const options = deps({ store: memory.store, deliver: () => void delivered++ });
  const first = await handleSubmit(submitRequest(VALID), options);
  assert.equal(first.status, 201);
  const body = (await first.json()) as { ok: boolean; estimate: { token: string } } & Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["estimate", "ok"]);
  assert.match(body.estimate.token, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(JSON.stringify(body), /unitCost|"cost"|margin|\b\d{2}-\d{2}-\d{2}\b/);
  const again = await handleSubmit(submitRequest(VALID), options);
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { estimate: { token: string } }).estimate.token, body.estimate.token);
  assert.equal(memory.rows.size, 1);
  assert.equal(delivered, 1, "a retry must not deliver twice");
  const row = [...memory.rows.values()][0];
  assert.equal(row.email, "sample@example.com");
  assert.equal(row.phone, "(208) 555-0100");
});

test("submit ignores any price, quantity or line the browser sends", async () => {
  const memory = memoryStore();
  type Ranged = { estimate: { range: { low: number; high: number } } };
  const honest = (await (await handleSubmit(submitRequest(VALID), deps({ store: memoryStore().store }))).json()) as Ranged;
  const forged = { ...VALID, clientKey: "ffffffff0123456789abcdef01234567", total: 1, price: 1, lines: [{ price: 1 }], estimate: { total: 1 }, answers: { ...VALID.answers, total: 1 } };
  const result = (await (await handleSubmit(submitRequest(forged), deps({ store: memory.store }))).json()) as Ranged;
  assert.deepEqual(result.estimate.range, honest.estimate.range);
});

test("submit refuses bad contact details, bots, unknown projects and brands that are not live", async () => {
  const memory = memoryStore();
  const run = async (body: Record<string, unknown>) => handleSubmit(submitRequest(body), deps({ store: memory.store }));
  const bad = await run({ ...VALID, contact: { firstName: "", lastName: "X", email: "nope", phone: "12" } });
  assert.equal(bad.status, 422);
  assert.deepEqual(((await bad.json()) as { errors: { field: string }[] }).errors.map((e) => e.field), ["firstName", "email", "phone"]);
  assert.equal((await run({ ...VALID, company_website: "http://spam.example" })).status, 422);
  assert.equal((await run({ ...VALID, project: "custom-home" })).status, 400, "remodeling does not offer new homes");
  assert.equal((await run({ ...VALID, brand: "adu", project: "adu" })).status, 403);
  assert.equal((await run({ ...VALID, clientKey: "short" })).status, 400);
  assert.equal((await run({ ...VALID, project: "handyman", brand: "handyman", answers: { tasks: {} } })).status, 422);
  assert.equal((await handleSubmit(submitRequest(VALID), deps({ store: memory.store, allow: async () => false }))).status, 429);
  assert.equal(memory.rows.size, 0, "a refused request stored an estimate");
});

// ---------------------------------------------------------------------- email

function rowFor(estimate: PricedEstimate): GuidedRow {
  const view = customerEstimate(estimate, { token: "a".repeat(40), address: "100 Example Ave, Boise, ID 83702", createdAt: NOW, officialCopy: "after-review" });
  return {
    id: 1,
    token: view.token,
    brand: estimate.brand,
    project: estimate.project,
    tier: estimate.tier,
    first_name: "Sample",
    last_name: "Customer",
    email: "sample@example.com",
    phone: "(208) 555-0100",
    marketing_consent: false,
    address: view.address,
    property: null,
    total: String(estimate.pricing.totals.basePrice),
    price_withheld: priceWithheld(estimate),
    review: estimate.review,
    customer_view: view,
    internal_report: internalReport(estimate),
    rules_version: estimate.versions.rules,
    cost_book_version: estimate.versions.costBook,
    estimate_class: estimate.estimateClass,
    delivery: {},
  } as unknown as GuidedRow;
}

test("the team report carries the full financial picture", () => {
  const estimate = price("bathroom-remodel", { bath: "hall", scope: "full", bathing: "walkin" }, "mid", "remodeling");
  const message = teamReport(rowFor(estimate), { scopeUrl: "https://p5homeco.com/scopes/7", qboUrl: null, estimateNumber: null, status: "Waiting for team review", customerViewUrl: "https://p5homeco.com/estimator/e/x" });
  const report = internalReport(estimate);
  for (const part of [message.text, message.html]) {
    assert.match(part, /Gross margin/);
    assert.match(part, /Gross profit/);
    assert.ok(part.includes("09-30-05"), "cost book codes are in the report");
    assert.ok(part.includes("mailto:sample@example.com") || part.includes("sample@example.com"));
    assert.ok(part.includes("Boise Remodeling Co"));
  }
  assert.ok(message.html.includes('href="tel:+12085550100"'));
  assert.ok(message.text.includes(report.totalCost!.toLocaleString("en-US", { minimumFractionDigits: 2 })));
  assert.match(message.text, /Division|09 Finishes/);
});

test("the customer confirmation carries no figure and no internal wording", () => {
  for (const estimate of [price("bathroom-remodel", { bath: "hall" }, "mid", "remodeling"), price("custom-home", {}, "high", "construction"), price("handyman", { tasks: { faucet: 2 } }, "mid", "handyman")]) {
    const message = customerConfirmation(rowFor(estimate), "https://p5homeco.com/estimator/e/abc");
    for (const part of [message.subject, message.text, message.html.replace(/<[^>]+>/g, " ")]) {
      assert.doesNotMatch(part, /\$\s?\d|\bcost\b|margin|\b\d{2}-\d{2}-\d{2}\b/i);
    }
    assert.ok(message.text.includes("https://p5homeco.com/estimator/e/abc"));
    assert.ok(message.text.includes(BRAND_CONFIGS[estimate.brand].name));
  }
});

test("house style: no em dashes anywhere in the estimator", () => {
  const root = path.join(import.meta.dirname, "..");
  const files = [
    ...readdirSync(path.join(root, "app/lib/estimator")).map((f) => `app/lib/estimator/${f}`),
    ...readdirSync(path.join(root, "components/estimator")).map((f) => `components/estimator/${f}`),
    "app/estimator/page.tsx",
    "app/estimator/embed/page.tsx",
    "app/estimator/e/[token]/page.tsx",
    "migrations/027_guided_estimator.sql",
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /—/, `${file} contains an em dash`);
});

test("every project belongs to a trade, and every brand has at least one trade to show", () => {
  const trades = new Set(TRADES.map((t) => t.id));
  for (const flow of FLOWS) assert.ok(trades.has(flow.group), `${flow.id} is in unknown trade ${flow.group}`);
  for (const trade of TRADES) assert.ok(FLOWS.some((f) => f.group === trade.id), `trade ${trade.id} has no project`);
  for (const brand of Object.values(BRAND_CONFIGS)) assert.ok(brand.projects.some((id) => trades.has(flowById(id)!.group)));
});

test("every option card has its image", () => {
  const names = new Set<string>([...TRADES.map((t) => t.image), "finish-builder", "finish-mid", "finish-high", "finish-luxury"]);
  for (const flow of FLOWS) {
    names.add(flow.image);
    for (const q of flow.questions) if (q.kind === "choice") for (const o of q.options) if (o.image) names.add(o.image);
  }
  const dir = path.join(import.meta.dirname, "../public/estimator/img");
  const missing = [...names].filter((name) => !existsSync(path.join(dir, `${name}.webp`)));
  assert.deepEqual(missing, [], "option images are missing");
});

// ------------------------------------------------- one estimator on every site

test("a link opens the estimator on what the visitor chose, and only on what the brand offers", () => {
  const p5 = BRAND_CONFIGS.p5.projects;
  assert.deepEqual(estimatorEntry(p5, { project: "kitchen-remodel" }), { project: "kitchen-remodel", trade: null });
  // A trade with several projects opens that list; a trade with one opens the project.
  assert.deepEqual(estimatorEntry(p5, { trade: "remodel" }), { project: null, trade: "remodel" });
  assert.deepEqual(estimatorEntry(p5, { trade: "adu" }), { project: "adu", trade: null });
  // Unknown values, and projects another brand offers, start at the first question.
  assert.deepEqual(estimatorEntry(p5, { trade: "nonsense", project: "nonsense" }), { project: null, trade: null });
  assert.deepEqual(estimatorEntry(BRAND_CONFIGS.cabinet.projects, { project: "custom-home" }), { project: null, trade: null });
  assert.deepEqual(estimatorEntry(BRAND_CONFIGS.handyman.projects, { trade: "construction" }), { project: null, trade: null });
  // The homepage tiles are the estimator's own first question.
  const home = readFileSync(new URL("../app/HomePageClient.tsx", import.meta.url), "utf8");
  for (const t of TRADES) {
    assert.match(home, new RegExp(`\\{ id: "${t.id}", label: "${t.label}", hint: "${t.hint}", image: "${t.image}" \\}`), `homepage tile for ${t.id} is out of step with the estimator`);
    assert.ok(existsSync(new URL(`../public/estimator/img/${t.image}.webp`, import.meta.url)));
  }
});

test("each site's project list is its own, and every site uses the same engine", () => {
  // Changing one brand's list cannot change another's: the lists are separate arrays.
  const lists = Object.values(BRAND_CONFIGS).map((b) => b.projects);
  for (const [i, a] of lists.entries()) for (const [j, b] of lists.entries()) if (i !== j) assert.notEqual(a, b);
  // A site never offers a project outside its trade.
  assert.deepEqual(BRAND_CONFIGS.construction.projects.filter((id) => flowById(id)!.group !== "construction" && flowById(id)!.group !== "adu"), []);
  assert.deepEqual(BRAND_CONFIGS.cabinet.projects.filter((id) => flowById(id)!.group !== "cabinetry"), []);
  assert.deepEqual(BRAND_CONFIGS.adu.projects, ["adu"]);
  // The same project prices the same on every site that offers it.
  const a = priceEstimate({ brand: "p5", project: "addition", tier: "mid", answers: {}, address: null, property: null, contact: null as never });
  const b = priceEstimate({ brand: "remodeling", project: "addition", tier: "mid", answers: {}, address: null, property: null, contact: null as never });
  const c = priceEstimate({ brand: "construction", project: "addition", tier: "mid", answers: {}, address: null, property: null, contact: null as never });
  assert.deepEqual([b.range, c.range], [a.range, a.range]);
  // What it gives is an estimate. No brand's heading calls it a quote, a bid or a final price.
  for (const brand of Object.values(BRAND_CONFIGS)) assert.doesNotMatch(`${brand.heading} ${brand.intro}`, /quote|\bbid\b|final price|guarantee/i, brand.id);
});

test("a framed estimator sizes itself from the framing page and reports back", () => {
  const bridge = readFileSync(new URL("../app/estimator/embed/EmbedBridge.tsx", import.meta.url), "utf8");
  const estimator = readFileSync(new URL("../components/estimator/GuidedEstimator.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../app/lib/estimator/store.ts", import.meta.url), "utf8");
  // The content is measured, not the window: a frame's window can only ever grow.
  assert.match(bridge, /getElementById\("main-content"\)/);
  assert.doesNotMatch(bridge, /documentElement\.scrollHeight/);
  assert.match(bridge, /p5-estimator-ready/);
  // The room comes from the framing page, and only a family site may say so.
  assert.match(estimator, /p5-estimator-viewport/);
  assert.match(estimator, /familyOrigins\(\)\.includes\(event\.origin\)/);
  // A framed estimator leaves the lead conversion to the site that frames it: counted once.
  assert.match(estimator, /if \(!embedded\) trackAcceptedInquiry\("instant_estimator"\)/);
  assert.equal((estimator.match(/trackAcceptedInquiry\(/g) ?? []).length, 1);
  assert.match(store, /"consultation_requested"/);
});
