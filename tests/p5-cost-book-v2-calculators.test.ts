/**
 * Every calculator on this site prices from the shared v2 cost book
 * (lib/p5/priceBookData.ts through lib/p5/priceBook.ts). The totals below
 * are the repo functions' own results for scenarios taken from the
 * 2026-11-15 v2 pass (CHANGES.md S03 hall bath, S01 kitchen, plus a small
 * flooring job and a 2,000 SF home).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { priceEstimate } from "../app/lib/estimator/price.ts";
import { costBookRate } from "../app/lib/scopes/costbook.ts";
import { priceScope } from "../app/lib/scopes/pricing.ts";
import { DEFAULT_SCOPE_SETTINGS } from "../app/lib/scopes/types.ts";
import { priceReviewedScope } from "../lib/p5/costBook.ts";
import { createPlanningConfiguration, PLANNING_MODEL_VERSION } from "../lib/p5/planningBooks.ts";
import { priceBookRates, sharedBookRate, type FinishTier } from "../lib/p5/priceBook.ts";

const NOW = new Date("2026-11-15T12:00:00Z");
const REQUIRED = ["03-17-01-M", "03-17-01-L", "03-15-02-M", "03-15-02-L", "03-16-01-M", "03-16-01-L", "03-14-01-M", "03-14-01-L", "03-04-01", "03-04-02", "03-04-03", "03-05-02-M", "03-05-02-L", "REF-GENERAL-HOUR", "REF-PLUMBING-HOUR", "REF-ELECTRICAL-HOUR"];

function guided(project: string, answers: Record<string, unknown>, tier: FinishTier = "mid", brand: "p5" | "construction" = "p5") {
  return priceEstimate({ brand, project, tier, answers, address: null, property: null }, { now: NOW });
}

test("shared book, scope platform and guided estimator agree on v2 unit prices", () => {
  const lines: [string, FinishTier, boolean, string, number][] = [
    ["08-71-01", "mid", false, "handyman", 67],
    ["12-31-01", "mid", true, "kitchen", 303.45],
    ["90-10-01", "mid", false, "new-construction", 200],
    ["09-01-08", "mid", false, "re10", 155],
    ["08-83-01", "builder", false, "bathroom", 730],
    ["01-31-01", "mid", false, "bathroom", 4850],
  ];
  for (const [code, tier, remodel, service, amount] of lines) {
    const shared = sharedBookRate(code, tier, remodel);
    const book = costBookRate(code, tier, service);
    assert.equal(shared?.amount, amount, code);
    assert.equal(book?.amount, amount, `${code} costBookRate`);
  }
});

test("guided estimator and scope platform apply the new margins to v2 cost-book inputs for four scenarios", () => {
  const cases = [
    { name: "small flooring, 200 SF", project: "flooring", answers: { sqft: 200 }, brand: "p5" as const, base: 2508, low: 2508, high: 2730 },
    { name: "S03 hall bath, full, alcove", project: "bathroom-remodel", answers: { bath: "hall", scope: "full", bathing: "combo" }, brand: "p5" as const, base: 22728, low: 22728, high: 24600 },
    { name: "S01 kitchen, same layout, medium", project: "kitchen-remodel", answers: { size: "medium", scope: "replace" }, brand: "p5" as const, base: 48754, low: 48754, high: 52690 },
    { name: "large new home, 2,000 SF", project: "custom-home", answers: { sqft: 2000 }, brand: "construction" as const, base: 845057, low: 845057, high: 1064830 },
  ];
  for (const item of cases) {
    const estimate = guided(item.project, item.answers, "mid", item.brand);
    assert.equal(estimate.pricing.totals.basePrice, item.base, item.name);
    assert.deepEqual(estimate.range, { low: item.low, high: item.high }, item.name);
    const again = priceScope(estimate.doc, {
      service: estimate.service,
      finishTier: estimate.tier,
      settings: DEFAULT_SCOPE_SETTINGS,
      acknowledged: new Set<string>(),
      now: NOW,
    });
    assert.equal(again.totals.basePrice, item.base, `${item.name} scope platform`);
    assert.ok(estimate.pricing.lines.every((line) => line.basis === "cost-book" || line.basis === "trip-charge" || line.basis === "project-service" || line.basis === "project-service-credit"), item.name);
  }
});

// 01-31-02 stays on the scope at 16 hours for full hall and primary baths.
// Since 24 Nov 2026 new estimates bill all internal labor in full at $120/hr:
// the 01-31-03/04/05 project-service lines carry no overhead credit.
test("full hall and primary baths carry 16 hours of supervision at the standard hourly rate; a powder room does not", () => {
  const hall = guided("bathroom-remodel", { bath: "hall", scope: "full", bathing: "combo" });
  const primary = guided("bathroom-remodel", { bath: "primary", scope: "full", bathing: "walkin" });
  const powder = guided("bathroom-remodel", { bath: "powder", scope: "full" });
  for (const estimate of [hall, primary]) {
    const line = estimate.doc.tasks.find((task) => task.costCode === "01-31-02");
    assert.equal(line?.quantity.value, 16);
  }
  assert.equal(powder.doc.tasks.some((task) => task.costCode === "01-31-02"), false);
  assert.equal(primary.pricing.totals.basePrice, 31479);
});

test("conversational assembly calculator prices the v2 book, not a local table", () => {
  const answers = { service: "new-construction", sqft: "2000", garageIncluded: "yes", garageSqft: "600", finish: "mid-range", stories: "1" };
  const rates = [
    ...REQUIRED.map((code) => ({ code, description: "Synthetic", type: "Labor" as const, unit: code.includes("HOUR") ? "HR" : "SF", amount: 1, source: "Synthetic", basis: "owner-average-cost" as const })),
    ...priceBookRates(answers),
  ];
  const config = createPlanningConfiguration({ version: PLANNING_MODEL_VERSION, source: "owner", authorizedBy: "owner", importedAt: "2026-11-15T00:00:00.000Z", rates }, ["new-construction"]);
  const priced = priceReviewedScope({ text: "New 2,000 SF home with a 600 SF garage", answers: { location: "Boise", ...answers }, extraction: null, uploads: [], reviewedAt: "2026-11-15", corrections: [] }, config, NOW);
  assert.equal(priced.internal.directCost, 439000);
  assert.deepEqual(priced.customer.range, { low: 805000, high: 862000 });
  const lines = (priced.internal as { lines: { unitCost: number; evidence: { reference: string } }[] }).lines;
  assert.equal(lines.find((line) => line.evidence.reference.includes("PB-90-10-01"))?.unitCost, 200);
  assert.equal(lines.find((line) => line.evidence.reference.includes("PB-90-10-03"))?.unitCost, 65);
});
