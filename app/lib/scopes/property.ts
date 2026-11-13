/**
 * The public property record for a project's address. Server only.
 *
 * County parcel layers publish the lot and the zoning but nothing about the
 * building, so building facts come from a property-data service. RentCast's
 * free plan allows a small number of lookups each month, which is enough when
 * each address is looked up once and the answer is kept on the project.
 *
 * What a public record holds is whole-house: living area, bedrooms, bathrooms,
 * year built, stories, lot, and a few features. It never holds the size of an
 * individual room; no property record does. Every value is unverified and is
 * shown, and given to the scope, as something to confirm.
 */

import { setProjectProperty, type ProjectRow, type PropertyRecord } from "./store.ts";

export function isPropertyLookupConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RENTCAST_API_KEY);
}

const num = (value: unknown, min: number, max: number): number | null => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null);
const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** Read one RentCast property record. Pure, so the mapping is testable. */
export function fromRentCast(body: unknown, now = new Date()): PropertyRecord | null {
  const r = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  const f = (r.features ?? {}) as Record<string, unknown>;
  const record: PropertyRecord = {
    source: "county tax records, through RentCast",
    livingSqft: num(r.squareFootage, 200, 30_000),
    bedrooms: num(r.bedrooms, 0, 30),
    bathrooms: num(r.bathrooms, 0, 30),
    yearBuilt: num(r.yearBuilt, 1800, now.getFullYear() + 1),
    stories: num(f.floorCount, 1, 6),
    lotSqft: num(r.lotSize, 300, 50_000_000),
    garageSpaces: num(f.garageSpaces, 1, 12),
    propertyType: text(r.propertyType),
    foundation: text(f.foundationType),
    roof: text(f.roofType),
    exterior: text(f.exteriorType),
    heating: text(f.heatingType),
    cooling: text(f.coolingType),
    fireplace: flag(f.fireplace),
    pool: flag(f.pool),
    parcel: text(r.assessorID),
    lookedUpAt: now.toISOString(),
  };
  return record.livingSqft || record.bedrooms || record.bathrooms || record.yearBuilt || record.lotSqft ? record : null;
}

export async function lookupProperty(address: string, env: Record<string, string | undefined> = process.env): Promise<PropertyRecord | null> {
  const key = env.RENTCAST_API_KEY;
  const clean = address.trim().slice(0, 200);
  if (!key || clean.length < 8) return null;
  const response = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(clean)}&limit=1`, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  // 404 is RentCast's "no record for this address".
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The property lookup was refused (${response.status}).`);
  return fromRentCast(await response.json());
}

const key = (address: string | null) => (address ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Look the address up once and keep the answer. A second call for the same
 * address does nothing, so the monthly allowance is spent once per project.
 * A failed lookup is not recorded, so it is tried again next time.
 */
export async function ensureProperty(p: ProjectRow, force = false): Promise<boolean> {
  const address = key(p.project_address);
  if (!isPropertyLookupConfigured() || address.length < 8) return false;
  if (!force && p.property_checked_for === address) return false;
  const record = await lookupProperty(p.project_address!);
  await setProjectProperty(p.id, record, address);
  return true;
}

/** The record as rows for the screen: label, value. Only what was found. */
export function propertyRows(r: PropertyRecord): [string, string][] {
  const rows: [string, string | null][] = [
    ["Living area", r.livingSqft ? `${r.livingSqft.toLocaleString("en-US")} sq ft` : null],
    ["Bedrooms", r.bedrooms !== null && r.bedrooms !== undefined ? String(r.bedrooms) : null],
    ["Bathrooms", r.bathrooms !== null && r.bathrooms !== undefined ? String(r.bathrooms) : null],
    ["Year built", r.yearBuilt ? String(r.yearBuilt) : null],
    ["Stories", r.stories ? String(r.stories) : null],
    ["Lot", r.lotSqft ? `${r.lotSqft.toLocaleString("en-US")} sq ft` : null],
    ["Garage", r.garageSpaces ? `${r.garageSpaces} spaces` : null],
    ["Type", r.propertyType ?? null],
    ["Foundation", r.foundation ?? null],
    ["Roof", r.roof ?? null],
    ["Exterior", r.exterior ?? null],
    ["Heating", r.heating ?? null],
    ["Cooling", r.cooling ?? null],
    ["Fireplace", r.fireplace === null || r.fireplace === undefined ? null : r.fireplace ? "Yes" : "No"],
    ["Pool", r.pool === null || r.pool === undefined ? null : r.pool ? "Yes" : "No"],
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
