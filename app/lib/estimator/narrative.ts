/**
 * The range and the words on a customer's estimate. Server only, pure.
 *
 * Nothing here is written freehand per estimate. Every sentence is selected
 * by a fact in the priced scope: which divisions have lines, which quantities
 * came from a typical dimension, which lines are allowances, what kind of
 * building the work is in, whether an address was given. Change the scope and
 * the words change with it; a sentence cannot describe work that has no line.
 *
 * THE RANGE
 * A preliminary estimate is shown as a range. Its width is not a number
 * picked here. It is the owner's existing rule for estimate bands
 * (lib/p5/pricing.ts, owner rule 2026-09-21), applied to the risks this
 * project actually carries:
 *
 *   priced line by line from the cost book   5% each way, plus 1% for each
 *                                            risk present, never over 8%
 *   priced from a whole-project rate         20% each way, plus 1.5% for
 *                                            each risk present, never over 50%
 *
 * The second row is that rule's "medium uncertainty" band: a budgetary figure
 * comes from one rate per square foot with no drawings, which is not the
 * line-by-line pricing the tight band was approved for. Which uncertainty
 * level budgetary projects should use is the owner's call; medium is the
 * middle one.
 */

import type { RiskFactor } from "../../../lib/p5/pricing.ts";
import { divisionName } from "../scopes/divisions.ts";
import type { EstimateLine, ScopeTask } from "../scopes/types.ts";
import type { BrandConfig } from "./brands.ts";
import type { Answers, CustomerDivision, EstimateClass, EstimateGuide, PropertyFacts } from "./types.ts";

export type NarrativeInput = {
  brand: Pick<BrandConfig, "name" | "phoneDisplay">;
  project: string;
  projectTitle: string;
  service: string;
  estimateClass: EstimateClass;
  answers: Answers;
  summary: string[];
  tasks: ScopeTask[];
  lines: EstimateLine[];
  assumptions: string[];
  exclusions: string[];
  address: string | null;
  property: PropertyFacts | null;
};

const EXISTING_HOME = new Set(["kitchen", "bathroom", "remodel", "whole-home", "addition"]);
const GROUND_UP = new Set(["new-construction", "adu", "addition"]);

/** The risks this project carries, from facts in the scope. Each one is explained to the customer. */
export function projectRisks(input: Pick<NarrativeInput, "service" | "estimateClass" | "answers" | "tasks" | "address" | "project">): RiskFactor[] {
  const risks: RiskFactor[] = [];
  const estimated = input.tasks.some((t) => t.quantity?.estimated);
  if (estimated || input.estimateClass === "budgetary") risks.push("incomplete-plans");
  if (EXISTING_HOME.has(input.service) && input.project !== "interior-paint") risks.push("hidden-conditions");
  const movesServices =
    input.answers.scope === "redesign" || input.answers.scope === "relocate" || (input.project === "basement-finish" && input.answers.bath === "yes") || GROUND_UP.has(input.service);
  if (movesServices) risks.push("unknown-utilities");
  if (GROUND_UP.has(input.service) || input.project === "garage-shop") risks.push("soil-slope");
  if (!input.address) risks.push("jurisdiction-uncertain");
  return risks;
}

export function rangeWidth(estimateClass: EstimateClass, risks: RiskFactor[]): number {
  return estimateClass === "budgetary" ? Math.min(0.5, 0.2 + risks.length * 0.015) : Math.min(0.08, 0.05 + risks.length * 0.01);
}

const down = (n: number) => Math.floor(n / 10) * 10;
const up = (n: number) => Math.ceil(n / 10) * 10;

/**
 * Division ranges, and a total that is exactly their sum. Each division's
 * priced lines are widened by the same band and rounded outward to $10, so
 * the breakdown always reconciles with the headline range.
 */
export type DivisionSplit = (line: EstimateLine) => { division: string; texts: string[]; price: number }[] | null;

/**
 * `split` spreads a whole-project line across the divisions it is made of
 * (shares.ts). The pieces add up to the line's price, so the total does not
 * move. `shares` lists the wording that came from a split, not from a line.
 */
