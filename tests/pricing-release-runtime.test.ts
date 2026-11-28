/**
 * One approved release prices everything: the catalog and the bid rules a
 * calculation reads come from the release in scope, a saved result records
 * that release, and a release that cannot be verified never moves a price.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { baselinePricing, runWithPricing, currentPricing } from "../lib/p5/pricingReleaseScope.ts";
import { digestPricingSnapshot, validatePricingSnapshot, type PricingSnapshot } from "../lib/p5/pricingRelease.ts";
import { activeBookVersion, sharedBookRate, PRICE_BOOK_VERSION } from "../lib/p5/priceBook.ts";
import { fixedBookCharge, netQuotePrice, releasedVisitMinimum } from "../lib/p5/netPricingPolicy.ts";
import { fetchPricingRelease, verifyReleasePayload } from "../lib/p5/pricingReleaseClient.ts";
import type { ActivePricing } from "../lib/p5/pricingContext.ts";
import { compilePricingWorkbook, CANONICAL_P5_WORKBOOK } from "../lib/p5/pricingWorkbook.ts";
import { diffSnapshots, previewWorkbook, workbookRevision } from "../app/lib/pricing-release/workbook.ts";
import { priceEstimate } from "../app/lib/estimator/price.ts";
import { costBookVersion } from "../app/lib/scopes/costbook.ts";

function release(version: string, edit: (snapshot: PricingSnapshot) => void): ActivePricing {
  const snapshot = structuredClone(baselinePricing().snapshot);
  edit(snapshot);
  const checked = validatePricingSnapshot(snapshot);
  return { version, digest: digestPricingSnapshot(checked), snapshot: checked, source: "published", generation: 1 };
}
const row = (snapshot: PricingSnapshot, code: string) => snapshot.lines.find(line => line[0] === code)!;

test("the compiled catalog is a valid release and is what an unscoped calculation uses", () => {
  const base = baselinePricing();
  assert.equal(base.version, "P5-BID-2026-11-25");
  assert.equal(currentPricing().digest, base.digest);
  assert.equal(activeBookVersion(), PRICE_BOOK_VERSION);
  assert.equal(base.snapshot.rules.fixedCharges?.["01-01-07"], 135);
});

test("rates, rules and fixed charges come from the release in scope, and only there", async () => {
  const before = sharedBookRate("09-91-01", "mid")!.amount;
  const next = release("P5-TEST-RATES", snapshot => {
    const line = row(snapshot, "09-91-01");
    for (const i of [10, 11, 12, 13]) (line[i] as number) = Math.round((line[i] as number) * 2 * 100) / 100;
    snapshot.rules.jobPolicies["complex-remodel"][2] = 0.22;
    snapshot.rules.fixedCharges!["01-01-07"] = 150;
  });
  const economics = { jobClass: "complex-remodel" as const, direct: 10000, otherCostDollars: 2000, otherCostRate: 0.02 };
  const baseQuote = netQuotePrice(economics);
  await runWithPricing(next, async () => {
    await new Promise(resolve => setTimeout(resolve, 1)); // the release follows the request across awaits
    assert.equal(sharedBookRate("09-91-01", "mid")!.amount, Math.round(before * 2 * 100) / 100);
    assert.equal(netQuotePrice(economics).netTarget, 0.22);
    assert.ok(netQuotePrice(economics).price > baseQuote.price);
    assert.equal(releasedVisitMinimum(), 150);
    assert.equal(fixedBookCharge("PB-01-01-07")!.visitMinimum, true);
    assert.notEqual(costBookVersion(), PRICE_BOOK_VERSION);
  });
  assert.equal(sharedBookRate("09-91-01", "mid")!.amount, before);
  assert.equal(netQuotePrice(economics).price, baseQuote.price);
  assert.equal(releasedVisitMinimum(), 135);
});

test("the owner's worked example holds: $10,000 direct, $2,000 allocated, 2% of sale, 18% net, 32% gross", () => {
  const quote = netQuotePrice({ jobClass: "standard-remodel", direct: 10000, otherCostDollars: 2000, otherCostRate: 0.02 });
  assert.equal(Math.ceil(10000 / (1 - 0.32)), 14706);
  assert.equal(quote.price, 15000);
  assert.equal(Math.round(quote.netProfit), 2700);
  assert.equal(Math.round(quote.netMargin * 1000) / 1000, 0.18);
});

test("the same guided scope gives the same dollars under the same release, different dollars under a changed one, and records which", () => {
  const input = { brand: "remodeling", project: "bathroom-remodel", tier: "mid", answers: {}, address: null, property: null } as unknown as Parameters<typeof priceEstimate>[0];
  const first = priceEstimate(input), again = priceEstimate(input);
  assert.deepEqual(first.pricing.totals, again.pricing.totals);
  assert.deepEqual(first.versions.pricingRelease, { version: "P5-BID-2026-11-25", digest: baselinePricing().digest, source: "baseline" });
  const dearer = release("P5-TEST-DEARER", snapshot => {
    for (const line of snapshot.lines) if (line[5] !== "Percentage" && !["01-31-03", "01-31-04", "01-31-05"].includes(line[0]))
      for (const i of [10, 11, 12, 13]) (line[i] as number) = Math.round((line[i] as number) * 1.1 * 100) / 100;
  });
  const priced = runWithPricing(dearer, () => priceEstimate(input));
  assert.ok(priced.pricing.totals.basePrice > first.pricing.totals.basePrice);
  assert.equal(priced.versions.pricingRelease?.version, "P5-TEST-DEARER");
  assert.equal(priced.versions.pricingRelease?.digest, dearer.digest);
  assert.equal(priced.pricing.policy.pricingRelease?.digest, dearer.digest);
  // Pricing the first scope again after the change still gives the first result when run under the first release.
  assert.deepEqual(runWithPricing(baselinePricing(), () => priceEstimate(input)).pricing.totals, first.pricing.totals);
});

test("a site accepts a fetched release only when its digest and catalog check out", async () => {
  const good = release("P5-TEST-FETCH", snapshot => { snapshot.rules.jobPolicies["complex-remodel"][0] = 0.36; });
  const wire = { version: good.version, digest: good.digest, generation: 4, snapshot: good.snapshot };
  assert.equal(verifyReleasePayload(JSON.parse(JSON.stringify(wire))).digest, good.digest);
  assert.throws(() => verifyReleasePayload({ ...wire, digest: "0".repeat(64) }), /digest/);
  const tampered = JSON.parse(JSON.stringify(wire)); tampered.snapshot.lines[5][13] += 1;
  assert.throws(() => verifyReleasePayload(tampered), /digest/);
  const missing = structuredClone(good.snapshot); missing.lines.splice(10, 1);
  assert.throws(() => verifyReleasePayload({ version: "P5-TEST-MISSING", digest: digestPricingSnapshot(missing), snapshot: missing }));

  const calls: { url: string; auth: string | null }[] = [];
  const fetcher = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return Response.json(wire);
  }) as typeof fetch;
  // No token: the site prices from its compiled baseline and calls nothing.
  assert.equal((await fetchPricingRelease(undefined, fetcher, {})).source, "baseline");
  assert.equal(calls.length, 0);
  const fetched = await fetchPricingRelease(undefined, fetcher, { P5_PRICING_RELEASE_TOKEN: "t".repeat(32) });
  assert.equal(fetched.version, "P5-TEST-FETCH");
  assert.equal(calls[0].url, "https://p5homeco.com/api/pricing/release");
  assert.equal(calls[0].auth, `Bearer ${"t".repeat(32)}`);
  await assert.rejects(fetchPricingRelease(undefined, fetcher, { P5_PRICING_RELEASE_TOKEN: "t".repeat(32), P5_PRICING_RELEASE_URL: "http://example.com/x" }), /HTTPS/);
  const nothing = (async () => Response.json({ baseline: true })) as typeof fetch;
  assert.equal((await fetchPricingRelease(undefined, nothing, { P5_PRICING_RELEASE_TOKEN: "t".repeat(32) })).source, "baseline");
});

/** The workbook as the Sheets API returns it unformatted, built from a snapshot. */
function workbookValues(snapshot: PricingSnapshot, edit?: (costBook: unknown[][], policy: unknown[][]) => void) {
  const head = ["ID", "Division", "Section", "Item", "Unit", "Cost type", "Essential\nbook cost", "Signature\nbook cost", "Premium\nbook cost", "Luxury\nbook cost",
    "Essential reference sell", "Signature reference sell", "Premium reference sell", "Luxury reference sell", "Remodel\npremium", "Notes", "Market basis", "Source", "Confidence", "Last verified", "Pricing basis", "New quote treatment"];
  const fixed = snapshot.rules.fixedCharges!;
  const costBook: unknown[][] = [head, ...snapshot.lines.map(line => {
    const service = ["01-31-03", "01-31-04", "01-31-05"].includes(line[0]);
    const tiers = service ? [77.27, 77.27, 77.27, 77.27] : line.slice(10, 14);
    const sell = fixed[line[0]] ?? (service ? 125 : "");
    return [line[0], line[1], line[2], line[3], line[4], line[5], ...tiers, sell, sell, sell, sell, line[14], line[15], "", "", "Med", "2026-11-15", fixed[line[0]] !== undefined || service ? "Fixed selling price" : "Book planning input", ""];
  })];
  const p = snapshot.rules.jobPolicies;
  const klass = (label: string, key: keyof typeof p) => [label, p[key][0] || "", "", p[key][2], key === "protected" ? "Yes" : "No", "", p[key][1] ?? ""];
  const policy: unknown[][] = [["P5 pricing policy | New estimates"], ["Standing policy"],
    ["Project class", "Gross target", "Pricing basis", "Normal net target", "Protect prior price", "Eligibility and scope", "Owner concession gross floor"],
    klass("Repeat builder stock cabinets", "builder-cabinets"), klass("Retail cabinet supply", "retail-cabinets"), klass("Standard installed cabinets", "installed-cabinets"),
    klass("Same-layout kitchen", "same-layout-kitchen"), klass("Standard bath or light multiroom", "standard-remodel"), klass("Structural kitchen or complex whole home", "complex-remodel"),
    klass("Handyman or short work", "short-service"), klass("Simple one-story addition", "simple-addition"), klass("Verified ADU conversion", "verified-conversion"),
    klass("New home or detached new-build ADU", "protected"), klass("High-risk addition or uncertain conversion", "protected"), klass("Other or change order", "protected"),
    ["Rush work", "", "Protected schedule", snapshot.rules.rushMinNet, "Yes", ""],
    ["Control", "Value", "Application"], ["Hard net minimum", 0.15, ""], ["P5 project services per person-hour", 125, ""],
    ["Boise Handyman labor per hour", fixed["01-01-01"], ""], ["Handyman half day", fixed["01-01-04"], ""], ["Handyman full day", fixed["01-01-05"], ""],
    ["Handyman minimum visit", fixed["01-01-07"], ""], ["Approved materials pickup", fixed["01-01-08"], ""]];
  edit?.(costBook, policy);
  return { costBook, policy };
}

