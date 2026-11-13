/**
 * Recipes: what a customer's selections buy, as cost book lines.
 *
 * Server only. A recipe returns quantities of lines from the owner's cost
 * book ("P5 Cost Database 2026"), nothing else. There is not one dollar
 * figure in this file and there must never be: every price comes from the
 * book at the customer's finish level, and the margin policy is applied once
 * by the scope pricing engine.
 *
 * Two kinds of project:
 *
 *  Itemized (kitchen, bathroom, flooring, paint, cabinets, handyman). Built
 *  line by line from the book's component lines. Quantities come from the
 *  typical dimensions each size option states on screen, or from counts the
 *  customer entered. Where the book also carries a whole-project assembly
 *  for the same work (Division 90), the recipe names it as a cross-check and
 *  price.ts compares the two; a result far from the owner's own assembly
 *  figure goes to review instead of to the customer as an official estimate.
 *
 *  Budgetary (new home, addition, ADU, garage, basement, whole home). Priced
 *  from the book's Division 90 assembly at the customer's size and finish.
 *  Nobody can itemize a house from five taps, and pretending to would be the
 *  invention this system exists to prevent.
 *
 * THE DIMENSIONS AND INCLUSIONS HERE ARE ESTIMATING RULES AND NEED THE
 * OWNER'S SIGN-OFF. They were written from the cost book's own line
 * definitions, and tests/guided-estimator.test.ts prints how each itemized
 * recipe compares with the book's assembly for the same project. Official
 * estimates are not sent to customers automatically until the owner has
 * reviewed that comparison and turned sending on (see qualify in price.ts).
 */

import type { PhaseId } from "../scopes/types.ts";
import { flowById } from "./flows.ts";
import type { Answers, PropertyFacts, Tier } from "./types.ts";

export type RecipeLine = {
  code: string;
  qty: number;
  /** Customer-facing description. Plain words, no codes, no trade shorthand. */
  text: string;
  /** Quantity comes from a typical dimension, not a count the customer gave. */
  estimated?: boolean;
  phase?: PhaseId;
  /** Presentation division when it differs from the cost code's own. */
  division?: string;
  /** Left out of the assembly cross-check (work the assembly does not cover). */
  outsideCheck?: boolean;
};

export type CrossCheck = {
  /** Cost book lines whose total is the low and high end of a plausible direct cost. */
  low: { code: string; qty: number }[];
  high: { code: string; qty: number }[];
  basis: string;
};

export type Recipe = {
  lines: RecipeLine[];
  assumptions: string[];
  exclusions: string[];
  crossCheck: CrossCheck | null;
};

export type RecipeInput = { answers: Answers; tier: Tier; property: PropertyFacts | null };

type Builder = (input: RecipeInput) => Recipe;

const str = (a: Answers, key: string) => String(a[key] ?? "");
const num = (a: Answers, key: string) => Number(a[key] ?? 0);

class Lines {
  readonly lines: RecipeLine[] = [];
  /** A measured or counted quantity. */
  add(code: string, qty: number, text: string, extra: Partial<RecipeLine> = {}) {
    if (qty > 0) this.lines.push({ code, qty, text, ...extra });
    return this;
  }
  /** A quantity derived from a typical dimension. */
  est(code: string, qty: number, text: string, extra: Partial<RecipeLine> = {}) {
    return this.add(code, qty, text, { estimated: true, ...extra });
  }
}

const PRE: Partial<RecipeLine> = { phase: "pre-construction" };

/** Homes built before 1978 need lead-safe work practices when paint is disturbed. */
function leadSafe(l: Lines, property: PropertyFacts | null, assumptions: string[]) {
  const year = property?.yearBuilt ?? null;
  if (year !== null && year < 1978) {
    l.add("02-82-03", 1, `Lead-safe work practices, required for homes built before 1978 (county record shows ${year})`, { outsideCheck: true });
  } else if (year === null) {
    assumptions.push("The home was built in 1978 or later. Older homes need lead-safe work practices, which are priced separately.");
  }
}

const STANDARD_EXCLUSIONS = [
  "Repair of hidden conditions found after work starts, such as rot, mold, or outdated wiring and plumbing",
  "Asbestos or other hazardous material testing and removal",
];

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

const KITCHEN = {
  small: { floor: 100, base: 14, upper: 12, pantry: 0, pulls: 28, recessed: 4, rooms: 1 },
  medium: { floor: 150, base: 20, upper: 16, pantry: 1, pulls: 40, recessed: 6, rooms: 1 },
  large: { floor: 250, base: 26, upper: 20, pantry: 1, pulls: 52, recessed: 8, rooms: 2 },
} as const;

const COUNTERS: Record<string, { code: string; name: string }> = {
  quartz: { code: "12-36-02", name: "Quartz" },
  granite: { code: "12-36-03", name: "Granite" },
  butcher: { code: "12-36-06", name: "Butcher block" },
  laminate: { code: "12-36-01", name: "Laminate" },
};

