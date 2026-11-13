/**
 * Turn a scope into estimate lines. Deterministic: same scope, settings and
 * date give the same lines, so a saved version can always be re-derived.
 *
 * Margin policy is the owner's existing one (lib/p5/pricing.ts), not a copy:
 *   customer price = direct cost x (1 + contingency) / (1 - overhead - profit)
 * with the 20% unified overhead, the service's profit target and the 10%
 * project reserve. Cost book amounts are direct costs; a written quote is a
 * direct cost. P5 labor is billed at the hourly rate as is, never marked up.
 *
 * Duplicate charges are avoided structurally: a bundled cost book line
 * (installed, labor plus disposal, assemblies) never also gets internal
 * labor, and a labor-only cost book line is replaced, not joined, by internal
 * labor when P5's own crew does the work.
 */

import {
  DEFAULT_FINANCE,
  SERVICE_MATRIX,
  companyAllocation,
  type FinancePolicy,
} from "../../../lib/p5/pricing.ts";
import type { FinishTier } from "../../../lib/p5/priceBook.ts";
import {
  COST_BOOK_REVIEWED_AT,
  COST_BOOK_SOURCE,
  COST_BOOK_VERSION,
  costBookEntry,
  costBookRate,
  itemForEntry,
} from "./costbook.ts";
import type {
  EstimateLine,
  ItemKey,
  Measurement,
  PricingIssue,
  PricingResult,
  ProfitCheck,
  ScopeDoc,
  ScopeSettings,
  ScopeTask,
} from "./types.ts";

export const CONTINGENCY_RATE = 0.1;
/** Cost book line "Trip / material run charge". */
export const TRIP_CHARGE_CODE = "01-01-08";