export function divisionRanges(lines: EstimateLine[], width: number, split?: DivisionSplit): { divisions: CustomerDivision[]; low: number; high: number; shares: string[] } {
  const allowanceTasks = new Set(lines.filter((l) => l.allowance).map((l) => l.taskId));
  const byDivision = new Map<string, { cents: number; items: CustomerDivision["items"] }>();
  const shares: string[] = [];
  const at = (code: string) => {
    if (!byDivision.has(code)) byDivision.set(code, { cents: 0, items: [] });
    return byDivision.get(code)!;
  };
  for (const line of lines) {
    const pieces = split?.(line) ?? null;
    if (pieces) {
      for (const piece of pieces) {
        const entry = at(piece.division);
        entry.cents += Math.round(piece.price * 100);
        for (const text of piece.texts) {
          if (!entry.items.some((i) => i.text === text)) entry.items.push({ text, quantity: 1, unit: "LS", allowance: false });
          if (!shares.includes(text)) shares.push(text);
        }
      }
      continue;
    }
    const entry = at(line.division);
    entry.cents += Math.round(line.price * 100);
    // The handyman trip charge and its equal credit are arithmetic, not scope.
    if (line.basis !== "trip-charge") entry.items.push({ text: line.description, quantity: line.quantity, unit: line.unit, allowance: allowanceTasks.has(line.taskId) });
  }
  const divisions = [...byDivision.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, entry]) => ({
      code,
      name: divisionName(code),
      low: Math.max(0, down((entry.cents / 100) * (1 - width))),
      high: up((entry.cents / 100) * (1 + width)),
      items: entry.items,
    }))
    .filter((d) => d.items.length > 0);
  return { divisions, low: divisions.reduce((s, d) => s + d.low, 0), high: divisions.reduce((s, d) => s + d.high, 0), shares };
}

/** Shown with a breakdown built from shares, so nobody reads a share as a quote for that trade. */
export const SHARE_NOTE =
  "This project is priced as a whole from our cost book. The division amounts show how a budget of this kind is typically spread across the work. They are indicative shares, not separate quotes, and they are replaced by a detailed breakdown once drawings and selections are defined.";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What the finished project gives the homeowner, from their selections. Plain, no sales claims. */
function outcome(input: NarrativeInput): string[] {
  const a = input.answers;
  const has = (code: string) => input.tasks.some((t) => t.costCode === code);
  const out: string[] = [];
  switch (input.project) {
    case "kitchen-remodel":
      if (a.scope === "refresh") out.push("Your existing cabinets with a new sprayed finish and new hardware, under new countertops and a new backsplash.");
      else out.push(a.scope === "redesign" ? "A kitchen rebuilt on a new layout, with plumbing and electrical moved to suit it." : "A new kitchen in the same layout: new cabinets, countertops, backsplash, sink and faucet.");
      if (has("12-32-06")) out.push("A new island of about 8 ft with power and pendant lighting.");
      if (has("26-50-03")) out.push("Under-cabinet and recessed lighting.");
      if (a.floor && a.floor !== "keep") out.push("New flooring through the kitchen.");
      out.push(has("11-31-01") ? "A new appliance package, priced as an allowance." : "Your appliances reinstalled once the kitchen is finished.");
      break;
    case "bathroom-remodel":
      if (a.scope === "refresh") out.push("A refreshed bathroom: new vanity, toilet, faucet, lighting and fan, with fresh paint.");
      else {
        out.push("A bathroom rebuilt from the studs: new drywall, tile, vanity, toilet, lighting and fan.");
        if (has("09-30-05")) out.push(has("09-30-06") ? "A curbless tiled shower with no step at the entry, a linear drain and glass." : "A walk-in tiled shower with a waterproofed pan, niche and glass enclosure.");
        if (has("22-41-26")) out.push("A new bathtub with a tiled surround and shower.");
        if (has("22-40-01")) out.push("A freestanding soaking tub with its own filler.");
        if (a.scope === "relocate") out.push("Fixtures moved to a new layout within the existing room.");
      }
      break;
    case "basement-finish":
      out.push("Your unfinished basement turned into finished living space.");
      if (has("90-30-08")) out.push("A new basement bathroom.");
      if (has("90-45-05")) out.push("A basement bar.");
      break;
    case "whole-home":
      out.push("A renovation of the home's interior at the finish level you chose.");
      break;
    case "flooring":
      out.push("New flooring installed across the area you entered, with transitions at doorways.");
      if (has("06-20-01")) out.push("New painted baseboards.");
      break;
    case "interior-paint":
      out.push("Freshly painted walls in the rooms you counted.");
      if (has("09-91-03")) out.push("Ceilings painted as well.");
      if (has("09-01-19")) out.push("Trim caulked and painted.");
      break;
    case "kitchen-cabinets":
      out.push("New kitchen cabinets, designed for your room and installed, with hardware.");
      if (has("12-36-12")) out.push("New countertops, with your sink, faucet and disposal reinstalled.");
      break;
    case "bathroom-vanity":
      out.push("A new vanity installed and connected, with a new faucet.");
      break;
    case "cabinet-refresh":
      out.push("Your existing cabinets given a new finish.");
      if (has("12-38-02")) out.push("New pulls and knobs.");
      break;
    case "built-ins":
      out.push("A built-in made to fit your wall and installed.");
      break;
    case "handyman":
      out.push("The jobs on your list completed in one visit where possible.");
      break;
    case "custom-home":
      out.push("A new home built on your lot at the finish level you chose.");
      if (has("90-10-03")) out.push("An attached garage.");
      if (has("90-10-04") || has("90-10-05")) out.push(has("90-10-05") ? "A finished basement." : "An unfinished basement.");
      break;
    case "addition":
      out.push("New space added to your home and tied into the existing house.");
      break;
    case "garage-shop":
      out.push("A new detached garage or shop.");
      break;
    case "adu":
      out.push("A complete accessory dwelling unit on your property.");
      break;
  }
  return out;
}

