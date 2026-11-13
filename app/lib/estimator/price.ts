/**
 * Price a guided estimate. Server only, pure and deterministic.
 *
 *   selections -> recipe (cost book lines) -> scope document
 *              -> priceScope() -> qualification -> two projections
 *
 * priceScope is the scope platform's engine, unchanged. It reads direct costs
 * from the owner's cost book and applies the owner's margin policy once. This
 * module adds nothing to a price. What it adds is judgement about whether the
 * result may go to a customer as an official estimate (qualify), and two
 * views of the same priced lines: one for the customer with no cost in it,
 * one for the team with everything.
 *
 * The same scope document is saved as a scope platform project, so the team
 * opens an online estimate in /scopes and revises it with the tools they
 * already use, and the QuickBooks estimate is built from the same lines the
 * customer saw.
 */

import type { FinancePolicy } from "../../../lib/p5/pricing.ts";
import { COST_BOOK_SOURCE, COST_BOOK_VERSION, costBookEntry, costBookRate } from "../scopes/costbook.ts";
import { defaultPhase, divisionName, groupByPhaseDivision, phaseName } from "../scopes/divisions.ts";
import { priceScope } from "../scopes/pricing.ts";
import { DEFAULT_SCOPE_SETTINGS, emptyScope, type EstimateLine, type PricingResult, type ScopeDoc, type ScopeSettings, type ScopeTask } from "../scopes/types.ts";
import { brandConfig } from "./brands.ts";
import { flowById } from "./flows.ts";
import { HANDYMAN_MINIMUM_CODE, buildRecipe, type CrossCheck, type Recipe } from "./recipes.ts";
import {
  CLASS_LABELS,
  TIER_LABELS,
  isVisible,
  resolveAnswers,
  type Answers,
  type BrandId,
  type CustomerEstimate,
  type EstimateClass,
  type PropertyFacts,
  type Tier,
} from "./types.ts";

/** Bumped whenever a recipe or a qualification rule changes, and stored with every estimate. */
export const ESTIMATOR_RULES_VERSION = "2026-11-13.1";

/**
 * Gross margin floor. Owner business plan (lib/p5/pricing.ts): 20% overhead
 * plus a 10% profit floor, a 30% hard floor company-wide. An estimate under
 * it is never sent; it goes to review.
 */
export const MARGIN_FLOOR = 0.3;

/**
 * How far an itemized estimate may sit from the cost book's own assembly for
 * the same project before a person looks at it. Wide on purpose: it exists to
 * catch a recipe that double counts or drops a trade, not to tune prices.
 */
export const CROSS_CHECK_BAND = { low: 0.5, high: 1.5 };

export type PriceInput = {
  brand: BrandId;
  project: string;
  tier: Tier;
  answers: Answers;
  address: string | null;
  property: PropertyFacts | null;
};

export type PriceContext = {
  settings?: ScopeSettings;
  finance?: FinancePolicy;
  acknowledged?: Set<string>;
  now?: Date;
};

export type ReviewReason = { code: string; message: string };

export type CrossCheckResult = { basis: string; itemizedCost: number; low: number; high: number; ratioLow: number; ratioHigh: number; within: boolean };

