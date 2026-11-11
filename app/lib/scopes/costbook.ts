/**
 * The owner's cost book, as the scope platform uses it.
 *
 * Source: lib/p5/priceBookData.ts, generated from "P5 Cost Database 2026.xlsx".
 * Every amount there is a DIRECT COST (no overhead, contingency or profit);
 * the pricing engine applies the owner's margin policy once. Rates are priced
 * with the existing priceBookRate helper so a line here costs exactly what it
 * costs in the public estimator for the same tier and service.
 *
 * Server only: the price book is about 250 KB.
 */

import { PRICE_BOOK, PRICE_BOOK_SOURCE, type PriceBookRow } from "../../../lib/p5/priceBookData.ts";
import {
  PRICE_BOOK_VERSION,
  priceBookRate,
  serviceContext,
  type FinishTier,
} from "../../../lib/p5/priceBook.ts";
import type { ItemKey } from "./types.ts";

/**
 * Date the current cost book was imported (commit of lib/p5/priceBookData.ts).
 * The book itself carries no per-line dates, so age is measured from here.
 */
export const COST_BOOK_REVIEWED_AT = "2026-10-24";
export const COST_BOOK_SOURCE = PRICE_BOOK_SOURCE;
export const COST_BOOK_VERSION = PRICE_BOOK_VERSION;

export type CostBookEntry = {
  code: string;
  division: string;
  divisionName: string;
  section: string;
  item: string;
  uom: string;
  costType: string;
  allowance: string;
  /** Labor plus material (or equipment, disposal) priced together. */
  bundled: boolean;
  percentage: boolean;
};

const BUNDLED = new Set([
  "Labor + Material (Installed)",
  "Labor + Minor Materials",
  "Labor + Equipment",
  "Labor + Disposal",
]);

function entry(row: PriceBookRow): CostBookEntry {
  return {
    code: row[0],
    division: row[0].slice(0, 2),
    divisionName: row[1],
    section: row[2],
    item: row[3],
    uom: row[4],
    costType: row[5],
    allowance: row[6],
    bundled: BUNDLED.has(row[5]) || row[0].startsWith("90-"),
    percentage: row[5] === "Percentage",
  };
}

const ROWS = new Map<string, PriceBookRow>(PRICE_BOOK.map((r) => [r[0], r]));
const ENTRIES = new Map<string, CostBookEntry>(PRICE_BOOK.map((r) => [r[0], entry(r)]));

export function costBookEntry(code: string | null | undefined): CostBookEntry | null {
  if (!code) return null;
  return ENTRIES.get(code.replace(/^PB-/, "")) ?? null;
}

export function allCostBookEntries(): CostBookEntry[] {
  return [...ENTRIES.values()];
}

/** Direct cost per unit for this project (finish tier, remodel premium where it applies). */
export function costBookRate(
  code: string,
  tier: FinishTier,
  service: string,
): { amount: number; unit: string; source: string } | null {
  const row = ROWS.get(code.replace(/^PB-/, ""));
  if (!row) return null;
  if (row[5] === "Percentage") {
    const tierValue = { builder: row[10], mid: row[11], high: row[12], luxury: row[13] }[tier];
    return { amount: tierValue, unit: row[4], source: `${PRICE_BOOK_SOURCE}, ${row[0]} (percentage)` };
  }
  const rate = priceBookRate(row, tier, serviceContext(service).remodel);
  return { amount: rate.amount, unit: rate.unit, source: `${rate.source}, ${row[0]}` };
}

/**
 * Which P5 QuickBooks item a cost book line books to. The item carries the
 * account and cost group, so this is the whole of the line's coding.
 */
export function itemForEntry(e: CostBookEntry, service: string): ItemKey {
  const cabinetJob = service === "cabinet-product" || service === "cabinet-install";
  if (e.division === "00") {
    if (/permit|fee|impact|plan review|inspection/i.test(`${e.section} ${e.item}`)) return "Permits and Fees";
    return "Design and Preconstruction Services";
  }
  if (cabinetJob && e.division === "12") {
    if (/freight|delivery/i.test(e.item)) return "Cabinet Freight and Delivery";
    if (e.costType === "Material Only") return "Cabinet Product";
    return "Cabinet Installation";
  }
  if (service === "handyman" && !e.bundled && e.costType !== "Material Only") return "Handyman Service Work";
  if (/permit/i.test(e.item)) return "Permits and Fees";
  if (/freight|delivery/i.test(e.item) && e.costType !== "Labor Only") return "Freight and Delivery";
  switch (e.costType) {
    case "Material Only":
      return "Project Materials";
    case "Equipment / Service":
      return "Equipment and Rentals";
    case "Fee / Professional Service":
    case "Service Fee":
      return "Other Direct Cost";
    default:
      return "Subcontractor Work";
  }
}

/**
 * The catalog as compact text for the extraction model: one line per entry,
 * grouped by division. The model picks codes; the server re-validates them.
 */
export function catalogForPrompt(): string {
  const out: string[] = [];
  let division = "";
  for (const e of ENTRIES.values()) {
    if (e.division !== division) {
      division = e.division;
      out.push(`# ${e.division} ${e.divisionName}`);
    }
    out.push(`${e.code} | ${e.item} | ${e.uom} | ${e.costType}${e.allowance ? ` | ${e.allowance}` : ""}`);
  }
  return out.join("\n");
}

/** Cost book lines used for supporting-task suggestions (site protection, cleanup...). */
export function findEntries(pattern: RegExp, division?: string): CostBookEntry[] {
  return [...ENTRIES.values()].filter(
    (e) => (!division || e.division === division) && pattern.test(`${e.section} ${e.item}`),
  );
}
