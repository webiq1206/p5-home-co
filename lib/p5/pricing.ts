import {publicPricingText} from './customerProjection.ts';
import {tradeForLine,apportionAmount,type TradeCategory} from "./trades.ts";
/** Internal policy. Import only from server entry points, never client components. */
export const POLICY_VERSION = "p5-2026-09-21-business-plan";
export const STANDARD_OVERHEAD_RATE = .20;
/** Operating profit targets. Owner business plan (P5 Comprehensive Business Planning Roadmap, 2026):
 * a 32% planning gross margin with a 30% hard floor, company-wide. The engine prices as
 * cost / (1 - overhead - profit), so 20% overhead + 12% profit = the 32% gross margin target,
 * 20% + 10% = the 30% floor, and risk may add up to 3 points (35%). Rush keeps its urgency premium. */
export const SERVICE_MATRIX = {
  handyman: { target: .12, floor: .10, stretch: .15, contingency: [0, 0], method: "Flat-rate menu or fixed-price package" },
  re10: { target: .12, floor: .10, stretch: .15, contingency: [0, 0], method: "Flat-rate menu or fixed-price package" },
  "cabinet-product": { target: .12, floor: .10, stretch: .15, contingency: [0, 0], method: "Quoted product price with design and delivery separated" },
  "cabinet-install": { target: .12, floor: .10, stretch: .15, contingency: [0, 0], method: "Fixed price after measurement and supplier confirmation" },
  kitchen: { target: .12, floor: .10, stretch: .15, contingency: [.10, .10], method: "Paid planning followed by fixed price or guaranteed maximum price" },
  bathroom: { target: .12, floor: .10, stretch: .15, contingency: [.10, .10], method: "Paid planning followed by fixed price or guaranteed maximum price" },
  "whole-home": { target: .12, floor: .10, stretch: .15, contingency: [.10, .10], method: "Paid preconstruction followed by a guaranteed maximum price" },
  addition: { target: .12, floor: .10, stretch: .15, contingency: [.10, .10], method: "Paid preconstruction followed by a guaranteed maximum price" },
  adu: { target: .12, floor: .10, stretch: .15, contingency: [.10, .10], method: "Paid preconstruction followed by a guaranteed maximum price" },
  "new-construction": { target: .12, floor: .10, stretch: .15, contingency: [.10, .10], method: "Paid preconstruction followed by a guaranteed maximum price or controlled cost-plus agreement" },
  "change-order": { target: .12, floor: .10, stretch: .15, contingency: [0, 0], method: "Written price and schedule approval before changed work proceeds" },
  rush: { target: .25, floor: .20, stretch: .30, contingency: [0, 0], method: "Written fixed-price scope and schedule approval before work proceeds" },
} as const;
export type Service = keyof typeof SERVICE_MATRIX;
export const COST_CATEGORIES = ["materials", "field-labor", "owner-production", "subcontractors", "permits-inspections", "engineering-design", "equipment-rentals", "disposal", "travel-mobilization", "protection-cleanup", "project-supervision", "closeout", "other-direct"] as const;
export type CostCategory = typeof COST_CATEGORIES[number];
export const RISK_FACTORS = ["incomplete-plans", "hidden-conditions", "occupied-home", "limited-access", "unknown-utilities", "soil-slope", "long-lead-times", "material-escalation", "jurisdiction-uncertain", "difficult-sequencing", "compressed-schedule", "incomplete-sub-quotes"] as const;
export type RiskFactor = typeof RISK_FACTORS[number];
export type PricingWarning = { code: string; message: string; severity: "review" | "block" };
export interface FinancePolicy {
  annualOverhead: number;
  /** Optional quarterly forecast. Its absence does not undo the approved 20% rate. */
  annualRevenue: number | null;
  forecastSource: string;
  reviewedAt: string | null;
  approvedBy: string[];
  overheadRate?: number;
  /** Actual earned-revenue evidence is needed to lower the standard rate. */
  reducedRateReview?: { annualizedEarnedRevenue:number; annualizedOverhead:number; source:string; reviewedAt:string };
}
export const DEFAULT_FINANCE: FinancePolicy = {
  annualOverhead: 420000, annualRevenue: null, forecastSource: "",
  overheadRate: STANDARD_OVERHEAD_RATE, reviewedAt: "2026-09-10",
  approvedBy: ["Jared Brost: unified overhead instruction, September 10, 2026"],
};
/** Backward-compatible import name. The overhead policy is now approved. */
export const UNCONFIGURED_FINANCE = DEFAULT_FINANCE;
export interface CostEvidence {
  provenance?:{status:'estimated'|'verified';location:string;retrievedAt:string;assumptions:string[];sources:{url:string;date:string;dateBasis?:'published'|'retrieved';region:string;low:number;high:number}[]};
  basis: "written-quote" | "payroll" | "market-replacement" | "approved-cost-book" | "planning-assumption" | "owner-estimating-schedule" | "sourced-market-average" | "regional-planning-average";
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
  allowance?:boolean;
  building?:string;
  floor?:string;
  unitCostRange?:{low:number;high:number};
  quantityRange?:{low:number;high:number};
  /** A modeled cost budget is not an observed invoice or payroll record. */
  estimatingBasis?:'owner-average-cost'|'historical-cost-budget'|'sourced-market-average'|'regional-planning-average';
  trade?: TradeCategory;
  /** Historical selling prices are comparison evidence, never direct cost. */
  priceBasis?: "direct-cost" | "customer-price" | "unknown";
  id: string; category: CostCategory; description: string; quantity: number; unit: string;
  unitCost: number; evidence: CostEvidence;
  labor?: LoadedLabor; landed?: LandedMaterial;
  /** A source reference ties quantity to the reviewed scope or drawing. */
  quantitySource: string;
  /** Owner salary in the annual overhead budget cannot also be a direct charge. */
  ownerLaborTreatment?: "additional-project-labor" | "included-in-overhead";
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
  estimatePurpose?:'preliminary';
  /** One price instead of a range (owner rule: an RE-10 repair list gets a single firm price). */
  firmPrice?:boolean;
  /** Every line is priced from the owner's price book: the band reflects the book's own accuracy (owner rule 2026-09-21). */
  bookPriced?:boolean;
  service: Service; revision: string; scopeSummary: string; lines: DirectCostLine[];
  coverage: ScopeCoverage[]; risks: RiskFactor[]; assumptions: string[];
  exclusions: string[]; missingInformation: string[]; allowances: Allowance[];
  uncertainty: "low" | "medium" | "high"; locationProvided: boolean;
  urgency?: "standard" | "priority" | "emergency";
  complexity?: "standard" | "complex";
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
  if(policy.annualOverhead<420000)warnings.push({code:"overhead-budget-understated",severity:"block",message:"The official annual overhead budget is $420,000. Advertising appears once within that budget."});
  let requiredOverhead: number | null = null;
  if (policy.annualRevenue === null) warnings.push({ code: "forecast-missing", severity: "review", message: "Using the approved overhead recovery rate. Add a conservative earned-revenue forecast at the quarterly review. The $2.4 million sales goal is not recorded as a forecast." });
  else requiredOverhead = policy.annualOverhead / finite(policy.annualRevenue, "Annual revenue", true);
  const reviewed = policy.reviewedAt ? dateValue(policy.reviewedAt) : NaN;
  if(reviewed>now.getTime())warnings.push({code:"overhead-review-invalid",severity:"block",message:"The overhead review date cannot be in the future."});
  else if (!Number.isFinite(reviewed) || now.getTime() - reviewed > 92 * 86400000) warnings.push({ code: "overhead-review-due", severity: "review", message: "The quarterly overhead review is due. The approved rate and any higher known forecast requirement remain in effect." });
  if (policy.annualRevenue!==null&&!policy.forecastSource.trim()) warnings.push({ code: "forecast-source-missing", severity: "review", message: "Document the basis of the quarterly earned-revenue forecast." });
  let approvedRate=policy.overheadRate??STANDARD_OVERHEAD_RATE;
  finite(approvedRate,"Approved overhead recovery rate",true);
  if(approvedRate<.175||approvedRate>=1)throw new Error("Overhead recovery must be at least 17.5% and below 100%.");
  if(approvedRate<STANDARD_OVERHEAD_RATE){
    const review=policy.reducedRateReview;
    const reviewDate=review?dateValue(review.reviewedAt):NaN;
    const supported=review&&Number.isFinite(review.annualizedEarnedRevenue)&&review.annualizedEarnedRevenue>=2400000&&Number.isFinite(review.annualizedOverhead)&&review.annualizedOverhead>0&&review.annualizedOverhead<=420000&&typeof review.source==="string"&&review.source.trim().length>=20&&Number.isFinite(reviewDate)&&reviewDate<=now.getTime()&&now.getTime()-reviewDate<=92*86400000&&review.annualizedOverhead/review.annualizedEarnedRevenue<=approvedRate;
    if(!supported){approvedRate=STANDARD_OVERHEAD_RATE;warnings.push({code:"reduced-overhead-unverified",severity:"block",message:"A rate below 20% requires a current documented review showing consistent earned revenue of at least $200,000/month and overhead at or below $35,000/month. The calculation retains 20%."});}
  }
  const overhead = Math.max(approvedRate, requiredOverhead ?? approvedRate);
  if (overhead > approvedRate) warnings.push({ code: "overhead-increased", severity: "review", message: "The conservative forecast requires more overhead recovery than the approved standard rate. The operating-profit target has been preserved." });
  return { model:"unified-overhead" as const, approvedRate, overhead, requiredOverhead, total: overhead, warnings };
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
  // A range that does not contain the value it brackets is a repairable inconsistency in one line,
  // not a reason to discard a finished estimate. Live 2026-09-23: "The quantity range must contain
  // the modeled quantity" threw out completed pricing and the stage was asked again, which is how a
  // five-item bedroom scope reached 27 mapping calls. Widening is also the safe direction here: the
  // range feeds the HIGH end of the estimate, so including the modeled value can only make the top
  // of the range honest, never narrower than the work actually priced.
  input = {...input, lines: input.lines.map(line => {
    const widen = (range: {low: number; high: number} | undefined, value: number) =>
      range && Number.isFinite(range.low) && Number.isFinite(range.high) && Number.isFinite(value)
        ? {low: Math.min(range.low, value), high: Math.max(range.high, value)} : range;
    const quantityRange = widen(line.quantityRange, line.quantity);
    const unitCostRange = widen(line.unitCostRange, line.unitCost);
    if ((quantityRange && line.quantityRange && (quantityRange.low !== line.quantityRange.low || quantityRange.high !== line.quantityRange.high))
      || (unitCostRange && line.unitCostRange && (unitCostRange.low !== line.unitCostRange.low || unitCostRange.high !== line.unitCostRange.high)))
      console.error(`[p5-pricing] widened a range on ${line.id} to contain its own value; the line is priced, not discarded.`);
    return {...line, ...(quantityRange ? {quantityRange} : {}), ...(unitCostRange ? {unitCostRange} : {})};
  })};
  const service = input.service === "change-order" ? input.service : input.urgency && input.urgency !== "standard" ? "rush" : input.service;
  if(input.complexity!==undefined&&!["standard","complex"].includes(input.complexity))throw new Error("Unknown project complexity");
  const baseMatrix = SERVICE_MATRIX[service];
  // A complex project may carry up to 2 more points of profit, still inside the business plan's range.
  const matrix = input.complexity==="complex"?{...baseMatrix,target:Math.min(baseMatrix.stretch,baseMatrix.target+.02)}:baseMatrix;
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
  // Owner rule 2026-09-21: a flat 10% contingency on remodels and new construction, none on cabinet,
  // handyman, RE-10, change-order or rush work. Risk is reflected in the range, not a larger reserve.
  // Keyed to the kind of project, not its urgency: a rushed new build is still new construction.
  const projectContingency = SERVICE_MATRIX[input.service].contingency;
  const contingencyRate = input.contingencyRate ?? projectContingency[0];
  finite(contingencyRate, "Contingency rate");
  if (contingencyRate < projectContingency[0]) warn("contingency-below-policy", "Contingency is below the service starting range.", "block");
  if (contingencyRate > projectContingency[1]) warn("elevated-contingency", "Risk factors require contingency above the service starting range. Keep this reserve until closeout and warranty review.");
  const ids = new Set<string>();
  const directByCategory = Object.fromEntries(COST_CATEGORIES.map(c => [c, 0])) as Record<CostCategory, number>;
  const lines = input.lines.map(line => {
    const trade=tradeForLine(line);
    const modeled=input.estimatePurpose==='preliminary'&&((line.evidence?.basis==='owner-estimating-schedule'&&['owner-average-cost','historical-cost-budget'].includes(line.estimatingBasis||''))||(line.evidence?.basis==='sourced-market-average'&&line.estimatingBasis==='sourced-market-average')||(line.evidence?.basis==='regional-planning-average'&&line.estimatingBasis==='regional-planning-average'));
    if(line.evidence?.basis==='regional-planning-average')warn(modeled?'planning-average-preliminary':'planning-average-preliminary-only',`${line.id}: regional planning average, not verified local pricing. Confirm current local rates before a firm proposal.`,modeled?'review':'block');
    if(line.evidence?.basis==='sourced-market-average'&&!modeled)warn('market-average-preliminary-only',`${line.id}: sourced averages require current quotes before a firm proposal.`,'block');
    if(line.evidence?.basis==='owner-estimating-schedule'&&!modeled)warn('estimating-purpose-required',`${line.id}: owner estimating rates are restricted to the configured preliminary model.`,'block');
    if(line.priceBasis && line.priceBasis!=="direct-cost") warn("selling-price-as-cost", `${line.id}: confirm current direct cost. Do not apply P5 allocations or profit to a customer selling price or an unknown price basis.`, "block");
    if (!line.id.trim() || ids.has(line.id)) throw new Error("Blank or duplicated direct-cost line id");
    ids.add(line.id);
    if (!(COST_CATEGORIES as readonly string[]).includes(line.category)) throw new Error("Unknown direct-cost category");
    if (!line.description.trim() || !line.unit.trim() || !line.quantitySource.trim()) throw new Error("Every cost line needs a description, unit and quantity source");
    finite(line.quantity, "Quantity", true); finite(line.unitCost, "Unit cost", true);
    const cost = line.quantity * line.unitCost; finite(cost, "Extended cost", true);
    if (line.category === "materials") {
      if (!line.landed) warn("landed-cost-missing", `${line.id}: net cost, tax, freight, delivery, waste, storage and handling must be itemized before a firm proposal.`, modeled?"review":"block");
      else if (Math.abs(landedUnitCost(line.landed) - line.unitCost) > 1e-8) throw new Error(`${line.id}: landed cost does not match unit cost`);
    }
    if (line.category === "field-labor") {
      if (!line.labor || line.unit !== "hour") warn("loaded-labor-missing", `${line.id}: this labor budget needs actual production hours and burden components before a firm proposal.`, modeled?"review":"block");
      else if (Math.abs(loadedHourlyCost(line.labor) - line.unitCost) > 1e-8) throw new Error(`${line.id}: loaded hourly cost does not match unit cost`);
    }
    const evidence = line.evidence;
    if (!evidence || !evidence.reference.trim() || !Number.isFinite(dateValue(evidence.verifiedAt)) || !Number.isFinite(dateValue(evidence.validUntil))) warn("cost-evidence-missing", `${line.id}: current cost evidence is required.`, "block");
    else {
      // Under the preliminary planning model an aging owner schedule or allowance is disclosed with its date, not a reason to withhold the range; a firm proposal still requires refreshed evidence.
      if (dateValue(evidence.validUntil) < now.getTime() || dateValue(evidence.verifiedAt) > now.getTime()) warn("cost-evidence-expired", modeled ? `${line.id}: rates last confirmed ${String(evidence.verifiedAt).slice(0,10)}; confirm current rates before a firm proposal.` : `${line.id}: refresh the cost evidence before presenting a range.`, modeled ? "review" : "block");
      if (evidence.basis === "planning-assumption") warn("unverified-direct-cost", `${line.id}: this planning assumption needs current cost confirmation.`, "block");
      if (line.category === "subcontractors" && evidence.basis !== "written-quote") warn("written-sub-quote-required", `${line.id}: obtain a current written subcontractor price before a firm proposal.`, modeled?"review":"block");
      if (line.category === "owner-production" && (evidence.basis !== "market-replacement" || line.unit !== "hour")) warn("owner-production-cost-required", `${line.id}: additional owner production requires a supported hourly replacement cost.`, "block");
    }
    if(line.category==="owner-production"&&line.ownerLaborTreatment!=="additional-project-labor")warn("owner-salary-double-count",`${line.id}: both owner salaries are already in overhead. Include only additional project labor outside those salaries, and document that treatment.`,"block");
    directByCategory[line.category] += cost;
    return { ...line, trade, cost };
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
  const allocationDollars = { overhead: contractPrice * allocations.overhead };
  const operatingProfit = contractPrice * margin;
  const pricedLines=lines.map(line=>{
    const lineContingency=line.cost*contingencyRate;
    const riskAdjustedCost=line.cost+lineContingency;
    const sellingAmount=riskAdjustedCost/divisor;
    const overheadRecovery=sellingAmount*allocations.overhead;
    const operatingProfit=sellingAmount*margin;
    return {...line,contingency:lineContingency,riskAdjustedCost,overheadRecovery,operatingProfit,sellingAmount,sellingUnitPrice:sellingAmount/line.quantity};
  });
  // A book-priced estimate carries the owner's own dialed-in prices, so its band is tight: 5% each way,
  // plus 1% per real risk flag, never more than 8%. Anything priced outside the book keeps the wider band.
  const width = input.bookPriced ? Math.min(.08, .05 + riskCount * .01) : Math.min(.5, (input.uncertainty === "high" ? .30 : input.uncertainty === "medium" ? .20 : .10) + riskCount * .015);
  const step = contractPrice >= 100000 ? 1000 : contractPrice >= 10000 ? 100 : contractPrice >= 1000 ? 25 : 5;
  // The low endpoint cannot cut known direct costs below the approved floor.
  const lowFloor = priceFromRiskAdjustedCost(riskAdjustedDirectCost, allocations.total, Math.min(matrix.floor, margin));
  const planningRange = { low: Math.ceil(Math.max(lowFloor, contractPrice * (1 - width)) / step) * step, high: Math.ceil(contractPrice * (1 + width) / step) * step };
  // Extend observed direct-cost bounds before applying the same policy once. Each line's upside is
  // its high quantity at its high cost, less its modeled cost. The uncertain lines of one job do
  // not all land at their worst case together, so their upsides combine as independent errors
  // (square root of the sum of squares) rather than stacking: a single uncertain allowance keeps
  // its full upside, while twenty small ones no longer compound into a range the customer reads
  // as a guess (live Marcliffe RE-10: $28,200 to $45,900).
  const upsides=lines.map(line=>{
    const range=line.unitCostRange;
    if(range){finite(range.low,'Source cost low',true);finite(range.high,'Source cost high',true);if(range.low>line.unitCost||range.high<line.unitCost)throw new Error('The source range must contain the unit cost');}
    if(line.quantityRange){finite(line.quantityRange.low,'Quantity allowance low',true);finite(line.quantityRange.high,'Quantity allowance high',true);if(line.quantityRange.low>line.quantity||line.quantityRange.high<line.quantity)throw new Error('The quantity range must contain the modeled quantity');}
    return Math.max(0,(line.quantityRange?.high??line.quantity)*(range?.high??line.unitCost)-line.cost);
  });
  const sourceHigh=directCost+Math.sqrt(upsides.reduce((total,upside)=>total+upside*upside,0));
  planningRange.high=Math.max(planningRange.high,Math.ceil(priceFromRiskAdjustedCost(sourceHigh*(1+contingencyRate),allocations.total,margin)/step)*step);
  // A firm price is the modeled, margin-correct contract price, rounded up to the step: the number the
  // range was built around, never its low end. Quantities a document leaves open are priced at the
  // modeled count and disclosed as assumptions.
  if(input.firmPrice){const firm=Math.ceil(contractPrice/step)*step;planningRange.low=firm;planningRange.high=firm;}
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
    estimatePurpose: input.estimatePurpose||'verified-cost-review',
    currentCostsConfirmed: !lines.some(line=>['owner-estimating-schedule','sourced-market-average','regional-planning-average'].includes(line.evidence.basis)),
    service, requestedService: input.service, matrix, lines:pricedLines, coverage: input.coverage,
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
const CUSTOMER_ALLOWANCE_DISCLOSURE="Preliminary allowance: confirm quantities, selections and current supplier or trade pricing before a firm proposal.";
const INTERNAL_COMMERCIAL_NOTE=[
  /\bdirect[- ]costs?\b/i,
  /\bdirect[- ](?:materials?|labor|labour)\b/i,
  /\bunit costs?\b/i,
  /\blanded costs?\b/i,
  /\bcost arithmetic\b/i,
  /\boverhead\s+(?:recovery|allocation|costs?|expenses?|burden|rate|charge|percentage|factor)\b/i,
  /\boverhead\b\s*(?::|=|\bis\b|\bof\b)?\s*(?:\$[\d,.]+|\d+(?:\.\d+)?\s*%)/i,
  /(?:\$[\d,.]+|\d+(?:\.\d+)?\s*%)\s*(?:(?:for|in|as)\s+)?overhead\b/i,
  /\b(?:operating|target|gross)\s+(?:profit|margin)\b/i,
  /\ballocation(?: dollars?| figures?)?\b/i,
  /\bpricing divisor\b/i,
  /\bmark[- ]?up\b/i,
  /\$\s*\d[\d,.]*(?:\s*-\s*\$\s*\d[\d,.]*)?\s*(?:\/|\bper\b)\s*(?:lf|sf|ea|each|hour|hr|cy)\b/i,
  /\b\d[\d,.]*(?:\s*(?:to|-)\s*\d[\d,.]*)?\s+USD\s*\/\s*(?:lf|sf|ea|each|hour|hr|cy)\b/i,
  // A model audit remark quotes the direct amount it checked ("2 EA @ $2,990", "at $1,600 each",
  // "scope-7 ... $2,990"): a figure next to an internal line id, an "@", or "each" is private cost,
  // never a customer amount (live Remodeling email, 2026-09-25).
  /@\s*\$\s*\d/i,
  /\$\s*\d[\d,.]*\s*(?:each|apiece|a piece)\b/i,
  /\bat\s+\$\s*\d[\d,.]*\s*(?:each|per|\/|a\b)/i,
  /\b(?:scope|planning|regional)-\d+\b[^$]*\$\s*\d|\$\s*\d[^$]*\b(?:scope|planning|regional)-\d+\b/i,
  /\bPB-\d{2}-\d{2}-\d{2}\b[^$]*\$\s*\d|\$\s*\d[^$]*\bPB-\d{2}-\d{2}-\d{2}\b/i,
];
/** Internal line and catalog identifiers are administrative detail, never customer wording. */
const INTERNAL_ID_GROUP=/\s*\((?:\s*(?:and|,|\/|or)?\s*(?:(?:scope|planning|regional)-\d+(?:-[a-z]+)?|PB-\d{2}-\d{2}-\d{2}(?:-[A-Z])?))+\s*\)/gi;
const INTERNAL_ID=/\b(?:scope|planning|regional)-\d+(?:-[a-z]+)?\b|\bPB-\d{2}-\d{2}-\d{2}(?:-[A-Z])?\b/gi;
export function withoutInternalIds(text:string):string{
  if(!INTERNAL_ID.test(text)){INTERNAL_ID.lastIndex=0;return text;}
  INTERNAL_ID.lastIndex=0;
  return text.replace(INTERNAL_ID_GROUP,'').replace(INTERNAL_ID,'').replace(/\(\s*\)/g,'').replace(/\s{2,}/g,' ')
    .replace(/\s+([,.;:!?)])/g,'$1').replace(/([(,;:])\s*(?=[,;:])/g,'$1').replace(/,\s*,/g,',').replace(/:\s*([,.;])/g,'$1').replace(/^[\s,;:]+/,'').trim();
}
const INTERNAL_RATE=/\$\s*\d[\d,.]*(?:\s*-\s*\$\s*\d[\d,.]*)?\s*(?:\/|\bper\b)\s*(?:lf|sf|ea|each|hour|hr|cy)\b(?:\s*\(\s*\$\s*\d[\d,.]*\s+direct costs?\s*\))?/gi;
const INTERNAL_DIRECT_TOTAL=/\(?\s*\$\s*\d[\d,.]*\s+direct costs?\s*\)?/gi;
/** Redact only private cost arithmetic; retain surrounding scope, quantity,
 * selection, and preliminary-allowance wording. */
export function customerSafeText(value:string):string{
  // The one customer projection runs first (cost wording, rates, plain
  // allowance language), so the page, PDF, email and API can never disagree
  // about what is private; remaining commercial arithmetic is removed after it.
  // Both filters always run, so either order is safe. They cut sentences at
  // different places; the order that keeps more of the customer's own scope
  // and honest allowance wording is used.
  const first=withoutCommercialArithmetic(publicPricingText(value)),second=publicPricingText(withoutCommercialArithmetic(value));
  const commercial=first||second;const projected=second.length>first.length?second:first;
  return projected||(commercial&&/\b(?:preliminary|allowance)\b/i.test(value)?CUSTOMER_ALLOWANCE_DISCLOSURE:'');
}
function withoutCommercialArithmetic(value:string):string{
  const original=value.trim();
  if(!INTERNAL_COMMERCIAL_NOTE.some(pattern=>pattern.test(original))&&!INTERNAL_RATE.test(original)&&!INTERNAL_DIRECT_TOTAL.test(original)){
    INTERNAL_RATE.lastIndex=0;INTERNAL_DIRECT_TOTAL.lastIndex=0;
    return original;
  }
  INTERNAL_RATE.lastIndex=0;INTERNAL_DIRECT_TOTAL.lastIndex=0;
  const allowance=/\b(?:preliminary|allowance)\b/i.test(value);
  // Internal review amounts may appear in a later sentence of the same note.
  let text=value.replace(INTERNAL_RATE,'').replace(INTERNAL_DIRECT_TOTAL,'').replace(/\$\s*\d[\d,.]*(?:\s*(?:-|to)\s*\$?\s*\d[\d,.]*)?/gi,'[internal amount]');
  INTERNAL_RATE.lastIndex=0;INTERNAL_DIRECT_TOTAL.lastIndex=0;
  text=text.replace(/\bbased on\s*(?=[,;:.!?]|$)/gi,'').replace(/\s+([,;:.!?])/g,'$1').replace(/([,;])\s*([,;])/g,'$2');
  const clauses=text.split(/;\s*|(?<=[.!?])\s+/).map(part=>part.trim()).filter(Boolean);
  const safe=clauses.filter(part=>!part.includes('[internal amount]')&&!INTERNAL_COMMERCIAL_NOTE.some(pattern=>pattern.test(part))).join('; ').replace(/\s{2,}/g,' ').trim();
  return safe||(allowance?CUSTOMER_ALLOWANCE_DISCLOSURE:'');
}
/** Customer prose may describe scope and preliminary allowances, but never the
 * private cost basis or the arithmetic used to turn cost into a selling range. */
export function customerSafeNotes(notes:unknown):string[]{
  if(!Array.isArray(notes))return [];
  const safe:string[]=[];
  for(const value of notes){
    if(typeof value!=="string"||!value.trim())continue;
    const note=withoutInternalIds(customerSafeText(value.trim()));
    if(note)safe.push(note);
  }
  return [...new Set(safe)];
}
/** Prose fields where an internal line or catalog id is administrative noise; identifiers such as a
 * line's own id, reference or code are never rewritten. */
const PROSE_KEYS=new Set(['verificationItems','assumptions','exclusions','allowances','verification','summary','description','explanation','rationale','notes','nextStep','basis','includes','excludes','text','disclaimer','changeSummary','factors','scopeTasks']);
/** One final recursive projection protects every prose field later rendered by
 * the customer page, PDF, email, or public API response. */
export function customerSafeProjection<T>(value:T,key=''):T{
  if(typeof value==="string"){const safe=customerSafeText(value);return (PROSE_KEYS.has(key)?withoutInternalIds(safe):safe) as T;}
  if(Array.isArray(value))return value.map(item=>customerSafeProjection(item,key)).filter(item=>item!==''&&item!==null&&item!==undefined) as T;
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,item])=>[k,customerSafeProjection(item,k)])) as T;
  return value;
}
/** Explicit projection keeps internal calculations out of API, email and PDF output. */
/** What happens next, in plain words, for the customer. */
export function customerNextStep(service: string, firm: boolean): string {
  if (firm) return "Book a walkthrough so we can confirm the listed repairs on site. Once they are confirmed, this is the price we hold.";
  if (["handyman", "change-order", "rush"].includes(service)) return "Schedule a visit so we can confirm the work on site and give you a fixed price.";
  if (["new-construction", "addition", "adu"].includes(service)) return "Book a planning meeting. We will review your plans, site and selections and turn this range into a detailed proposal.";
  return "Book a free consultation. We will walk the space with you, go over selections, and turn this range into a fixed-price proposal.";
}
export function customerEstimate(estimate: P5Estimate, summary: string) {
  const trades=[...new Set(estimate.lines.map(l=>tradeForLine(l)))];
  const weights=estimate.lines.map(line=>line.cost);
  const lows=apportionAmount(estimate.planningRange.low,weights);
  // Assign item-specific uncertainty to its actual item/building instead of
  // spreading a well allowance's high bound over unrelated cabinetry, etc.
  const highWeights=estimate.lines.some(l=>l.unitCostRange||l.quantityRange)?estimate.lines.map((line,i)=>Math.max(0,(line.quantityRange?.high??line.quantity)*(line.unitCostRange?.high??line.unitCost)*(1+estimate.contingencyRate)/estimate.divisor-lows[i])):weights;
  const increases=apportionAmount(estimate.planningRange.high-estimate.planningRange.low,highWeights.some(n=>n>0)?highWeights:weights);
  const highs=lows.map((low,i)=>low+increases[i]);
  const lineItems=estimate.publishable?estimate.lines.map((line,i)=>({id:line.id,category:tradeForLine(line),description:line.description,quantity:line.quantity,unit:line.unit,low:lows[i],high:highs[i],unitLow:lows[i]/line.quantity,unitHigh:highs[i]/line.quantity,...(line.building?{building:line.building}:{}),...(line.floor?{floor:line.floor}:{}),...(line.quantityRange?{quantityRange:line.quantityRange}:{}),pricingStatus:line.allowance||line.estimatingBasis==='sourced-market-average'||line.estimatingBasis==='regional-planning-average'?'estimated-allowance':line.evidence.basis==='owner-estimating-schedule'?'owner-planning-rate':'verified-cost',...(line.estimatingBasis==='regional-planning-average'?{verification:'Regional planning average, not verified local pricing. Confirm current local rates, quantities and selections before a firm proposal.'}:line.allowance||line.estimatingBasis==='sourced-market-average'||line.evidence.basis==='owner-estimating-schedule'?{verification:'Confirm quantities, selections and current supplier/trade pricing before a firm proposal.'}:{}),...(line.evidence.provenance?{rateLocation:line.evidence.provenance.location,rateDate:line.evidence.provenance.retrievedAt,rateSources:line.evidence.provenance.sources.map(s=>s.url)}:{})})):[];
  return customerSafeProjection({
    status: estimate.publishable ? "planning-range" as const : "review-required" as const,
    range: estimate.publishable ? estimate.planningRange : null,
    summary,
    includedCategories: trades,
    categoryRanges: estimate.publishable ? trades.map(category=>({category,low:sum(lineItems.filter(line=>line.category===category).map(line=>line.low)),high:sum(lineItems.filter(line=>line.category===category).map(line=>line.high))})) : [],
    lineItems,
    allowances: estimate.allowances.map(a => ({
      description: a.description,
      amount: estimate.publishable ? Math.round(a.directAmount * (1 + estimate.contingencyRate) / estimate.divisor) : null,
      includes: a.includes, taxIncluded: a.tax, freightIncluded: a.freight,
      deliveryIncluded: a.delivery, installationIncluded: a.installation, wasteIncluded: a.waste,
      selectionDeadline: a.selectionDeadline,
      adjustment: "Selection increases and decreases receive the same project pricing treatment. Confirm changes in writing before ordering.",
    })),
    assumptions: customerSafeNotes(estimate.assumptions), exclusions: estimate.exclusions,
    factors: estimate.riskFactors.map(r => r.replaceAll("-", " ")),
    // The contract method is internal ("paid planning followed by a guaranteed maximum price"); the
    // customer is told, in plain words, what happens next.
    nextStep: customerNextStep(estimate.service, estimate.planningRange.low===estimate.planningRange.high),
    message: estimate.publishable ? (estimate.planningRange.low===estimate.planningRange.high ? "This is your price for the repairs listed. Schedule a walkthrough so we can confirm the items on site before work begins." : "Schedule a consultation to confirm the scope and refine this range.") : "Your scope needs a pricing review before we can provide a reliable range. Schedule a consultation or plan review.",
    disclaimer: PLANNING_DISCLAIMER,
  });
}