/**
 * Work that may or may not be needed. It is neither in the range nor ruled
 * out: nobody can say until it is looked at. Kept apart from exclusions on
 * purpose, because "we have not checked" is not "we will not do it".
 */
function undetermined(input: NarrativeInput, risks: RiskFactor[]): string[] {
  const out: string[] = [];
  const hasPermit = input.tasks.some((t) => String(t.costCode ?? "").startsWith("00-20"));
  if (risks.includes("hidden-conditions")) out.push("Repairs to framing, plumbing or wiring found once walls and floors are opened.");
  if (EXISTING_HOME.has(input.service) && !input.property?.yearBuilt && ["kitchen-remodel", "bathroom-remodel", "whole-home", "basement-finish"].includes(input.project)) {
    out.push("Lead-safe work practices, which are required if the home was built before 1978.");
  }
  if (input.project === "handyman") out.push("Repairs to hidden damage found once a job is opened up.", "A permit, if one of the jobs turns out to need one.");
  if (input.project === "flooring") out.push("Subfloor repair or leveling, if the subfloor is not flat and sound once the old floor is up.");
  if (!hasPermit && input.project !== "handyman" && input.project !== "interior-paint") out.push("Permits, if your jurisdiction requires one for this work.");
  if (input.answers.scope === "redesign" || input.answers.scope === "relocate") out.push("An electrical panel or service upgrade, if the existing service cannot carry the new layout.");
  if (input.project === "basement-finish") out.push("Egress windows, moisture control or added ceiling height, if the basement needs them to become living space.");
  if (GROUND_UP.has(input.service) || input.project === "garage-shop") out.push("Site work beyond a typical lot, such as rock, poor soils, a steep grade or long utility runs.");
  return out;
}

function verification(input: NarrativeInput, risks: RiskFactor[]): string[] {
  const out: string[] = [];
  const estimated = input.tasks.some((t) => t.quantity?.estimated);
  const allowances = input.lines.filter((l) => l.allowance).length;
  if (estimated) out.push("Field measurements. Quantities come from typical dimensions for the size you chose; measured quantities can raise or lower the price.");
  if (input.estimateClass === "budgetary") out.push("Drawings and a defined scope. A budgetary range becomes a detailed price once the design is known.");
  if (allowances) out.push("Your material and fixture selections. The range uses an allowance at your finish level until you choose.");
  if (risks.includes("hidden-conditions")) out.push("Existing conditions. We look at structure, plumbing and wiring in person before pricing is final.");
  if (risks.includes("unknown-utilities")) out.push("Utility locations and capacity, which decide how far plumbing, electrical and mechanical work has to reach.");
  if (risks.includes("soil-slope")) out.push("The building site: soils, grade, access and setbacks.");
  if (risks.includes("jurisdiction-uncertain")) out.push("The property address, which sets the jurisdiction and its permit requirements.");
  else if (input.project !== "handyman" && input.project !== "interior-paint" && input.project !== "flooring") out.push("Permit requirements for your jurisdiction.");
  if (input.property && !input.property.confirmed) out.push("The public property record used for this estimate, which has not been confirmed on site.");
  // Even a counted list is priced unseen.
  if (!out.length) out.push("The condition of the surfaces and the access to the work, which we confirm before final pricing.");
  return out;
}

const DRIVER: Partial<Record<RiskFactor, string>> = {
  "incomplete-plans": "Size and quantities. This estimate uses typical dimensions, not measurements of your home.",
  "hidden-conditions": "What is behind the walls and under the floor. Older or altered homes sometimes need repairs that cannot be seen yet.",
  "unknown-utilities": "How far plumbing, electrical and mechanical work has to run from what exists today.",
  "soil-slope": "Site conditions: soil, slope, access and the distance to utilities.",
  "jurisdiction-uncertain": "Local permit and code requirements, which depend on the property's address.",
};

