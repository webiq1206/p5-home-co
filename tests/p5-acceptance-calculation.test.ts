import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_CATEGORIES,
  DEFAULT_FINANCE,
  calculateP5Estimate,
  companyAllocation,
  type CostCategory,
  type DirectCostLine,
  type ScopeCoverage,
} from "../lib/p5/pricing.ts";
import {
  materializePlanningBook,
  createPlanningConfiguration,
  PLANNING_MODEL_VERSION,
  type PlanningCatalog,
  type PlanningRate,
} from "../lib/p5/planningBooks.ts";
import { priceReviewedScope, type ServiceCostBook } from "../lib/p5/costBook.ts";
import {
  compareReference,
  referenceDirectCostBudget,
  validateReferences,
  type PriceReference,
} from "../lib/p5/references.ts";
import type { ReviewedScope } from "../lib/p5/scope.ts";

/*
 * This file is deliberately a pure, synthetic acceptance suite. It exercises
 * the calculation modules directly: no database, upload transport, owner
 * session, provider, policy write, or business record is involved.
 */
const date = "2026-09-11T00:00:00.000Z";
const now = new Date(date);
const near = (actual: number, expected: number, message = "") =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}${message ? ` (${message})` : ""}`);

const REQUIRED_CODES = [
  "03-17-01-M",
  "03-17-01-L",
  "03-19-02-M",
  "03-15-02-M",
  "03-15-02-L",
  "03-16-01-M",
  "03-16-01-L",
  "03-14-01-M",
  "03-14-01-L",
  "03-04-01",
  "03-04-02",
  "03-04-03",
  "03-05-02-M",
  "03-05-02-L",
  "REF-GENERAL-HOUR",
  "REF-PLUMBING-HOUR",
  "REF-ELECTRICAL-HOUR",
  "03-02-02",
  "03-02-04",
  "03-02-06",
] as const;

function rate(code: string, overrides: Partial<PlanningRate> = {}): PlanningRate {
  const labor = code.endsWith("-L") || code.includes("HOUR");
  return {
    code,
    description: code.includes("17-02") ? "Countertop assembly" : "Synthetic approved work",
    type: labor ? "Labor" : "Material",
    unit: code.includes("HOUR") ? "HRS" : "LF",
    amount: 10,
    source: "Synthetic approved owner schedule; test fixture only",
    basis: "owner-average-cost",
    ...overrides,
  };
}

function catalog(overrides: Record<string, Partial<PlanningRate>> = {}): PlanningCatalog {
  const codes = [...REQUIRED_CODES, "03-17-02-M", "03-17-02-L"];
  return {
    version: PLANNING_MODEL_VERSION,
    source: "Synthetic approved owner schedule; test fixture only",
    importedAt: date,
    authorizedBy: "Synthetic test owner",
    rates: codes.map(code => rate(code, overrides[code])),
  };
}

function scope(answers: ReviewedScope["answers"], text = ""): ReviewedScope {
  return { text, answers, extraction: null, uploads: [], reviewedAt: date, corrections: [] };
}

function coverage(included: CostCategory): ScopeCoverage[] {
  return COST_CATEGORIES.map(category => ({
    category,
    status: category === included ? "included" : "not-applicable",
    reason: "Synthetic acceptance fixture reviewed for this calculation.",
  }));
}

function evidence(): DirectCostLine["evidence"] {
  return {
    basis: "approved-cost-book",
    reference: "Synthetic approved cost-book fixture",
    verifiedAt: "2026-09-01",
    validUntil: "2026-12-01",
  };
}

test("cost-book conversion preserves unit roles and rounds rates only at the documented boundaries", () => {
  const c = catalog({
    "03-17-02-M": { amount: 12.34567, unit: "LF", type: "Material" },
    "03-17-02-L": { amount: 4.56789, unit: "HRS", type: "Labor" },
  });
  const config = createPlanningConfiguration(c);
  const book = config.costBooks.find(item => item.service === "kitchen")!;
  const modeled = materializePlanningBook(
    book,
    c,
    scope({
      service: "kitchen",
      taskList: "Install countertops and paint",
      sqft: "100",
      countertopSqft: "50",
      location: "Boise",
      finish: "high-end",
    }),
    now,
  );

  const material = modeled.book.rules.find(rule => rule.id.startsWith("03-17-02-M"));
  const labor = modeled.book.rules.find(rule => rule.id.startsWith("03-17-02-L"));
  assert.ok(material);
  assert.ok(labor);
  assert.equal(material.unit, "LF", "the source countertop rate remains a linear-foot rate");
  assert.equal(labor.unit, "hour", "HRS is normalized to the pricing engine's labor unit");
  near(material.quantity.fixed!, 50 / (25 / 12), "50 SF at the disclosed 25-inch depth is 24 LF");
  near(labor.quantity.fixed!, 50 / (25 / 12), "labor follows the same converted countertop run");
  assert.equal(material.unitCost, 15.4321, "high-end material factor is rounded to four decimals");
  assert.equal(labor.unitCost, 4.5679, "labor rate is rounded to four decimals independently");
  assert.match(
    modeled.book.assumptions.join(" "),
    /25-inch modeled depth to convert the source LF rate/,
    "the dimensional conversion is disclosed instead of silently changing units",
  );

  const materialCost = modeled.book.rules
    .filter(rule => rule.category === "materials")
    .reduce((sum, rule) => sum + rule.quantity.fixed! * rule.unitCost, 0);
  const procurement = modeled.book.rules.find(rule => rule.id === "material-procurement");
  assert.ok(procurement);
  assert.equal(
    procurement.unitCost,
    Math.round(materialCost * 0.12 * 100) / 100,
    "the material reserve is rounded to cents after multiplying the unrounded material total",
  );
  assert.ok(procurement.unitCost !== Math.round(procurement.unitCost), "reserve rounding does not discard cents");
});

test("explicitly excluded work is absent while the remaining requested work remains priceable", () => {
  const c = catalog();
  const config = createPlanningConfiguration(c);
  const answers = {
    service: "kitchen" as const,
    taskList: "Install countertops and paint",
    sqft: "100",
    countertopSqft: "50",
    location: "Boise",
  };
  const included = priceReviewedScope(scope(answers), config, now);
  const excluded = priceReviewedScope(
    scope({ ...answers, exclusions: "Countertops are explicitly excluded from this scope." }),
    config,
    now,
  );
  const includedInternal = included.internal as { lines?: Array<{ id: string; cost: number }> };
  const excludedInternal = excluded.internal as { lines?: Array<{ id: string; cost: number }> };
  assert.ok(included.customer.range, "the included countertop and paint scope has a planning range");
  assert.ok(excluded.customer.range, "excluding countertops does not hide the unrelated paint scope");
  assert.ok(includedInternal.lines?.some(line => line.id.startsWith("03-17-02-M")));
  assert.ok(includedInternal.lines?.some(line => line.id.startsWith("03-17-02-L")));
  assert.ok(
    !excludedInternal.lines?.some(line => line.id.startsWith("03-17-02")),
    "an explicitly excluded assembly contributes neither material nor installation labor",
  );
  assert.ok(
    (excludedInternal.lines ?? []).some(line => line.id.startsWith("03-14-01")),
    "the non-excluded paint work is still retained",
  );
  assert.ok(
    (excludedInternal.lines ?? []).reduce((sum, line) => sum + line.cost, 0) <
      (includedInternal.lines ?? []).reduce((sum, line) => sum + line.cost, 0),
    "excluding work lowers direct cost rather than merely relabeling it",
  );
  assert.ok(excluded.customer.exclusions.some(item => /countertops are explicitly excluded/i.test(item)));
});

test("conditional alternatives select one option and never charge both alternatives", () => {
  const option = (id: string, amount: number, finish: string) => ({
    id,
    category: "materials" as const,
    description: `${finish} countertop option`,
    unit: "LF",
    unitCost: amount,
    quantity: { fixed: 10, factor: 1 },
    when: { field: "finish" as const, equals: finish },
    priceBasis: "direct-cost" as const,
    evidence: evidence(),
    landed: {
      netPurchase: amount,
      tax: 0,
      freight: 0,
      delivery: 0,
      waste: 0,
      storage: 0,
      handling: 0,
    },
  });
  const book: ServiceCostBook = {
    service: "kitchen",
    rules: [option("countertop-standard", 100, "mid-range"), option("countertop-premium", 225, "high-end")],
    coverage: coverage("materials"),
    assumptions: ["Synthetic option fixture."],
    exclusions: [],
    verifiedScope: "Synthetic reviewed scope.",
    reviewedAt: date,
  };
  const config = { finance: DEFAULT_FINANCE, costBooks: [book] };
  const standard = priceReviewedScope(
    scope({ service: "kitchen", finish: "mid-range", location: "Boise" }),
    config,
    now,
  );
  const premium = priceReviewedScope(
    scope({ service: "kitchen", finish: "high-end", location: "Boise" }),
    config,
    now,
  );
  const standardInternal = standard.internal as { lines?: Array<{ id: string; cost: number }>; directCost?: number };
  const premiumInternal = premium.internal as { lines?: Array<{ id: string; cost: number }>; directCost?: number };
  assert.deepEqual(standardInternal.lines?.map(line => line.id), ["countertop-standard"]);
  assert.deepEqual(premiumInternal.lines?.map(line => line.id), ["countertop-premium"]);
  assert.equal(standardInternal.directCost, 1000, "the standard option is extended once");
  assert.equal(premiumInternal.directCost, 2250, "the premium option is extended once");
  assert.ok(standard.customer.range && premium.customer.range);
  assert.notDeepEqual(standard.customer.range, premium.customer.range, "selecting an alternative changes the result");
  assert.equal(standard.customer.lineItems.length, 1);
  assert.equal(premium.customer.lineItems.length, 1);
});

test("historical uploaded prices remain comparison ceilings and cannot override approved policy or direct costs", () => {
  const historical = [
    {
      id: "history-base",
      source: "Synthetic historical customer estimate",
      sourceDate: "2025-01-01",
      page: 1,
      trade: "Cabinets" as const,
      description: "Comparable cabinet scope",
      quantity: 10,
      unit: "LF",
      unitPrice: 900,
      extendedPrice: 9000,
      priceBasis: "customer-price" as const,
      commercialStatus: "base" as const,
      location: "Synthetic location",
      conditions: "Synthetic comparable scope",
      warnings: [],
    },
    {
      id: "history-alternate",
      source: "Synthetic historical alternate",
      sourceDate: "2025-01-01",
      page: 1,
      trade: "Cabinets" as const,
      description: "Optional alternate scope",
      quantity: 10,
      unit: "LF",
      unitPrice: 1200,
      extendedPrice: 12000,
      priceBasis: "customer-price" as const,
      commercialStatus: "alternate" as const,
      location: "Synthetic location",
      conditions: "Synthetic alternate",
      warnings: [],
    },
    {
      id: "history-excluded",
      source: "Synthetic historical exclusion",
      sourceDate: "2025-01-01",
      page: 1,
      trade: "Cabinets" as const,
      description: "Excluded cabinet scope",
      quantity: 10,
      unit: "LF",
      unitPrice: 500,
      extendedPrice: 5000,
      priceBasis: "customer-price" as const,
      commercialStatus: "excluded" as const,
      location: "Synthetic location",
      conditions: "Synthetic exclusion",
      warnings: [],
    },
  ] satisfies PriceReference[];
  const saved = validateReferences(historical);
  assert.deepEqual(
    saved.map(reference => reference.commercialStatus),
    ["base", "alternate", "excluded"],
    "historical classifications are preserved on import rather than silently promoted",
  );
  const selection = {
    referenceId: "history-base",
    costLineId: "current-direct-cost",
    quantity: 10,
    unit: "LF",
    adjustedCustomerUnitPrice: 900,
    scopeConfirmed: true,
    locationConfirmed: true,
    dateConfirmed: true,
    rationale: "Synthetic reviewed scope, location and date are comparable for this fixture.",
  };
  for (const status of ["alternate", "excluded", "allowance", "optional"] as const) {
    assert.throws(
      () =>
        compareReference(
          { ...saved[0], commercialStatus: status },
          selection,
          9000,
        ),
      new RegExp("Resolve optional scope"),
      `${status} history cannot be used as a base comparison`,
    );
  }
  const allocation = companyAllocation(DEFAULT_FINANCE, now);
  assert.equal(allocation.approvedRate, 0.2, "the approved overhead rate remains 20%");
  assert.equal(allocation.total, 0.2, "historical records do not add a second allocation");
  const ceiling = referenceDirectCostBudget(900, allocation.total, 0.2, 0.1);
  near(ceiling.maximumDirectUnitCost, (900 * (1 - 0.2 - 0.2)) / 1.1);
  assert.match(ceiling.note, /not an observed supplier/);

  const line: DirectCostLine = {
    id: "current-direct-cost",
    category: "subcontractors",
    description: "Current synthetic written trade cost",
    quantity: 1,
    unit: "package",
    unitCost: 100,
    quantitySource: "Synthetic current direct-cost fixture",
    evidence: {
      basis: "written-quote",
      reference: "Synthetic current quote",
      verifiedAt: "2026-09-01",
      validUntil: "2026-12-01",
    },
  };
  const input = {
    service: "kitchen" as const,
    revision: "synthetic-policy-revision",
    scopeSummary: "Synthetic current direct-cost review",
    uncertainty: "low" as const,
    locationProvided: true,
    lines: [line],
    coverage: coverage("subcontractors"),
    risks: [],
    assumptions: [],
    exclusions: [],
    missingInformation: [],
    allowances: [],
    contingencyRate: 0.1,
    targetMargin: 0.2,
  };
  const current = calculateP5Estimate(input, DEFAULT_FINANCE, [], now);
  near(current.directCost, 100);
  near(current.riskAdjustedDirectCost, 110);
  near(current.contractPrice, 110 / (1 - 0.2 - 0.2));
  near(current.allocationDollars.overhead, current.contractPrice * 0.2);
  assert.notEqual(current.directCost, 9000, "historical selling total never becomes current direct cost");
  assert.equal(current.publishable, true);

  const historicalAsCost = calculateP5Estimate(
    { ...input, lines: [{ ...line, unitCost: 9000, priceBasis: "customer-price" }] },
    DEFAULT_FINANCE,
    [],
    now,
  );
  assert.equal(historicalAsCost.publishable, false);
  assert.ok(historicalAsCost.warnings.some(warning => warning.code === "selling-price-as-cost"));
});