test("the workbook as it stands compiles to the release in force, and an edit shows exactly what changes", () => {
  const base = baselinePricing();
  const same = previewWorkbook(workbookValues(base.snapshot), base);
  assert.ok(same.ok && same.unchanged, same.ok ? "expected no change" : same.issues.join("; "));

  const edited = workbookValues(base.snapshot, (costBook, policy) => {
    const paint = costBook.find(r => r[0] === "09-91-01")!;
    for (const i of [6, 7, 8, 9]) paint[i] = Math.round((paint[i] as number) * 1.05 * 100) / 100;
    costBook.find(r => r[0] === "01-01-08")![3] = "Materials pickup, separately approved"; // wording may change
    policy.find(r => r[0] === "Structural kitchen or complex whole home")![3] = 0.21;
  });
  const preview = previewWorkbook(edited, base);
  assert.ok(preview.ok && !preview.unchanged);
  if (!preview.ok) return;
  assert.deepEqual(preview.diff.rateChanges.map(c => c.code), ["09-91-01"]);
  assert.deepEqual(preview.diff.ruleChanges, [{ rule: "complex-remodel: net target", before: "20%", after: "21%" }]);
  assert.equal(preview.snapshot.lines.find(l => l[0] === "01-01-08")![3], "Materials pickup, separately approved");
  assert.equal(preview.snapshot.lines.find(l => l[0] === "01-31-03")![10], 125, "project services stay the fixed $125 rate");
  assert.equal(workbookRevision(edited), preview.revision);
  assert.notEqual(preview.revision, same.revision);
  assert.equal(diffSnapshots(base.snapshot, base.snapshot).rateChanges.length, 0);
});