export type PricedEstimate = {
  brand: BrandId;
  project: string;
  projectTitle: string;
  service: string;
  tier: Tier;
  usesFinish: boolean;
  answers: Answers;
  /** The customer's selections in words. */
  summary: string[];
  estimateClass: EstimateClass;
  doc: ScopeDoc;
  pricing: PricingResult;
  recipe: Pick<Recipe, "assumptions" | "exclusions">;
  crossCheck: CrossCheckResult | null;
  /** Empty when the estimate may go to the customer as an official estimate. */
  review: ReviewReason[];
  versions: { rules: string; costBook: string; costBookSource: string };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function selectionSummary(project: string, answers: Answers, tier: Tier): string[] {
  const flow = flowById(project)!;
  const out: string[] = [];
  for (const q of flow.questions) {
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (q.kind === "choice") {
      const option = q.options.find((o) => o.id === value);
      if (option) out.push(option.label);
    } else if (q.kind === "number") {
      out.push(`${Number(value).toLocaleString("en-US")} ${q.unit}`);
    } else {
      const counts = (value ?? {}) as Record<string, number>;
      const picked = q.options.filter((o) => (counts[o.id] ?? 0) > 0);
      out.push(`${picked.reduce((s, o) => s + counts[o.id], 0)} items across ${picked.length} kinds of job`);
    }
  }
  if (flow.usesFinish) out.push(`${TIER_LABELS[tier].label} finish level`);
  return out;
}

/** Direct cost of a list of cost book lines at this tier and service. */
function directCost(lines: { code: string; qty: number }[], tier: Tier, service: string): number | null {
  let total = 0;
  for (const line of lines) {
    const rate = costBookRate(line.code, tier, service);
    if (!rate) return null;
    total += rate.amount * line.qty;
  }
  return total;
}

function compileDoc(input: PriceInput, recipe: Recipe, service: string, summary: string[]): ScopeDoc {
  const flow = flowById(input.project)!;
  const brand = brandConfig(input.brand)!;
  const tasks: ScopeTask[] = [];
  recipe.lines.forEach((line, index) => {
    const entry = costBookEntry(line.code);
    const rate = costBookRate(line.code, input.tier, service);
    const division = line.division ?? entry?.division ?? "01";
    tasks.push({
      id: `g${String(index + 1).padStart(3, "0")}`,
      title: line.text,
      description: line.text,
      phase: line.phase ?? defaultPhase(division),
      division,
      bucket: "approved",
      certainty: "confirmed",
      costCode: line.code,
      quantity: { value: line.qty, unit: rate?.unit ?? entry?.uom ?? "EA", estimated: Boolean(line.estimated) },
      // Every line is priced from the cost book as a direct cost. Internal
      // hours are a decision the team makes in the scope platform.
      performer: "subcontractor",
      evidence: [],
      origin: "generated",
    });
  });

  // Handyman minimum: when the listed jobs cost less than the book's minimum
  // service charge, the balance up to that minimum is charged.
  if (service === "handyman" && tasks.length) {
    const direct = directCost(recipe.lines.map((l) => ({ code: l.code, qty: l.qty })), input.tier, service);
    const minimum = costBookRate(HANDYMAN_MINIMUM_CODE, input.tier, service);
    if (direct !== null && minimum && direct < minimum.amount) {
      const quantity = Math.ceil(((minimum.amount - direct) / minimum.amount) * 100) / 100;
      tasks.push({
        id: "gmin",
        title: "Minimum service charge, balance",
        description: "Balance up to our minimum service charge",
        phase: "construction",
        division: "01",
        bucket: "approved",
        certainty: "confirmed",
        costCode: HANDYMAN_MINIMUM_CODE,
        quantity: { value: quantity, unit: "EA", estimated: false },
        performer: "subcontractor",
        evidence: [],
        origin: "generated",
      });
    }
  }

  const doc = emptyScope();
  doc.summary = `${flow.title} requested through the ${brand.name} online estimator: ${summary.join("; ")}.`;
  doc.goals = [flow.title];
  doc.tasks = tasks;
  doc.assumptions = recipe.assumptions;
  doc.exclusions = recipe.exclusions;
  if (input.property) {
    const p = input.property;
    const facts = [
      p.livingSqft ? `${p.livingSqft.toLocaleString("en-US")} sq ft living area` : null,
      p.yearBuilt ? `built ${p.yearBuilt}` : null,
      p.stories ? `${p.stories} ${p.stories === 1 ? "story" : "stories"}` : null,
      p.lotAcres ? `${p.lotAcres} acre lot` : null,
      p.jurisdiction ? `jurisdiction ${p.jurisdiction}` : null,
    ].filter(Boolean);
    if (facts.length) {
      doc.siteConditions = [
        `Public property record from ${p.source}${p.parcel ? ` (parcel ${p.parcel})` : ""}: ${facts.join(", ")}. ${p.confirmed ? "Confirmed by the customer." : "Not confirmed by the customer."} A public record, not a site measurement.`,
      ];
    }
  }
  return doc;
}

function crossCheckResult(check: CrossCheck | null, recipe: Recipe, tier: Tier, service: string): CrossCheckResult | null {
  if (!check) return null;
  const itemized = directCost(
    recipe.lines.filter((l) => !l.outsideCheck).map((l) => ({ code: l.code, qty: l.qty })),
    tier,
    service,
  );
  const low = directCost(check.low, tier, service);
  const high = directCost(check.high, tier, service);
  if (itemized === null || low === null || high === null || low <= 0 || high <= 0) return null;
  const ratioLow = itemized / low;
  const ratioHigh = itemized / high;
  return {
    basis: check.basis,
    itemizedCost: round2(itemized),
    low: round2(low),
    high: round2(high),
    ratioLow: Math.round(ratioLow * 100) / 100,
    ratioHigh: Math.round(ratioHigh * 100) / 100,
    within: itemized >= low * CROSS_CHECK_BAND.low && itemized <= high * CROSS_CHECK_BAND.high,
  };
}

/**
 * May this estimate go to the customer as an official estimate without a
 * person looking at it first? Every reason it may not is listed.
 */
export function qualify(pricing: PricingResult, estimateClass: EstimateClass, crossCheck: CrossCheckResult | null, recipeLineCount: number): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  // Cost book allowances are disclosed to the customer as allowances, and
  // typical-dimension quantities are what "preliminary" means; neither blocks.
  const disclosed = new Set(["allowance-unapproved", "estimated-quantity"]);
  for (const issue of pricing.issues) {
    if (disclosed.has(issue.kind)) continue;
    reasons.push({ code: issue.kind, message: issue.message });
  }
  const priced = pricing.lines.filter((l) => l.basis !== "trip-charge" && l.taskId !== "gmin").length;
  if (recipeLineCount === 0) reasons.push({ code: "empty", message: "No work was selected." });
  else if (priced < recipeLineCount) reasons.push({ code: "unpriced-lines", message: `${recipeLineCount - priced} selected item(s) could not be priced from the cost book.` });
  if (pricing.totals.basePrice <= 0 && recipeLineCount > 0) reasons.push({ code: "zero-total", message: "The estimate total is zero." });
  if (pricing.totals.margin === null) reasons.push({ code: "margin-unknown", message: "Internal cost is unknown for at least one line, so margin cannot be checked." });
  else if (pricing.totals.margin < MARGIN_FLOOR) {
    reasons.push({ code: "margin-floor", message: `Gross margin ${(pricing.totals.margin * 100).toFixed(1)}% is under the ${MARGIN_FLOOR * 100}% floor.` });
  }
  if (crossCheck && !crossCheck.within) {
    reasons.push({
      code: "cross-check",
      message: `Itemized direct cost $${crossCheck.itemizedCost.toLocaleString("en-US")} is outside the plausible range from the cost book's ${crossCheck.basis} ($${crossCheck.low.toLocaleString("en-US")} to $${crossCheck.high.toLocaleString("en-US")}).`,
    });
  }
  if (estimateClass === "budgetary") {
    reasons.push({ code: "budgetary", message: "Budgetary estimates are priced in detail by the team before an official estimate is issued." });
  }
  return reasons;
}

