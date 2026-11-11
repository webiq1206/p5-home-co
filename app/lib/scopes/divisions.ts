/**
 * Phases and divisions for every scope.
 *
 * Phase 1 Pre-Construction and Phase 2 Construction, each organized by the
 * divisions of P5's cost book. The division codes, names and order below are
 * the ones in "P5 Cost Database 2026.xlsx" (lib/p5/priceBookData.ts), which
 * is the pricing source estimates are built from. A test asserts this list
 * matches the cost book exactly, so the two cannot drift.
 *
 * Verified 2026-11-11: the cost book runs 00 to 33 with gaps (15 to 20, 24,
 * 25, 29 and 30 are unused) plus 90 Project Assemblies, 25 divisions in all.
 * It is not a continuous 00 to 22 list. The QuickBooks side is checked live by
 * the setup check (app/lib/scopes/qbo.ts), because only the connected
 * QuickBooks company can say what exists there.
 *
 * Kept free of the price book import so the browser can use it cheaply.
 */

import type { PhaseId } from "./types.ts";

export type Division = { code: string; name: string };

export const DIVISIONS: Division[] = [
  { code: "00", name: "Pre-Construction & Fees" },
  { code: "01", name: "General Requirements" },
  { code: "02", name: "Existing Conditions" },
  { code: "03", name: "Concrete" },
  { code: "04", name: "Masonry" },
  { code: "05", name: "Metals" },
  { code: "06", name: "Wood & Carpentry" },
  { code: "07", name: "Thermal & Moisture Protection" },
  { code: "08", name: "Openings" },
  { code: "09", name: "Finishes" },
  { code: "10", name: "Specialties" },
  { code: "11", name: "Equipment & Appliances" },
  { code: "12", name: "Casework, Cabinets & Countertops" },
  { code: "13", name: "Special Construction" },
  { code: "14", name: "Conveying Equipment" },
  { code: "21", name: "Fire Suppression" },
  { code: "22", name: "Plumbing" },
  { code: "23", name: "HVAC" },
  { code: "26", name: "Electrical" },
  { code: "27", name: "Low Voltage, Networking & A/V" },
  { code: "28", name: "Electronic Safety & Security" },
  { code: "31", name: "Earthwork" },
  { code: "32", name: "Exterior Improvements" },
  { code: "33", name: "Site Utilities" },
  { code: "90", name: "Project Assemblies" },
];

export const PHASES: { id: PhaseId; number: number; name: string }[] = [
  { id: "pre-construction", number: 1, name: "Pre-Construction" },
  { id: "construction", number: 2, name: "Construction" },
];

const BY_CODE = new Map(DIVISIONS.map((d) => [d.code, d]));

export function divisionName(code: string): string {
  return BY_CODE.get(code)?.name ?? `Division ${code}`;
}

export function isDivision(code: string): boolean {
  return BY_CODE.has(code);
}

export function divisionLabel(code: string): string {
  return `${code} ${divisionName(code)}`;
}

export function phaseName(id: PhaseId): string {
  const phase = PHASES.find((p) => p.id === id)!;
  return `Phase ${phase.number}: ${phase.name}`;
}

/** Division 00 is pre-construction work; everything else defaults to construction. */
export function defaultPhase(division: string): PhaseId {
  return division === "00" ? "pre-construction" : "construction";
}

/** Sort key for phase then division in cost book order. */
export function divisionOrder(code: string): number {
  const i = DIVISIONS.findIndex((d) => d.code === code);
  return i === -1 ? 999 : i;
}

/** Group anything with phase and division into phase -> division buckets, in order. */
export function groupByPhaseDivision<T extends { phase: PhaseId; division: string }>(
  items: T[],
): { phase: PhaseId; divisions: { code: string; items: T[] }[] }[] {
  return PHASES.map((p) => {
    const inPhase = items.filter((i) => i.phase === p.id);
    const codes = [...new Set(inPhase.map((i) => i.division))].sort(
      (a, b) => divisionOrder(a) - divisionOrder(b),
    );
    return {
      phase: p.id,
      divisions: codes.map((code) => ({ code, items: inPhase.filter((i) => i.division === code) })),
    };
  }).filter((g) => g.divisions.length > 0);
}

const UNIT_LABELS: Record<string, string> = {
  LF: "linear feet (LF)",
  SF: "square feet (SF)",
  EA: "each (EA)",
  HR: "hours (HR)",
  SQ: "roofing squares (SQ, 100 SF)",
  CY: "cubic yards (CY)",
  TON: "tons",
  DAY: "days",
  MO: "months",
  RL: "rolls",
  AC: "acres",
  W: "watts",
  LS: "lump sum",
};

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}
