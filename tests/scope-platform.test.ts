import { test } from "node:test";
import assert from "node:assert/strict";

import { PRICE_BOOK } from "../lib/p5/priceBookData.ts";
import { DIVISIONS, groupByPhaseDivision } from "../app/lib/scopes/divisions.ts";
import { priceScope, priceMultiplier } from "../app/lib/scopes/pricing.ts";
import { applyAnswer, deriveQuestions, readiness, reconcileMeasurements } from "../app/lib/scopes/gaps.ts";
import { supportingSuggestions } from "../app/lib/scopes/checklist.ts";
import { applyChanges, diffScopes, markEdited } from "../app/lib/scopes/merge.ts";
import { buildEstimatePayload, compareEstimate, estimateStatus } from "../app/lib/scopes/estimate.ts";
import { costBookRate } from "../app/lib/scopes/costbook.ts";
import {
  DEFAULT_SCOPE_SETTINGS,
  emptyScope,
  type ItemKey,
  type ScopeDoc,
  type ScopeSettings,
  type ScopeTask,
} from "../app/lib/scopes/types.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const SETTINGS: ScopeSettings = { ...DEFAULT_SCOPE_SETTINGS };
const ctx = (over: Partial<Parameters<typeof priceScope>[1]> = {}) => ({
  service: "kitchen",
  finishTier: "mid" as const,
  settings: SETTINGS,
  acknowledged: new Set<string>(),
  now: NOW,
  ...over,
});

function task(over: Partial<ScopeTask>): ScopeTask {
  return {
    id: "t1",
    title: "Install baseboard",
    description: "Install new baseboard in the kitchen.",
    phase: "construction",
    division: "06",
    bucket: "approved",
    certainty: "confirmed",
    performer: "subcontractor",
    evidence: [],
    ...over,
  };
}

function doc(tasks: ScopeTask[], extra: Partial<ScopeDoc> = {}): ScopeDoc {
  return { ...emptyScope(), summary: "Kitchen remodel", tasks, ...extra };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

test("division registry matches the cost book exactly, in order", () => {
  const fromBook: { code: string; name: string }[] = [];
  for (const r of PRICE_BOOK) {
    const code = r[0].slice(0, 2);
    if (!fromBook.some((d) => d.code === code)) fromBook.push({ code, name: r[1] });
  }
  assert.deepEqual(DIVISIONS, fromBook);
});

test("grouping puts pre-construction first and divisions in cost book order", () => {
  const groups = groupByPhaseDivision([
    { phase: "construction" as const, division: "22" },
    { phase: "construction" as const, division: "06" },
    { phase: "pre-construction" as const, division: "00" },
  ]);
  assert.deepEqual(groups.map((g) => g.phase), ["pre-construction", "construction"]);
  assert.deepEqual(groups[1].divisions.map((d) => d.code), ["06", "22"]);
});

test("a documented measurement prices through the owner's margin formula", () => {
  const d = doc([task({ costCode: "06-20-26", quantity: { measurementId: "m1" } })], {
    measurements: [{ id: "m1", label: "Baseboard length", value: 40, unit: "LF", status: "documented", evidence: [] }],
  });
  const r = priceScope(d, ctx());
  const rate = costBookRate("06-20-26", "mid", "kitchen")!;
  const { multiplier } = priceMultiplier("kitchen", NOW);
  assert.equal(r.lines.length, 1);
  const line = r.lines[0];
  assert.equal(line.cost, round2(rate.amount * 40));
  assert.equal(line.unitPrice, round2(rate.amount * multiplier));
  assert.equal(line.price, round2(line.unitPrice * 40));
  assert.equal(line.item, "Subcontractor Work");
  assert.equal(r.issues.length, 0);
  // 20% overhead, 12% kitchen profit, 10% reserve.
  assert.equal(round2(multiplier), round2(1.1 / (1 - 0.2 - 0.12)));
});

test("an estimated measurement prices but blocks until confirmed, and one answer fixes every task using it", () => {
  const d = doc(
    [
      task({ id: "a", costCode: "06-20-26", quantity: { measurementId: "m1" } }),
      task({ id: "b", title: "Paint baseboard", costCode: "06-20-26", quantity: { measurementId: "m1" } }),
    ],
    { measurements: [{ id: "m1", label: "Baseboard length", value: 35, unit: "LF", status: "estimated", evidence: [] }] },
  );
  const r = priceScope(d, ctx());
  assert.equal(r.lines.length, 2);
  const qs = deriveQuestions(d, r, new Map());
  assert.equal(qs.length, 1, "two tasks, one shared measurement, one question");
  assert.equal(qs[0].key, "measure:m1");
  assert.equal(qs[0].suggested, 35);
  assert.deepEqual(qs[0].taskIds.sort(), ["a", "b"]);
  assert.equal(readiness(d, r, qs).status, "needs_information");

  const answered = applyAnswer(d, "measure:m1", { value: 38 });
  const r2 = priceScope(answered, ctx());
  assert.equal(deriveQuestions(answered, r2, new Map()).length, 0);
  assert.ok(r2.lines.every((l) => l.quantity === 38));
  assert.equal(readiness(answered, r2, []).status, "ready");
});

test("bundled installed items never also get internal labor", () => {
  const d = doc([
    task({ costCode: "01-50-04", division: "01", performer: "internal", quantity: { value: 1 }, laborHours: { value: 6, basis: "stated" } }),
  ]);
  const r = priceScope(d, ctx());
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].basis, "cost-book");
  assert.match(r.lines[0].notes.join(" "), /not added/);
});

test("labor-only cost book line is replaced by internal labor at $125/hour", () => {
  const d = doc([
    task({ costCode: "06-20-26", performer: "internal", quantity: { value: 40, unit: "LF" }, laborHours: { value: 4, basis: "stated" } }),
  ]);
  const r = priceScope(d, ctx());
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].basis, "internal-labor");
  assert.equal(r.lines[0].price, 500);
  assert.equal(r.lines[0].unitPrice, 125);
  assert.equal(r.totals.laborHours, 4);
  assert.equal(r.totals.margin, null, "billed rate with no loaded cost leaves margin unknown");
});

