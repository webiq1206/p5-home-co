/**
 * Ada County, Idaho. The Assessor publishes its parcel data as free downloads,
 * refreshed on the second and last Wednesday of each month, "for personal and
 * business use" and not for resale, redistribution or mailing lists
 * (adacounty.id.gov/assessor, Ada County Assessor Data). Two files are used:
 *
 *   parcelCharacteristics.zip -> resichar.dbf   the building, per parcel
 *   parcelpointspublic.zip    -> the .dbf       the address, lot, zoning
 *
 * Owner names are not in these files and are never stored.
 */

import JSZip from "jszip";

import type { PropertyRecord } from "../store.ts";
import { streetAddress } from "./address.ts";
import { eachDbfRecord } from "./dbf.ts";

export const ADA_SOURCE = "Ada County Assessor public records";
const CHARACTERISTICS = "https://adacountyassessor.org/public/parcelCharacteristics.zip";
const PARCEL_POINTS = "https://adacountyassessor.org/public/parcelpointspublic.zip";

const DESIGN: Record<string, string> = { "1": "Single level", "2": "Two story", "3": "Split entry", "4": "Tri-level", "5": "Other", "6": "Condo", "7": "Townhome", "8": "Three story" };
const DWELLING: Record<string, string> = { "1": "Single family", "2": "Duplex", "3": "Triplex", "4": "Fourplex", "5": "Other" };
const QUALITY: Record<string, string> = { "3": "Fair", "4": "Average", "5": "Good", "6": "Very good", "7": "Excellent", "8": "Excellent" };

const n = (v: string): number => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const yes = (v: string): boolean | null => (v === "Y" ? true : v === "N" ? false : null);

/** A record as it is stored: no nulls, and no lookup time (that is set when a project reads it). */
export type StoredRecord = Omit<PropertyRecord, "lookedUpAt">;
export type CountyRow = { parcel: string; addressKey: string; streetNo: string; streetName: string; city: string; record: StoredRecord };

/** Drop empty values so 180,000 records stay small in memory and in the table. */
export function compact<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
}

/** One building row from RESICHAR as a property record. Pure. */
export function adaBuilding(get: (name: string) => string): StoredRecord {
  const ground = n(get("GRFLSQFT"));
  const upper = n(get("UPFLSQFT"));
  const lowerFinished = n(get("LWRFLSQFTF"));
  const lowerUnfinished = n(get("LWRFLSQFTU"));
  const basementFinished = n(get("BSMTFLSQFF"));
  const basementUnfinished = n(get("BSMTFLSQFU"));
  const atticFinished = n(get("ATTICSQFTF"));
  const atticUnfinished = n(get("ATTICSQFTU"));
  const finished = ground + upper + lowerFinished + basementFinished + atticFinished;
  const year = n(get("YEARBUILT"));
  const remodeled = n(get("YEARREM"));
  const garage = n(get("CARSTORAGE")) + n(get("CARSTOR2"));
  return compact({
    source: ADA_SOURCE,
    livingSqft: finished || null,
    bedrooms: get("BEDROOMS") === "" ? null : n(get("BEDROOMS")),
    bathrooms: get("BATHROOMS") === "" ? null : n(get("BATHROOMS")),
    yearBuilt: year >= 1800 ? year : null,
    yearRemodeled: remodeled >= 1800 ? remodeled : null,
    propertyType: DWELLING[get("NOOFDWELLI")] ?? null,
    design: DESIGN[get("RESDESIGN")] ?? null,
    quality: QUALITY[get("CONSTCLASS")] ?? null,
    groundFloorSqft: ground || null,
    upperFloorSqft: upper || null,
    lowerFinishedSqft: lowerFinished || null,
    lowerUnfinishedSqft: lowerUnfinished || null,
    basementFinishedSqft: basementFinished || null,
    basementUnfinishedSqft: basementUnfinished || null,
    atticFinishedSqft: atticFinished || null,
    atticUnfinishedSqft: atticUnfinished || null,
    garageSqft: garage || null,
    porchSqft: n(get("PORCHSQFT")) || null,
    deckSqft: n(get("DECKSQFT")) || null,
    deckCovered: n(get("DECKSQFT")) ? yes(get("DECKCOVERE")) : null,
    patioSqft: n(get("PATIOSQFT")) || null,
    patioCovered: n(get("PATIOSQFT")) ? yes(get("PATIOCOVER")) : null,
    poolSqft: n(get("POOLSQFT")) || null,
    outbuildingSqft: n(get("GPBUILDING")) || null,
    fireplaces: get("FIREPLACE") === "" ? null : n(get("FIREPLACE")),
    heating: yes(get("HEATING")) === null ? null : yes(get("HEATING")) ? "Yes" : "No",
    cooling: yes(get("AC")) === null ? null : yes(get("AC")) ? "Yes" : "No",
  });
}

async function fetchZip(url: string): Promise<JSZip> {
  const res = await fetch(url, { headers: { "User-Agent": "P5 Home Co property records" }, signal: AbortSignal.timeout(240_000) });
  if (!res.ok) throw new Error(`Ada County's data file could not be downloaded (${res.status}).`);
  return JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
}

async function table(zip: JSZip, match: RegExp): Promise<Buffer> {
  const entry = Object.values(zip.files).find((f) => !f.dir && match.test(f.name));
  if (!entry) throw new Error("Ada County's data file did not contain the expected table.");
  return entry.async("nodebuffer");
}

/**
 * Every Ada County parcel that has a home on it. Where a parcel has several
 * buildings, the largest is kept and the count is recorded.
 */
export async function loadAda(): Promise<{ rows: CountyRow[]; sourceDate: string | null }> {
  const characteristics = await fetchZip(CHARACTERISTICS);
  const entry = Object.values(characteristics.files).find((f) => /resichar\.dbf$/i.test(f.name));
  const sourceDate = entry?.date ? entry.date.toISOString().slice(0, 10) : null;
  const buildings = new Map<string, { record: StoredRecord; count: number }>();
  eachDbfRecord(await table(characteristics, /resichar\.dbf$/i), (get) => {
    const parcel = get("PARCEL");
    if (!parcel) return;
    const record = adaBuilding(get);
    const existing = buildings.get(parcel);
    if (!existing) buildings.set(parcel, { record, count: 1 });
    else {
      existing.count++;
      if ((record.livingSqft ?? 0) > (existing.record.livingSqft ?? 0)) existing.record = record;
    }
  });

  const points = await fetchZip(PARCEL_POINTS);
  const rows: CountyRow[] = [];
  eachDbfRecord(await table(points, /parcelpointspublic\.dbf$/i), (get) => {
    const parcel = get("PARCEL");
    const building = buildings.get(parcel);
    if (!building) return;
    const cityState = get("CITY_STATE");
    const address = streetAddress(`${get("ADDRESS")}, ${cityState.split(",")[0]}`);
    if (!address) return;
    const acres = Number(get("ACRES"));
    rows.push({
      parcel,
      addressKey: address.key,
      streetNo: address.number,
      streetName: address.name,
      city: address.city,
      record: compact({
        ...building.record,
        parcel,
        buildings: building.count > 1 ? building.count : null,
        lotSqft: Number.isFinite(acres) && acres > 0 ? Math.round(acres * 43_560) : null,
        zoning: get("ZONING") || null,
        subdivision: get("SUBNM") || null,
      }),
    });
    buildings.delete(parcel); // a parcel with several address points is stored once
  });
  return { rows, sourceDate };
}
