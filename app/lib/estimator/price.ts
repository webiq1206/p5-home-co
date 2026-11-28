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

import {NET_POLICY_VERSION, allocatePrice} from "../../../lib/p5/netPricingPolicy.ts";
import type { FinancePolicy } from "../../../lib/p5/pricing.ts";
import {newProjectServices,projectServiceCode,projectServiceDefaults,isSuperintendentCode,type ProjectServiceDefaults} from "../../../lib/p5/projectServices.ts";
import { COST_BOOK_SOURCE, costBookVersion, costBookEntry, costBookRate } from "../scopes/costbook.ts";
import type { RiskFactor } from "../../../lib/p5/pricing.ts";
import { defaultPhase, divisionName, groupByPhaseDivision, phaseName } from "../scopes/divisions.ts";
import { priceMultiplier, priceScope } from "../scopes/pricing.ts";
import { DEFAULT_SCOPE_SETTINGS, emptyScope, type EstimateLine, type PricingResult, type ScopeDoc, type ScopeSettings, type ScopeTask } from "../scopes/types.ts";
import { brandConfig } from "./brands.ts";
import { flowById } from "./flows.ts";
import { SHARE_NOTE, buildGuide, divisionRanges, narrativeProblems, projectRisks, rangeWidth, type PricedDivision } from "./narrative.ts";
import { splitByDivision } from "./shares.ts";
import { HANDYMAN_MINIMUM_CODE, buildRecipe, type CrossCheck, type Recipe } from "./recipes.ts";
import {
  CLASS_LABELS,
  TIER_LABELS,
  isVisible,
  resolveAnswers,
  type Answers,
  type BrandId,
  publicEstimate,
  type CustomerEstimate,
  type EstimateGuide,
  type EstimateClass,
  type PropertyFacts,
  type Tier,
} from "./types.ts";

/** Bumped whenever a recipe or a qualification rule changes, and stored with every estimate. */
export const ESTIMATOR_RULES_VERSION = NET_POLICY_VERSION;

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
  projectServiceDefaults?:ProjectServiceDefaults;
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
  /** The risks this project carries, which set the width of the range. */
  risks: RiskFactor[];
  rangeWidth: number;
  /** The customer's range, the internal division breakdown behind it and the words that explain it. */
  range: { low: number; high: number };
  /** Internal: each division carries its share of the range. The customer gets the scope only. */
  divisions: PricedDivision[];
  /** Wording in the divisions that came from spreading a whole-project line, not from a line of its own. */
  divisionShares: string[];
  guide: EstimateGuide;
  /** Empty when the estimate may go to the customer as an official estimate. */
  review: ReviewReason[];
  versions: { rules: string; costBook: string; costBookSource: string; pricingRelease?: { version: string; digest: string; source: string } };
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

/**
 * Handyman one-hour minimum (owner, 21 November 2026): "if a job takes less
 * than an hour, we bill for 1 hour minimum at the hourly rate". The rate is
 * the labor rate in Pricing setup. Handyman jobs are priced from cost book
 * lines, not hours, so the minimum is held on the price: no visit is shown,
 * at either end of its range, for less than one hour at that rate. The cost
 * book's own minimum service charge still applies and is the higher of the
 * two at today's rates.
 */
export const HANDYMAN_MINIMUM_HOURS = 1;
/** Handyman Co hourly rate (owner, 24 November 2026), shared with the scope platform. */
export { HANDYMAN_HOURLY_RATE } from "../scopes/types.ts";
import { HANDYMAN_HOURLY_RATE } from "../scopes/types.ts";