export function buildGuide(input: NarrativeInput, divisions: CustomerDivision[], range: { low: number; high: number } | null, risks: RiskFactor[], shares: string[] = []): EstimateGuide {
  const allowances = input.lines.filter((l) => l.allowance).length;
  const estimated = input.tasks.some((t) => t.quantity?.estimated);
  const basis: string[] = [];
  if (input.property) basis.push(`public property records (${input.property.source})`);
  basis.push("the selections you made");
  basis.push(estimated ? "typical dimensions for the size you chose" : input.estimateClass === "budgetary" ? "the size you entered" : "the quantities you entered");
  basis.push(`${input.brand.name}'s construction cost book`);
  const overview = [
    `This estimate covers ${/^[aeiou]/i.test(input.projectTitle) ? "an" : "a"} ${lower(input.projectTitle)}${input.address ? ` at ${input.address}` : ""}. You selected: ${input.summary.join("; ")}.`,
    range ? `The preliminary range is ${money(range.low)} to ${money(range.high)}.` : "Our team is reviewing this project before giving you a range.",
    `It was developed from ${basis.slice(0, -1).join(", ")} and ${basis.at(-1)}.`,
    input.estimateClass === "budgetary"
      ? "It is an early budgeting range. It narrows as drawings, site conditions and selections are defined."
      : "It is an initial budgeting range. It narrows once we have measured, seen the existing conditions and confirmed your selections.",
  ];
  if (shares.length) overview.push(SHARE_NOTE);
  const costDrivers = risks.map((r) => DRIVER[r]).filter((d): d is string => Boolean(d));
  if (allowances) costDrivers.push("The materials and fixtures you choose. Selections above or below the allowance move the price with them.");
  return {
    overview,
    // A whole-project line is what was priced; its shares only describe where the money goes.
    included: shares.length
      ? [
          { division: "Priced as a whole project", items: input.lines.filter((l) => l.basis !== "trip-charge").map((l) => l.description) },
          ...divisions.map((d) => ({ division: `Division ${d.code}: ${d.name}`, items: d.items.map((i) => i.text) })),
        ]
      : divisions.map((d) => ({ division: `Division ${d.code}: ${d.name}`, items: d.items.map((i) => i.text) })),
    outcome: outcome(input),
    assumptions: input.assumptions,
    excluded: input.exclusions,
    undetermined: undetermined(input, risks),
    verification: verification(input, risks),
    costDrivers,
    disclaimer: [
      "This estimate is based on the information available today. Property conditions and measurements have not been independently verified.",
      "Material selections, engineering, permitting and site conditions may change the final price.",
      "It is provided for preliminary budgeting and planning. The range is not a guaranteed or binding construction price.",
      "It is not a construction contract and does not authorize any work to begin. Final pricing and obligations are set only in a separate written agreement.",
    ],
  };
}

/** Wording that must never reach a customer: vague references and casual or promotional phrases. */
export const BANNED_WORDING = /\b(down there|up there|over here|over there|that space|heads[- ]up|crystal ball|handy estimator|ballpark)\b/i;

/**
 * Check the customer's words against the priced scope before they are shown.
 * Returns every problem found; an empty list means the estimate is coherent.
 */
export function narrativeProblems(guide: EstimateGuide, divisions: CustomerDivision[], range: { low: number; high: number } | null, lines: EstimateLine[], shares: string[] = []): string[] {
  const problems: string[] = [];
  const priced = new Set([...lines.map((l) => l.description), ...shares]);
  for (const group of guide.included) for (const item of group.items) if (!priced.has(item)) problems.push(`"${item}" is described as included but has no priced line.`);
  const includedText = guide.included.flatMap((g) => g.items).map((i) => i.toLowerCase());
  for (const text of [...guide.excluded, ...guide.undetermined]) if (includedText.includes(text.toLowerCase())) problems.push(`"${text}" is listed as both included and not included.`);
  for (const text of guide.excluded) if (guide.undetermined.includes(text)) problems.push(`"${text}" is listed as both excluded and not yet determined.`);
  if (range) {
    if (!(range.low > 0 && range.high > range.low)) problems.push("The range is not a valid low-to-high range.");
    if (divisions.reduce((s, d) => s + d.low, 0) !== range.low || divisions.reduce((s, d) => s + d.high, 0) !== range.high) problems.push("Division ranges do not add up to the total range.");
    if (divisions.some((d) => d.low > d.high || d.items.length === 0)) problems.push("A division has an invalid range or no work in it.");
    if (new Set(divisions.map((d) => d.code)).size !== divisions.length) problems.push("A division appears twice.");
  }
  const everything = [...guide.overview, ...guide.outcome, ...guide.assumptions, ...guide.excluded, ...guide.undetermined, ...guide.verification, ...guide.costDrivers, ...guide.disclaimer, ...includedText];
  for (const text of everything) if (BANNED_WORDING.test(text)) problems.push(`Unprofessional or vague wording: "${text}".`);
  if (!guide.disclaimer.length || !guide.overview.length) problems.push("The preliminary pricing qualifications are missing.");
  return problems;
}
