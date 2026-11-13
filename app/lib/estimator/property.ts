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
 *  service: RentCast (RENTCAST_API_KEY), on its free plan. Run against the
 *  live service on 13 November 2026 with one Canyon and one Valley County
 *  address: both returned living area, year built, bedrooms, stories and
 *  the county's own parcel number. With neither source, the customer is
 *  asked.
 *
 * Adding a county means adding a provider to COUNTY_PROVIDERS; nothing else
 * changes. A field no source published stays empty. Nothing is inferred, and
 * every value is a public record, never a measurement: it is shown to the
 * customer to confirm, and labeled with its source wherever it travels.
 */

import { isDatabaseConfigured, query, queryOne } from "../db.ts";
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
    bedrooms: positive(record.bedrooms, 1, 20),
    // Bathrooms are deliberately not read. On the two live records checked on 13 November 2026
    // (a 2022 four-bedroom in Middleton, a 2016 home in McCall) the service reported one
    // bathroom for each, which is not believable. A wrong fact is worse than a question.
    county: typeof record.county === "string" ? record.county.slice(0, 40) : null,
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

/**
 * RentCast's free plan includes 50 requests a month and bills for any beyond
 * that. We stop short of it, so this can never produce a charge. Raise it
 * with RENTCAST_MONTHLY_LIMIT only on a paid plan.
 */
export const RENTCAST_FREE_LIMIT = 45;
export const addressKey = (address: string) => address.toLowerCase().replace(/[^a-z0-9]/g, "");

export type LookupLedger = {
  /** A previous answer for this address: the facts, or null when the service had none. Undefined when never asked. */
  cached: (provider: string, key: string) => Promise<PropertyFacts | null | undefined>;
  usedThisMonth: (provider: string) => Promise<number>;
  record: (provider: string, key: string, facts: PropertyFacts | null) => Promise<void>;
};

const databaseLedger: LookupLedger = {
  async cached(provider, key) {
    // A home's record rarely changes; a year is fresh enough, and each address costs one request.
    const row = await queryOne<{ facts: PropertyFacts | null }>("SELECT facts FROM property_lookup WHERE provider = $1 AND address_key = $2 AND fetched_at > now() - interval '365 days'", [provider, key]);
    return row ? row.facts : undefined;
  },
  async usedThisMonth(provider) {
    const row = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM property_lookup WHERE provider = $1 AND fetched_at >= date_trunc('month', now())", [provider]);
    return row?.n ?? 0;
  },
  async record(provider, key, facts) {
    await query(
      `INSERT INTO property_lookup (provider, address_key, facts) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (provider, address_key) DO UPDATE SET facts = EXCLUDED.facts, fetched_at = now()`,
      [provider, key, facts ? JSON.stringify(facts) : null],
    );
  },
};

/**
 * One request per address, and never past the monthly allowance. Without a
 * database there is nowhere to count requests, so nothing is requested.
 */
export async function rentCastLookup(address: string, signal: AbortSignal, env: Record<string, string | undefined>, ledger: LookupLedger | null = isDatabaseConfigured() ? databaseLedger : null): Promise<PropertyFacts | null> {
  const key = env.RENTCAST_API_KEY;
  if (!key || !ledger) return null;
  const id = addressKey(address);
  const known = await ledger.cached("rentcast", id);
  if (known !== undefined) return known;
  const limit = Number(env.RENTCAST_MONTHLY_LIMIT) > 0 ? Number(env.RENTCAST_MONTHLY_LIMIT) : RENTCAST_FREE_LIMIT;
  if ((await ledger.usedThisMonth("rentcast")) >= limit) return null;
  const response = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}&limit=1`, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal });
  // A request the service answered counts against the allowance whether or not it found the home.
  if (!response.ok && response.status !== 404) return null;
  const facts = response.ok ? fromRentCast(await response.json()) : null;
  await ledger.record("rentcast", id, facts);
  return facts;
}

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
    const county = await quiet((async () => { for (const provider of COUNTY_PROVIDERS) { const found = await provider.lookup(clean, controller.signal, env); if (found) return found; } return null; })());
    // The county's own building record, when it publishes one, comes first and costs nothing.
    const assessor = county?.county && county.parcel ? await quiet(residence(county.county, county.parcel)) : null;
    // The metered service is asked only when the county gave us no building record.
    const building = assessor ? null : await quiet(rentCastLookup(clean, controller.signal, env));
    return mergeProperty(county, assessor ?? building);
  } finally {
    clearTimeout(timer);
  }
}
