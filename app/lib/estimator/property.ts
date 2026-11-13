/**
 * Property facts for an address. Server only.
 *
 * Two kinds of source, kept apart because they answer different questions:
 *
 *  COUNTY PARCEL RECORD (Ada and Canyon today). Looked up through the lookup
 *  Boise Remodeling Co already runs against the county GIS layers
 *  (boise-remodeling-co/lib/assessors), so there is one implementation of the
 *  address matching, not two. It gives the parcel number, county,
 *  jurisdiction, permitting authority, zoning, subdivision and lot size.
 *  It does NOT give anything about the building: those layers publish no
 *  living area, year built, stories, bedrooms, basement or foundation, and
 *  that code is explicit that its building figures are estimates from the
 *  city and street name. Estimates are never used here.
 *
 *  BUILDING RECORD. Living area, year built, stories, bedrooms, bathrooms
 *  and basement. In Ada County these come from the Assessor's own free
 *  published file, looked up by the parcel number the county record gave us
 *  (county-records.ts). Elsewhere they come only from a paid property-data
 *  service if the owner ever sets one up: one adapter is written, for
 *  RentCast (RENTCAST_API_KEY), from its published response shape, and it
 *  has NOT been run against the live service. With neither, the customer is
 *  asked.
 *
 * Adding a county means adding a provider to COUNTY_PROVIDERS; nothing else
 * changes. A field no source published stays empty. Nothing is inferred, and
 * every value is a public record, never a measurement: it is shown to the
 * customer to confirm, and labeled with its source wherever it travels.
 */

import { residenceFacts } from "./county-records.ts";
import type { PropertyFacts } from "./types.ts";

export function isPropertyLookupConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env.ESTIMATOR_PROPERTY_LOOKUP !== "off";
}

const positive = (value: unknown, min: number, max: number): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Read one RentCast property record. Pure, so the mapping is testable. */
export function fromRentCast(body: unknown): PropertyFacts | null {
  const record = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
  if (!record || typeof record !== "object") return null;
  const features = (record.features ?? {}) as Record<string, unknown>;
  const lotSqft = positive(record.lotSize, 500, 50_000_000);
  const facts: PropertyFacts = {
    source: "county tax records, via RentCast",
    parcel: typeof record.assessorID === "string" ? record.assessorID.slice(0, 40) : null,
    livingSqft: positive(record.squareFootage, 200, 30_000),
    yearBuilt: positive(record.yearBuilt, 1850, new Date().getFullYear() + 1),
    lotAcres: lotSqft ? Math.round((lotSqft / 43_560) * 100) / 100 : null,
    stories: positive(features.floorCount, 1, 6),
    garageSpaces: positive(features.garageSpaces, 1, 12),
    jurisdiction: typeof record.city === "string" ? record.city.slice(0, 60) : null,
  };
  return facts.livingSqft || facts.yearBuilt || facts.lotAcres ? facts : null;
}

/** Read a county parcel profile from the remodeling site's lookup. Pure, so the mapping is testable. */
export function fromCountyProfile(body: unknown): PropertyFacts | null {
  const profile = (body as { profile?: Record<string, unknown> } | null)?.profile;
  if (!profile || typeof profile !== "object") return null;
  const county = profile.county === "ada" ? "Ada" : profile.county === "canyon" ? "Canyon" : null;
  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const parcel = text(profile.parcelId, 40);
  // No parcel means the county did not match the address: there is no record to report.
  if (!county || !parcel) return null;
  return {
    source: `${county} County parcel record`,
    county,
    parcel,
    jurisdiction: text(profile.jurisdiction, 80),
    permittingAuthority: text(profile.permittingAuthority, 120),
    zoning: text(profile.zoning, 20),
    subdivision: text(profile.subdivision, 80),
    lotAcres: positive(profile.lotSizeAcres, 0.01, 2000),
  };
}

type Provider = (address: string, signal: AbortSignal, env: Record<string, string | undefined>) => Promise<PropertyFacts | null>;

const familyParcelLookup: Provider = async (address, signal) => {
  const response = await fetch("https://boiseremodeling.co/api/property/enrich", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ formattedAddress: address }),
    signal,
  });
  return response.ok ? fromCountyProfile(await response.json()) : null;
};

/** County parcel sources, tried in order. A new county is a new entry here. */
export const COUNTY_PROVIDERS: { name: string; counties: string[]; lookup: Provider }[] = [{ name: "P5 family parcel lookup", counties: ["Ada", "Canyon"], lookup: familyParcelLookup }];

const rentCast: Provider = async (address, signal, env) => {
  const key = env.RENTCAST_API_KEY;
  if (!key) return null;
  const response = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}&limit=1`, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal });
  return response.ok ? fromRentCast(await response.json()) : null;
};

/** County record and building record merged, each field keeping its own source. */
export function mergeProperty(county: PropertyFacts | null, building: PropertyFacts | null): PropertyFacts | null {
  if (!county && !building) return null;
  if (!building) return county;
  const facts = {
    livingSqft: building.livingSqft,
    yearBuilt: building.yearBuilt,
    stories: building.stories,
    garageSpaces: building.garageSpaces,
    bedrooms: building.bedrooms,
    bathrooms: building.bathrooms,
    hasBasement: building.hasBasement,
    buildingSource: building.source,
  };
  if (!county) return { ...building, ...facts };
  return { ...county, ...facts, lotAcres: county.lotAcres ?? building.lotAcres, source: `${county.source} and ${building.source}` };
}

type Residence = (county: string, parcel: string) => Promise<PropertyFacts | null>;

export async function lookupProperty(address: string, env: Record<string, string | undefined> = process.env, residence: Residence = residenceFacts): Promise<PropertyFacts | null> {
  const clean = address.trim().slice(0, 200);
  if (clean.length < 8) return null;
  const controller = new AbortController();
  // The customer is mid-flow: a slow lookup is skipped, never waited on.
  const timer = setTimeout(() => controller.abort(), 4000);
  const quiet = (p: Promise<PropertyFacts | null>) => p.catch(() => null);
  try {
    const [county, building] = await Promise.all([
      quiet((async () => { for (const provider of COUNTY_PROVIDERS) { const found = await provider.lookup(clean, controller.signal, env); if (found) return found; } return null; })()),
      quiet(rentCast(clean, controller.signal, env)),
    ]);
    // The county's own building record, when it publishes one, comes before any third party's.
    const assessor = county?.county && county.parcel ? await quiet(residence(county.county, county.parcel)) : null;
    return mergeProperty(county, assessor ?? building);
  } finally {
    clearTimeout(timer);
  }
}
