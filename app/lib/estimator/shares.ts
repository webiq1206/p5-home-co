/**
 * Division shares for projects priced from one whole-project rate.
 *
 * New homes, additions, ADUs, garages, basements and whole-home renovations
 * are priced from a single cost book assembly (Division 90): one rate per
 * square foot, or one figure per project. That figure is the owner's, and it
 * stays the price. Nothing in this file can raise or lower a total.
 *
 * What this file does is show the customer how that figure is spread across
 * the construction divisions. For each kind of project it lists typical cost
 * book component lines with typical quantities per square foot, prices them
 * from the cost book at the customer's finish level, and uses the PROPORTIONS
 * between divisions to split the assembly price. Component prices are the
 * owner's; the quantities per square foot are typical-building ratios chosen
 * here, and they need the owner's review like the recipes do.
 *
 * So a division amount on a budgetary estimate is an indicative share of the
 * whole-project budget, and the estimate says so. It is not a takeoff, and
 * no trade should be quoted from it.
 */

import { costBookRate } from "../scopes/costbook.ts";
import type { Tier } from "./types.ts";

type Part = [code: string, quantityPerSquareFoot: number];
type Share = { division: string; text: string; parts: Part[] };

/** A typical new house, per square foot of living area (ratios taken at about 2,200 sq ft). */
const HOUSE: Share[] = [
  { division: "31", text: "Excavation and site preparation", parts: [["31-20-01", 1 / 2200]] },
  { division: "03", text: "Foundation and concrete", parts: [["03-30-03", 0.75]] },
  { division: "06", text: "Framing, roof structure and interior trim", parts: [["06-10-01", 1], ["06-20-01", 0.3], ["06-20-23", 1 / 170]] },
  { division: "07", text: "Roofing, siding and insulation", parts: [["07-31-01", 0.011], ["07-46-02", 0.9], ["07-21-01", 0.9], ["07-21-02", 0.75]] },
  { division: "08", text: "Windows and doors", parts: [["08-51-01", 1 / 160], ["08-16-01", 2 / 2200], ["08-14-01", 1 / 170]] },
  { division: "09", text: "Drywall, paint and flooring", parts: [["09-29-01", 3.4], ["09-91-01", 1], ["09-65-01", 0.6], ["09-68-01", 0.3], ["09-30-01", 0.1]] },
  { division: "12", text: "Cabinets, countertops and vanities", parts: [["12-31-01", 30 / 2200], ["12-36-02", 60 / 2200], ["12-41-01", 3 / 2200]] },
  { division: "22", text: "Plumbing and fixtures", parts: [["22-10-01", 1], ["22-41-01", 3 / 2200], ["22-41-26", 2 / 2200], ["22-41-08", 4 / 2200], ["22-41-20", 1 / 2200]] },
  { division: "23", text: "Heating and cooling", parts: [["23-81-01", 1]] },
  { division: "26", text: "Electrical and lighting", parts: [["26-20-01", 1], ["26-50-05", 1], ["26-20-02", 1 / 2200]] },
];

const without = (shares: Share[], ...divisions: string[]) => shares.filter((s) => !divisions.includes(s.division));

/** Added space with no kitchen of its own. */
const ADDITION: Share[] = [{ division: "02", text: "Opening and tying into the existing home", parts: [["02-41-02", 0.15]] }, ...without(HOUSE, "12")];

/** A garage or shop: slab, shell, garage doors and basic power. Per square foot of floor. */
const GARAGE: Share[] = [
  { division: "31", text: "Excavation and site preparation", parts: [["31-20-01", 1 / 1200]] },
  { division: "03", text: "Concrete slab and footings", parts: [["03-35-02", 1], ["03-30-01", 0.17]] },
  { division: "06", text: "Framing and roof structure", parts: [["06-10-04", 1.5], ["06-17-02", 1], ["06-10-08", 1.1]] },
  { division: "07", text: "Roofing and siding", parts: [["07-31-01", 0.011], ["07-46-02", 1.5]] },
  { division: "08", text: "Garage doors and entry door", parts: [["08-36-01", 1 / 576], ["08-36-02", 1 / 576], ["08-16-09", 1 / 576]] },
  { division: "09", text: "Fire-rated drywall", parts: [["09-29-05", 2.5]] },
  { division: "26", text: "Electrical and lighting", parts: [["26-20-06", 1 / 576], ["26-27-01", 8 / 576], ["26-51-12", 4 / 576]] },
];

