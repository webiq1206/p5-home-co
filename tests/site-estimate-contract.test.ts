/**
 * Site estimates into QuickBooks: the contract and the pure rules.
 *
 * `estimate` on the lead intake is the price a website gave the visitor. It is
 * read forgivingly (a bad one is "no estimate", never a refused lead) and
 * passed on strictly: customer prices only, a total that is the lines' total,
 * and ceilings a hostile post cannot get past. No database is used here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_SITE_ESTIMATE_LINES,
  SITE_ESTIMATE_CEILING,
  SITE_ESTIMATE_UNVERIFIED_CEILING,
  readSiteEstimate,
} from "../app/lib/leads/intakeContract.ts";
import {
  SITE_ESTIMATE_ITEMS,
  documentSiteEstimate,
  siteEstimateDivision,
  siteEstimateDoc,
  siteEstimateEnabled,
  siteEstimateItem,
  siteEstimatePricing,
  siteRangeNote,
} from "../app/lib/leads/site-estimate.ts";
import { describeLeadEstimate } from "../app/lib/leads/estimate-links.ts";
import { submittedFieldsFromBody } from "../app/lib/leads/submittedFields.ts";
import { BRANDS } from "../app/lib/leads/types.ts";
import { rangeNote } from "../app/lib/estimator/deliver.ts";
import { buildEstimatePayload } from "../app/lib/scopes/estimate.ts";
import { isDivision } from "../app/lib/scopes/divisions.ts";
import { P5_ITEMS } from "../app/lib/scopes/qbo.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const good = (extra: Record<string, unknown> = {}) => ({ kind: "planning-range", low: 40000, high: 55000, verified: true, ...extra });
const sum = (amounts: number[]) => Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;

test("no estimate sent is not a problem, and a lead is never refused for a bad one", () => {
  for (const absent of [undefined, null, ""]) assert.deepEqual(readSiteEstimate(absent), { estimate: null, problem: null });
  for (const bad of ["nonsense", 12, [], true, "{broken", { kind: "planning-range" }, { low: 1, high: 2 }, { kind: "bid", low: 1, high: 2 }]) {
    const result = readSiteEstimate(bad);
    assert.equal(result.estimate, null);
    assert.ok(result.problem, `a reason is given for ${JSON.stringify(bad)}`);
  }
});

test("a planning range without lines: the one figure is the base sent, else the midpoint", () => {
  const mid = readSiteEstimate(good()).estimate!;
  assert.deepEqual({ kind: mid.kind, low: mid.low, high: mid.high, base: mid.base, lines: mid.lines, verified: mid.verified }, { kind: "planning-range", low: 40000, high: 55000, base: 47500, lines: [], verified: true });
  assert.equal(readSiteEstimate(good({ base: 46123.456 })).estimate!.base, 46123.46);
  assert.equal(readSiteEstimate(good({ low: "40000", high: "55000.50" })).estimate!.high, 55000.5, "numeric strings are read");
  // A firm price: low and high are the same figure.
  const firm = readSiteEstimate(good({ low: 12400, high: 12400 })).estimate!;
  assert.equal(firm.base, 12400);
  // A JSON string is read too (some forms post one).
  assert.equal(readSiteEstimate(JSON.stringify(good())).estimate!.base, 47500);
});

test("with lines, the total is the lines' total, to the cent", () => {
  const lines = [
    { title: "  Flooring  ", amount: 8200.004, division: "FLOORING", quantity: 410, unit: "sq ft" },
    { title: "Cabinets", description: "Shaker, painted", amount: "21450.10" },
    { title: "Plumbing", amount: 6349.9 },
  ];
  const estimate = readSiteEstimate(good({ low: 32000, high: 41000, lines })).estimate!;
  assert.deepEqual(estimate.lines.map((l) => l.amount), [8200, 21450.1, 6349.9]);
  assert.equal(estimate.base, 36000);
  assert.equal(estimate.lines[0].title, "Flooring");
  assert.equal(estimate.lines[0].quantity, 410);
  assert.equal(estimate.lines[1].description, "Shaker, painted");
  assert.deepEqual(estimate.notes, []);

  // A base that agrees to the cent is not remarked on; one that does not is replaced by the lines and noted.
  assert.deepEqual(readSiteEstimate(good({ low: 32000, high: 41000, lines, base: 36000.005 })).estimate!.notes, []);
  const disagreed = readSiteEstimate(good({ low: 32000, high: 41000, lines, base: 37000 })).estimate!;
  assert.equal(disagreed.base, 36000, "the lines are kept");
  assert.match(disagreed.notes.join(" "), /did not equal the lines.*the lines were kept/);
});

test("numbers must be finite and above zero, the range the right way round, and lines at most sixty", () => {
  for (const bad of [
    good({ low: 0 }), good({ high: -5 }), good({ low: Number.NaN }), good({ high: Number.POSITIVE_INFINITY }), good({ low: "$40,000" }),
    good({ low: 60000, high: 50000 }), good({ base: -1 }), good({ base: "about 47k" }),
    good({ lines: "Flooring 8200" }), good({ lines: [{ title: "Flooring" }] }), good({ lines: [{ title: "Credit", amount: -500 }] }),
    good({ lines: [{ amount: 500 }] }), good({ lines: ["Flooring"] }),
    good({ lines: Array.from({ length: MAX_SITE_ESTIMATE_LINES + 1 }, (_, i) => ({ title: `Line ${i}`, amount: 800 })) }),
  ]) {
    const result = readSiteEstimate(bad);
    assert.equal(result.estimate, null, JSON.stringify(bad).slice(0, 90));
    assert.ok(result.problem);
  }
  const sixty = readSiteEstimate(good({ lines: Array.from({ length: MAX_SITE_ESTIMATE_LINES }, (_, i) => ({ title: `Line ${i}`, amount: 800 })) })).estimate!;
  assert.equal(sixty.lines.length, 60);
  assert.equal(sixty.base, 48000);
  // A line priced at nothing adds nothing: it is left out and said, not fatal.
  const withEmpty = readSiteEstimate(good({ lines: [{ title: "Flooring", amount: 47000 }, { title: "Included", amount: 0 }] })).estimate!;
  assert.equal(withEmpty.lines.length, 1);
  assert.match(withEmpty.notes.join(" "), /1 line with no amount left out/);
});

test("strings are trimmed, flattened to one line and capped", () => {
  const estimate = readSiteEstimate(good({
    label: `  Kitchen remodel,\n mid-range ${"x".repeat(400)}`,
    lines: [{ title: `T${"t".repeat(400)}`, description: `D\u0000${"d".repeat(2000)}`, unit: "u".repeat(60), division: "v".repeat(200), amount: 47000 }],
  })).estimate!;
  assert.equal(estimate.label!.length, 200);
  assert.ok(estimate.label!.startsWith("Kitchen remodel, mid-range"));
  assert.equal(estimate.lines[0].title.length, 200);
  assert.equal(estimate.lines[0].description!.length, 1000);
  assert.ok(!estimate.lines[0].description!.includes("\u0000"));
  assert.equal(estimate.lines[0].unit!.length, 20);
  assert.equal(estimate.lines[0].division!.length, 80);
});

test("the ceilings: nothing above five million, and nothing unverified above five hundred thousand", () => {
  assert.equal(SITE_ESTIMATE_CEILING, 5_000_000);
  assert.equal(SITE_ESTIMATE_UNVERIFIED_CEILING, 500_000);
  const over = readSiteEstimate({ kind: "planning-range", low: 5_200_000, high: 6_000_000, base: 5_500_000, verified: true });
  assert.equal(over.estimate, null);
  assert.match(over.problem!, /above the \$5,000,000 ceiling/);
  const browser = readSiteEstimate({ kind: "planning-range", low: 600_000, high: 700_000 });
  assert.equal(browser.estimate, null);
  assert.match(browser.problem!, /not verified by the site's server.*\$500,000 ceiling/);
  // "verified" must be the boolean true: a truthy string is not the site's word.
  assert.equal(readSiteEstimate({ kind: "planning-range", low: 600_000, high: 700_000, verified: "true" }).estimate, null);
  assert.equal(readSiteEstimate({ kind: "planning-range", low: 600_000, high: 700_000, verified: true }).estimate!.base, 650_000);
  assert.equal(readSiteEstimate({ kind: "planning-range", low: 400_000, high: 480_000 }).estimate!.verified, false);
  // The ceiling is on the figure QuickBooks would hold: lines that add up past it are refused too.
  const lines = Array.from({ length: 6 }, (_, i) => ({ title: `Building ${i}`, amount: 1_000_000 }));
  assert.equal(readSiteEstimate({ kind: "document", low: 5_000_000, high: 6_500_000, lines, verified: true }).estimate, null);
});

test("a total that does not belong to its range is not that estimate", () => {
  const far = readSiteEstimate({ kind: "planning-range", low: 1, high: 2, base: 400_000 });
  assert.equal(far.estimate, null);
  assert.match(far.problem!, /does not belong to its range/);
  assert.equal(readSiteEstimate(good({ lines: [{ title: "Only the flooring", amount: 8000 }] })).estimate, null);
  // A firm price rounded up from its base still belongs.
  assert.equal(readSiteEstimate({ kind: "document", low: 12400, high: 12400, base: 12340.55, verified: true }).estimate!.base, 12340.55);
});

test("the estimate is not a submitted field: it is not stored on the lead or sent to HubSpot", () => {
  const fields = submittedFieldsFromBody({ name: "Pat Example", estimate: good(), site_estimate: good(), siteEstimate: good(), answers: { estimate: "A kitchen and a bath" } });
  const labels = fields.map((f) => f.label).join(" | ");
  assert.doesNotMatch(labels, /^Estimate|\| Estimate|Site estimate/i);
  // A custom question that happens to be called "estimate" is still the visitor's own answer.
  assert.ok(fields.some((f) => f.value === "A kitchen and a bath"));
  // The intake itself puts it nowhere: it only queues the QuickBooks work.
  const handler = read("app/api/leads/intake/handler.ts");
  assert.equal((handler.match(/siteEstimate\b/g) ?? []).length > 0, true);
  assert.doesNotMatch(handler, /summary[^\n]*siteEstimate|siteEstimate[^\n]*summary/);
});

test("every line books to an item QuickBooks has, by brand, and by division when it clearly maps", () => {
  for (const brand of BRANDS) assert.ok(P5_ITEMS.includes(SITE_ESTIMATE_ITEMS.brand[brand]), brand);
  for (const entry of [...SITE_ESTIMATE_ITEMS.division, ...SITE_ESTIMATE_ITEMS.cabinetDivision]) assert.ok(P5_ITEMS.includes(entry.item), entry.item);
  for (const entry of SITE_ESTIMATE_ITEMS.division) if (entry.cabinetItem) assert.ok(P5_ITEMS.includes(entry.cabinetItem));

  assert.equal(siteEstimateItem("Boise Remodeling Co", "FLOORING"), "Subcontractor Work");
  assert.equal(siteEstimateItem("Boise Remodeling Co", null), "Subcontractor Work");
  assert.equal(siteEstimateItem("Boise Construction Co", "FOUNDATION"), "Subcontractor Work");
  assert.equal(siteEstimateItem("Boise Handyman Co", "Drywall"), "Handyman Service Work");
  assert.equal(siteEstimateItem("Boise Cabinet Co", "Kitchen"), "Cabinet Installation");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "Permits"), "Permits and Fees");
  assert.equal(siteEstimateItem("Boise Handyman Co", "Permits & Fees"), "Permits and Fees");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "Plans & Engineering"), "Design and Preconstruction Services");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "DESIGN"), "Design and Preconstruction Services");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "00"), "Design and Preconstruction Services");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "Freight + Delivery"), "Freight and Delivery");
  assert.equal(siteEstimateItem("Boise Cabinet Co", "Delivery"), "Cabinet Freight and Delivery");
  assert.equal(siteEstimateItem("Boise Cabinet Co", "Cabinet product"), "Cabinet Product");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "Cabinet product"), "Subcontractor Work", "the cabinet items are Boise Cabinet Co's");
  // Only a division named exactly that maps: labor that mentions design is still labor.
  assert.equal(siteEstimateItem("Boise Remodeling Co", "DESIGN + BUILD LABOR"), "Subcontractor Work");
  assert.equal(siteEstimateItem("Boise Remodeling Co", "Kitchen design consult and permits"), "Subcontractor Work");
});

test("the division heading is a cost book division, whatever name the site used", () => {
  const cases: [string | null, string][] = [
    ["09", "09"], ["FLOORING", "09"], ["Painting", "09"], ["TILE + STONE", "09"], ["Drywall", "09"], ["Plumbing", "22"], ["ELECTRICAL", "26"],
    ["MECHANICAL (HVAC)", "23"], ["Heating & Cooling", "23"], ["COUNTERTOPS + CABINETRY", "12"], ["Cabinets", "12"], ["FRAMING", "06"],
    ["INTERIOR DOORS + MILLWORK", "06"], ["Windows & Doors", "08"], ["EXTERIOR OPENINGS", "08"], ["Roofing", "07"], ["FOUNDATION", "03"], ["Concrete", "03"],
    ["LANDSCAPE", "32"], ["SITE WORK", "31"], ["Permits", "00"], ["DESIGN", "00"], ["Plans & Engineering", "00"], ["Demolition", "02"],
    ["Cleanup & Disposal", "01"], ["Appliances", "11"], ["Primary bathroom", "90"], [null, "90"], ["77", "90"],
  ];
  for (const [name, code] of cases) {
    assert.equal(siteEstimateDivision("Boise Remodeling Co", name), code, String(name));
    assert.ok(isDivision(siteEstimateDivision("Boise Remodeling Co", name)));
  }
  assert.equal(siteEstimateDivision("Boise Cabinet Co", "Primary bathroom"), "12");
});

test("the priced lines are customer prices only, and add up to the base to the cent", () => {
  const estimate = readSiteEstimate(good({
    low: 32000, high: 41000, label: "Kitchen remodel, mid-range, 180 sq ft",
    lines: [
      { title: "Flooring", amount: 8200, division: "FLOORING", quantity: 410, unit: "SF" },
      { title: "Cabinets", description: "Shaker, painted", amount: 21450.1, quantity: 3, unit: "EA" },
      { title: "Permits", amount: 349.9 },
      { title: "Plumbing", amount: 6000, division: "PLUMBING" },
    ],
  })).estimate!;
  const pricing = siteEstimatePricing("Boise Remodeling Co", estimate);
  assert.equal(pricing.totals.basePrice, estimate.base);
  assert.equal(sum(pricing.lines.map((l) => l.price)), 36000);
  for (const line of pricing.lines) {
    assert.equal(line.cost, null);
    assert.equal(line.unitCost, null);
    assert.equal(line.optional, false);
    assert.equal(line.basis, "site-estimate");
    assert.ok(P5_ITEMS.includes(line.item));
    // QuickBooks refuses a line whose amount is not its quantity times its rate.
    assert.equal(Math.round(line.quantity * line.unitPrice * 100) / 100, line.price, line.title);
  }
  assert.equal(pricing.totals.baseCost, null);
  assert.equal(pricing.totals.margin, null);
  assert.equal(pricing.totals.profit, null);
  const [flooring, cabinets, permits] = pricing.lines;
  assert.deepEqual([flooring.quantity, flooring.unit, flooring.unitPrice, flooring.division], [410, "SF", 20, "09"]);
  // 21450.10 does not divide by 3 to the cent: one lump sum, with the quantity in words.
  assert.deepEqual([cabinets.quantity, cabinets.unit, cabinets.unitPrice], [1, "LS", 21450.1]);
  assert.equal(cabinets.description, "Shaker, painted (3 EA)");
  assert.deepEqual([permits.item, permits.division, permits.phase], ["Permits and Fees", "00", "pre-construction"]);

  // No lines: one line, titled from the label, at the base.
  const lump = siteEstimatePricing("Boise Handyman Co", readSiteEstimate(good({ label: "Punch list, half day" })).estimate!);
  assert.equal(lump.lines.length, 1);
  assert.deepEqual([lump.lines[0].title, lump.lines[0].price, lump.lines[0].item, lump.lines[0].division], ["Punch list, half day", 47500, "Handyman Service Work", "90"]);
  assert.equal(siteEstimatePricing("Boise Cabinet Co", readSiteEstimate(good()).estimate!).lines[0].title, "Planning range");

  // What reaches QuickBooks: sales lines that total the base, and not one cost or margin figure.
  const payload = buildEstimatePayload({
    customerId: "34", pricing, itemIds: Object.fromEntries(P5_ITEMS.map((item, i) => [item, String(100 + i)])) as never,
    taxable: [], exclusions: [], privateNote: "note",
  });
  const sales = payload.Line.filter((l) => l.DetailType === "SalesItemLineDetail");
  assert.equal(sum(sales.map((l) => l.Amount!)), estimate.base);
  assert.equal(payload.EmailStatus, "NotSet", "created unsent");
  assert.doesNotMatch(JSON.stringify(payload), /cost|margin|markup|profit|overhead|contingenc/i);
});

test("the range travels as words, in the guided estimator's wording", () => {
  const guided = rangeNote({ customer_view: { range: { low: 32000, high: 41000 } } as never, total: "36000.00" });
  assert.equal(siteRangeNote({ low: 32000, high: 41000, base: 36000 }), guided);
  assert.match(guided, /^Preliminary range given online: \$32,000 to \$41,000\. The total on this estimate \(\$36,000\) is the base figure that range is built on\.$/);
  const firm = siteRangeNote({ low: 12400, high: 12400, base: 12340.55 });
  assert.match(firm, /^Price given online: \$12,400, one figure and not a range\. The total on this estimate \(\$12,341\)/);
  const doc = siteEstimateDoc("Boise Remodeling Co", readSiteEstimate(good({ label: "Kitchen remodel" })).estimate!);
  assert.match(doc.summary, /^Planning range from the Boise Remodeling Co request form: Kitchen remodel\./);
  assert.match(doc.summary, /Figures verified by the site's server\./);
  assert.match(siteEstimateDoc("P5 Home Co", readSiteEstimate({ kind: "document", low: 900, high: 1100 }).estimate!).summary, /^Document estimator on P5 Home Co\..*not verified by the site's server/);
  assert.deepEqual(doc.tasks, [], "no scope is invented for it");
});

test("the document estimator's record: customer amounts, the contract price, the range shown", () => {
  const record = {
    draftId: "12345678-1234-4123-8123-123456789abc", revision: 3,
    scope: { answers: { service: "installation" } },
    customer: { range: { low: 3000, high: 3600 } },
    internal: {
      contractPrice: 3333.335,
      lines: [
        { description: "Install owner-supplied trim", quantity: 120, unit: "LF", trade: "Trim & Finish Carpentry", sellingAmount: 1111.1117, sellingUnitPrice: 9.2593, cost: 700, unitCost: 5.83, operatingProfit: 120, overheadRecovery: 200, contingency: 70, riskAdjustedCost: 770 },
        { description: "Paint new trim", quantity: 1, unit: "LS", trade: "Painting", sellingAmount: 2222.2233, cost: 1400, operatingProfit: 240 },
        { description: "No charge item", quantity: 1, unit: "EA", trade: "Painting", sellingAmount: 0 },
      ],
    },
  };
  const estimate = documentSiteEstimate(record)!;
  assert.equal(estimate.kind, "document");
  assert.equal(estimate.verified, true);
  assert.deepEqual([estimate.low, estimate.high, estimate.base], [3000, 3600, 3333.34]);
  assert.equal(estimate.lines.length, 2);
  // Rounding each line to the cent moved a cent; it goes on the largest line, so the lines are the contract price.
  assert.equal(sum(estimate.lines.map((l) => l.amount)), 3333.34);
  assert.deepEqual(estimate.lines.map((l) => l.division), ["Trim & Finish Carpentry", "Painting"]);
  assert.equal(estimate.label, "Document estimate, installation");
  // Not one internal field crosses.
  assert.doesNotMatch(JSON.stringify(estimate), /cost|profit|overhead|contingenc|margin/i);
  // It passes the same reading the intake applies.
  const reread = readSiteEstimate(estimate);
  assert.equal(reread.problem, null);
  assert.equal(reread.estimate!.base, 3333.34);
  assert.deepEqual(reread.estimate!.notes, []);

  // No price shown to the customer: nothing for QuickBooks.
  assert.equal(documentSiteEstimate({ ...record, customer: {} }), null);
  assert.equal(documentSiteEstimate({ ...record, customer: { range: null } }), null);
  assert.equal(documentSiteEstimate({ ...record, internal: { lines: [] } }), null);
  assert.equal(documentSiteEstimate(null), null);

  // More lines than one estimate carries: one line per trade, the same total.
  const many = {
    ...record,
    customer: { range: { low: 7000, high: 9000 } },
    internal: { contractPrice: 8000, lines: Array.from({ length: 80 }, (_, i) => ({ description: `Item ${i}`, quantity: 1, unit: "EA", trade: i % 2 ? "Plumbing" : "Electrical", sellingAmount: 100 })) },
  };
  const combined = documentSiteEstimate(many)!;
  assert.deepEqual(combined.lines.map((l) => [l.title, l.amount]), [["Electrical", 4000], ["Plumbing", 4000]]);
  assert.match(combined.notes.join(" "), /80 lines were combined into one line per trade/);
});

test("the switch, the wiring and the house style", () => {
  assert.equal(siteEstimateEnabled({}), true);
  assert.equal(siteEstimateEnabled({ SITE_ESTIMATE_QBO: "off" }), false);
  assert.equal(siteEstimateEnabled({ SITE_ESTIMATE_QBO: " OFF " }), false);
  assert.equal(siteEstimateEnabled({ SITE_ESTIMATE_QBO: "on" }), true);

  const handler = read("app/api/leads/intake/handler.ts");
  // Queued while the submission is handled, started only from handleIntake, after the team email is queued or sent.
  assert.match(handler, /if \(deps\.skipLeadAlert \|\| alerts\.siteEstimate \|\| !\(dealId > 0\)\) return;/, "the guided estimator never queues one");
  assert.equal((handler.match(/after\(alerts\.siteEstimate\)/g) ?? []).length, 2);
  const start = handler.indexOf("export async function handleIntake");
  const body = handler.slice(start, handler.indexOf("async function runIntake"));
  assert.ok(body.indexOf("for (const send of alerts.sends) after(") < body.indexOf("after(alerts.siteEstimate)"), "after the team email is queued");
  assert.ok(body.indexOf("alerts.sends.map((send) => send()") < body.lastIndexOf("after(alerts.siteEstimate)"), "after a confirmed team email is sent");
  assert.doesNotMatch(handler.slice(handler.indexOf("async function runIntake")), /after\(alerts\.siteEstimate\)|await [^\n]*createSiteEstimate/, "never on the visitor's path");
  const guided = read("app/lib/estimator/deliver.ts");
  assert.match(guided, /skipLeadAlert: true/);
  assert.doesNotMatch(guided, /estimate:\s*\{|site_estimate|siteEstimate/, "the guided estimator sends no `estimate`");

  // The watchdog retries beside the other two, in its own try and catch.
  const watchdog = read("app/lib/leads/watchdog.ts");
  assert.ok(watchdog.indexOf("await settleStageAlignment();") < watchdog.indexOf("await settleSiteEstimates();"));
  assert.match(watchdog, /try \{\s*const \{ settleSiteEstimates \} = await import\("\.\/site-estimate\.ts"\);\s*await settleSiteEstimates\(\);\s*\} catch/);

  // The document estimator: after its lead is saved, never for a QA record, loaded on demand.
  const adapter = read("lib/p5/deliveryAdapter.ts");
  assert.match(adapter, /if\(mode!=='synthetic_qa'\)await documentEstimateToQuickBooks\(record,result\.dealId\);\s*return String\(result\.dealId\);/);
  assert.match(adapter, /await import\("\.\.\/\.\.\/app\/lib\/leads\/site-estimate\.ts"\)/);
  assert.doesNotMatch(adapter, /^import [^\n]*site-estimate/m, "not a static import: the mail paths never load QuickBooks code");

  // Continuous integration runs the database suite, and runs when these files change.
  const workflow = read(".github/workflows/p5-estimator-verification.yml");
  const paths = workflow.split("\n").find((line) => line.trim().startsWith("paths:")) ?? "";
  for (const path of ["tests/site-estimate.integration.test.ts", "app/lib/leads/site-estimate.ts", "app/lib/leads/estimate-links.ts"]) assert.ok(paths.includes(`'${path}'`), path);
  assert.match(workflow, /run: node --test --test-concurrency=1 [^\n]*tests\/site-estimate\.integration\.test\.ts/);

  // Only an estimate is ever written, and never sent.
  const source = read("app/lib/leads/site-estimate.ts");
  assert.doesNotMatch(source, /["'`/]invoice|\/payment|salesreceipt|\/send\?sendTo|sendEstimate/i);
  for (const file of ["app/lib/leads/site-estimate.ts", "app/lib/leads/estimate-links.ts", "migrations/032_site_estimate_link.sql", "tests/site-estimate-contract.test.ts", "tests/site-estimate.integration.test.ts"]) {
    assert.ok(!read(file).includes(String.fromCharCode(8212)), `${file} has an em dash`);
  }
});

test("the examples in the contract document are estimates this code accepts", () => {
  const doc = read("docs/lead-intake-contract.md");
  const section = doc.slice(doc.indexOf("## The price the website gave"));
  const bodies = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]) as { brand: string; estimate: unknown });
  assert.equal(bodies.length, 2);
  const [byTrade, byRoom] = bodies.map((body) => readSiteEstimate(body.estimate));
  assert.equal(byTrade.problem, null);
  assert.deepEqual([byTrade.estimate!.base, byTrade.estimate!.lines.length, byTrade.estimate!.notes.length], [36000, 4, 0]);
  assert.equal(byRoom.problem, null);
  assert.deepEqual([byRoom.estimate!.base, byRoom.estimate!.low, byRoom.estimate!.high], [19000, 16500, 21500]);
  assert.deepEqual(siteEstimatePricing("Boise Cabinet Co", byRoom.estimate!).lines.map((l) => l.item), ["Cabinet Installation", "Cabinet Installation"]);
  assert.deepEqual(siteEstimatePricing("Boise Remodeling Co", byTrade.estimate!).lines.map((l) => l.item), ["Subcontractor Work", "Subcontractor Work", "Permits and Fees", "Subcontractor Work"]);
  // The document never shows a cost or a margin inside an estimate.
  for (const body of bodies) assert.doesNotMatch(JSON.stringify(body.estimate), /cost|margin|markup|profit|overhead|contingenc/i);
  assert.ok(!doc.includes(String.fromCharCode(8212)));
});

test("until a database has migration 032, the lead links read the guided estimator alone, as before", async () => {
  const { projectsForLead, leadsForProject } = await import("../app/lib/leads/estimate-links.ts");
  const holder = globalThis as { __p5Pool?: unknown };
  const before = { pool: holder.__p5Pool, url: process.env.DATABASE_URL };
  const seen: string[] = [];
  let failWith: Error | null = Object.assign(new Error('column sp.lead_deal_id does not exist'), { code: "42703" });
  holder.__p5Pool = {
    query: async (sql: string) => {
      seen.push(sql.includes("sp.lead_deal_id") ? "both" : "guided");
      if (sql.includes("sp.lead_deal_id") && failWith) throw failWith;
      return { rows: sql.includes("deal_id::int") ? [{ deal_id: 9 }] : [{ id: 5 }] };
    },
  };
  process.env.DATABASE_URL = "postgres://synthetic.invalid/offline";
  const logged = console.error;
  console.error = () => undefined;
  try {
    assert.deepEqual(await projectsForLead(1), [5]);
    assert.deepEqual(seen, ["both", "guided"], "the missing column is answered from the guided link");
    // It is not asked again straight away: the deletion and stage rules keep running at their old cost.
    assert.deepEqual(await leadsForProject(5), [9]);
    assert.deepEqual(seen, ["both", "guided", "guided"]);
  } finally {
    console.error = logged;
    holder.__p5Pool = before.pool;
    if (before.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before.url;
  }
  // Any other database error is a real one, never swallowed (checked on the source: only a missing lead_deal_id falls back).
  failWith = null;
  const source = read("app/lib/leads/estimate-links.ts");
  assert.match(source, /if \(!columnMissing\(error\)\) throw error;/);
  assert.match(source, /e\.code === "42703"[^\n]*&& \/lead_deal_id\/\.test/);
});

test("the lead page line says where an estimate came from and where it stands", () => {
  const base = { projectId: 7, title: "Example - 123 N Main St - Remodel", source: "site-estimate", qboEstimateId: "5001", docNumber: "1042", total: 36000, txnStatus: "Pending", emailStatus: "NotSet", invoiced: false };
  assert.equal(describeLeadEstimate(base), "Website estimate 1042 · $36,000.00 · in QuickBooks, not sent");
  assert.equal(describeLeadEstimate({ ...base, source: "online-estimator", emailStatus: "EmailSent" }), "Instant estimate 1042 · $36,000.00 · sent, awaiting response");
  assert.equal(describeLeadEstimate({ ...base, txnStatus: "Accepted" }), "Website estimate 1042 · $36,000.00 · accepted");
  assert.equal(describeLeadEstimate({ ...base, txnStatus: "Deleted" }), "Website estimate 1042 · $36,000.00 · deleted in QuickBooks");
  assert.equal(describeLeadEstimate({ ...base, qboEstimateId: null, docNumber: null, total: null, txnStatus: null }), "Website estimate · not in QuickBooks yet");
});