/** Countertops are about 25.5 inches deep: 2.1 sq ft per foot of base cabinet. */
const counterSqft = (baseLf: number) => Math.round(baseLf * 2.1);
/** An 18 inch backsplash along the counter run. */
const backsplashSqft = (baseLf: number) => Math.round(baseLf * 1.5);
const ISLAND_COUNTER_SQFT = 24;

const FLOORS: Record<string, { code: string; text: string }> = {
  lvp: { code: "09-65-01", text: "Luxury vinyl plank flooring, installed" },
  hardwood: { code: "09-64-01", text: "Engineered hardwood flooring, installed" },
  tile: { code: "09-30-01", text: "Porcelain or ceramic tile flooring, installed" },
  carpet: { code: "09-68-01", text: "Carpet with new pad, installed" },
  laminate: { code: "09-65-02", text: "Laminate flooring, installed" },
};

function kitchenSinkAndFaucet(l: Lines) {
  l.add("22-41-20", 1, "Stainless undermount kitchen sink")
    .add("22-42-03", 1, "Install the kitchen sink")
    .add("22-41-04", 1, "Pull-down kitchen faucet")
    .add("22-42-02", 1, "Install the kitchen faucet")
    .add("22-41-28", 1, "Garbage disposal")
    .add("22-42-04", 1, "Install the garbage disposal")
    .add("22-41-31", 1, "New supply lines, shutoff valves and drain trap");
}

function kitchenCounters(l: Lines, counter: string, sqft: number) {
  const c = COUNTERS[counter] ?? COUNTERS.quartz;
  l.est(c.code, sqft, `${c.name} countertops, fabricated and installed`)
    .add("12-36-12", 1, "Undermount sink cutout")
    .add("12-36-24", 1, "Countertop template visit");
}

const kitchenRemodel: Builder = ({ answers: a, property }) => {
  const k = KITCHEN[str(a, "size") as keyof typeof KITCHEN] ?? KITCHEN.medium;
  const scope = str(a, "scope");
  const island = scope !== "refresh" && str(a, "island") === "yes";
  const l = new Lines();
  const assumptions: string[] = [
    `A kitchen of about ${k.floor} sq ft with about ${k.base} ft of base cabinets and ${k.upper} ft of upper cabinets`,
    "Finish materials are priced at the finish level you chose. Your actual selections are confirmed before work starts.",
  ];
  const exclusions = [...STANDARD_EXCLUSIONS];
  const counters = counterSqft(k.base) + (island ? ISLAND_COUNTER_SQFT : 0);

  l.add("01-50-04", 1, "Dust barriers and floor protection for the work area");

  if (scope === "refresh") {
    l.est("02-41-07", k.base, "Remove and haul away the existing countertops")
      .est("12-39-02", k.base + k.upper, "Professional spray painting of your existing cabinets");
    kitchenCounters(l, str(a, "counter"), counters);
    l.est("09-30-07", backsplashSqft(k.base), "Tile backsplash, installed")
      .add("12-38-02", 1, "Cabinet pulls and knobs")
      .est("12-01-05", k.pulls, "Install the cabinet hardware");
    kitchenSinkAndFaucet(l);
    assumptions.push("Your existing cabinet boxes and doors are sound and stay in place.");
  } else {
    l.add("00-20-06", 2, "Plumbing and electrical permits", PRE);
    if (scope === "redesign") l.add("00-20-02", 1, "Building permit for the new layout", PRE);
    l.add("02-41-03", 1, "Remove and haul away the existing kitchen: cabinets, counters, backsplash and fixtures")
      .est("12-32-01", k.base, "Base cabinets, installed")
      .est("12-32-02", k.upper, "Upper cabinets, installed")
      .add("12-32-04", k.pantry, "Tall pantry cabinet, installed")
      .est("12-34-04", k.upper, "Crown molding on the upper cabinets")
      .add("12-34-07", 1, "Fillers and toe kicks")
      .add("12-38-02", 1, "Cabinet pulls and knobs")
      .est("12-01-05", k.pulls, "Install the cabinet hardware");
    if (island) {
      l.add("12-32-06", 1, "Island cabinets, about 8 ft, installed")
        .add("26-27-10", 1, "Power at the island")
        .add("26-51-01", 2, "Pendant lights over the island")
        .add("26-50-02", 2, "Install the pendant lights");
    }
    kitchenCounters(l, str(a, "counter"), counters);
    l.est("09-30-07", backsplashSqft(k.base), "Tile backsplash, installed");
    kitchenSinkAndFaucet(l);
    if (scope === "redesign") {
      // The book prices these two as whole assemblies; their parts are not added.
      l.add("90-20-05", 1, "Move the kitchen plumbing to the new layout", { division: "22" })
        .add("90-20-04", 1, "Update the kitchen electrical for the new layout: circuits, outlets and lighting", { division: "26" })
        .est("09-29-01", 200, "New drywall where walls and ceilings are opened")
        .est("09-91-12", 200, "Prime the new drywall");
      assumptions.push("The new layout stays within the existing kitchen walls. Removing or moving walls is priced after a site visit.");
    } else {
      l.est("26-50-03", k.upper, "Under-cabinet LED lighting")
        .est("26-50-01", k.recessed, "Recessed LED ceiling lights")
        .add("26-01-05", 4, "Replace the countertop outlets with new GFCI outlets")
        .est("09-01-06", 40, "Drywall repair behind the old cabinets and backsplash");
      assumptions.push("Plumbing, gas and electrical stay where they are now.");
    }
  }

  l.add("09-91-07", k.rooms, "Paint the kitchen walls").est("09-91-03", k.floor, "Paint the kitchen ceiling");

  const floor = str(a, "floor");
  if (FLOORS[floor]) {
    l.est("02-41-15", k.floor, "Remove the existing vinyl or laminate floor", { outsideCheck: true })
      .est(FLOORS[floor].code, k.floor, FLOORS[floor].text, { outsideCheck: true })
      .est("06-20-01", Math.round(Math.sqrt(k.floor) * 2), "New painted baseboard on the open walls", { outsideCheck: true });
    exclusions.push("Removing tile, hardwood or more than one layer of existing flooring");
  }

  // Appliances: the homeowner's own are reinstalled either way.
  l.add("11-33-01", 1, "Install the dishwasher")
    .add("11-33-02", 1, "Install the range")
    .add("11-33-04", 1, "Install the refrigerator")
    .add("11-33-06", 1, "Install the range hood");
  if (str(a, "appliances") === "package") {
    l.add("11-31-01", 1, "Kitchen appliance package allowance", { outsideCheck: true });
  } else {
    exclusions.push("Appliances. We disconnect and reinstall yours, or install the ones you buy");
  }
  l.est("01-74-05", k.floor, "Final cleaning");
  if (scope !== "refresh") leadSafe(l, property, assumptions);

  const crossCheck: CrossCheck =
    scope === "refresh"
      ? { low: [{ code: "90-20-07", qty: 1 }], high: [{ code: "90-20-07", qty: 1 }], basis: "Kitchen refresh assembly" }
      : {
          low: [{ code: "90-20-02", qty: k.floor }, ...(island ? [{ code: "90-20-03", qty: 1 }] : [])],
          high: [{ code: "90-20-01", qty: 1 }, ...(island ? [{ code: "90-20-03", qty: 1 }] : [])],
          basis: "Kitchen remodel assemblies, per sq ft (low) and complete (high)",
        };
  return { lines: l.lines, assumptions, exclusions, crossCheck };
};

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