export type PricingContext = {
  service: string;
  finishTier: FinishTier;
  settings: ScopeSettings;
  /** Keys of one-time acknowledgements recorded through the wizard. */
  acknowledged: Set<string>;
  /** The saved estimator finance policy; the approved default when none is saved. */
  finance?: FinancePolicy;
  now?: Date;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function profitRate(service: string): number {
  const matrix = (SERVICE_MATRIX as Record<string, { target: number }>)[service];
  return (matrix ?? SERVICE_MATRIX.remodel).target;
}

export function priceMultiplier(service: string, now = new Date(), finance: FinancePolicy = DEFAULT_FINANCE): {
  multiplier: number;
  overhead: number;
  profit: number;
} {
  let overhead: number;
  try {
    overhead = companyAllocation(finance, now).overhead;
  } catch {
    // A saved policy the estimator itself would reject falls back to the approved default.
    overhead = companyAllocation(DEFAULT_FINANCE, now).overhead;
  }
  const profit = profitRate(service);
  return { multiplier: (1 + CONTINGENCY_RATE) / (1 - overhead - profit), overhead, profit };
}

export function costBookAgeKey(): string {
  return `price-age:${COST_BOOK_VERSION}`;
}

/** Tasks that count toward pricing at all. */
export function isPriced(task: ScopeTask): boolean {
  if (task.dismissed) return false;
  if (task.bucket !== "approved" && task.bucket !== "optional") return false;
  return task.certainty === "confirmed" || task.certainty === "assumed";
}

type Qty =
  | { state: "missing"; unit: string }
  | { state: "firm" | "estimated"; value: number; unit: string; measurement?: Measurement };

export function taskQuantity(task: ScopeTask, doc: ScopeDoc, fallbackUnit: string): Qty {
  const q = task.quantity;
  const factor = q?.factor && q.factor > 0 ? q.factor : 1;
  if (q?.measurementId) {
    const m = doc.measurements.find((x) => x.id === q.measurementId);
    if (!m || m.value === null || !Number.isFinite(m.value)) {
      return { state: "missing", unit: m?.unit || q.unit || fallbackUnit };
    }
    return {
      state: m.status === "estimated" ? "estimated" : "firm",
      value: m.value * factor,
      unit: q.unit || m.unit || fallbackUnit,
      measurement: m,
    };
  }
  if (q && typeof q.value === "number" && Number.isFinite(q.value)) {
    return { state: q.estimated ? "estimated" : "firm", value: q.value * factor, unit: q.unit || fallbackUnit };
  }
  return { state: "missing", unit: q?.unit || fallbackUnit };
}

function laborItem(task: ScopeTask, service: string): ItemKey {
  if (task.phase === "pre-construction") return "Design and Preconstruction Services";
  if (service === "handyman") return "Handyman Service Work";
  return "Direct Labor";
}

function description(task: ScopeTask): string {
  const base = (task.description || task.title).trim();
  return task.area && !base.toLowerCase().includes(task.area.toLowerCase()) ? `${task.area}: ${base}` : base;
}

export function priceScope(doc: ScopeDoc, ctx: PricingContext): PricingResult {
  const now = ctx.now ?? new Date();
  const { multiplier, overhead, profit } = priceMultiplier(ctx.service, now, ctx.finance);
  const settings = ctx.settings;
  const lines: EstimateLine[] = [];
  const issues: PricingIssue[] = [];
  const issue = (i: PricingIssue) => {
    if (!issues.some((x) => x.key === i.key)) issues.push(i);
  };
  const percentTasks: { task: ScopeTask; rate: number; source: string; item: ItemKey }[] = [];
  const tripTaskIds = new Set<string>();

  const sell = (unitCost: number) => round2(unitCost * multiplier);

  const pushLabor = (task: ScopeTask, hours: number, basisNote: string) => {
    // Owner rule: the hourly rate is the customer's price. Overhead, reserve
    // and profit are never added to it, on any service.
    const unitPrice = settings.laborRate;
    const unitCost = settings.laborLoadedCost;
    lines.push({
      id: `${task.id}:labor`,
      taskId: task.id,
      phase: task.phase,
      division: task.division,
      item: laborItem(task, ctx.service),
      description: `${description(task)} (labor)`,
      quantity: round2(hours),
      unit: "HR",
      unitCost,
      cost: unitCost === null ? null : round2(unitCost * hours),
      unitPrice,
      price: round2(unitPrice * round2(hours)),
      basis: "internal-labor",
      source: `P5 labor at $${unitPrice}/hour, billed as is with no markup; hours: ${basisNote}`,
      optional: task.bucket === "optional",
      allowance: false,
      laborHours: round2(hours),
      notes: [],
    });
  };

  /** Hours for internal labor on a task, with their basis. Null when unknown. */
  const laborHours = (task: ScopeTask, qty: Qty | null): { hours: number; basis: string; proposed: boolean } | null => {
    const code = task.costCode ?? "";
    const production = settings.productionRates[code];
    if (production && qty && qty.state !== "missing") {
      return {
        hours: qty.value * production.hoursPerUnit,
        basis: `production rate ${production.hoursPerUnit} hr per ${qty.unit}`,
        proposed: false,
      };
    }
    const lh = task.laborHours;
    if (lh && typeof lh.value === "number" && lh.value > 0) {
      return {
        hours: lh.value,
        basis: `${lh.basis === "proposed" ? "proposed" : lh.basis}${lh.note ? `, ${lh.note}` : ""}`,
        proposed: lh.basis === "proposed",
      };
    }
    return null;
  };

  const needLabor = (task: ScopeTask, qty: Qty | null, blocking: boolean) => {
    const h = laborHours(task, qty);
    if (!h) {
      issue({
        key: `hours:${task.id}`,
        taskId: task.id,
        kind: "proposed-hours",
        blocking,
        message: `Labor hours are needed for "${task.title}".`,
      });
      return;
    }
    if (h.proposed) {
      issue({
        key: `hours:${task.id}`,
        taskId: task.id,
        kind: "proposed-hours",
        blocking,
        message: `Proposed ${round2(h.hours)} labor hours for "${task.title}" need review.`,
      });
    }
    pushLabor(task, h.hours, h.basis);
  };

  for (const task of doc.tasks) {
    if (!isPriced(task)) continue;
    const blocking = task.bucket === "approved";
    const optional = task.bucket === "optional";
    const entry = costBookEntry(task.costCode);
    const internal = task.performer === "internal";

    // 1. Allowance: a fixed, approved direct amount.
    if (task.allowance) {
      const item = entry ? itemForEntry(entry, ctx.service) : "Other Direct Cost";
      const price = sell(task.allowance.amount);
      lines.push({
        id: `${task.id}:allowance`,
        taskId: task.id,
        phase: task.phase,
        division: task.division,
        item,
        description: `Allowance: ${description(task)}`,
        quantity: 1,
        unit: "LS",
        unitCost: task.allowance.amount,
        cost: task.allowance.amount,
        unitPrice: price,
        price,
        basis: "allowance",
        source: task.allowance.approved ? "Allowance approved by employee" : "Allowance pending approval",
        optional,
        allowance: true,
        notes: [],
      });
      if (!task.allowance.approved) {
        issue({
          key: `allowance:${task.id}`,
          taskId: task.id,
          kind: "allowance-unapproved",
          blocking,
          message: `Allowance for "${task.title}" must be approved.`,
        });
      }
      continue;
    }

    // 2. A written quote replaces the cost book price.
    if (task.quote && task.quote.amount > 0) {
      const item: ItemKey = task.performer === "supplier" ? "Project Materials" : entry ? itemForEntry(entry, ctx.service) : "Subcontractor Work";
      const price = sell(task.quote.amount);
      lines.push({
        id: `${task.id}:quote`,
        taskId: task.id,
        phase: task.phase,
        division: task.division,
        item: item === "Direct Labor" ? "Subcontractor Work" : item,
        description: description(task),
        quantity: 1,
        unit: "LS",
        unitCost: task.quote.amount,
        cost: task.quote.amount,
        unitPrice: price,
        price,
        basis: "written-quote",
        source: `Written quote${task.quote.vendor ? ` from ${task.quote.vendor}` : ""}`,
        optional,
        allowance: false,
        notes: [],
      });
      // A supplier quote is material only; P5's crew may still install it.
      if ((internal || task.performer === "supplier") && task.laborHours) needLabor(task, null, blocking);
      continue;
    }

    // 3. No cost book match and no quote.
    if (!entry) {
      if (internal && task.laborHours) {
        needLabor(task, null, blocking);
        if (task.materials?.length) {
          issue({
            key: `price:${task.id}`,
            taskId: task.id,
            kind: "unmatched-item",
            blocking,
            message: `Materials for "${task.title}" have no cost book match or quote.`,
          });
        }
        continue;
      }
      issue({
        key: `price:${task.id}`,
        taskId: task.id,
        kind: "unmatched-item",
        blocking,
        message: `"${task.title}" has no cost book match. Enter a quoted or known amount.`,
      });
      continue;
    }

    // 4. Percentage lines are computed after every other line.
    if (entry.percentage) {
      const rate = costBookRate(entry.code, ctx.finishTier, ctx.service);
      if (rate) percentTasks.push({ task, rate: rate.amount, source: rate.source, item: itemForEntry(entry, ctx.service) });
      continue;
    }

    // Handyman trip charge from the cost book: when a trip charge is set in
    // Pricing setup, that one is used and this task is not charged a second
    // time; otherwise it is priced here and credited below.
    if (ctx.service === "handyman" && entry.code === TRIP_CHARGE_CODE) {
      if ((settings.handymanTripCharge ?? 0) > 0) continue;
      tripTaskIds.add(task.id);
    }

    // 5. Cost book line.
    const rate = costBookRate(entry.code, ctx.finishTier, ctx.service)!;
    let qty = taskQuantity(task, doc, rate.unit);
    const laborOnlyInternal = internal && entry.costType === "Labor Only";
    const linked = task.quantity?.measurementId;
    const measurementKey = linked && doc.measurements.some((m) => m.id === linked) ? `measure:${linked}` : null;

    // P5's crew doing labor-only work is priced by hours alone; a quantity is
    // only needed when an approved production rate turns it into hours.
    if (laborOnlyInternal && !settings.productionRates[entry.code]) {
      needLabor(task, null, blocking);
      continue;
    }
    // A quantity in a different unit than the cost book rate cannot be priced
    // (linear feet against a per-square-foot rate). Ask for it in the right unit.
    let unitMismatch = false;
    if (qty.state !== "missing" && qty.unit.toUpperCase() !== rate.unit) {
      unitMismatch = true;
      qty = { state: "missing", unit: rate.unit };
    }
    if (qty.state === "missing") {
      issue({
        key: measurementKey && !unitMismatch ? measurementKey : `qty:${task.id}`,
        taskId: task.id,
        kind: "missing-quantity",
        blocking,
        message: unitMismatch
          ? `"${task.title}" is priced per ${rate.unit}, but its quantity is in a different unit. Enter it in ${rate.unit}.`
          : `"${task.title}" needs a quantity (${rate.unit}).`,
      });
      continue;
    }
    if (qty.state === "estimated") {
      issue({
        key: measurementKey ?? `qty:${task.id}`,
        taskId: task.id,
        kind: "estimated-quantity",
        blocking,
        message: `The quantity for "${task.title}" is an estimate and must be confirmed.`,
      });
    }

    const notes: string[] = [];
    if (laborOnlyInternal) {
      // P5's crew does the labor this line would have bought: replace it.
      needLabor(task, qty, blocking);
      continue;
    }

    const unitCost = rate.amount;
    const unitPrice = sell(unitCost);
    const quantity = round2(qty.value);
    if (entry.bundled && internal && task.laborHours?.value) {
      notes.push("Labor is included in this bundled cost book item; internal hours were not added.");
    }
    lines.push({
      id: `${task.id}:main`,
      taskId: task.id,
      phase: task.phase,
      division: task.division,
      item: itemForEntry(entry, ctx.service),
      description: description(task),
      quantity,
      unit: rate.unit,
      unitCost,
      cost: round2(unitCost * quantity),
      unitPrice,
      price: round2(unitPrice * quantity),
      basis: "cost-book",
      source: rate.source + (qty.state === "estimated" ? " (quantity estimated)" : ""),
      optional,
      allowance: Boolean(entry.allowance),
      notes,
    });
    if (entry.allowance && !task.allowance) {
      issue({
        key: `allowance:${task.id}`,
        taskId: task.id,
        kind: "allowance-unapproved",
        blocking,
        message: `"${task.title}" is priced as a cost book ${entry.allowance.toLowerCase()} and must be approved.`,
      });
    }
    // Material only: P5's crew installs it, so internal labor is added once.
    if (internal && entry.costType === "Material Only") needLabor(task, qty, blocking);
  }

  // Percentage lines: a share of construction direct cost in the base scope.
  const directBase = lines
    .filter((l) => !l.optional && l.phase === "construction")
    .reduce((s, l) => s + (l.cost ?? l.price / multiplier), 0);
  for (const p of percentTasks) {
    const cost = round2(directBase * p.rate);
    const price = round2(cost * multiplier);
    lines.push({
      id: `${p.task.id}:pct`,
      taskId: p.task.id,
      phase: p.task.phase,
      division: p.task.division,
      item: p.item,
      description: description(p.task),
      quantity: 1,
      unit: "LS",
      unitCost: cost,
      cost,
      unitPrice: price,
      price,
      basis: "percentage",
      source: `${p.source}: ${round2(p.rate * 100)}% of construction direct cost`,
      optional: p.task.bucket === "optional",
      allowance: false,
      notes: [],
    });
  }

  // Handyman trip charge. Owner rule: the trip charge is shown, then removed
  // from the total when the client moves forward with the work. The estimate
  // is the price of moving forward, so every trip charge on it carries an
  // equal credit and the two net to zero.
  if (ctx.service === "handyman" && lines.some((l) => !l.optional)) {
    const configured = settings.handymanTripCharge ?? 0;
    const tripLine = (id: string, text: string, amount: number, source: string): EstimateLine => ({
      id,
      taskId: "trip-charge",
      phase: "construction",
      division: "01",
      item: "Handyman Service Work",
      description: text,
      quantity: 1,
      unit: "EA",
      unitCost: 0,
      cost: 0,
      unitPrice: amount,
      price: amount,
      basis: "trip-charge",
      source,
      optional: false,
      allowance: false,
      notes: [],
    });
    if (configured > 0) {
      lines.push(tripLine("trip-charge:charge", "Trip charge", configured, "Handyman trip charge from Pricing setup, billed as is"));
    }
    const charged = round2(
      lines.filter((l) => !l.optional && (l.id === "trip-charge:charge" || tripTaskIds.has(l.taskId))).reduce((s, l) => s + l.price, 0),
    );
    if (charged > 0) {
      lines.push(
        tripLine(
          "trip-charge:credit",
          "Trip charge credit, applied because you are moving forward with this work",
          -charged,
          "Owner rule: the trip charge is removed from the total when the client moves forward",
        ),
      );
    }
  }

  // Cost book age.
  const ageDays = (now.getTime() - Date.parse(COST_BOOK_REVIEWED_AT)) / 86_400_000;
  if (ageDays > settings.priceMaxAgeDays && lines.some((l) => l.basis === "cost-book") && !ctx.acknowledged.has(costBookAgeKey())) {
    issue({
      key: costBookAgeKey(),
      kind: "outdated-price",
      blocking: true,
      message: `The cost book was last imported ${COST_BOOK_REVIEWED_AT}, more than ${settings.priceMaxAgeDays} days ago.`,
    });
  }

  const base = lines.filter((l) => !l.optional);
  const baseCostKnown = base.every((l) => l.cost !== null);
  const basePrice = round2(base.reduce((s, l) => s + l.price, 0));
  const baseCost = baseCostKnown ? round2(base.reduce((s, l) => s + (l.cost ?? 0), 0)) : null;

  // What stops cost and margin from being known, in plain counts.
  const unknown = base.filter((l) => l.cost === null);
  const costGaps = {
    laborHours: round2(unknown.filter((l) => l.basis === "internal-labor").reduce((s, l) => s + (l.laborHours ?? l.quantity), 0)),
    lines: unknown.filter((l) => l.basis !== "internal-labor").length,
  };

  // Where the money goes: direct cost, overhead, the reserve, and what is left.
  let profitCheck: ProfitCheck | null = null;
  if (baseCost !== null && basePrice > 0) {
    const grossProfit = round2(basePrice - baseCost);
    const overheadShare = round2(basePrice * overhead);
    // Only marked-up lines carry the reserve; P5 labor and the trip charge are billed as is.
    const reserve = round2(
      base.filter((l) => l.basis !== "internal-labor" && l.basis !== "trip-charge").reduce((s, l) => s + (l.cost ?? 0) * CONTINGENCY_RATE, 0),
    );
    const netProfit = round2(grossProfit - overheadShare - reserve);
    const netMargin = Math.round((netProfit / basePrice) * 10000) / 10000;
    const notes: string[] = [];
    const status: ProfitCheck["status"] =
      netMargin >= profit * 2 ? "high" : netMargin >= profit ? "on-target" : netMargin >= profit / 2 ? "thin" : "below";
    if (settings.laborLoadedCost !== null && settings.laborLoadedCost >= settings.laborRate) {
      notes.push(`P5 labor costs $${settings.laborLoadedCost}/hour and is billed at $${settings.laborRate}/hour, so every labor hour loses money.`);
    }
    const underwater = base.filter((l) => l.cost !== null && l.price < (l.cost ?? 0) && l.basis !== "trip-charge");
    if (underwater.length) notes.push(`${underwater.length} line${underwater.length === 1 ? " is" : "s are"} priced below cost: ${underwater.slice(0, 3).map((l) => l.description).join("; ")}.`);
    if (status === "below" || status === "thin") {
      // The price that would return the target profit with the same costs.
      const needed = round2((baseCost + reserve) / (1 - overhead - profit));
      if (needed > basePrice) notes.push(`To reach the ${Math.round(profit * 100)}% profit target with these costs the base estimate would need to be about $${needed.toLocaleString("en-US", { maximumFractionDigits: 0 })}.`);
    }
    if (status === "high") notes.push("Profit is more than double the target. Check the price against what the market will bear before sending.");
    profitCheck = { grossProfit, overhead: overheadShare, reserve, netProfit, netMargin, targetNetMargin: profit, status, notes };
  }

  return {
    lines,
    issues,
    totals: {
      costGaps,
      profit: profitCheck,
      baseCost,
      basePrice,
      optionalPrice: round2(lines.filter((l) => l.optional).reduce((s, l) => s + l.price, 0)),
      margin: baseCost !== null && basePrice > 0 ? Math.round(((basePrice - baseCost) / basePrice) * 10000) / 10000 : null,
      laborHours: round2(base.reduce((s, l) => s + (l.laborHours ?? 0), 0)),
    },
    policy: {
      overheadRate: overhead,
      profitRate: profit,
      contingencyRate: CONTINGENCY_RATE,
      laborRate: settings.laborRate,
      finishTier: ctx.finishTier,
      costBookSource: COST_BOOK_SOURCE,
      costBookVersion: COST_BOOK_VERSION,
    },
  };
}
