/** Internal policy. Import only from server entry points, never client components. */
export const POLICY_VERSION = "p5-2026-09-10";
export const SERVICE_MATRIX = {
  handyman: { target: .25, floor: .20, stretch: .30, contingency: [.03, .05], method: "Flat-rate menu or fixed-price package" },
  re10: { target: .25, floor: .20, stretch: .30, contingency: [.03, .05], method: "Flat-rate menu or fixed-price package" },
  "cabinet-product": { target: .15, floor: .12, stretch: .20, contingency: [.03, .05], method: "Quoted product price with design and delivery separated" },
  "cabinet-install": { target: .20, floor: .15, stretch: .25, contingency: [.03, .05], method: "Fixed price after measurement and supplier confirmation" },
  kitchen: { target: .20, floor: .15, stretch: .25, contingency: [.07, .10], method: "Paid planning followed by fixed price or guaranteed maximum price" },
  bathroom: { target: .20, floor: .15, stretch: .25, contingency: [.07, .10], method: "Paid planning followed by fixed price or guaranteed maximum price" },
  "whole-home": { target: .18, floor: .15, stretch: .22, contingency: [.08, .12], method: "Paid preconstruction followed by a guaranteed maximum price" },
  addition: { target: .15, floor: .12, stretch: .20, contingency: [.05, .08], method: "Paid preconstruction followed by a guaranteed maximum price" },
  adu: { target: .15, floor: .12, stretch: .20, contingency: [.05, .08], method: "Paid preconstruction followed by a guaranteed maximum price" },
  "new-construction": { target: .15, floor: .10, stretch: .20, contingency: [.03, .05], method: "Paid preconstruction followed by a guaranteed maximum price or controlled cost-plus agreement" },
  "change-order": { target: .25, floor: .20, stretch: .30, contingency: [.05, .10], method: "Written price and schedule approval before changed work proceeds" },
  rush: { target: .25, floor: .20, stretch: .30, contingency: [.05, .10], method: "Written fixed-price scope and schedule approval before work proceeds" },
} as const;
export type Service = keyof typeof SERVICE_MATRIX;
export const COST_CATEGORIES = ["materials", "field-labor", "owner-production", "subcontractors", "permits-inspections", "engineering-design", "equipment-rentals", "disposal", "travel-mobilization", "protection-cleanup", "project-supervision", "closeout", "other-direct"] as const;
export type CostCategory = typeof COST_CATEGORIES[number];
export const RISK_FACTORS = ["incomplete-plans", "hidden-conditions", "occupied-home", "limited-access", "unknown-utilities", "soil-slope", "long-lead-times", "material-escalation", "jurisdiction-uncertain", "difficult-sequencing", "compressed-schedule", "incomplete-sub-quotes"] as const;
export type RiskFactor = typeof RISK_FACTORS[number];
export type PricingWarning = { code: string; message: string; severity: "review" | "block" };
export interface FinancePolicy {
  annualOverhead: number;
  /** A documented conservative forecast, never the marketing sales goal. */
  annualRevenue: number | null;
  forecastSource: string;
  reviewedAt: string | null;
  approvedBy: string[];
}
export const UNCONFIGURED_FINANCE: FinancePolicy = {
  annualOverhead: 420000, annualRevenue: null, forecastSource: "",
  reviewedAt: null, approvedBy: [],
};
export interface CostEvidence {
  basis: "written-quote" | "payroll" | "market-replacement" | "approved-cost-book" | "planning-assumption";
  reference: string;
  verifiedAt: string;
  validUntil: string;
}
export interface LoadedLabor {
  wage: number; payrollTaxes: number; workersComp: number; benefits: number;
  paidNonproductiveTime: number; directLaborExpenses: number;
}
export interface LandedMaterial {
  netPurchase: number; tax: number; freight: number; delivery: number;
  waste: number; storage: number; handling: number;
}
export interface DirectCostLine {
  id: string; category: CostCategory; description: string; quantity: number; unit: string;
  unitCost: number; evidence: CostEvidence;
  labor?: LoadedLabor; landed?: LandedMaterial;
  /** A source reference ties quantity to the reviewed scope or drawing. */
  quantitySource: string;
}
export interface Allowance {
  id: string; description: string; directAmount: number; costLineIds: string[];
  includes: string[]; tax: boolean; freight: boolean; delivery: boolean;
  installation: boolean; waste: boolean; selectionDeadline: string;
}
export interface ScopeCoverage { category: CostCategory; status: "included" | "not-applicable" | "missing"; reason: string }
export interface OwnerApproval {
  /** Supplied only after an authenticated server verifies the stored approval. */
  owner: "Nick" | "Jared"; recordId: string; writtenReason: string;
  approvedAt: string; estimateRevision: string;
}
export interface PricingInput {
  service: Service; revision: string; scopeSummary: string; lines: DirectCostLine[];
  coverage: ScopeCoverage[]; risks: RiskFactor[]; assumptions: string[];
  exclusions: string[]; missingInformation: string[]; allowances: Allowance[];
  uncertainty: "low" | "medium" | "high"; locationProvided: boolean;
  urgency?: "standard" | "priority" | "emergency";
  targetMargin?: number; contingencyRate?: number;
  manualAdjustments?: { reason: string; costLineId: string }[];
  /** Benchmarks are administrator-maintained checks, never a pricing input. */
  benchmark?: { low: number; high: number; source: string; validUntil: string };
}
const finite = (n: number, name: string, positive = false) => {
  if (!Number.isFinite(n) || (positive ? n <= 0 : n < 0)) throw new Error(`${name} must be a finite ${positive ? "positive" : "nonnegative"} number`);
  return n;
};
const dateValue = (value: string) => /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) ? Date.parse(value) : NaN;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export function loadedHourlyCost(labor: LoadedLabor): number {
  return sum([labor.wage, labor.payrollTaxes, labor.workersComp, labor.benefits, labor.paidNonproductiveTime, labor.directLaborExpenses].map(n => finite(n, "Labor burden component")));
}
export function landedUnitCost(material: LandedMaterial): number {
  return sum([material.netPurchase, material.tax, material.freight, material.delivery, material.waste, material.storage, material.handling].map(n => finite(n, "Landed material component")));
}
export function companyAllocation(policy: FinancePolicy, now = new Date()) {
  finite(policy.annualOverhead, "Annual overhead", true);
  const warnings: PricingWarning[] = [];
  let requiredOverhead: number | null = null;
  if (policy.annualRevenue === null) warnings.push({ code: "forecast-missing", severity: "block", message: "A conservative 12-month revenue forecast is required. The $2.4 million marketing goal is not a forecast." });
  else requiredOverhead = policy.annualOverhead / finite(policy.annualRevenue, "Annual revenue", true);
  const reviewed = policy.reviewedAt ? dateValue(policy.reviewedAt) : NaN;
  if (!Number.isFinite(reviewed) || reviewed > now.getTime() || now.getTime() - reviewed > 92 * 86400000) warnings.push({ code: "overhead-review-due", severity: "block", message: "The quarterly overhead and revenue forecast review is missing or overdue." });
  if (!policy.forecastSource.trim()) warnings.push({ code: "forecast-source-missing", severity: "block", message: "Document the basis of the conservative forecast." });
  const overhead = Math.max(.08, requiredOverhead ?? .08);
  if (overhead > .08) warnings.push({ code: "overhead-increased", severity: "review", message: "The forecast requires an overhead allocation above the standard 8%. The operating-profit target has been preserved." });
  return { nick: .05, jared: .05, social: .02, overhead, requiredOverhead, total: .12 + overhead, warnings };
}
export function priceFromRiskAdjustedCost(cost: number, allocation: number, operatingProfit: number): number {
  finite(cost, "Risk-adjusted direct cost"); finite(allocation, "Company allocation"); finite(operatingProfit, "Operating profit");
  const divisor = 1 - allocation - operatingProfit;
  if (divisor <= 0 || divisor > 1) throw new Error("The pricing divisor must be positive. Review overhead and profit configuration.");
  return cost / divisor;
}
/** Signed allowance deltas use the same divisor in both directions. */
export function allowanceAdjustment(newDirectAmount: number, oldDirectAmount: number, contingencyRate: number, allocation: number, operatingProfit: number): number {
  finite(newDirectAmount, "New allowance"); finite(oldDirectAmount, "Old allowance"); finite(contingencyRate, "Contingency");
  return (newDirectAmount - oldDirectAmount) * (1 + contingencyRate) * priceFromRiskAdjustedCost(1, allocation, operatingProfit);
}
export function calculateP5Estimate(input: PricingInput, finance: FinancePolicy, approvals: OwnerApproval[] = [], now = new Date()) {
  const warnings: PricingWarning[] = [];
  const warn = (code: string, message: string, severity: "review" | "block" = "review") => warnings.push({ code, message, severity });
  if (!input.scopeSummary.trim() || !input.revision.trim()) throw new Error("A scope summary and estimate revision are required");
  if (!Object.hasOwn(SERVICE_MATRIX,input.service)) throw new Error("Unknown service");
  if (!input.lines.length) throw new Error("At least one direct-cost line is required");
  const service = input.service === "change-order" ? input.service : input.urgency && input.urgency !== "standard" ? "rush" : input.service;
  const matrix = SERVICE_MATRIX[service];
  const riskSet = new Set(input.risks);
  for (const risk of riskSet) if (!(RISK_FACTORS as readonly string[]).includes(risk)) throw new Error("Unknown risk factor");
  if (!input.locationProvided) { riskSet.add("jurisdiction-uncertain"); warn("location-unknown", "Jurisdiction, utilities, access, soil, slope and permits require review. Obtain the exact address before a site visit or firm proposal."); }
  const riskCount = riskSet.size;
  const riskMargin = Math.min(matrix.stretch, matrix.target + Math.min(4, riskCount) * .01 + (input.urgency === "emergency" ? .025 : 0));
  const margin = input.targetMargin ?? riskMargin;
  finite(margin, "Operating-profit target");
  if (margin > matrix.stretch) warn("above-stretch", "The selected target is above the service stretch target; confirm the documented value and market position.");
  if (margin < matrix.target) warn("below-target", "Value-engineer the scope first. Record the reason for using a target below the standard service target.");
  const validApprovals = approvals.filter(a => ["Nick", "Jared"].includes(a.owner) && a.estimateRevision === input.revision && a.recordId.trim() && a.writtenReason.trim().length >= 20 && Number.isFinite(dateValue(a.approvedAt)) && dateValue(a.approvedAt) <= now.getTime());
  if (margin < matrix.floor && !["Nick", "Jared"].every(owner => validApprovals.some(a => a.owner === owner))) warn("owner-approval-required", "Below-floor pricing requires written approval from both owners for this exact estimate revision.", "block");
  const contingencyRate = input.contingencyRate ?? Math.min(.25, matrix.contingency[0] + riskCount * .01 + (input.uncertainty === "high" ? .02 : input.uncertainty === "medium" ? .01 : 0));
  finite(contingencyRate, "Contingency rate");
  if (contingencyRate < matrix.contingency[0]) warn("contingency-below-policy", "Contingency is below the service starting range.", "block");
  if (contingencyRate > matrix.contingency[1]) warn("elevated-contingency", "Risk factors require contingency above the service starting range. Keep this reserve until closeout and warranty review.");
  const ids = new Set<string>();
  const directByCategory = Object.fromEntries(COST_CATEGORIES.map(c => [c, 0])) as Record<CostCategory, number>;
  const lines = input.lines.map(line => {
    if (!line.id.trim() || ids.has(line.id)) throw new Error("Blank or duplicated direct-cost line id");
    ids.add(line.id);
    if (!(COST_CATEGORIES as readonly string[]).includes(line.category)) throw new Error("Unknown direct-cost category");
    if (!line.description.trim() || !line.unit.trim() || !line.quantitySource.trim()) throw new Error("Every cost line needs a description, unit and quantity source");
    finite(line.quantity, "Quantity", true); finite(line.unitCost, "Unit cost", true);
    const cost = line.quantity * line.unitCost; finite(cost, "Extended cost", true);
    if (line.category === "materials") {
      if (!line.landed) warn("landed-cost-missing", `${line.id}: net cost, tax, freight, delivery, waste, storage and handling must be itemized.`, "block");
      else if (Math.abs(landedUnitCost(line.landed) - line.unitCost) > 1e-8) throw new Error(`${line.id}: landed cost does not match unit cost`);
    }
    if (line.category === "field-labor") {
      if (!line.labor || line.unit !== "hour") warn("loaded-labor-missing", `${line.id}: employee production hours require all burden components.`, "block");
      else if (Math.abs(loadedHourlyCost(line.labor) - line.unitCost) > 1e-8) throw new Error(`${line.id}: loaded hourly cost does not match unit cost`);
    }
    const evidence = line.evidence;
    if (!evidence || !evidence.reference.trim() || !Number.isFinite(dateValue(evidence.verifiedAt)) || !Number.isFinite(dateValue(evidence.validUntil))) warn("cost-evidence-missing", `${line.id}: current cost evidence is required.`, "block");
    else {
      if (dateValue(evidence.validUntil) < now.getTime() || dateValue(evidence.verifiedAt) > now.getTime()) warn("cost-evidence-expired", `${line.id}: refresh the cost evidence before presenting a range.`, "block");
      if (evidence.basis === "planning-assumption") warn("unverified-direct-cost", `${line.id}: this planning assumption needs current cost confirmation.`, "block");
      if (line.category === "subcontractors" && evidence.basis !== "written-quote") warn("written-sub-quote-required", `${line.id}: obtain a current written subcontractor price.`, "block");
      if (line.category === "owner-production" && (evidence.basis !== "market-replacement" || line.unit !== "hour")) warn("owner-production-cost-required", `${line.id}: owner physical work must use separate market replacement hourly cost.`, "block");
    }
    directByCategory[line.category] += cost;
    return { ...line, cost };
  });
  const coverageIds = new Set<string>();
  for (const c of input.coverage) { if (!(COST_CATEGORIES as readonly string[]).includes(c.category) || !["included","missing","not-applicable"].includes(c.status) || typeof c.reason!=="string") throw new Error("Invalid scope coverage"); if (coverageIds.has(c.category)) throw new Error("Duplicate scope coverage category"); coverageIds.add(c.category); }
  for (const category of COST_CATEGORIES) {
    const c = input.coverage.find(c => c.category === category);
    if (!c || c.status === "missing" || !c.reason.trim()) warn("scope-coverage-missing", `${category}: confirm inclusion or record why it does not apply.`, "block");
    else if ((c.status === "included") !== (directByCategory[category] > 0)) warn("scope-cost-conflict", `${category}: coverage and priced lines disagree.`, "block");
  }
  const allowanceIds = new Set<string>(); const allocatedLines = new Set<string>();
  for (const a of input.allowances) {
    if (!a.id.trim() || allowanceIds.has(a.id)) throw new Error("Blank or duplicated allowance"); allowanceIds.add(a.id);
    finite(a.directAmount, "Allowance", true);
    if (!a.description.trim() || !a.includes.length || !Number.isFinite(dateValue(a.selectionDeadline))) warn("allowance-incomplete", `${a.id}: describe inclusions and set a selection deadline.`, "block");
    for (const key of ["tax", "freight", "delivery", "installation", "waste"] as const) if (typeof a[key] !== "boolean") warn("allowance-treatment-missing", `${a.id}: ${key} treatment is required.`, "block");
    let linkedCost = 0;
    for (const id of a.costLineIds) { if (!ids.has(id) || allocatedLines.has(id)) throw new Error("Allowance has an unknown or duplicated cost line"); allocatedLines.add(id); linkedCost += lines.find(l => l.id === id)!.cost; }
    if (Math.abs(linkedCost - a.directAmount) > 1e-8) throw new Error("Allowance amount must match its direct-cost lines; never add it twice");
  }
  const allocations = companyAllocation(finance, now); warnings.push(...allocations.warnings);
  const directCost = sum(lines.map(l => l.cost)); finite(directCost, "Total direct cost", true);
  const contingency = directCost * contingencyRate;
  const riskAdjustedDirectCost = directCost + contingency;
  const divisor = 1 - allocations.total - margin;
  const contractPrice = priceFromRiskAdjustedCost(riskAdjustedDirectCost, allocations.total, margin);
  const allocationDollars = { nick: contractPrice * allocations.nick, jared: contractPrice * allocations.jared, social: contractPrice * allocations.social, overhead: contractPrice * allocations.overhead };
  const operatingProfit = contractPrice * margin;
  const width = Math.min(.5, (input.uncertainty === "high" ? .30 : input.uncertainty === "medium" ? .20 : .10) + riskCount * .015);
  const step = contractPrice >= 100000 ? 1000 : contractPrice >= 10000 ? 100 : contractPrice >= 1000 ? 25 : 5;
  // The low endpoint cannot cut known direct costs below the approved floor.
  const lowFloor = priceFromRiskAdjustedCost(riskAdjustedDirectCost, allocations.total, Math.min(matrix.floor, margin));
  const planningRange = { low: Math.ceil(Math.max(lowFloor, contractPrice * (1 - width)) / step) * step, high: Math.ceil(contractPrice * (1 + width) / step) * step };
  if (input.missingInformation.length) warn("missing-project-information", "Resolve the recorded missing project information before a firm proposal.");
  if (contractPrice < 100 || contractPrice > 10000000) warn("unusual-total", "The result is outside the broad project review limits. Verify quantities and units.", "block");
  if (input.benchmark) {
    finite(input.benchmark.low, "Benchmark low", true); finite(input.benchmark.high, "Benchmark high", true);
    if (input.benchmark.low > input.benchmark.high) throw new Error("Reversed benchmark range");
    if (!input.benchmark.source.trim() || !Number.isFinite(dateValue(input.benchmark.validUntil)) || dateValue(input.benchmark.validUntil) < now.getTime()) warn("benchmark-stale", "Refresh the project benchmark before using it for comparison.");
    else if (contractPrice < input.benchmark.low || contractPrice > input.benchmark.high) warn("benchmark-outlier", "This estimate is outside the documented project benchmark. Review scope and costs; do not automatically reduce profit.");
  } else warn("benchmark-missing", "Add a current, scope-comparable project benchmark for administrator review.");
  for (const a of input.manualAdjustments ?? []) if (!ids.has(a.costLineId) || !a.reason.trim()) throw new Error("Every manual adjustment needs a valid cost line and written reason");
  return {
    policyVersion: POLICY_VERSION, revision: input.revision, evaluatedAt: now.toISOString(),
    service, requestedService: input.service, matrix, lines, coverage: input.coverage,
    directByCategory, directCost, contingencyRate, contingency, riskAdjustedDirectCost,
    allocations, allocationDollars, targetOperatingProfit: margin, operatingProfit, divisor,
    contractPrice, planningRange, assumptions: input.assumptions, allowances: input.allowances,
    exclusions: input.exclusions, missingInformation: input.missingInformation,
    riskFactors: [...riskSet], manualAdjustments: input.manualAdjustments ?? [],
    ownerApprovals: validApprovals, financeSnapshot: finance, warnings,
    requiresAdminReview: warnings.length > 0,
    publishable: !warnings.some(w => w.severity === "block"),
    contractMethod: matrix.method,
    reconciliation: riskAdjustedDirectCost + sum(Object.values(allocationDollars)) + operatingProfit - contractPrice,
  };
}
export type P5Estimate = ReturnType<typeof calculateP5Estimate>;
export const PLANNING_DISCLAIMER = "Preliminary planning information only. This is not a bid, quote, offer or guaranteed price. A site or plan review, confirmed scope, current supplier and trade pricing, and written agreement are required before work proceeds.";
/** Explicit projection keeps internal calculations out of API, email and PDF output. */
export function customerEstimate(estimate: P5Estimate, summary: string) {
  return {
    status: estimate.publishable ? "planning-range" as const : "review-required" as const,
    range: estimate.publishable ? estimate.planningRange : null,
    summary,
    includedCategories: [...new Set(estimate.lines.map(l => l.category))],
    allowances: estimate.allowances.map(a => ({
      description: a.description,
      amount: estimate.publishable ? Math.round(a.directAmount * (1 + estimate.contingencyRate) / estimate.divisor) : null,
      includes: a.includes, taxIncluded: a.tax, freightIncluded: a.freight,
      deliveryIncluded: a.delivery, installationIncluded: a.installation, wasteIncluded: a.waste,
      selectionDeadline: a.selectionDeadline,
      adjustment: "Selection increases and decreases receive the same project pricing treatment. Confirm changes in writing before ordering.",
    })),
    assumptions: estimate.assumptions, exclusions: estimate.exclusions,
    factors: estimate.riskFactors.map(r => r.replaceAll("-", " ")),
    nextStep: estimate.contractMethod,
    message: estimate.publishable ? "Schedule a consultation to confirm the scope and refine this range." : "Your scope needs a pricing review before we can provide a reliable range. Schedule a consultation or plan review.",
    disclaimer: PLANNING_DISCLAIMER,
  };
}