const BATH = {
  powder: { floor: 20, perimeter: 18, walls: 144, recessed: 1, accessories: 2, assembly: "90-30-01", label: "A powder room of about 4 x 5 ft" },
  hall: { floor: 40, perimeter: 26, walls: 208, recessed: 2, accessories: 3, assembly: "90-30-02", label: "A full bath of about 5 x 8 ft" },
  primary: { floor: 100, perimeter: 40, walls: 320, recessed: 4, accessories: 5, assembly: "90-30-03", label: "A primary bath of about 10 x 10 ft" },
} as const;

function vanityAndToilet(l: Lines, double: boolean) {
  const sinks = double ? 2 : 1;
  l.add(double ? "12-41-02" : "12-41-01", 1, double ? "Double vanity with top, installed" : "Single vanity with top, installed")
    .add("22-41-08", sinks, sinks > 1 ? "Bathroom faucets" : "Bathroom faucet")
    .add("22-42-02", sinks, sinks > 1 ? "Install the faucets" : "Install the faucet")
    .add("22-41-01", 1, "Toilet")
    .add("22-42-01", 1, "Install the toilet")
    .add("22-41-31", sinks + 1, "New supply lines, shutoff valves and drain traps")
    .add("26-51-05", sinks, sinks > 1 ? "Vanity lights" : "Vanity light")
    .add("26-50-02", sinks, sinks > 1 ? "Install the vanity lights" : "Install the vanity light")
    .add("10-28-05", sinks, sinks > 1 ? "Hang the vanity mirrors" : "Hang the vanity mirror");
}

function showerValve(l: Lines) {
  l.add("22-41-12", 1, "Shower valve")
    .add("22-42-09", 1, "Plumb the new shower valve")
    .add("22-41-13", 1, "Shower trim: head, handle and arm")
    .add("22-42-05", 1, "Install the shower trim");
}

