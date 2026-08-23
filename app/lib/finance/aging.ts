/**
 * Aging and the short-horizon cash forecast (S72, S99, S141).
 *
 * Pure, because these are the numbers people make payment decisions from and
 * an off-by-one in a bucket boundary is the kind of error that hides for
 * months. "Current" means not yet due; a thing due today is not overdue.
 */

import { roundMoney } from "./engines.ts";

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

/** Whole days from due date to as-of. Negative means not yet due. */
export function daysOverdue(dueDate: string | null, asOf: Date): number {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00Z`);
  const at = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  return Math.round((at.getTime() - due.getTime()) / 86_400_000);
}

export function agingBucket(dueDate: string | null, asOf: Date): AgingBucket {
  // No due date is not evidence of lateness; treat it as current rather than
  // inventing an overdue balance nobody can act on.
  if (!dueDate) return "current";
  const days = daysOverdue(dueDate, asOf);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export type AgeableItem = { dueDate: string | null; openBalance: number };

export type AgingSummary = {
  buckets: Record<AgingBucket, number>;
  total: number;
  /** Anything past due, i.e. everything except 'current'. */
  overdue: number;
  oldestDays: number;
};

export function summariseAging(items: AgeableItem[], asOf: Date): AgingSummary {
  const buckets: Record<AgingBucket, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  let oldestDays = 0;
  for (const item of items) {
    buckets[agingBucket(item.dueDate, asOf)] += item.openBalance;
    oldestDays = Math.max(oldestDays, daysOverdue(item.dueDate, asOf));
  }
  for (const key of AGING_BUCKETS) buckets[key] = roundMoney(buckets[key]);

  const total = roundMoney(AGING_BUCKETS.reduce((sum, k) => sum + buckets[k], 0));
  return {
    buckets,
    total,
    overdue: roundMoney(total - buckets.current),
    oldestDays: Math.max(0, oldestDays),
  };
}

// ---------------------------------------------------------------------------
// Short-horizon cash forecast
// ---------------------------------------------------------------------------

export type ForecastItem = {
  /** ISO date the money is expected to move. */
  date: string | null;
  amount: number;
  label: string;
};

export type ForecastWeek = {
  /** Monday of the week, ISO. */
  weekStart: string;
  inflow: number;
  outflow: number;
  net: number;
  /** Cash at the end of this week, carrying the opening balance forward. */
  closing: number;
};

function startOfWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday. Weeks start Monday, which is how the Money Run reads.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bucket expected movements into weeks and carry a running balance.
 *
 * Anything dated before the window - an overdue invoice, a late bill - lands in
 * the first week rather than being dropped. Money that is already late is the
 * most real money in the forecast, and silently excluding it would make the
 * position look better than it is.
 */
export function forecastWeeks(
  openingCash: number,
  inflows: ForecastItem[],
  outflows: ForecastItem[],
  weeks: number,
  asOf: Date,
): ForecastWeek[] {
  const firstWeek = startOfWeekUtc(asOf);
  const starts: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(firstWeek);
    d.setUTCDate(d.getUTCDate() + i * 7);
    starts.push(isoDate(d));
  }

  const lastStart = new Date(`${starts[starts.length - 1]}T00:00:00Z`);
  const horizonEnd = new Date(lastStart);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 7);

  const index = new Map<string, { inflow: number; outflow: number }>();
  for (const s of starts) index.set(s, { inflow: 0, outflow: 0 });

  const place = (item: ForecastItem, kind: "inflow" | "outflow"): void => {
    // Undated movements cannot be scheduled; excluding them is honest, and the
    // module says so rather than pretending the forecast is complete.
    if (!item.date) return;
    const when = new Date(`${item.date}T00:00:00Z`);
    if (when >= horizonEnd) return;
    const bucketStart = when < firstWeek ? starts[0] : isoDate(startOfWeekUtc(when));
    const bucket = index.get(bucketStart);
    if (bucket) bucket[kind] += item.amount;
  };

  for (const item of inflows) place(item, "inflow");
  for (const item of outflows) place(item, "outflow");

  let running = openingCash;
  return starts.map((weekStart) => {
    const b = index.get(weekStart)!;
    const inflow = roundMoney(b.inflow);
    const outflow = roundMoney(b.outflow);
    const net = roundMoney(inflow - outflow);
    running = roundMoney(running + net);
    return { weekStart, inflow, outflow, net, closing: running };
  });
}

/** The first week the balance goes negative, if any - the thing to act on. */
export function firstShortfall(weeks: ForecastWeek[]): ForecastWeek | null {
  return weeks.find((w) => w.closing < 0) ?? null;
}