test("material only plus internal crew adds material and labor once each", () => {
  const materialCode = PRICE_BOOK.find((row) => row[5] === "Material Only" && row[4] === "SF")![0];
  const d = doc([
    task({ costCode: materialCode, division: materialCode.slice(0, 2), performer: "internal", quantity: { value: 100 }, laborHours: { value: 8, basis: "proposed" } }),
  ]);
  const r = priceScope(d, ctx());
  assert.deepEqual(r.lines.map((l) => l.basis).sort(), ["cost-book", "internal-labor"]);
  const qs = deriveQuestions(d, r, new Map());
  assert.ok(qs.some((q) => q.key === "hours:t1" && q.suggested === 8), "proposed hours go to review with the proposal pre-filled");
});

test("P5 labor is never marked up: $125/hour is the customer's price on every service", () => {
  const d = doc([task({ costCode: null, performer: "internal", laborHours: { value: 2, basis: "confirmed" } })]);
  for (const service of ["kitchen", "remodel", "new-construction", "cabinet-install"]) {
    const r = priceScope(d, ctx({ service }));
    assert.equal(r.lines[0].unitPrice, 125, service);
    assert.equal(r.lines[0].price, 250, service);
    assert.equal(r.issues.length, 0, "nothing to confirm about the rate");
  }
  // Knowing P5's own cost changes the margin shown internally, never the price.
  const withCost = priceScope(d, ctx({ settings: { ...SETTINGS, laborLoadedCost: 80 } }));
  assert.equal(withCost.lines[0].price, 250);
  assert.equal(withCost.lines[0].cost, 160);
  assert.equal(readiness(d, withCost, []).status, "ready");
});

test("handyman trip charge is shown and credited, so it never adds to the total", () => {
  const work = task({ costCode: null, performer: "internal", laborHours: { value: 2, basis: "confirmed" } });
  // Set in Pricing setup: one charge line, one equal credit, net zero.
  const set = priceScope(doc([work]), ctx({ service: "handyman", settings: { ...SETTINGS, handymanTripCharge: 75 } }));
  assert.deepEqual(set.lines.map((l) => l.price), [250, 75, -75]);
  assert.equal(set.totals.basePrice, 250);
  // A trip charge task from the cost book is not charged twice when one is set.
  const trip = task({ id: "trip", title: "Trip charge", division: "01", costCode: "01-01-08", quantity: { value: 1, unit: "EA" } });
  const both = priceScope(doc([work, trip]), ctx({ service: "handyman", settings: { ...SETTINGS, handymanTripCharge: 75 } }));
  assert.equal(both.totals.basePrice, 250);
  assert.equal(both.lines.filter((l) => l.price > 0 && /trip/i.test(l.description)).length, 1);
  // Not set: the cost book trip charge is priced, then credited in full.
  const book = priceScope(doc([work, trip]), ctx({ service: "handyman", settings: { ...SETTINGS, handymanTripCharge: null } }));
  const charged = book.lines.find((l) => l.taskId === "trip")!.price;
  assert.ok(charged > 0);
  assert.equal(book.lines.at(-1)!.price, -charged);
  assert.equal(book.totals.basePrice, 250);
  // Other services are untouched, and a handyman job with nothing priced gets no stray lines.
  assert.equal(priceScope(doc([work]), ctx({ service: "kitchen", settings: { ...SETTINGS, handymanTripCharge: 75 } })).lines.length, 1);
  assert.equal(priceScope(doc([]), ctx({ service: "handyman", settings: { ...SETTINGS, handymanTripCharge: 75 } })).lines.length, 0);
});

test("unmatched work asks for a quote; the answer prices it as a written quote", () => {
  const d = doc([task({ title: "Electrical rough-in", division: "26", costCode: null })]);
  const r = priceScope(d, ctx());
  const qs = deriveQuestions(d, r, new Map());
  assert.equal(qs[0].key, "price:t1");
  assert.equal(qs[0].input.type, "currency");
  const answered = applyAnswer(d, "price:t1", { amount: 2400, assetId: 7 });
  const r2 = priceScope(answered, ctx());
  assert.equal(r2.lines[0].basis, "written-quote");
  assert.equal(r2.lines[0].cost, 2400);
  assert.equal(answered.tasks[0].quote?.assetId, 7);
});

test("optional upgrades are priced separately and never in the base total", () => {
  const d = doc([
    task({ id: "base", costCode: "06-20-26", quantity: { value: 10 } }),
    task({ id: "opt", bucket: "optional", costCode: "06-20-26", quantity: { value: 10 } }),
    task({ id: "idea", bucket: "considering", costCode: "06-20-26", quantity: { value: 10 } }),
  ]);
  const r = priceScope(d, ctx());
  const base = r.lines.find((l) => l.taskId === "base")!;
  assert.equal(r.totals.basePrice, base.price);
  assert.equal(r.totals.optionalPrice, base.price);
  assert.ok(!r.lines.some((l) => l.taskId === "idea"));
});