function compileDoc(input: PriceInput, recipe: Recipe, service: string, summary: string[], defaults?:ProjectServiceDefaults): ScopeDoc {
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

  const doc = emptyScope();
  doc.pricingVersion=NET_POLICY_VERSION;
  doc.handymanAllIn=brand.id==="handyman";
  // Handyman Co bills $95/hour all-in on every job (t2013u), including paint and flooring:
  // no separate internal-labor lines for the handyman service or the Handyman Co brand.
  if (service !== "handyman" && brand.id !== "handyman") doc.projectServices = newProjectServices(defaults);
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
      p.permittingAuthority ? `permits through ${p.permittingAuthority}` : null,
      p.zoning ? `zoning ${p.zoning}` : null,
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
    // A budgetary draft may be itemized in QuickBooks while its firm price awaits approval.
    if (issue.key === "protected-price-review" && estimateClass === "budgetary") continue;
    reasons.push({ code: issue.kind, message: issue.message });
  }
  const priced = pricing.lines.filter((l) => l.basis !== "trip-charge" && !l.basis.startsWith("project-service") && l.taskId !== "gmin").length;
  if (recipeLineCount === 0) reasons.push({ code: "empty", message: "No work was selected." });
  else if (priced < recipeLineCount) reasons.push({ code: "unpriced-lines", message: `${recipeLineCount - priced} selected item(s) could not be priced from the cost book.` });
  if (pricing.totals.basePrice <= 0 && recipeLineCount > 0) reasons.push({ code: "zero-total", message: "The estimate total is zero." });
  if (pricing.totals.margin === null) reasons.push({ code: "margin-unknown", message: "Internal cost is unknown for at least one line, so margin cannot be checked." });
  else if (pricing.netPricing ? pricing.totals.margin < pricing.netPricing.grossTarget-0.00005 || (pricing.totals.profit?.netMargin??0)<0.15-0.00005 : pricing.totals.margin < MARGIN_FLOOR) {
    reasons.push({ code: "margin-floor", message: `Gross margin ${(pricing.totals.margin * 100).toFixed(1)}% is below the applicable gross or net requirement.` });
  }
  if (crossCheck && !crossCheck.within) {
    reasons.push({
      code: "cross-check",
      message: `Itemized direct cost $${crossCheck.itemizedCost.toLocaleString("en-US")} is outside the plausible range from the cost book's ${crossCheck.basis} ($${crossCheck.low.toLocaleString("en-US")} to $${crossCheck.high.toLocaleString("en-US")}).`,
    });
  }
  if (estimateClass === "budgetary") {
    const protectedPrice = pricing.issues.find(issue => issue.key === "protected-price-review");
    reasons.push({ code: "budgetary", message: protectedPrice?.message ?? "Budgetary estimates are priced in detail by the team before an official estimate is issued." });
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
  const settings = ctx.settings ?? DEFAULT_SCOPE_SETTINGS;
  const pricingContext = {
    service: flow.service,
    finishTier: tier,
    settings,
    acknowledged: ctx.acknowledged ?? new Set<string>(),
    finance: ctx.finance,
    now: ctx.now,
  };
  const doc = compileDoc(resolved, recipe, flow.service, summary,ctx.projectServiceDefaults);
  const pricing = priceScope(doc, pricingContext);
  const crossCheck = crossCheckResult(recipe.crossCheck, recipe, tier, flow.service);
  const base = pricing.lines.filter((l) => !l.optional);
  const narrativeFor = () => ({
    brand,
    project: flow.id,
    projectTitle: flow.title,
    service: flow.service,
    estimateClass: flow.estimateClass,
    answers,
    summary,
    tasks: doc.tasks,
    lines: base,
    assumptions: recipe.assumptions,
    exclusions: recipe.exclusions,
    address: input.address,
    property: input.property,
  });
  const narrative = narrativeFor();
  const risks = projectRisks(narrative);
  const width = rangeWidth(flow.estimateClass, risks);
  // A whole-project assembly line is shown across the divisions it is made of.
  // The pieces add up to the line, so the price itself is untouched.
  const codeOf = new Map(doc.tasks.map((t) => [t.id, String(t.costCode ?? "")]));
  const rangeOf = () => divisionRanges(base, width, (line) => (line.division === "90" ? splitByDivision(codeOf.get(line.taskId) ?? "", line.price, tier, flow.service) : null));
  const ranged = rangeOf();
  // Handyman one-hour minimum: the low end of the range the customer sees is
  // never under one hour at the labor rate. When it would be, the balance on
  // the minimum service charge line is raised until it is not.
  const oneHour = 135;
  const hourlyVisit = flow.service === "handyman" && recipe.lines.length > 0 && oneHour > 0;
  if(pricing.netPricing && ranged.low<pricing.netPricing.price && ranged.divisions.length) {
    const low=pricing.netPricing.price;
    const portions=allocatePrice(low,ranged.divisions.map(d=>d.low || d.high),1);
    ranged.divisions.forEach((d,i)=>{d.low=portions[i];d.high=Math.max(d.high,d.low);});
    ranged.low=low;
    ranged.high=ranged.divisions.reduce((s,d)=>s+d.high,0);
    if(ranged.high===low){ranged.divisions[0].high+=1;ranged.high+=1;}
  }
  const range = { low: ranged.low, high: ranged.high };
  const guide = buildGuide(narrative, ranged.divisions, range, risks, ranged.shares);
  // 01-31-02 (and any 01-31-01) recipe hours stay on the scope, but project-services-v2
  // prices them through 01-31-03/04/05 instead of as a second superintendent line.
  const recipeLineCount = recipe.lines.filter((l) => !projectServiceCode(l.code) && !isSuperintendentCode(l.code)).length;
  const review = qualify(pricing, flow.estimateClass, crossCheck, recipeLineCount);
  if (hourlyVisit && range.low < oneHour) {
    review.push({ code: "hourly-minimum", message: `The range starts under the visit minimum of $${oneHour.toLocaleString("en-US")}.` });
  }
  // The words are checked against the priced scope before anyone sees them.
  const pricedCodes = base.map((l) => codeOf.get(l.taskId) ?? "").filter(Boolean);
  for (const problem of narrativeProblems(guide, ranged.divisions, range, base, ranged.shares, pricedCodes)) review.push({ code: "narrative", message: problem });
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
    risks,
    rangeWidth: width,
    range,
    divisions: ranged.divisions,
    divisionShares: ranged.shares,
    guide,
    review,
    versions: { rules: ESTIMATOR_RULES_VERSION, costBook: costBookVersion(), costBookSource: COST_BOOK_SOURCE, pricingRelease: pricing.policy.pricingRelease },
  };
}