const bathroomRemodel: Builder = ({ answers: a, property }) => {
  const type = (str(a, "bath") as keyof typeof BATH) in BATH ? (str(a, "bath") as keyof typeof BATH) : "hall";
  const b = BATH[type];
  const scope = str(a, "scope");
  const double = type !== "powder" && str(a, "vanity") === "double";
  const l = new Lines();
  const assumptions: string[] = [
    b.label,
    "Finish materials are priced at the finish level you chose. Your actual selections are confirmed before work starts.",
  ];
  const exclusions = [...STANDARD_EXCLUSIONS, "Mirrors, towel bars and other accessories themselves. We install the ones you choose"];

  if (scope === "refresh") {
    l.add("01-50-04", 1, "Dust barriers and floor protection for the work area")
      .add("02-41-22", 1, "Remove and haul away the old vanity")
      .add("02-41-21", 1, "Remove and haul away the old toilet");
    vanityAndToilet(l, double);
    l.add("26-27-06", 1, "New bathroom exhaust fan");
    if (type !== "powder") {
      l.add("22-41-13", 1, "Shower trim: head, handle and arm")
        .add("22-42-05", 1, "Install the shower trim")
        .add("22-01-07", 1, "Re-caulk the tub or shower");
      assumptions.push("The existing tub or shower, its tile and the floor stay in place.");
    } else {
      assumptions.push("The existing floor stays in place.");
    }
    l.add("09-91-07", 1, "Paint the walls")
      .est("09-91-03", b.floor, "Paint the ceiling")
      .add("10-28-02", b.accessories, "Install towel bars, hooks and paper holder")
      .est("01-74-05", b.floor, "Final cleaning");
    return {
      lines: l.lines,
      assumptions,
      exclusions,
      crossCheck: { low: [{ code: "90-30-09", qty: 1 }], high: [{ code: "90-30-09", qty: 1 }], basis: "Bathroom refresh assembly" },
    };
  }

  // Full remodel.
  l.add("00-20-06", 2, "Plumbing and electrical permits", PRE);
  if (scope === "relocate") l.add("00-20-02", 1, "Building permit for the new layout", PRE);
  l.add("01-50-04", 1, "Dust barriers and floor protection for the work area");

  if (type === "powder") {
    l.add("02-41-22", 1, "Remove and haul away the old vanity")
      .add("02-41-21", 1, "Remove and haul away the old toilet")
      .est("02-41-09", b.floor, "Remove the existing floor tile")
      .est("09-01-06", 20, "Drywall repair")
      .est("09-30-01", b.floor, "Tile floor, installed")
      .est("06-20-01", b.perimeter - 6, "New painted baseboard");
  } else {
    const bathing = str(a, "bathing") || "combo";
    const tiled = bathing !== "combo";
    // Shower footprint and wall tile. Combo: a 5 ft alcove tub tiled 7 ft up
    // on three walls. Walk-in: 3 x 5 ft (hall) or 4 x 6 ft (primary), tiled
    // to an 8 ft ceiling on three walls.
    const wallTile = !tiled ? 70 : type === "primary" ? 112 : 88;
    const footprint = !tiled ? 15 : type === "primary" ? 24 : 15;
    const showerWidth = tiled && type === "primary" ? 6 : 5;
    l.add("02-41-04", 1, "Strip the bathroom to the studs and haul everything away")
      .est("09-29-04", wallTile, "Cement backer board on the shower walls")
      .est("09-30-10", wallTile, "Waterproofing membrane on the shower walls")
      .est("09-30-04", wallTile, tiled ? "Shower wall tile, installed" : "Tile tub surround, installed")
      .est("09-29-01", b.walls - wallTile + b.floor, "New drywall on the walls and ceiling")
      .est("09-91-12", b.walls - wallTile + b.floor, "Prime the new drywall");
    if (!tiled) {
      l.add("22-41-26", 1, "Alcove bathtub").add("22-42-06", 1, "Set and plumb the bathtub").add("22-41-34", 1, "Tub drain and overflow");
    } else {
      l.add("09-30-05", 1, "Tiled shower floor with waterproofing").add("09-30-09", 1, "Recessed shower niche");
      if (bathing === "curbless") {
        l.add("09-30-06", 1, "Curbless entry: recessed floor so there is no step").add("22-41-18", 1, "Linear shower drain");
      } else {
        l.add("09-30-14", 1, "Tiled shower curb").add("22-41-19", 1, "Shower drain");
      }
      l.add("08-83-01", 1, "Glass shower enclosure, installed");
    }
    if (bathing === "both") {
      l.add("22-40-01", 1, "Freestanding soaking tub")
        .add("22-40-02", 1, "Set and plumb the freestanding tub")
        .add("22-41-11", 1, "Floor-mount tub filler")
        .add("22-42-10", 1, "Install and plumb the tub filler");
    }
    showerValve(l);
    l.est("09-30-01", b.floor - footprint, "Tile floor, installed")
      .est("06-20-01", b.perimeter - showerWidth - (double ? 6 : 3) - 3, "New painted baseboard");
  }

  vanityAndToilet(l, double);
  l.add("26-27-06", 1, "New bathroom exhaust fan")
    .est("26-50-01", b.recessed, "Recessed LED ceiling lights")
    .add("26-27-01", 2, "New GFCI outlet and switch");
  if (scope === "relocate") {
    l.add("22-10-04", 2, "Move drain lines for the new layout", { outsideCheck: true }).add("26-27-02", 1, "New dedicated electrical circuit", { outsideCheck: true });
    assumptions.push("Up to two fixtures move, and the new layout stays within the existing bathroom walls.");
  } else {
    assumptions.push("The toilet, vanity and tub or shower stay where they are now.");
  }
  l.add("09-91-07", 1, "Paint the walls")
    .est("09-91-03", b.floor, "Paint the ceiling")
    .add("10-28-02", b.accessories, "Install towel bars, hooks and paper holder")
    .est("01-74-05", b.floor, "Final cleaning");
  assumptions.push("The existing door and window stay.");
  leadSafe(l, property, assumptions);

  // The book's bath assemblies do not say which shower they assume. A tiled
  // walk-in shower is priced as its own assembly, so for those the top of the
  // plausible range is the bath plus that shower (an upper bound, since the
  // two overlap) and the bottom is the bath alone.
  const bathing = type === "powder" ? "" : str(a, "bathing") || "combo";
  const shower = bathing === "curbless" ? "90-30-06" : bathing === "walkin" || bathing === "both" ? "90-30-05" : null;
  return {
    lines: l.lines,
    assumptions,
    exclusions,
    crossCheck: {
      low: [{ code: b.assembly, qty: 1 }],
      high: [{ code: b.assembly, qty: 1 }, ...(shower ? [{ code: shower, qty: 1 }] : [])],
      basis: shower ? "Bathroom remodel assembly (low) plus the tiled shower assembly (high)" : "Bathroom remodel assembly for this bath type",
    },
  };
};