test("suggested supporting tasks are not priced until confirmed, and are not blocking", () => {
  const d = doc([
    task({ id: "cab", title: "Remove existing cabinets and install new", division: "12", costCode: null, quote: { amount: 9000 } }),
    task({ id: "pl", title: "Move sink plumbing", division: "22", costCode: null, quote: { amount: 1500 } }),
  ]);
  const suggestions = supportingSuggestions(d, "kitchen");
  const ids = suggestions.map((s) => s.id);
  for (const id of ["chk-protection", "chk-demolition", "chk-coordination", "chk-permit", "chk-cleanup"]) assert.ok(ids.includes(id), id);
  const withSuggestions = doc([...d.tasks, ...suggestions]);
  const r = priceScope(withSuggestions, ctx());
  assert.equal(r.lines.length, 2);
  const qs = deriveQuestions(withSuggestions, r, new Map());
  assert.ok(qs.filter((q) => q.key.startsWith("suggest:")).every((q) => !q.blocking));
  assert.equal(readiness(withSuggestions, r, qs).status, "ready");
  const declined = applyAnswer(withSuggestions, "suggest:chk-permit", { value: false });
  assert.equal(supportingSuggestions(declined, "kitchen").length, 0, "declined suggestions are not proposed again");
});

test("conflicts become one choice question; resolving confirms the task", () => {
  const d = doc([task({ certainty: "conflict", costCode: "06-20-26", quantity: { value: 10 } })], {
    conflicts: [{ id: "c1", topic: "baseboard style", statements: [{ text: "Flat 1x4", evidence: [] }, { text: "Colonial 3.25 in", evidence: [] }], taskIds: ["t1"] }],
  });
  const r = priceScope(d, ctx());
  assert.equal(r.lines.length, 0, "conflicting work is not priced");
  const qs = deriveQuestions(d, r, new Map());
  assert.equal(qs[0].key, "conflict:c1");
  assert.ok(qs[0].blocking);
  const resolved = applyAnswer(d, "conflict:c1", { value: "Colonial 3.25 in" });
  assert.equal(resolved.tasks[0].certainty, "confirmed");
  assert.equal(priceScope(resolved, ctx()).lines.length, 1);
});

test("a deferred question stays blocking but sorts after open ones", () => {
  const d = doc([
    task({ id: "a", costCode: null }),
    task({ id: "b", costCode: null, title: "Second" }),
  ]);
  const r = priceScope(d, ctx());
  const qs = deriveQuestions(d, r, new Map([["price:a", { status: "deferred" as const }]]));
  assert.equal(qs[0].key, "price:b");
  assert.equal(qs[1].key, "price:a");
  assert.ok(qs[1].deferred && qs[1].blocking);
});

test("duplicate measurements are merged and the firm value wins", () => {
  const d = doc([task({ quantity: { measurementId: "x" } }), task({ id: "t2", quantity: { measurementId: "y" } })], {
    measurements: [
      { id: "x", label: "Backsplash length", area: "Kitchen", value: 12, unit: "LF", status: "estimated", evidence: [] },
      { id: "y", label: "backsplash length", area: "kitchen", value: 14, unit: "LF", status: "documented", evidence: [] },
    ],
  });
  const r = reconcileMeasurements(d);
  assert.equal(r.measurements.length, 1);
  assert.equal(r.measurements[0].value, 14);
  assert.ok(r.tasks.every((t) => t.quantity?.measurementId === "y"));
});

test("regeneration keeps manual edits and only proposes the rest", () => {
  const current = doc([
    markEdited(task({ title: "Install baseboard" }), task({ title: "Install baseboard (owner supplied)" })),
    task({ id: "gone", title: "Old idea" }),
    task({ id: "mine", title: "Typed by hand", origin: "manual" }),
  ]);
  const generated = doc([
    task({ title: "Install MDF baseboard", description: "New description." }),
    task({ id: "new", title: "Paint trim" }),
  ]);
  const changes = diffScopes(current, generated);
  const byId = new Map(changes.map((c) => [c.id, c]));
  assert.ok(byId.get("kept:t1:title")?.informational);
  assert.ok(byId.has("task:t1:description"));
  assert.ok(byId.has("add:new"));
  assert.ok(byId.has("remove:gone"));
  assert.ok(!byId.has("remove:mine"));
  const applied = applyChanges(current, { changes, generated, createdAt: "" }, changes.map((c) => c.id));
  assert.equal(applied.tasks.find((t) => t.id === "t1")!.title, "Install baseboard (owner supplied)");
  assert.equal(applied.tasks.find((t) => t.id === "t1")!.description, "New description.");
  assert.ok(applied.tasks.some((t) => t.id === "new"));
  assert.ok(applied.tasks.some((t) => t.id === "mine"));
  assert.ok(!applied.tasks.some((t) => t.id === "gone"));
});

test("a confirmed measurement is not overwritten by regeneration", () => {
  const m = { id: "m1", label: "Backsplash length", value: 14, unit: "LF", status: "confirmed" as const, evidence: [] };
  const changes = diffScopes(doc([], { measurements: [m] }), doc([], { measurements: [{ ...m, value: 18, status: "stated" }] }));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "measurement-conflict");
  assert.ok(changes[0].informational);
});

test("estimate payload groups by phase and division and excludes optional lines from amounts", () => {
  const d = doc([
    task({ id: "d", phase: "pre-construction", division: "00", costCode: "00-20-02", quantity: { value: 1 } }),
    task({ id: "a", costCode: "06-20-26", quantity: { value: 10 } }),
    task({ id: "o", bucket: "optional", costCode: "06-20-26", quantity: { value: 5 }, description: "Crown upgrade" }),
  ]);
  const pricing = priceScope(d, ctx());
  const itemIds = Object.fromEntries(
    ["Subcontractor Work", "Permits and Fees", "Direct Labor"].map((k, i) => [k, String(i + 1)]),
  ) as Record<ItemKey, string>;
  const payload = buildEstimatePayload({
    customerId: "42",
    pricing,
    itemIds,
    taxable: [],
    exclusions: ["Appliances"],
    privateNote: "scope 1",
  });
  const descriptions = payload.Line.map((l) => l.Description);
  assert.equal(descriptions[0], "PHASE 1: PRE-CONSTRUCTION");
  assert.ok(descriptions.includes("PHASE 2: CONSTRUCTION"));
  assert.ok(descriptions.includes("DIVISION 06 WOOD & CARPENTRY"));
  const sales = payload.Line.filter((l) => l.DetailType === "SalesItemLineDetail");
  assert.equal(sales.length, 2);
  assert.equal(round2(sales.reduce((s, l) => s + (l.Amount ?? 0), 0)), pricing.totals.basePrice);
  assert.ok(sales.every((l) => l.Amount === round2(l.SalesItemLineDetail!.Qty * l.SalesItemLineDetail!.UnitPrice)));
  assert.match(payload.CustomerMemo!.value, /Optional upgrades, not included/);
  assert.equal(payload.EmailStatus, "NotSet");
});