/** Review reasons that mean the number itself cannot be trusted, so the customer is not shown one. */
const WITHHOLD_PRICE = new Set(["hourly-minimum", "missing-quantity", "unmatched-item", "missing-price", "outdated-price", "unpriced-lines", "zero-total", "margin-unknown", "margin-floor", "cross-check", "empty", "proposed-hours", "narrative"]);

export function priceWithheld(estimate: PricedEstimate): boolean {
  return estimate.review.some((r) => WITHHOLD_PRICE.has(r.code));
}

const baseLines = (pricing: PricingResult) => pricing.lines.filter((l) => !l.optional);

// ---------------------------------------------------------------------------
// The customer's view. Built field by field from named values so that a cost,
// a margin or a cost code cannot ride along: there is no spread of a priced
// line anywhere in this function.
//
// Scope and one total (owner decision, 16 November 2026): the divisions carry
// the work and no price. The only figure is the range for the whole project.
// ---------------------------------------------------------------------------

export function customerEstimate(
  estimate: PricedEstimate,
  meta: { token: string; address: string | null; createdAt: Date; officialCopy: "sending" | "after-review" },
): CustomerEstimate {
  const brand = brandConfig(estimate.brand)!;
  const withheld = priceWithheld(estimate);
  const klass = CLASS_LABELS[estimate.estimateClass];
  const divisions = withheld
    ? []
    : estimate.divisions.map((d) => ({
        code: d.code,
        name: d.name,
        items: d.items.map((i) => ({ text: i.text, quantity: i.quantity, unit: i.unit, allowance: i.allowance })),
      }));
  const g = estimate.guide;
  const guide: EstimateGuide = withheld
    ? { ...emptyGuide(), overview: ["Our team is reviewing this project so the range we give you is one we can stand behind."], disclaimer: [...g.disclaimer] }
    : {
        rangeNotes: [...(g.rangeNotes ?? [])],
        overview: [...g.overview],
        included: g.included.map((x) => ({ division: x.division, items: [...x.items] })),
        outcome: [...g.outcome],
        assumptions: [...g.assumptions],
        excluded: [...g.excluded],
        undetermined: [...g.undetermined],
        verification: [...g.verification],
        costDrivers: [...g.costDrivers],
        disclaimer: [...g.disclaimer],
      };
  const nextSteps = withheld
    ? ["Our team reviews your project.", `We contact you with your estimate. You can also call ${brand.phoneDisplay}.`]
    : estimate.estimateClass === "budgetary"
      ? [
          "A project lead contacts you to talk through your goals, site and timeline.",
          "We visit the property and confirm the scope.",
          "Preconstruction turns this budget into drawings, selections and a detailed proposal.",
          `Questions? Call or text ${brand.phoneDisplay}.`,
        ]
      : [
          "We contact you to talk through the project and answer questions.",
          "We visit to confirm measurements, existing conditions and your selections.",
          "You receive a detailed written proposal with a final price before any work starts.",
          `Questions? Call or text ${brand.phoneDisplay}.`,
        ];
  return publicEstimate({
    token: meta.token,
    estimateNumber: `P5-${meta.token.slice(0, 8).toUpperCase()}`,
    brandName: brand.name,
    projectName: estimate.projectTitle,
    address: meta.address,
    summary: estimate.summary,
    estimateClass: estimate.estimateClass,
    classLabel: klass.label,
    classStatement: klass.statement,
    range: withheld ? null : { low: estimate.range.low, high: estimate.range.high },
    divisions,
    divisionNote: !withheld && estimate.divisionShares.length ? SHARE_NOTE : null,
    guide,
    assumptions: guide.assumptions,
    exclusions: guide.excluded,
    nextSteps,
    officialCopy: meta.officialCopy,
    createdAt: meta.createdAt.toISOString(),
  });
}