// ---------------------------------------------------------------------------
// Flooring and paint
// ---------------------------------------------------------------------------

const FLOOR_REMOVAL: Record<string, { code: string; text: string }> = {
  carpet: { code: "02-41-08", text: "Remove and haul away the existing carpet and pad" },
  vinyl: { code: "02-41-15", text: "Remove and haul away the existing vinyl or laminate" },
  tile: { code: "02-41-09", text: "Remove and haul away the existing tile" },
  hardwood: { code: "02-41-14", text: "Remove and haul away the existing hardwood" },
};

const flooring: Builder = ({ answers: a }) => {
  const sqft = num(a, "sqft");
  const material = FLOORS[str(a, "material")] ?? FLOORS.lvp;
  const l = new Lines();
  const removal = FLOOR_REMOVAL[str(a, "existing")];
  if (removal) l.est(removal.code, sqft, removal.text);
  l.est(material.code, sqft, material.text).est("09-69-01", Math.max(1, Math.round(sqft / 250)), "Transition strips at doorways");
  const assumptions = [
    `About ${sqft.toLocaleString("en-US")} sq ft of floor, as you entered. We measure before ordering.`,
    "The subfloor is flat and sound. Leveling or subfloor repair is priced if it is needed.",
  ];
  if (str(a, "baseboard") === "new") {
    // A 12 x 12 room has 48 ft of wall for 144 sq ft of floor.
    const lf = Math.round(sqft * 0.3);
    l.est("06-20-01", lf, "New painted baseboard, installed").est("09-91-04", lf, "Paint the new baseboard");
  } else {
    assumptions.push("Existing baseboards stay in place.");
  }
  return {
    lines: l.lines,
    assumptions,
    exclusions: ["Moving furniture and appliances", "Stairs", "Subfloor repair or leveling"],
    crossCheck: null,
  };
};

const interiorPaint: Builder = ({ answers: a }) => {
  const rooms = num(a, "rooms");
  const l = new Lines();
  l.add("09-91-07", rooms, "Paint the walls, per room");
  if (str(a, "ceilings") === "yes") l.est("09-91-03", rooms * 144, "Paint the ceilings");
  if (str(a, "trim") === "yes") l.add("09-01-19", rooms, "Caulk and paint the trim, per room");
  return {
    lines: l.lines,
    assumptions: ["Rooms of about 12 x 12 ft with 8 ft ceilings and walls in paint-ready condition", "Two coats in one color per room"],
    exclusions: ["Drywall repair beyond filling nail holes", "Moving furniture", "Rooms with ceilings over 10 ft, stairwells and cabinets"],
    crossCheck: null,
  };
};

// ---------------------------------------------------------------------------
// Cabinets
// ---------------------------------------------------------------------------

const cabinetVisit = (l: Lines) => l.add("12-39-09", 1, "In-home measurement", PRE);