test("estimate status labels follow QuickBooks fields only", () => {
  assert.equal(estimateStatus(null, false), "not_created");
  assert.equal(estimateStatus(null, true), "unavailable");
  assert.equal(estimateStatus({ TxnStatus: "Pending", EmailStatus: "NotSet" }, true), "created_unsent");
  assert.equal(estimateStatus({ TxnStatus: "Pending", EmailStatus: "EmailSent" }, true), "sent");
  assert.equal(estimateStatus({ TxnStatus: "Accepted" }, true), "accepted");
  assert.equal(estimateStatus({ TxnStatus: "Rejected" }, true), "declined");
  assert.equal(estimateStatus({ TxnStatus: "Closed", LinkedTxn: [{ TxnId: "9", TxnType: "Invoice" }] }, true), "converted");
});

test("changes made in QuickBooks are detected line by line", () => {
  const sent = {
    Line: [
      { DetailType: "SalesItemLineDetail", Description: "Baseboard", Amount: 100, SalesItemLineDetail: { Qty: 10, UnitPrice: 10 } },
      { DetailType: "DescriptionOnly", Description: "Phase 2" },
    ],
  };
  assert.equal(compareEstimate(sent, { Line: sent.Line, TotalAmt: 100 }).changed, false);
  const drift = compareEstimate(sent, {
    Line: [
      { DetailType: "SalesItemLineDetail", Description: "Baseboard", Amount: 120, SalesItemLineDetail: { Qty: 12, UnitPrice: 10 } },
      { DetailType: "SalesItemLineDetail", Description: "Extra", Amount: 50, SalesItemLineDetail: { Qty: 1, UnitPrice: 50 } },
    ],
    TotalAmt: 170,
  });
  assert.ok(drift.changed);
  assert.equal(drift.details.length, 3);
});

test("model output is normalized: real codes only, evidence scoped, unsupported values become estimates", async () => {
  const { normalizeScope } = await import("../app/lib/scopes/normalize.ts");
  const { costBookEntry } = await import("../app/lib/scopes/costbook.ts");
  const out = normalizeScope(
    {
      summary: "x",
      measurements: [
        { id: "m", label: "Backsplash length", value: 14, unit: "lf", status: "documented", evidence: [] },
        { id: "n", label: "Ceiling height", value: 9, unit: "FT", status: "stated", evidence: [{ assetId: 5, t: 12 }] },
        { id: "o", label: "Island", value: null, unit: "SF", status: "stated" },
      ],
      tasks: [
        { id: "a", title: "Tile backsplash", division: "99", costCode: "PB-06-20-26", quantity: { measurementId: "m" }, evidence: [{ assetId: 5, t: 30 }, { assetId: 999 }] },
        { id: "a", title: "Duplicate id", division: "06", costCode: "00-00-00", evidence: [] },
      ],
      conflicts: [{ id: "c", topic: "tile", statements: [{ text: "subway" }], taskIds: ["a"] }],
    },
    { assetIds: [5], validCostCode: (c) => Boolean(costBookEntry(c)) },
  );
  assert.equal(out.measurements[0].status, "estimated", "documented without a source is an estimate");
  assert.equal(out.measurements[0].unit, "LF");
  assert.equal(out.measurements[1].status, "stated");
  assert.equal(out.measurements[2].status, "missing");
  assert.equal(out.tasks[0].division, "06", "invalid division falls back to the cost code's");
  assert.equal(out.tasks[0].costCode, "06-20-26");
  assert.equal(out.tasks[0].evidence.length, 1, "evidence for unknown files is dropped");
  assert.notEqual(out.tasks[0].id, out.tasks[1].id);
  assert.equal(out.tasks[1].costCode, null);
  assert.equal(out.conflicts.length, 0, "a conflict needs two statements");
});

test("P5 crew labor-only work asks for hours, never a quantity", () => {
  const d = doc([task({ id: "sup", division: "01", costCode: "01-31-02", performer: "internal", laborHours: { value: null, basis: "proposed" } })]);
  const qs = deriveQuestions(d, priceScope(d, ctx()), new Map());
  assert.deepEqual(qs.map((q) => q.key), ["hours:sup"]);
  const answered = applyAnswer(d, "hours:sup", { value: 10 });
  const r = priceScope(answered, ctx());
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].basis, "internal-labor");
  assert.equal(r.lines[0].price, 1250);
});

// ---- Review pass: regressions for issues found on re-reading the logic ----

test("a gap that reappears is asked again even though its question was answered before", () => {
  const d = doc([task({ costCode: "06-20-26", quantity: { measurementId: "m1" } })], {
    measurements: [{ id: "m1", label: "Baseboard length", value: null, unit: "LF", status: "missing", evidence: [] }],
  });
  const answered = new Map([["measure:m1", { status: "answered" as const }]]);
  const r = priceScope(d, ctx());
  const qs = deriveQuestions(d, r, answered);
  assert.deepEqual(qs.map((q) => q.key), ["measure:m1"]);
  assert.equal(readiness(d, r, qs).status, "needs_information");
});