/** An unfinished basement under a new home: dig it, pour it. Per square foot of basement. */
const BASEMENT_SHELL: Share[] = [
  { division: "31", text: "Basement excavation", parts: [["31-20-02", 0.33]] },
  { division: "03", text: "Basement walls and slab", parts: [["03-30-04", 0.8], ["03-35-03", 1], ["03-35-04", 1]] },
  { division: "07", text: "Foundation wall insulation", parts: [["07-21-13", 0.8]] },
];

/** Finishing an existing basement or shell space. Per square foot finished. */
const INTERIOR_FINISH: Share[] = [
  { division: "06", text: "Wall framing, door trim and baseboard", parts: [["06-10-05", 0.16], ["06-20-01", 0.3], ["06-20-23", 1 / 200]] },
  { division: "07", text: "Insulation", parts: [["07-21-01", 0.7], ["07-21-06", 0.3]] },
  { division: "08", text: "Interior doors", parts: [["08-14-01", 1 / 200]] },
  { division: "09", text: "Drywall, paint and flooring", parts: [["09-29-01", 3], ["09-91-01", 1], ["09-68-01", 0.7], ["09-65-01", 0.3]] },
  { division: "23", text: "Heating and cooling runs", parts: [["23-31-05", 1 / 150], ["23-31-06", 1 / 600]] },
  { division: "26", text: "Electrical and lighting", parts: [["26-27-01", 1 / 40], ["26-50-01", 1 / 55], ["26-27-02", 1 / 400]] },
];

/** A bathroom added below the sewer line. One bathroom. */
const BASEMENT_BATH: Share[] = [
  { division: "03", text: "Slab trenching and patching for drains", parts: [["03-40-03", 15], ["03-35-07", 15]] },
  { division: "06", text: "Wall framing", parts: [["06-10-05", 20]] },
  { division: "09", text: "Tile, drywall and paint", parts: [["09-30-01", 35], ["09-30-04", 70], ["09-29-04", 70], ["09-29-01", 250], ["09-91-07", 1]] },
  { division: "12", text: "Vanity", parts: [["12-41-01", 1]] },
  { division: "22", text: "Plumbing, ejector pump and fixtures", parts: [["22-13-04", 1], ["22-10-03", 3], ["22-41-01", 1], ["22-42-01", 1], ["22-40-04", 1], ["22-41-08", 1], ["22-42-02", 1]] },
  { division: "26", text: "Electrical, lighting and fan", parts: [["26-27-06", 1], ["26-27-02", 1], ["26-27-01", 3], ["26-50-01", 2]] },
];

const BAR: Share[] = [
  { division: "12", text: "Bar cabinets and countertop", parts: [["12-44-08", 8], ["12-36-02", 20]] },
  { division: "22", text: "Bar sink and plumbing", parts: [["22-10-02", 1], ["22-41-22", 1], ["22-41-06", 1]] },
  { division: "26", text: "Electrical and lighting", parts: [["26-27-02", 1], ["26-27-01", 3], ["26-51-01", 2]] },
  { division: "09", text: "Backsplash tile", parts: [["09-30-07", 16]] },
];

