/**
 * RentCast, used only as a fallback for addresses in counties that publish no
 * building records a program can read (Canyon, Gem, Adams). Server only.
 *
 * It is off unless RENTCAST_API_KEY is set, and it stops for the month once
 * the free allowance is used, so it cannot run up a bill. County data, which
 * is free and unlimited, is always tried first.
 */

import { query, queryOne } from "../db.ts";
import type { PropertyRecord } from "./store.ts";

export const RENTCAST_SOURCE = "county tax records, through RentCast";
/** RentCast's free plan is 50 requests a month; stop short of it. */
const DEFAULT_MONTHLY_LIMIT = 45;

export function rentCastLimit(env: Record<string, string | undefined> = process.env): number {
  if (!env.RENTCAST_API_KEY) return 0;
  const n = Number(env.RENTCAST_MONTHLY_LIMIT);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MONTHLY_LIMIT;
}

const num = (value: unknown, min: number, max: number): number | null => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null);

/** Read one RentCast property record. Pure, so the mapping is testable. */
export function fromRentCast(body: unknown, now = new Date()): PropertyRecord | null {
  const r = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  const f = (r.features ?? {}) as Record<string, unknown>;
  const stories = num(f.floorCount, 1, 6);
  const record: PropertyRecord = {
    source: RENTCAST_SOURCE,
    livingSqft: num(r.squareFootage, 200, 30_000),
    bedrooms: num(r.bedrooms, 0, 30),
    bathrooms: num(r.bathrooms, 0, 30),
    yearBuilt: num(r.yearBuilt, 1800, now.getFullYear() + 1),
    propertyType: text(r.propertyType),
    design: stories ? `${stories} ${stories === 1 ? "story" : "stories"}` : null,
    foundation: text(f.foundationType),
    roof: text(f.roofType),
    exterior: text(f.exteriorType),
    heating: text(f.heatingType),
    cooling: text(f.coolingType),
    fireplaces: f.fireplace === true ? 1 : f.fireplace === false ? 0 : null,
    lotSqft: num(r.lotSize, 300, 50_000_000),
    zoning: text(r.zoning),
    subdivision: text(r.subdivision),
    parcel: text(r.assessorID),
    lookedUpAt: now.toISOString(),
  };
  return record.livingSqft || record.bedrooms || record.bathrooms || record.yearBuilt || record.lotSqft ? record : null;
}

export type RentCastResult = { record: PropertyRecord | null; asked: boolean };

/**
 * Look one address up, if the key is set and this month's allowance is not
 * used. `asked` is false when no request was sent, so the caller does not
 * record the address as checked and it is tried again next month.
 */
export async function lookupRentCast(address: string, env: Record<string, string | undefined> = process.env): Promise<RentCastResult> {
  const limit = rentCastLimit(env);
  const clean = address.trim().slice(0, 200);
  if (!limit || clean.length < 8) return { record: null, asked: false };
  // Claim one of this month's lookups before sending, so two people at once cannot overshoot.
  const claimed = await queryOne<{ id: string }>(
    `INSERT INTO property_lookup_log (source)
     SELECT 'rentcast' WHERE (SELECT count(*) FROM property_lookup_log WHERE source = 'rentcast' AND looked_up_at >= date_trunc('month', now())) < $1
     RETURNING id`,
    [limit],
  );
  if (!claimed) return { record: null, asked: false };
  const response = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(clean)}&limit=1`, {
    headers: { "X-Api-Key": env.RENTCAST_API_KEY!, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  // 404 is RentCast's "no record for this address".
  if (response.status === 404) return { record: null, asked: true };
  if (!response.ok) throw new Error(`The RentCast lookup was refused (${response.status}).`);
  return { record: fromRentCast(await response.json()), asked: true };
}

export async function rentCastUsed(): Promise<number> {
  const row = await query<{ n: string }>("SELECT count(*) AS n FROM property_lookup_log WHERE source = 'rentcast' AND looked_up_at >= date_trunc('month', now())");
  return Number(row[0]?.n ?? 0);
}