test("a quantity in the wrong unit is never priced; it is asked in the cost book's unit", () => {
  const sfCode = PRICE_BOOK.find((row) => row[4] === "SF" && row[5] === "Labor + Material (Installed)" && !row[6])![0];
  const d = doc([task({ costCode: sfCode, division: sfCode.slice(0, 2), quantity: { measurementId: "m1" } })], {
    measurements: [{ id: "m1", label: "Backsplash length", value: 18, unit: "LF", status: "documented", evidence: [] }],
  });
  const r = priceScope(d, ctx());
  assert.equal(r.lines.length, 0);
  const qs = deriveQuestions(d, r, new Map());
  assert.equal(qs[0].key, "qty:t1");
  assert.deepEqual(qs[0].input, { type: "number", unit: "SF" });
  const fixed = applyAnswer(d, "qty:t1", { value: 27, unit: "SF" });
  const r2 = priceScope(fixed, ctx());
  assert.equal(r2.lines[0].quantity, 27);
  assert.equal(r2.lines[0].unit, "SF");
  assert.equal(fixed.measurements[0].value, 18, "the measurement itself is untouched");
});

test("status is never ready while a blocking pricing issue has no question", () => {
  const d = doc([task({ costCode: "06-20-26", quantity: { measurementId: "ghost" } })]);
  const r = priceScope(d, ctx());
  const qs = deriveQuestions(d, r, new Map());
  assert.equal(qs[0].key, "qty:t1", "a link to a measurement that does not exist falls back to a direct quantity question");
  assert.equal(readiness(d, r, []).status, "needs_information");
});

test("work marked conflicting with no open conflict still gets a blocking decision", () => {
  const d = doc([task({ certainty: "conflict", costCode: "06-20-26", quantity: { value: 5, unit: "LF" } })]);
  const r = priceScope(d, ctx());
  assert.equal(r.lines.length, 0);
  const qs = deriveQuestions(d, r, new Map());
  assert.equal(qs[0].key, "decide:t1");
  assert.ok(qs[0].blocking);
  const decided = applyAnswer(d, "decide:t1", { value: "Include in the estimate" });
  assert.equal(priceScope(decided, ctx()).lines.length, 1);
});

test("a quote on P5-crew work keeps asking for missing hours", () => {
  const d = doc([task({ costCode: null, performer: "internal", laborHours: { value: null, basis: "proposed" }, materials: ["Tile"] })]);
  const quoted = applyAnswer(d, "price:t1", { amount: 800 });
  const qs = deriveQuestions(quoted, priceScope(quoted, ctx()), new Map());
  assert.deepEqual(qs.map((q) => q.key), ["hours:t1"]);
  assert.throws(() => applyAnswer(d, "hours:t1", { value: 0 }), /greater than zero/);
  assert.throws(() => applyAnswer(d, "price:t1", { amount: 0 }), /greater than zero/);
});

test("the saved finance policy drives overhead; an invalid one falls back to the approved default", async () => {
  const { DEFAULT_FINANCE } = await import("../lib/p5/pricing.ts");
  const standard = priceMultiplier("kitchen", NOW).overhead;
  assert.equal(priceMultiplier("kitchen", NOW, { ...DEFAULT_FINANCE, annualRevenue: 1_400_000, forecastSource: "test" }).overhead, 0.3);
  assert.equal(priceMultiplier("kitchen", NOW, { ...DEFAULT_FINANCE, overheadRate: 0.05 }).overhead, standard);
});