export function priceEstimate(input: PriceInput, ctx: PriceContext = {}): PricedEstimate {
  const flow = flowById(input.project);
  const brand = brandConfig(input.brand);
  if (!flow || !brand) throw new Error("Unknown project or brand.");
  if (!brand.projects.includes(flow.id)) throw new Error(`${brand.name} does not offer ${flow.title} through the estimator.`);
  const tier: Tier = flow.usesFinish ? input.tier : "mid";
  const answers = resolveAnswers(flow, input.answers);
  const resolved = { ...input, tier, answers };
  const recipe = buildRecipe(flow.id, { answers, tier, property: input.property });
  if (!recipe) throw new Error(`No recipe for ${flow.id}.`);
  const summary = selectionSummary(flow.id, answers, tier);
  const doc = compileDoc(resolved, recipe, flow.service, summary);
  const pricing = priceScope(doc, {
    service: flow.service,
    finishTier: tier,
    settings: ctx.settings ?? DEFAULT_SCOPE_SETTINGS,
    acknowledged: ctx.acknowledged ?? new Set<string>(),
    finance: ctx.finance,
    now: ctx.now,
  });
  const crossCheck = crossCheckResult(recipe.crossCheck, recipe, tier, flow.service);
  return {
    brand: input.brand,
    project: flow.id,
    projectTitle: flow.title,
    service: flow.service,
    tier,
    usesFinish: flow.usesFinish,
    answers,
    summary,
    estimateClass: flow.estimateClass,
    doc,
    pricing,
    recipe: { assumptions: recipe.assumptions, exclusions: recipe.exclusions },
    crossCheck,
    review: qualify(pricing, flow.estimateClass, crossCheck, recipe.lines.length),
    versions: { rules: ESTIMATOR_RULES_VERSION, costBook: COST_BOOK_VERSION, costBookSource: COST_BOOK_SOURCE },
  };
}