const kitchenCabinets: Builder = ({ answers: a }) => {
  const k = KITCHEN[str(a, "size") as keyof typeof KITCHEN] ?? KITCHEN.medium;
  const stacked = str(a, "uppers") === "stacked";
  const island = str(a, "island") === "yes";
  const counter = str(a, "counter");
  const l = new Lines();
  cabinetVisit(l).add("12-39-08", 1, "Cabinet design", PRE);
  if (str(a, "removal") === "yes") {
    l.est("02-41-06", k.base + k.upper, "Remove and haul away the existing cabinets").est("02-41-07", k.base, "Remove and haul away the existing countertops");
  }
  l.est("12-32-01", k.base, "Base cabinets, installed")
    .est(stacked ? "12-32-03" : "12-32-02", k.upper, stacked ? "Ceiling-height upper cabinets, installed" : "Upper cabinets, installed")
    .add("12-32-04", k.pantry, "Tall pantry cabinet, installed")
    .est("12-34-04", k.upper, "Crown molding on the upper cabinets")
    .add("12-34-07", 1, "Fillers and toe kicks")
    .add("12-38-02", 1, "Cabinet pulls and knobs")
    .est("12-01-05", k.pulls, "Install the cabinet hardware");
  if (island) l.add("12-32-06", 1, "Island cabinets, about 8 ft, installed");
  const exclusions = ["Plumbing, electrical and appliance changes", "Backsplash tile, flooring and painting"];
  if (COUNTERS[counter]) {
    kitchenCounters(l, counter, counterSqft(k.base) + (island ? ISLAND_COUNTER_SQFT : 0));
    l.add("22-42-03", 1, "Reinstall your kitchen sink").add("22-42-02", 1, "Reinstall your faucet").add("22-42-04", 1, "Reinstall your garbage disposal");
  } else {
    exclusions.push("Countertops and reconnecting the sink");
  }
  return {
    lines: l.lines,
    assumptions: [
      `About ${k.base} ft of base cabinets and ${k.upper} ft of upper cabinets. The final price follows the design and an in-home measurement.`,
      "Standard door style and finish at the finish level you chose. Painted, inset and specialty wood finishes are priced in design.",
    ],
    exclusions,
    crossCheck: null,
  };
};

const bathroomVanity: Builder = ({ answers: a }) => {
  const type = str(a, "type");
  const l = new Lines();
  cabinetVisit(l);
  if (str(a, "removal") === "yes") l.add("02-41-22", 1, "Remove and haul away the old vanity");
  let sinks = 1;
  const assumptions: string[] = [];
  if (type === "custom" || type === "floating") {
    const width = num(a, "width") || 5;
    sinks = width >= 5 ? 2 : 1;
    l.add(type === "floating" ? "12-41-04" : "12-41-03", width, type === "floating" ? "Custom floating vanity cabinet, installed" : "Custom vanity cabinet, installed")
      .est("12-36-02", Math.round(width * 1.9), "Quartz vanity top, fabricated and installed")
      .add("12-36-12", sinks, "Undermount sink cutouts")
      .add("22-41-23", sinks, "Undermount bathroom sinks")
      .add("22-42-03", sinks, "Install the sinks");
    assumptions.push(`A custom vanity ${width} ft wide with a quartz top and ${sinks === 2 ? "two sinks" : "one sink"}`);
  } else {
    sinks = type === "double" ? 2 : 1;
    l.add(sinks === 2 ? "12-41-02" : "12-41-01", 1, sinks === 2 ? "Double vanity with top, installed" : "Single vanity with top, installed");
  }
  l.add("22-41-08", sinks, sinks > 1 ? "Bathroom faucets" : "Bathroom faucet")
    .add("22-42-02", sinks, sinks > 1 ? "Install the faucets" : "Install the faucet")
    .add("22-41-31", sinks, "New supply lines, shutoff valves and drain traps");
  const extras = str(a, "extras");
  if (extras === "linen") l.add("12-41-06", 1, "Linen tower, installed");
  if (extras === "medicine") l.add("12-41-07", 1, "Recessed medicine cabinet, installed");
  assumptions.push("Plumbing stays where it is now.");
  return {
    lines: l.lines,
    assumptions,
    exclusions: ["Moving plumbing or electrical", "Flooring, wall repair and painting behind the old vanity", "Mirrors and lighting"],
    crossCheck: null,
  };
};

const REFRESH_LF = { small: { lf: 26, pulls: 28 }, medium: { lf: 36, pulls: 40 }, large: { lf: 46, pulls: 52 } } as const;
const REFRESH_METHOD: Record<string, { code: string; text: string }> = {
  paint: { code: "12-39-02", text: "Professional spray painting of your cabinets" },
  reface: { code: "12-39-01", text: "Cabinet refacing: new doors and drawer fronts, veneered boxes" },
  restain: { code: "12-39-04", text: "Restain and refinish your cabinets" },
};

const cabinetRefresh: Builder = ({ answers: a }) => {
  const size = REFRESH_LF[str(a, "size") as keyof typeof REFRESH_LF] ?? REFRESH_LF.medium;
  const method = REFRESH_METHOD[str(a, "method")] ?? REFRESH_METHOD.paint;
  const l = new Lines();
  cabinetVisit(l).est(method.code, size.lf, method.text);
  if (str(a, "hardware") === "yes") {
    l.add("12-38-02", 1, "Cabinet pulls and knobs").est("12-01-05", size.pulls, "Install the cabinet hardware");
  }
  return {
    lines: l.lines,
    assumptions: [`About ${size.lf} ft of cabinets in sound condition. We measure before the price is fixed.`],
    exclusions: ["Repairing damaged cabinet boxes", "Countertops, plumbing and appliances"],
    crossCheck: null,
  };
};