test("identical line descriptions are compared one to one, and key order never reads as a change", async () => {
  const { canonical } = await import("../app/lib/scopes/types.ts");
  assert.equal(canonical({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), canonical({ a: { d: [1, { y: 2, z: 1 }] }, b: 1 }));
  const line = (a: number) => ({ DetailType: "SalesItemLineDetail", Description: "Labor", Amount: a, SalesItemLineDetail: { Qty: 1, UnitPrice: a } });
  const sent = { Line: [line(100), line(250)] };
  assert.equal(compareEstimate(sent, { Line: [line(100), line(250)], TotalAmt: 350 }).changed, false);
  assert.equal(compareEstimate(sent, { Line: [line(100), line(300)], TotalAmt: 400 }).details.length, 2);
  assert.equal(estimateStatus({ TxnStatus: "Deleted" }, true), "deleted");
});

test("editor input is sanitized and cannot overwrite quotes, evidence or edit history", async () => {
  const { sanitizeTask, unit } = await import("../app/lib/scopes/normalize.ts");
  const { costBookEntry } = await import("../app/lib/scopes/costbook.ts");
  const valid = (c: string) => Boolean(costBookEntry(c));
  const before = task({ quote: { amount: 500 }, evidence: [{ assetId: 1, t: 3 }], edited: ["title"] });
  const out = sanitizeTask({ ...before, title: " New title ", division: "zz", costCode: "06-20-26", quote: { amount: 1 }, evidence: [], quantity: { value: 4, unit: "ft", measurementId: "nope" }, materials: ["", " Oak "] }, before, valid, new Set());
  assert.equal(out.title, "New title");
  assert.equal(out.division, "06");
  assert.deepEqual(out.quote, { amount: 500 });
  assert.equal(out.evidence.length, 1);
  assert.deepEqual(out.quantity, { measurementId: null, value: 4, unit: "LF", factor: null, estimated: false });
  assert.deepEqual(out.materials, ["Oak"]);
  assert.throws(() => sanitizeTask({ title: "x", costCode: "99-99-99" }, undefined, valid, new Set()), /not a cost book code/);
  assert.throws(() => sanitizeTask({ title: "" }, undefined, valid, new Set()), /needs a name/);
  assert.equal(unit("Sq Ft"), "SF");
  // Untouched fields are not marked as edited just because empty values are spelled differently.
  const same = sanitizeTask({ ...before, title: "Renamed" }, before, valid, new Set());
  assert.deepEqual(markEdited(before, same).edited, ["title"]);
});

test("the default handyman trip charge is $45, shown and credited", () => {
  const work = task({ costCode: null, performer: "internal", laborHours: { value: 1, basis: "confirmed" } });
  const r = priceScope(doc([work]), ctx({ service: "handyman" }));
  assert.deepEqual(r.lines.map((l) => l.price), [125, 45, -45]);
  assert.equal(r.totals.basePrice, 125);
});

test("the scope platform is private at its own address, and the old admin address redirects", async () => {
  const { isPrivatePath } = await import("../app/lib/privacy.ts");
  assert.ok(isPrivatePath("/scopes"));
  assert.ok(isPrivatePath("/scopes/12"));
  assert.ok(isPrivatePath("/api/scopes/12"));
  assert.equal(isPrivatePath("/scopes-of-work"), false, "a public page with a similar name stays public");
});

test("project names are always last name, street, type of project", async () => {
  const { projectTitle, streetLine } = await import("../app/lib/scopes/naming.ts");
  assert.equal(
    projectTitle({ lastName: "Brost", address: "2283 N Coopers Hawk Ave, Kuna, ID 83634, United States", service: "remodel" }),
    "Brost - 2283 N Coopers Hawk Ave - Remodel",
  );
  assert.equal(projectTitle({ lastName: " Brost ", address: "2283 N Coopers Hawk Ave", service: "kitchen" }), "Brost - 2283 N Coopers Hawk Ave - Kitchen remodel");
  // Missing parts are left out, never replaced with placeholders.
  assert.equal(projectTitle({ lastName: null, address: "100 Example Ave, Boise", service: "handyman" }), "100 Example Ave - Handyman");
  assert.equal(projectTitle({ lastName: "Sample", address: "", service: "adu" }), "Sample - ADU");
  assert.equal(projectTitle({}), "Project");
  assert.equal(streetLine("  12   Oak   St ,Boise"), "12 Oak St");
});

test("address suggestions and full addresses are read from Google's responses", async () => {
  const { parseSuggestions, formatAddress } = await import("../app/lib/scopes/address.ts");
  const suggestions = parseSuggestions({
    suggestions: [
      { placePrediction: { placeId: "ChIJ_place_one_1234", text: { text: "2283 N Coopers Hawk Ave, Kuna, ID, USA" }, structuredFormat: { mainText: { text: "2283 N Coopers Hawk Ave" }, secondaryText: { text: "Kuna, ID, USA" } } } },
      { placePrediction: { placeId: "ChIJ_place_two_5678", text: { text: "2283 N Cooper St, Boise, ID, USA" } } },
      { queryPrediction: { text: { text: "ignored" } } },
      { placePrediction: { text: { text: "no id" } } },
    ],
  });
  assert.deepEqual(suggestions, [
    { placeId: "ChIJ_place_one_1234", street: "2283 N Coopers Hawk Ave", rest: "Kuna, ID" },
    { placeId: "ChIJ_place_two_5678", street: "2283 N Cooper St", rest: "Boise, ID" },
  ]);
  assert.deepEqual(parseSuggestions(null), []);
  const c = (longText: string, shortText: string, type: string) => ({ longText, shortText, types: [type] });
  const place = {
    formattedAddress: "2283 N Coopers Hawk Ave, Kuna, ID 83634, USA",
    addressComponents: [
      c("2283", "2283", "street_number"),
      c("North Coopers Hawk Avenue", "N Coopers Hawk Ave", "route"),
      c("Kuna", "Kuna", "locality"),
      c("Idaho", "ID", "administrative_area_level_1"),
      c("United States", "US", "country"),
      c("83634", "83634", "postal_code"),
    ],
  };
  assert.equal(formatAddress(place), "2283 N Coopers Hawk Ave, Kuna, ID 83634");
  assert.equal(formatAddress({ ...place, addressComponents: [...place.addressComponents, c("4B", "4B", "subpremise")] }), "2283 N Coopers Hawk Ave #4B, Kuna, ID 83634");
  // No street parts: fall back to Google's line without the country.
  assert.equal(formatAddress({ formattedAddress: "Kuna, ID 83634, USA" }), "Kuna, ID 83634");
  assert.equal(formatAddress({}), null);
});

// ---------------------------------------------------------------------------
// OpenAI connections: refusals, fallback and plain-text transcripts
// ---------------------------------------------------------------------------

test("an out-of-credit refusal is told apart from a rate limit", async () => {
  const { readRefusal } = await import("../app/lib/scopes/ai.ts");
  const quota = readRefusal(429, JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } }), null);
  assert.equal(quota.quota, true);
  // The exact refusal the live key returned on 2026-11-12.
  const live = readRefusal(429, JSON.stringify({ error: { type: "insufficient_quota", code: "credit_balance_exhausted", message: "You have no credits remaining. Add credits to continue using the API." } }), null);
  assert.equal(live.quota, true);
  const rate = readRefusal(429, JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }), "3");
  assert.equal(rate.quota, false);
  assert.equal(rate.retryAfterMs, 3000);
});

test("plain-text transcripts get timestamps spread across the part", async () => {
  const { approximateSegments } = await import("../app/lib/scopes/ai.ts");
  const segs = approximateSegments("We keep the sink. The backsplash goes to the ceiling behind the range.", 60);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[1].end, 60);
  assert.ok(segs[1].start > 5 && segs[1].start < 30);
});

