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
const SETTINGS: ScopeSettings = { ...DEFAULT_SCOPE_SETTINGS, laborTreatment: "billed-rate" };
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

test("direct-cost labor treatment marks labor up; unconfirmed treatment blocks", () => {
  const d = doc([task({ costCode: null, performer: "internal", laborHours: { value: 2, basis: "confirmed" } })]);
  const direct = priceScope(d, ctx({ settings: { ...SETTINGS, laborTreatment: "direct-cost" } }));
  const { multiplier } = priceMultiplier("kitchen", NOW);
  assert.equal(direct.lines[0].unitPrice, round2(125 * multiplier));
  assert.equal(direct.lines[0].cost, 250);
  const unconfirmed = priceScope(d, ctx({ settings: DEFAULT_SCOPE_SETTINGS }));
  assert.ok(unconfirmed.issues.some((i) => i.kind === "labor-rate-unconfirmed" && i.blocking));
  assert.equal(readiness(d, unconfirmed, []).status, "needs_information");
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
  assert.equal(descriptions[0], "Phase 1: Pre-Construction");
  assert.ok(descriptions.includes("Phase 2: Construction"));
  assert.ok(descriptions.includes("Division 06 Wood & Carpentry"));
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