function emptyGuide(): EstimateGuide {
  return { rangeNotes: [], overview: [], included: [], outcome: [], assumptions: [], excluded: [], undetermined: [], verification: [], costDrivers: [], disclaimer: [] };
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
  /** What the customer was shown, and why the range is as wide as it is. */
  range: { low: number; high: number; width: number; risks: string[] };
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
  if(base.some(l=>l.sku))adjustments.push(`Project service exception: final $${estimate.doc.projectServices?.hourlyRate ?? 120}/person-hour, no markup. Frozen defaults: ${Object.entries(projectServiceDefaults(estimate.doc.projectServices?.defaults)).map(([code,d])=>`${code}: ${d.hoursPer1000} hours per $1,000 outside costs, whole-project minimum ${d.minimumHours} hours`).join("; ")}. Milestone cost shares or equal allocation; internal overrides prevail. Owner-salary overlap is credited once; distinct outside supervision remains chargeable.`);
  if (estimate.usesFinish) adjustments.push(`Cost book finish tier: ${p.finishTier}`);
  if (base.some((l) => /remodel premium/i.test(l.source) || / remodel direct cost/.test(l.source))) adjustments.push("Existing-home remodel premium applied where the cost book carries one");
  if (base.some((l) => l.basis === "trip-charge")) adjustments.push("Handyman trip charge shown with an equal credit (owner rule)");
  if (base.some((l) => l.taskId === "gmin")) {
    const hourly = estimate.doc.tasks.some((t) => t.id === "gmin" && t.title.startsWith("One-hour"));
    adjustments.push(hourly ? `Balance to the one-hour minimum at $${HANDYMAN_HOURLY_RATE}/hour added on the minimum service charge line` : "Balance to the cost book minimum service charge added");
  }
  return {
    lines: base.map((l) => ({
      code: codeByTask.get(l.taskId) ?? projectServiceCode(l.id) ?? null,
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
    range: { low: estimate.range.low, high: estimate.range.high, width: estimate.rangeWidth, risks: estimate.risks },
  };
}
