/**
 * Turning a street address into the form county records use, so "745 West
 * Allspice Street, Kuna, ID 83634, USA" and the assessor's "745 W ALLSPICE ST"
 * are the same key.
 */

const DIRECTIONS: Record<string, string> = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW" };
const TYPES: Record<string, string> = {
  STREET: "ST", AVENUE: "AVE", AV: "AVE", TR: "TRL", CR: "CIR", PKY: "PKWY", LA: "LN", BOULEVARD: "BLVD", DRIVE: "DR", ROAD: "RD", LANE: "LN", COURT: "CT", PLACE: "PL", WAY: "WAY",
  CIRCLE: "CIR", TERRACE: "TER", TRAIL: "TRL", PARKWAY: "PKWY", HIGHWAY: "HWY", LOOP: "LOOP", SQUARE: "SQ", POINT: "PT", COVE: "CV", CREEK: "CRK",
  CROSSING: "XING", HEIGHTS: "HTS", RIDGE: "RDG", RUN: "RUN", VIEW: "VW", VISTA: "VIS", ALLEY: "ALY", BEND: "BND", GLEN: "GLN", PASS: "PASS",
};
const DIR_SET = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const TYPE_SET = new Set(Object.values(TYPES));

export type StreetAddress = { key: string; number: string; name: string; city: string };

/**
 * The street line of an address as number, direction, name and type in county
 * style, plus the city when the address carries one. Unit numbers are dropped:
 * the parcel is the building.
 */
export function streetAddress(address: string | null | undefined): StreetAddress | null {
  const parts = (address ?? "").toUpperCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const words = parts[0]
    .replace(/[.#]/g, " ")
    .replace(/\b(APT|UNIT|STE|SUITE|SPC|SPACE|LOT|TRLR)\b.*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => DIRECTIONS[w] ?? TYPES[w] ?? w);
  if (words.length < 2 || !/^\d+[A-Z]?$/.test(words[0])) return null;
  const number = words[0];
  const rest = words.slice(1);
  // The name is what is left after a leading direction and a trailing type and direction.
  const core = [...rest];
  if (core.length > 1 && DIR_SET.has(core[0])) core.shift();
  if (core.length > 1 && DIR_SET.has(core[core.length - 1])) core.pop();
  if (core.length > 1 && TYPE_SET.has(core[core.length - 1])) core.pop();
  const city = (parts[1] ?? "").replace(/\b(ID|IDAHO)\b.*$/, "").replace(/\d/g, "").trim();
  return { key: [number, ...rest].join(" "), number, name: core.join(" "), city };
}
