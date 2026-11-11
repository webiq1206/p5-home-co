/**
 * Turn a scope into estimate lines. Deterministic: same scope, settings and
 * date give the same lines, so a saved version can always be re-derived.
 *
 * Margin policy is the owner's existing one (lib/p5/pricing.ts), not a copy:
 *   customer price = direct cost x (1 + contingency) / (1 - overhead - profit)
 * with the 20% unified overhead, the service's profit target and the 10%
 * project reserve. Cost book amounts are direct costs; a written quote is a
 * direct cost; internal labor follows the configured $125/hour treatment.
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
  ScopeDoc,
  ScopeSettings,
  ScopeTask,
} from "./types.ts";

export const CONTINGENCY_RATE = 0.1;

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

  const sell = (unitCost: number) => round2(unitCost * multiplier);

  const pushLabor = (task: ScopeTask, hours: number, basisNote: string) => {
    const rate = settings.laborRate;
    const billed = settings.laborTreatment !== "direct-cost";
    const unitPrice = billed ? rate : sell(rate);
    const unitCost = billed ? settings.laborLoadedCost : rate;
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
      source: `Internal labor at $${rate}/hour (${
        settings.laborTreatment === "direct-cost" ? "direct cost, markup applied" : "billed rate, no markup added"
      }); hours: ${basisNote}`,
      optional: task.bucket === "optional",
      allowance: false,
      laborHours: round2(hours),
      notes: [],
    });
    if (settings.laborTreatment === "unconfirmed") {
      issue({
        key: "labor-rate",
        kind: "labor-rate-unconfirmed",
        blocking: true,
        message:
          "Confirm once in Pricing setup whether $125/hour is the customer billed rate or P5's direct cost. Labor is shown as a billed rate until then.",
      });
    }
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

  return {
    lines,
    issues,
    totals: {
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
      laborTreatment: settings.laborTreatment,
      finishTier: ctx.finishTier,
      costBookSource: COST_BOOK_SOURCE,
      costBookVersion: COST_BOOK_VERSION,
    },
  };
}
