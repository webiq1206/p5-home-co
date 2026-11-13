/**
 * Property facts for an address. Server only.
 *
 * What exists today, verified in the family's own code: the county parcel
 * layers the remodeling site queries (boise-remodeling-co/lib/assessors)
 * publish the parcel number, lot size and zoning, and NOTHING about the
 * building. Living area, year built and stories are not in them, and that
 * code is explicit that its building figures are estimates from the city and
 * street name. An estimate is not something to show a homeowner as "we found
 * your home", so this module does not use them.
 *
 * Building facts therefore come from a property-data service, which is a paid
 * subscription the owner chooses. One adapter is written, for RentCast
 * (RENTCAST_API_KEY). It was written from RentCast's published response shape
 * and has NOT been run against the live service from the build environment:
 * confirm it with a real address before relying on it. Without a key the
 * lookup returns null and the estimator asks its questions as usual.
 *
 * Every value is a public record. It is shown to the customer to confirm or
 * correct, is labeled with its source wherever it travels, and is never
 * treated as a measurement.
 */

import type { PropertyFacts } from "./types.ts";

export function isPropertyLookupConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RENTCAST_API_KEY);
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
    source: "county tax records (via RentCast)",
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

export async function lookupProperty(address: string, env: Record<string, string | undefined> = process.env): Promise<PropertyFacts | null> {
  const key = env.RENTCAST_API_KEY;
  const clean = address.trim().slice(0, 200);
  if (!key || clean.length < 8) return null;
  const controller = new AbortController();
  // The customer is mid-flow: a slow lookup is skipped, never waited on.
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(clean)}&limit=1`, {
      headers: { "X-Api-Key": key, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return fromRentCast(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