const builtIns: Builder = ({ answers: a }) => {
  const type = str(a, "type");
  const width = num(a, "width") || 8;
  const l = new Lines();
  cabinetVisit(l);
  if (type === "media") l.add("12-44-04", 1, "Media and entertainment wall, built and installed");
  else if (type === "laundry") {
    l.add("12-43-01", width, "Laundry upper cabinets, installed").add("12-43-02", width, "Laundry base cabinets with countertop, installed");
  } else {
    const map: Record<string, { code: string; text: string }> = {
      mudroom: { code: "12-42-01", text: "Mudroom lockers and bench, built and installed" },
      closet: { code: "12-45-02", text: "Walk-in closet system, installed" },
      office: { code: "12-44-06", text: "Built-in desk with upper cabinets, installed" },
      bookshelves: { code: "12-44-02", text: "Built-in bookshelves with lower doors, installed" },
    };
    const pick = map[type] ?? map.mudroom;
    l.add(pick.code, width, pick.text);
  }
  return {
    lines: l.lines,
    assumptions: [
      type === "media" ? "A full media wall. The final price follows the design and an in-home measurement." : `A wall about ${width} ft wide, as you entered. The final price follows the design and an in-home measurement.`,
      "Standard construction and finish at the finish level you chose.",
    ],
    exclusions: ["Electrical, lighting and plumbing", "Wall repair and painting around the new built-in"],
    crossCheck: null,
  };
};

// ---------------------------------------------------------------------------
// Handyman
// ---------------------------------------------------------------------------

const HANDYMAN_CODES: Record<string, string> = {
  faucet: "22-42-02",
  "toilet-repair": "22-01-04",
  "toilet-replace": "22-42-01",
  disposal: "22-42-04",
  "caulk-tub": "22-01-07",
  light: "26-50-02",
  fan: "26-01-03",
  outlet: "26-01-04",
  gfci: "26-01-05",
  smoke: "26-27-05",
  "patch-small": "09-01-07",
  "patch-medium": "09-01-08",
  "paint-room": "09-91-07",
  "trim-caulk": "09-01-19",
  "door-hang": "08-01-03",
  "door-adjust": "08-01-05",
  weatherstrip: "08-01-06",
  "hang-art": "10-01-01",
  "hang-heavy": "10-01-03",
  shelf: "10-01-02",
  blinds: "12-01-02",
  "grab-bar": "10-28-03",
  furniture: "12-01-03",
  "fence-boards": "32-01-02",
  "fence-post": "32-01-03",
  gate: "32-01-04",
  "gutters-1": "07-01-03",
  "gutters-2": "07-01-04",
  "dryer-vent": "23-01-04",
};

/** Cost book line "Minimum service charge". */
export const HANDYMAN_MINIMUM_CODE = "01-01-07";

const handyman: Builder = ({ answers: a }) => {
  const flow = flowById("handyman")!;
  const question = flow.questions[0];
  const options = question.kind === "tasks" ? question.options : [];
  const counts = (a.tasks ?? {}) as Record<string, number>;
  const l = new Lines();
  for (const o of options) {
    const count = counts[o.id] ?? 0;
    const code = HANDYMAN_CODES[o.id];
    if (count > 0 && code) l.add(code, count, o.label);
  }
  return {
    lines: l.lines,
    assumptions: ["Standard conditions and normal access", "Fixtures and products are supplied by you unless the line says otherwise"],
    exclusions: ["Fixtures, doors and other products you are supplying", "Repairs to hidden damage found once work starts", "Permits, where a job turns out to need one"],
    crossCheck: null,
  };
};

// ---------------------------------------------------------------------------
// Budgetary projects, priced from the book's own project assemblies
// ---------------------------------------------------------------------------

const PRECON_EXCLUSIONS = [
  "Design, engineering and surveys",
  "Permits, impact fees and utility connection fees",
  "Unusual site conditions, such as rock, high groundwater or long utility runs",
];

const basementFinish: Builder = ({ answers: a }) => {
  const sqft = num(a, "sqft");
  const l = new Lines();
  l.add("90-40-02", sqft, "Basement finishing, complete, at your finish level");
  if (str(a, "bath") === "yes") l.add("90-30-08", 1, "Add a basement bathroom, including the sewage ejector pump");
  if (str(a, "bar") === "yes") l.add("90-45-05", 1, "Basement bar");
  return {
    lines: l.lines,
    assumptions: [
      `About ${sqft.toLocaleString("en-US")} sq ft of unfinished basement, as you entered`,
      "The basement is dry, has enough ceiling height, and has code-compliant exits or room to add them.",
    ],
    exclusions: ["Egress windows and window wells", "Waterproofing and foundation repair", "Design and permits", ...STANDARD_EXCLUSIONS],
    crossCheck: null,
  };
};

const wholeHome: Builder = ({ answers: a, property }) => {
  const sqft = num(a, "sqft");
  const l = new Lines();
  l.add("90-40-01", sqft, "Whole-home renovation, at your finish level");
  const assumptions = [`About ${sqft.toLocaleString("en-US")} sq ft of living area being renovated`];
  if (property?.livingSqft && Math.abs(property.livingSqft - sqft) < 1) {
    assumptions[0] += property.confirmed ? " (county record, which you confirmed)" : " (county record)";
  }
  return {
    lines: l.lines,
    assumptions: [...assumptions, "The home's structure, roof, siding and windows stay."],
    exclusions: ["Additions and structural changes", "Design and permits", ...STANDARD_EXCLUSIONS],
    crossCheck: null,
  };
};