/** A whole-home renovation: interiors renewed, structure and shell kept. Per square foot. */
const RENOVATION: Share[] = [
  { division: "01", text: "Protection and cleaning", parts: [["01-50-10", 1], ["01-74-05", 1]] },
  { division: "02", text: "Interior demolition", parts: [["02-41-02", 0.5]] },
  { division: "06", text: "Interior trim", parts: [["06-20-01", 0.3], ["06-20-23", 1 / 170]] },
  { division: "08", text: "Interior doors", parts: [["08-14-01", 1 / 170]] },
  { division: "09", text: "Drywall repair, paint, tile and flooring", parts: [["09-01-06", 0.4], ["09-91-01", 1], ["09-65-01", 0.6], ["09-68-01", 0.3], ["09-30-01", 0.1], ["09-30-04", 0.07]] },
  { division: "12", text: "Kitchen cabinets, countertops and vanities", parts: [["12-31-01", 30 / 2000], ["12-36-02", 60 / 2000], ["12-41-01", 3 / 2000]] },
  { division: "22", text: "Plumbing fixtures", parts: [["22-10-02", 8 / 2000]] },
  { division: "26", text: "Lighting and electrical devices", parts: [["26-50-05", 1], ["26-01-04", 1 / 25], ["26-50-01", 1 / 80]] },
];

/** A garage turned into a dwelling: finish the shell, add a bathroom and a kitchenette. */
const CONVERSION: Share[] = [
  ...INTERIOR_FINISH.map((s) => ({ ...s, parts: s.parts.map(([code, q]) => [code, q * 480] as Part) })),
  ...BASEMENT_BATH.filter((s) => s.division !== "03"),
  { division: "12", text: "Kitchenette cabinets and countertop", parts: [["12-31-01", 10], ["12-36-02", 20]] },
  { division: "08", text: "Windows and entry door in place of the garage door", parts: [["08-51-01", 3], ["08-16-01", 1]] },
  { division: "23", text: "Heating and cooling", parts: [["23-81-03", 1]] },
];

/** Assembly line to the profile that describes how its figure is spread. */
const PROFILES: Record<string, Share[]> = {
  "90-10-01": HOUSE,
  "90-10-03": GARAGE,
  "90-10-04": BASEMENT_SHELL,
  "90-10-05": [...BASEMENT_SHELL, ...INTERIOR_FINISH],
  "90-40-01": RENOVATION,
  "90-40-02": INTERIOR_FINISH,
  "90-30-08": BASEMENT_BATH,
  "90-45-05": BAR,
  "90-50-01": ADDITION,
  "90-50-04": ADDITION,
  "90-50-05": [{ division: "02", text: "Opening and tying into the existing home", parts: [["02-41-02", 0.15]] }, ...HOUSE],
  "90-50-06": without(ADDITION, "31", "03"),
  "90-50-08": ADDITION,
  "90-50-12": GARAGE,
  "90-50-13": GARAGE,
  "90-50-09": CONVERSION,
  "90-50-10": HOUSE,
  "90-50-11": HOUSE,
};

export function hasShareProfile(code: string | null | undefined): boolean {
  return Boolean(code && PROFILES[code]);
}

export function shareProfileCodes(): string[] {
  return Object.keys(PROFILES);
}

/**
 * Split one assembly price across divisions. The pieces are in cents and add
 * up to the price exactly; the last piece takes the rounding remainder.
 * Returns null when a component cannot be priced, so the caller keeps the
 * single assembly line rather than showing a guess.
 */
export function splitByDivision(code: string, price: number, tier: Tier, service: string): { division: string; texts: string[]; price: number }[] | null {
  const profile = PROFILES[code];
  if (!profile) return null;
  const merged = new Map<string, { text: string[]; weight: number }>();
  for (const share of profile) {
    let weight = 0;
    for (const [part, quantity] of share.parts) {
      const rate = costBookRate(part, tier, service);
      if (!rate || !(rate.amount > 0)) return null;
      weight += rate.amount * quantity;
    }
    const entry = merged.get(share.division) ?? { text: [], weight: 0 };
    if (!entry.text.includes(share.text)) entry.text.push(share.text);
    entry.weight += weight;
    merged.set(share.division, entry);
  }
  const total = [...merged.values()].reduce((s, e) => s + e.weight, 0);
  if (!(total > 0)) return null;
  const cents = Math.round(price * 100);
  const divisions = [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let used = 0;
  return divisions.map(([division, entry], index) => {
    const piece = index === divisions.length - 1 ? cents - used : Math.round((cents * entry.weight) / total);
    used += piece;
    return { division, texts: entry.text, price: piece / 100 };
  });
}