/** Review reasons that mean the number itself cannot be trusted, so the customer is not shown one. */
const WITHHOLD_PRICE = new Set(["missing-quantity", "unmatched-item", "missing-price", "outdated-price", "unpriced-lines", "zero-total", "margin-unknown", "margin-floor", "cross-check", "empty", "proposed-hours"]);

export function priceWithheld(estimate: PricedEstimate): boolean {
  return estimate.review.some((r) => WITHHOLD_PRICE.has(r.code));
}

const baseLines = (pricing: PricingResult) => pricing.lines.filter((l) => !l.optional);

// ---------------------------------------------------------------------------
// The customer's view. Built field by field from named values so that a cost,
// a margin or a cost code cannot ride along: there is no spread of a priced
// line anywhere in this function.
// ---------------------------------------------------------------------------

export function customerEstimate(
  estimate: PricedEstimate,
  meta: { token: string; address: string | null; createdAt: Date; officialCopy: "sending" | "after-review" },
): CustomerEstimate {
  const brand = brandConfig(estimate.brand)!;
  const withheld = priceWithheld(estimate);
  const klass = CLASS_LABELS[estimate.estimateClass];
  const phases = withheld
    ? []
    : groupByPhaseDivision(baseLines(estimate.pricing)).map((group) => {
        const divisions = group.divisions.map((d) => ({
          name: divisionName(d.code),
          subtotal: round2(d.items.reduce((s, l) => s + l.price, 0)),
          items: d.items.map((l) => ({ text: l.description, quantity: l.quantity, unit: l.unit, price: l.price, allowance: l.allowance })),
        }));
        return { name: phaseName(group.phase), subtotal: round2(divisions.reduce((s, d) => s + d.subtotal, 0)), divisions };
      });
  const allowanceCount = withheld ? 0 : baseLines(estimate.pricing).filter((l) => l.allowance).length;
  const assumptions = [...estimate.recipe.assumptions];
  if (allowanceCount) {
    assumptions.push(
      `${allowanceCount} ${allowanceCount === 1 ? "item is an allowance" : "items are allowances"} for products you will choose. If your selections cost more or less, the price moves with them.`,
    );
  }
  const nextSteps = withheld
    ? ["Our team is reviewing your project so the number we give you is one we can stand behind.", `We will reach out shortly. You can also call ${brand.phoneDisplay}.`]
    : estimate.estimateClass === "quote"
      ? [
          meta.officialCopy === "sending" ? "Your official estimate is on its way to your inbox. You can approve it there." : "We will send your official estimate once the team has confirmed it.",
          "Once you approve, we schedule the work.",
          `Questions? Call or text ${brand.phoneDisplay}.`,
        ]
      : estimate.estimateClass === "preliminary"
        ? [
            meta.officialCopy === "sending" ? "Your official estimate is on its way to your inbox." : "We will send your official estimate once the team has confirmed it.",
            "We visit to confirm measurements, conditions and your selections.",
            "You receive a fixed price before any work starts.",
            `Questions? Call or text ${brand.phoneDisplay}.`,
          ]
        : [
            "A project lead will contact you to talk through your goals, site and timeline.",
            "Preconstruction turns this budget into drawings, selections and a detailed price.",
            `Questions? Call or text ${brand.phoneDisplay}.`,
          ];
  return {
    token: meta.token,
    brandName: brand.name,
    projectName: estimate.projectTitle,
    address: meta.address,
    summary: estimate.summary,
    estimateClass: estimate.estimateClass,
    classLabel: klass.label,
    classStatement: klass.statement,
    total: withheld ? null : estimate.pricing.totals.basePrice,
    phases,
    assumptions,
    exclusions: estimate.recipe.exclusions,
    nextSteps,
    officialCopy: meta.officialCopy,
    createdAt: meta.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The team's view: every line with its cost book code, cost and price.
// ---------------------------------------------------------------------------

export type InternalLine = Pick<EstimateLine, "phase" | "division" | "description" | "quantity" | "unit" | "unitCost" | "cost" | "unitPrice" | "price" | "allowance" | "source"> & {
  code: string | null;
  item: string;
};

export type InternalReport = {
  lines: InternalLine[];
  groups: { phase: string; division: string; cost: number | null; price: number }[];
  phases: { phase: string; cost: number | null; price: number }[];
  totalCost: number | null;
  totalPrice: number;
  grossProfit: number | null;
  grossMargin: number | null;
  policy: PricingResult["policy"];
  adjustments: string[];
};

export function internalReport(estimate: PricedEstimate): InternalReport {
  const codeByTask = new Map(estimate.doc.tasks.map((t) => [t.id, t.costCode ?? null]));
  const base = baseLines(estimate.pricing);
  const sumCost = (lines: EstimateLine[]) => (lines.every((l) => l.cost !== null) ? round2(lines.reduce((s, l) => s + (l.cost ?? 0), 0)) : null);
  const sumPrice = (lines: EstimateLine[]) => round2(lines.reduce((s, l) => s + l.price, 0));
  const grouped = groupByPhaseDivision(base);
  const adjustments: string[] = [];
  const p = estimate.pricing.policy;
  adjustments.push(
    `Customer price = direct cost x ${(1 + p.contingencyRate).toFixed(2)} project reserve / (1 - ${(p.overheadRate * 100).toFixed(1)}% overhead - ${(p.profitRate * 100).toFixed(1)}% profit)`,
  );
  if (estimate.usesFinish) adjustments.push(`Cost book finish tier: ${p.finishTier}`);
  if (base.some((l) => /remodel premium/i.test(l.source) || / remodel direct cost/.test(l.source))) adjustments.push("Existing-home remodel premium applied where the cost book carries one");
  if (base.some((l) => l.basis === "trip-charge")) adjustments.push("Handyman trip charge shown with an equal credit (owner rule)");
  if (base.some((l) => l.taskId === "gmin")) adjustments.push("Balance to the cost book minimum service charge added");
  return {
    lines: base.map((l) => ({
      code: codeByTask.get(l.taskId) ?? null,
      item: l.item,
      phase: l.phase,
      division: l.division,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitCost: l.unitCost,
      cost: l.cost,
      unitPrice: l.unitPrice,
      price: l.price,
      allowance: l.allowance,
      source: l.source,
    })),
    groups: grouped.flatMap((g) => g.divisions.map((d) => ({ phase: phaseName(g.phase), division: `${d.code} ${divisionName(d.code)}`, cost: sumCost(d.items), price: sumPrice(d.items) }))),
    phases: grouped.map((g) => {
      const lines = g.divisions.flatMap((d) => d.items);
      return { phase: phaseName(g.phase), cost: sumCost(lines), price: sumPrice(lines) };
    }),
    totalCost: estimate.pricing.totals.baseCost,
    totalPrice: estimate.pricing.totals.basePrice,
    grossProfit: estimate.pricing.totals.baseCost === null ? null : round2(estimate.pricing.totals.basePrice - estimate.pricing.totals.baseCost),
    grossMargin: estimate.pricing.totals.margin,
    policy: estimate.pricing.policy,
    adjustments,
  };
}
