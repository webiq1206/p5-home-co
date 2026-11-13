/**
 * County assessor property records. Server only.
 *
 * Each county's own free public data is loaded into `county_property`, and a
 * project address is matched to its parcel there. Nothing is paid for and no
 * key is needed. A county is loaded the first time it is needed and again when
 * its copy is more than twenty days old (Ada County republishes twice a month).
 */

import { query, queryOne } from "../../db.ts";
import type { PropertyRecord } from "../store.ts";
import { loadAda, type CountyRow } from "./ada.ts";
import { streetAddress } from "./address.ts";
import { loadValley } from "./valley.ts";

/** `minimum` is the fewest homes a healthy file holds; a smaller load is treated as a broken download. */
type County = { id: string; name: string; minimum: number; load: () => Promise<{ rows: CountyRow[]; sourceDate: string | null }> };

/** Counties with a free public source of building records. Add a county by adding a loader. */
export const COUNTIES: County[] = [
  { id: "ada", name: "Ada County", load: loadAda, minimum: 50_000 },
  { id: "valley", name: "Valley County", load: loadValley, minimum: 3_000 },
];

const STALE_MS = 20 * 24 * 60 * 60 * 1000;
const LOAD_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH = 2000;

export type CountyStatus = { id: string; name: string; homes: number; loadedAt: string | null; sourceDate: string | null; loading: boolean; error: string | null };

type LoadRow = { county: string; homes: number; source_date: string | null; started_at: Date | null; loaded_at: Date | null; error: string | null };

export async function countyStatus(now = Date.now()): Promise<CountyStatus[]> {
  const rows = await query<LoadRow>("SELECT county, homes, source_date, started_at, loaded_at, error FROM county_property_load");
  return COUNTIES.map((c) => {
    const row = rows.find((r) => r.county === c.id);
    const started = row?.started_at?.getTime() ?? 0;
    const loaded = row?.loaded_at?.getTime() ?? 0;
    return {
      id: c.id,
      name: c.name,
      homes: row?.homes ?? 0,
      loadedAt: row?.loaded_at?.toISOString() ?? null,
      sourceDate: row?.source_date ?? null,
      loading: started > loaded && now - started < LOAD_TIMEOUT_MS && !row?.error,
      error: row?.error ?? null,
    };
  });
}

/** Store one county's rows, replacing what was there. Rows no longer published are removed. */
export async function storeCounty(county: string, rows: CountyRow[], sourceDate: string | null, startedAt: Date): Promise<number> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await query(
      `INSERT INTO county_property (county, parcel, address_key, street_no, street_name, city, record, loaded_at)
       SELECT $1, * , $8 FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::jsonb[])
       ON CONFLICT (county, parcel) DO UPDATE SET address_key = EXCLUDED.address_key, street_no = EXCLUDED.street_no,
         street_name = EXCLUDED.street_name, city = EXCLUDED.city, record = EXCLUDED.record, loaded_at = EXCLUDED.loaded_at`,
      [county, batch.map((r) => r.parcel), batch.map((r) => r.addressKey), batch.map((r) => r.streetNo), batch.map((r) => r.streetName), batch.map((r) => r.city), batch.map((r) => JSON.stringify(r.record)), startedAt],
    );
  }
  // The caller has already refused an empty or cut-off file, so what was not in this load is gone from the county's.
  await query("DELETE FROM county_property WHERE county = $1 AND loaded_at < $2", [county, startedAt]);
  await query("UPDATE county_property_load SET homes = $2, source_date = $3, loaded_at = now(), error = NULL WHERE county = $1", [county, rows.length, sourceDate]);
  return rows.length;
}

/** Load one county now. Returns false when another load of it is already running. */
export async function refreshCounty(id: string): Promise<boolean> {
  const county = COUNTIES.find((c) => c.id === id);
  if (!county) throw new Error("Unknown county.");
  const startedAt = new Date();
  // One load at a time: claim it only if nobody claimed it in the last ten minutes.
  const claimed = await queryOne<{ county: string }>(
    `INSERT INTO county_property_load (county, started_at) VALUES ($1, $2)
     ON CONFLICT (county) DO UPDATE SET started_at = EXCLUDED.started_at, error = NULL
       WHERE county_property_load.started_at IS NULL OR county_property_load.error IS NOT NULL
          OR county_property_load.loaded_at >= county_property_load.started_at
          OR county_property_load.started_at < $2::timestamptz - interval '10 minutes'
     RETURNING county`,
    [id, startedAt],
  );
  if (!claimed) return false;
  try {
    const { rows, sourceDate } = await county.load();
    if (rows.length < county.minimum) throw new Error(`${county.name}'s data held only ${rows.length} homes, so the existing records were kept.`);
    await storeCounty(id, rows, sourceDate, startedAt);
    return true;
  } catch (error) {
    await query("UPDATE county_property_load SET error = $2 WHERE county = $1", [id, (error as Error).message.slice(0, 400)]);
    throw error;
  }
}

/** Load every county that has never been loaded or whose copy is old. Safe to call often. */
export async function refreshStaleCounties(now = Date.now()): Promise<void> {
  for (const c of await countyStatus(now)) {
    if (c.loading) continue;
    const age = c.loadedAt ? now - new Date(c.loadedAt).getTime() : Infinity;
    // After a failure, wait an hour before trying again.
    if (age < STALE_MS) continue;
    if (c.error) {
      const row = await queryOne<{ started_at: Date | null }>("SELECT started_at FROM county_property_load WHERE county = $1", [c.id]);
      if (row?.started_at && now - row.started_at.getTime() < 60 * 60 * 1000) continue;
    }
    await refreshCounty(c.id).catch(() => undefined);
  }
}

export async function anyCountyLoaded(): Promise<boolean> {
  return Boolean(await queryOne("SELECT 1 FROM county_property_load WHERE loaded_at IS NOT NULL LIMIT 1"));
}

type Hit = { county: string; city: string; record: Omit<PropertyRecord, "lookedUpAt"> };

/** When several parcels share a street address, the city decides; with no single answer there is no match. */
export function pickByCity<T extends { city: string }>(hits: T[], city: string): T | null {
  if (hits.length === 1) return hits[0];
  if (!hits.length || !city) return null;
  const same = hits.filter((h) => h.city === city);
  return same.length === 1 ? same[0] : null;
}

/**
 * The county record for a street address, or null. An exact match on the
 * county-style street line first; failing that, the same house number and
 * street name when that is one parcel (so "Allspice St" and "Allspice" agree).
 * A doubtful match is no match: a wrong house's record is worse than none.
 */
export async function lookupCountyProperty(address: string, now = new Date()): Promise<PropertyRecord | null> {
  const a = streetAddress(address);
  if (!a) return null;
  const exact = await query<Hit>("SELECT county, city, record FROM county_property WHERE address_key = $1 LIMIT 20", [a.key]);
  let hit = pickByCity(exact, a.city);
  if (!hit && !exact.length && a.name) {
    const near = await query<Hit>("SELECT county, city, record FROM county_property WHERE street_no = $1 AND street_name = $2 LIMIT 20", [a.number, a.name]);
    hit = pickByCity(near, a.city);
  }
  return hit ? { ...hit.record, lookedUpAt: now.toISOString() } : null;
}