test("a workbook that is not safe to publish reports what to fix and yields no candidate", () => {
  const base = baselinePricing();
  const issues = (edit: Parameters<typeof workbookValues>[1]) => {
    const preview = previewWorkbook(workbookValues(base.snapshot, edit), base);
    assert.equal(preview.ok, false);
    return preview.ok ? [] : preview.issues;
  };
  assert.match(issues(c => { c.find(r => r[0] === "09-91-01")![7] = "$4.10"; }).join(" "), /numeric/);
  assert.match(issues(c => { c.find(r => r[0] === "09-91-01")![4] = "LF"; }).join(" "), /unit or cost type/);
  assert.match(issues(c => { c.splice(40, 1); }).join(" "), /Expected 1487/);
  assert.match(issues(c => { c.push(["99-99-99", "X", "Y", "New thing", "EA", "Material Only", 1, 1, 1, 1, "", "", "", "", 0]); }).join(" "), /new or unknown cost code/);
  assert.match(issues((c, p) => { p.find(r => r[0] === "Hard net minimum")![1] = 0.12; }).join(" "), /15% floor/);
  assert.match(issues((c, p) => { p.find(r => r[0] === "Same-layout kitchen")![3] = 0.16; }).join(" "), /same-layout-kitchen/);
  assert.match(issues((c, p) => { p.find(r => r[0] === "Handyman minimum visit")![1] = 150; }).join(" "), /disagree/);
  assert.throws(() => compilePricingWorkbook({ workbookId: "someone-elses-sheet", costBook: [], policy: [] }, base.snapshot), (e: unknown) => /canonical/.test((e as { issues: string[] }).issues.join(" ")));
  assert.equal(CANONICAL_P5_WORKBOOK.length > 20, true);
});
