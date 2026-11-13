/**
 * The public property record for a project's address. Server only.
 *
 * The record comes from the county assessor's own free public data (see
 * ./county), which the platform keeps a copy of. No paid service and no key.
 *
 * What a public record holds is whole-house: floor areas by level, bedrooms,
 * bathrooms, year built, garage, deck, patio, lot. It never holds the size of
 * an individual room; no property record does. Every value is unverified and
 * is shown, and given to the scope, as something to confirm.
 */

import { anyCountyLoaded, lookupCountyProperty, refreshStaleCounties } from "./county/index.ts";
import { setProjectProperty, type ProjectRow, type PropertyRecord } from "./store.ts";

const key = (address: string | null) => (address ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Look the address up and keep the answer on the project. A second call for
 * the same address does nothing unless forced. With `load`, county records
 * that are missing or old are fetched first (about a minute the first time).
 * Nothing is recorded while no county is loaded, so the lookup is tried again.
 */
export async function ensureProperty(p: ProjectRow, opts: { force?: boolean; load?: boolean } = {}): Promise<boolean> {
  const address = key(p.project_address);
  if (address.length < 8) return false;
  if (!opts.force && p.property_checked_for === address) return false;
  if (opts.load) await refreshStaleCounties();
  if (!(await anyCountyLoaded())) return false;
  const record = await lookupCountyProperty(p.project_address!);
  await setProjectProperty(p.id, record, address);
  return true;
}

const sqft = (v: number | null | undefined, note = "") => (v ? `${v.toLocaleString("en-US")} sq ft${note}` : null);
const count = (v: number | null | undefined) => (v !== null && v !== undefined ? String(v) : null);
const covered = (v: boolean | null | undefined) => (v === true ? ", covered" : v === false ? ", uncovered" : "");

/** The record as rows for the screen: label, value. Only what was found. */
export function propertyRows(r: PropertyRecord): [string, string][] {
  const acres = r.lotSqft ? r.lotSqft / 43_560 : 0;
  const rows: [string, string | null][] = [
    ["Finished area", sqft(r.livingSqft)],
    ["Bedrooms", count(r.bedrooms)],
    ["Bathrooms", count(r.bathrooms)],
    ["Year built", r.yearBuilt ? String(r.yearBuilt) : null],
    ["Remodeled", r.yearRemodeled ? String(r.yearRemodeled) : null],
    ["Type", [r.propertyType, r.design].filter(Boolean).join(", ") || null],
    ["Build quality", r.quality ?? null],
    ["Condition", r.condition ?? null],
    ["Rooms", count(r.rooms)],
    ["Foundation", r.foundation ?? null],
    ["Framing", r.framing ?? null],
    ["Exterior", r.exterior ?? null],
    ["Roof", r.roof ?? null],
    ["Ground floor", sqft(r.groundFloorSqft)],
    ["Upper floor", sqft(r.upperFloorSqft)],
    ["Lower level, finished", sqft(r.lowerFinishedSqft)],
    ["Lower level, unfinished", sqft(r.lowerUnfinishedSqft)],
    ["Basement, finished", sqft(r.basementFinishedSqft)],
    ["Basement, unfinished", sqft(r.basementUnfinishedSqft)],
    ["Attic, finished", sqft(r.atticFinishedSqft)],
    ["Attic, unfinished", sqft(r.atticUnfinishedSqft)],
    ["Garage", sqft(r.garageSqft)],
    ["Carport", sqft(r.carportSqft)],
    ["Porch", sqft(r.porchSqft)],
    ["Deck", sqft(r.deckSqft, covered(r.deckCovered))],
    ["Patio", sqft(r.patioSqft, covered(r.patioCovered))],
    ["Pool", sqft(r.poolSqft)],
    ["Outbuilding", sqft(r.outbuildingSqft)],
    ["Fireplaces", count(r.fireplaces)],
    ["Heating", r.heating ?? null],
    ["Air conditioning", r.cooling ?? null],
    ["Lot", r.lotSqft ? `${r.lotSqft.toLocaleString("en-US")} sq ft (${acres.toFixed(2)} acres)` : null],
    ["Zoning", r.zoning ?? null],
    ["Utilities on record", r.utilities ?? null],
    ["Subdivision", r.subdivision ?? null],
    ["Parcel", r.parcel ?? null],
    ["Buildings on the parcel", r.buildings ? `${r.buildings}; figures are for the largest` : null],
  ];
  return rows.filter((x): x is [string, string] => x[1] !== null);
}

/** The record as context for building the scope. It informs; it never measures. */
export function propertyForPrompt(r: PropertyRecord | null): string {
  if (!r) return "";
  return `PROPERTY RECORD for the project address (${r.source}; public record, not verified on site):\n${propertyRows(r)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}`;
}