test("transcription falls back to the managed connection when the key is out of credit", async () => {
  const { transcribe } = await import("../app/lib/scopes/ai.ts");
  const saved = { fetch: globalThis.fetch, a: process.env.OPENAI_API_KEY, b: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, c: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = "direct";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "http://localhost:1106/v1";
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init: { body: FormData }) => {
    const model = String(init.body.get("model"));
    calls.push(`${url.includes("localhost") ? "managed" : "direct"}:${model}`);
    if (!url.includes("localhost")) return new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }), { status: 429 });
    if (model === "whisper-1") return new Response(JSON.stringify({ error: { code: "model_not_found", message: "unsupported model" } }), { status: 400 });
    return new Response(JSON.stringify({ text: "Replace the vanity. Keep the tub." }), { status: 200 });
  }) as never;
  try {
    const t = await transcribe(Buffer.from("audio"), "a.webm", "audio/webm", 20);
    assert.deepEqual(calls, ["direct:whisper-1", "managed:whisper-1", "managed:gpt-4o-mini-transcribe"]);
    assert.equal(t.approximate, true);
    assert.equal(t.segments.length, 2);
    assert.equal(t.segments[1].end, 20);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [["OPENAI_API_KEY", saved.a], ["AI_INTEGRATIONS_OPENAI_API_KEY", saved.b], ["AI_INTEGRATIONS_OPENAI_BASE_URL", saved.c]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("when every connection refuses, the message says why and that the recording is saved", async () => {
  const { transcribe } = await import("../app/lib/scopes/ai.ts");
  const saved = { fetch: globalThis.fetch, a: process.env.OPENAI_API_KEY, b: process.env.AI_INTEGRATIONS_OPENAI_API_KEY };
  process.env.OPENAI_API_KEY = "direct";
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }), { status: 429 })) as never;
  try {
    await assert.rejects(transcribe(Buffer.from("audio"), "a.webm", "audio/webm"), /out of credit or over its spending limit.*Billing.*recording is saved/s);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.a === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.a;
    if (saved.b !== undefined) process.env.AI_INTEGRATIONS_OPENAI_API_KEY = saved.b;
  }
});

// ---------------------------------------------------------------------------
// Questions: asked once, in scope order, like items together
// ---------------------------------------------------------------------------

test("a clarification that repeats a measurement or quantity question is not asked", () => {
  const d = doc(
    [task({ id: "a", costCode: "06-20-26", quantity: { measurementId: "m1" } })],
    {
      measurements: [{ id: "m1", label: "Baseboard length", value: null, unit: "LF", status: "missing", evidence: [] }],
      openQuestions: [
        "What is the total linear footage required for new baseboards?",
        "Is there a preferred start date?",
      ],
    },
  );
  const qs = deriveQuestions(d, priceScope(d, ctx()), new Map());
  const prompts = qs.map((q) => q.prompt);
  assert.equal(qs.filter((q) => q.key === "measure:m1").length, 1);
  assert.ok(!prompts.some((p) => /linear footage/i.test(p)), "the baseboard length is asked once, as a measurement");
  assert.ok(prompts.includes("Is there a preferred start date?"), "an unrelated clarification is still asked");
});

test("a clarification answered earlier is not asked again in different words", () => {
  const d = doc([task({ id: "a", quote: { amount: 500, assetId: null } })], {
    assumptions: ["Is there a preferred start date? Early March."],
    openQuestions: ["Does the client have a preferred start date?", "Is there a preferred start date?"],
  });
  const qs = deriveQuestions(d, priceScope(d, ctx()), new Map());
  assert.equal(qs.filter((q) => q.key.startsWith("open:")).length, 0);
});

test("two measurements for the same thing in different words become one question", () => {
  const d = reconcileMeasurements(
    doc(
      [
        task({ id: "a", costCode: "06-20-26", quantity: { measurementId: "m1" } }),
        task({ id: "b", title: "Paint baseboard", costCode: "06-20-26", quantity: { measurementId: "m2" } }),
      ],
      {
        measurements: [
          { id: "m1", label: "Baseboard length", value: null, unit: "LF", status: "missing", evidence: [] },
          { id: "m2", label: "Total linear footage of baseboards", value: null, unit: "LF", status: "missing", evidence: [] },
        ],
      },
    ),
  );
  assert.equal(d.measurements.length, 1);
  const qs = deriveQuestions(d, priceScope(d, ctx()), new Map());
  assert.equal(qs.filter((q) => q.key.startsWith("measure:")).length, 1);
});

test("the same missing quantity on several tasks is asked once and fills them all", () => {
  const d = doc([
    task({ id: "a", title: "Remove existing baseboards", costCode: "06-20-26" }),
    task({ id: "b", title: "Install new baseboards", costCode: "06-20-26" }),
    task({ id: "c", title: "Install interior doors", division: "08", costCode: null, quote: { amount: 900, assetId: null } }),
  ]);
  const qs = deriveQuestions(d, priceScope(d, ctx()), new Map());
  const qty = qs.filter((q) => q.key.startsWith("qty:"));
  assert.equal(qty.length, 1);
  assert.deepEqual(qty[0].also, ["qty:b"]);
  assert.deepEqual(qty[0].taskIds.sort(), ["a", "b"]);
  let next = applyAnswer(d, qty[0].key, { value: 120, unit: "LF" });
  for (const k of qty[0].also ?? []) next = applyAnswer(next, k, { value: 120, unit: "LF" });
  assert.equal(deriveQuestions(next, priceScope(next, ctx()), new Map()).filter((q) => q.key.startsWith("qty:")).length, 0);
});

test("questions follow the scope: division order, then one task at a time", () => {
  const d = doc(
    [
      task({ id: "paint", title: "Paint walls", division: "09", costCode: null }),
      task({ id: "demo", title: "Remove cabinets", division: "02", costCode: null }),
      task({ id: "base", title: "Install baseboards", division: "06", costCode: "06-20-26", certainty: "suggested" }),
    ],
    { openQuestions: ["Is there a preferred start date?"] },
  );
  const qs = deriveQuestions(d, priceScope(d, ctx()), new Map());
  const firstFor = (id: string) => qs.findIndex((q) => q.taskIds.includes(id));
  assert.ok(firstFor("demo") < firstFor("base") && firstFor("base") < firstFor("paint"), "division 02, then 06, then 09");
  const base = qs.map((q, i) => (q.taskIds.includes("base") ? i : -1)).filter((i) => i >= 0);
  assert.equal(base.at(-1)! - base[0], base.length - 1, "every question about one task is together");
  assert.equal(qs.at(-1)!.key.startsWith("open:"), true, "clarifications with no task come last");
});