const customHome: Builder = ({ answers: a }) => {
  const sqft = num(a, "sqft");
  const garage = { two: 576, three: 864 }[str(a, "garage")] ?? 0;
  const basement = str(a, "basement");
  const l = new Lines();
  l.add("90-10-01", sqft, "New home construction, complete, on your lot");
  l.add("90-10-03", garage, garage === 864 ? "Attached 3-car garage" : "Attached 2-car garage");
  const below = Math.round(sqft / 2);
  if (basement === "unfinished") l.est("90-10-04", below, "Unfinished basement");
  if (basement === "finished") l.est("90-10-05", below, "Finished basement");
  return {
    lines: l.lines,
    assumptions: [
      `About ${sqft.toLocaleString("en-US")} sq ft of heated living area`,
      "A buildable lot you already own, with utilities available at the street",
      ...(basement !== "none" ? [`A basement of about ${below.toLocaleString("en-US")} sq ft, under roughly half of the home`] : []),
    ],
    exclusions: ["The land", ...PRECON_EXCLUSIONS, "Landscaping, fencing and window coverings"],
    crossCheck: null,
  };
};

const addition: Builder = ({ answers: a }) => {
  const type = str(a, "type");
  const sqft = num(a, "sqft");
  const l = new Lines();
  const perSf: Record<string, { code: string; text: string }> = {
    room: { code: "90-50-01", text: "Room addition, complete" },
    sunroom: { code: "90-50-08", text: "Sunroom addition, complete" },
    garage: { code: "90-50-12", text: "Attached garage addition, complete" },
  };
  const each: Record<string, { code: string; text: string }> = {
    suite: { code: "90-50-04", text: "Primary suite addition" },
    inlaw: { code: "90-50-05", text: "In-law suite addition" },
    second: { code: "90-50-06", text: "Second-story addition" },
  };
  const assumptions: string[] = [];
  if (perSf[type]) {
    l.add(perSf[type].code, sqft, perSf[type].text);
    assumptions.push(`About ${sqft.toLocaleString("en-US")} sq ft, as you entered`);
  } else {
    const pick = each[type] ?? each.suite;
    l.add(pick.code, 1, pick.text);
    assumptions.push("A typical size for this kind of addition. Your design sets the final size and price.");
  }
  return {
    lines: l.lines,
    assumptions: [...assumptions, "Your lot has room for the addition within setbacks, and the existing home can tie into it without major structural work."],
    exclusions: [...PRECON_EXCLUSIONS, "Remodeling of existing rooms beyond the connection to the addition"],
    crossCheck: null,
  };
};

const garageShop: Builder = ({ answers: a }) => {
  const sqft = num(a, "sqft");
  const l = new Lines();
  l.add("90-50-13", sqft, "Detached garage or shop, complete");
  return {
    lines: l.lines,
    assumptions: [`About ${sqft.toLocaleString("en-US")} sq ft, as you entered`, "A level, accessible building site with power available nearby"],
    exclusions: [...PRECON_EXCLUSIONS, "Driveway, plumbing and heating unless added in design"],
    crossCheck: null,
  };
};

const adu: Builder = ({ answers: a }) => {
  const map: Record<string, { code: string; text: string; assume: string }> = {
    detached: { code: "90-50-10", text: "New detached ADU of about 600 sq ft, complete", assume: "A detached unit of about 600 sq ft" },
    attached: { code: "90-50-11", text: "Attached ADU, complete", assume: "An attached unit of typical size" },
    garage: { code: "90-50-09", text: "Garage conversion to an ADU, complete", assume: "An existing garage in sound condition" },
  };
  const pick = map[str(a, "type")] ?? map.detached;
  const l = new Lines();
  l.add(pick.code, 1, pick.text);
  return {
    lines: l.lines,
    assumptions: [pick.assume, "Your lot and zoning allow an ADU, and water, sewer and power can be extended from the main home."],
    exclusions: PRECON_EXCLUSIONS,
    crossCheck: null,
  };
};

const RECIPES: Record<string, Builder> = {
  "kitchen-remodel": kitchenRemodel,
  "bathroom-remodel": bathroomRemodel,
  "basement-finish": basementFinish,
  "whole-home": wholeHome,
  flooring,
  "interior-paint": interiorPaint,
  "kitchen-cabinets": kitchenCabinets,
  "bathroom-vanity": bathroomVanity,
  "cabinet-refresh": cabinetRefresh,
  "built-ins": builtIns,
  handyman,
  "custom-home": customHome,
  addition,
  "garage-shop": garageShop,
  adu,
};

export function buildRecipe(project: string, input: RecipeInput): Recipe | null {
  const builder = RECIPES[project];
  return builder ? builder(input) : null;
}

export function recipeProjects(): string[] {
  return Object.keys(RECIPES);
}