// ---------------------------------------------------------------------------
// Profit check
// ---------------------------------------------------------------------------

test("cost and margin stay unknown, with the reason, until P5's labor cost is set", () => {
  const d = doc([task({ id: "a", performer: "internal", costCode: null, laborHours: { value: 22, basis: "confirmed", note: null } })]);
  const r = priceScope(d, ctx());
  assert.equal(r.totals.baseCost, null);
  assert.equal(r.totals.profit, null);
  assert.deepEqual(r.totals.costGaps, { laborHours: 22, lines: 0 });
});

test("the profit check splits the price into cost, overhead, reserve and profit", () => {
  const d = doc([
    task({ id: "q", quote: { amount: 1000, assetId: null } }),
    task({ id: "l", title: "Install trim", performer: "internal", costCode: null, laborHours: { value: 10, basis: "confirmed", note: null } }),
  ]);
  const r = priceScope(d, ctx({ settings: { ...SETTINGS, laborLoadedCost: 60 } }));
  const p = r.totals.profit!;
  assert.ok(p, "every cost is known");
  assert.equal(r.totals.baseCost, 1600);
  assert.equal(p.grossProfit, round2(r.totals.basePrice - 1600));
  assert.equal(p.overhead, round2(r.totals.basePrice * r.policy.overheadRate));
  assert.equal(p.reserve, 100, "10% reserve on the marked-up quote only, never on P5 labor");
  assert.equal(p.netProfit, round2(p.grossProfit - p.overhead - p.reserve));
  assert.ok(p.netMargin >= p.targetNetMargin, "standard markup with labor at $60 cost meets the target");
  assert.ok(p.status === "on-target" || p.status === "high");
});

test("labor that costs more than it bills is called out and the price needed is given", () => {
  const d = doc([task({ id: "l", performer: "internal", costCode: null, laborHours: { value: 10, basis: "confirmed", note: null } })]);
  const r = priceScope(d, ctx({ settings: { ...SETTINGS, laborLoadedCost: 130 } }));
  const p = r.totals.profit!;
  assert.equal(p.status, "below");
  assert.ok(p.notes.some((n) => /loses money/.test(n)));
  assert.ok(p.notes.some((n) => /would need to be about/.test(n)));
});

test("an invoiced estimate reads completed only when fully invoiced and nothing is owed", () => {
  const raw = { TxnStatus: "Closed", TotalAmt: 1000, LinkedTxn: [{ TxnId: "9", TxnType: "Invoice" }] };
  assert.equal(estimateStatus(raw, true), "converted");
  assert.equal(estimateStatus(raw, true, { count: 1, total: 1000, balance: 250 }), "converted", "money still owed");
  assert.equal(estimateStatus(raw, true, { count: 1, total: 400, balance: 0 }), "converted", "a paid deposit is not the whole job");
  assert.equal(estimateStatus(raw, true, { count: 2, total: 1000, balance: 0 }), "paid");
  assert.equal(estimateStatus({ TxnStatus: "Rejected" }, true), "declined");
  assert.equal(estimateStatus({ TxnStatus: "Pending", EmailStatus: "EmailSent" }, true), "sent");
});

test("QuickBooks lines lead with the name of the work, not just the item", async () => {
  const { lineText } = await import("../app/lib/scopes/estimate.ts");
  const d = doc([
    task({ id: "c", title: "Final cleaning", area: "Entire house", description: "Perform a thorough cleaning of the house after construction is complete.", quote: { amount: 800, assetId: null } }),
    task({ id: "l", title: "Project supervision", description: "Schedule and coordinate the trades.", performer: "internal", costCode: null, laborHours: { value: 20, basis: "confirmed", note: null } }),
  ]);
  const r = priceScope(d, ctx());
  const clean = r.lines.find((l) => l.taskId === "c")!;
  assert.equal(clean.title, "Entire house: Final cleaning");
  assert.equal(lineText(clean), "Entire house: Final cleaning\nPerform a thorough cleaning of the house after construction is complete.");
  assert.equal(r.lines.find((l) => l.taskId === "l")!.title, "Project supervision, labor");
  assert.equal(lineText({ title: "Install baseboard", description: "Install baseboard in the hall." }), "Install baseboard in the hall.", "no repeated title");
  assert.equal(lineText({ description: "Older line with no title." }), "Older line with no title.");
});

// ---------------------------------------------------------------------------
// Long PDFs: page-by-page reading
// ---------------------------------------------------------------------------

test("a long or heavy PDF is read page by page; a short one is read whole", async () => {
  const { readsPageByPage } = await import("../app/lib/scopes/sheets.ts");
  assert.equal(readsPageByPage(3, 2_000_000), false);
  assert.equal(readsPageByPage(40, 2_000_000), true);
  assert.equal(readsPageByPage(2, 60_000_000), true);
});

test("a full-size plan sheet is cut into overlapping tiles that cover every pixel, within the tile limit", async () => {
  const { tileGrid, renderScale } = await import("../app/lib/scopes/sheets.ts");
  assert.deepEqual(tileGrid(1275, 1650), [], "a letter page is one image");
  // 36 x 24 inch sheet, in points.
  const scale = renderScale(2592, 1728);
  const w = Math.ceil(2592 * scale);
  const h = Math.ceil(1728 * scale);
  const tiles = tileGrid(w, h);
  assert.ok(tiles.length > 1 && tiles.length <= 12);
  assert.ok(w / 36 >= 100, "at least 100 pixels per inch on a 36 inch sheet");
  const covered = (x: number, y: number) => tiles.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [Math.floor(w / 2), Math.floor(h / 2)], [1499, 1499], [1500, 1500]]) {
    assert.ok(covered(x, y), `pixel ${x},${y} is inside a tile`);
  }
});
