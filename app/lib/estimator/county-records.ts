/**
 * Building facts from the county assessor's own published file. Server only.
 *
 * ADA COUNTY publishes its residential characteristics as a free download
 * (adacounty.id.gov, Assessor, "Ada County Assessor Data"), refreshed on the
 * second and last Wednesday of each month: one record per home with the year
 * built, bedrooms, bathrooms, floor area by level, basement area and home
 * style. Read on 13 November 2026: 185,840 records, those fields about 99%
 * filled. No key and no subscription.
 *
 * The file is a download, not a lookup service, so it is copied into our own
 * table (county_residence) and looked up there by parcel number. The copy
 * refreshes itself when it is more than 16 days old.
 *
 * The county's conditions: the file is provided as is, must not be
 * redistributed, and must not be used as a mailing list (Idaho Code 74-120).
 * It holds no owner names. We use it for one thing: showing a customer the
 * recorded facts for the address they typed, so they can confirm them.
 *
 * Nothing is inferred. Area is the sum of the finished levels the county
 * lists. A parcel with more than one residential record (two houses on one
 * lot) reports nothing, because we cannot tell which one the customer means.
 * A split-level home with no basement area does not say "no basement".
 *
 * CANYON COUNTY publishes no equivalent file that we have found. Adding a
 * county is a new entry in SOURCES and a mapping function.
 */

import { inflateRawSync } from "node:zlib";

import { isDatabaseConfigured, isMissingRelation, queryOne, transaction } from "../db.ts";
import type { PropertyFacts } from "./types.ts";

export const ADA_SOURCE_URL = "https://adacountyassessor.org/public/parcelCharacteristics.zip";
export const ADA_SOURCE_NAME = "Ada County Assessor residential records";
/** The county refreshes about every two weeks. */
export const REFRESH_AFTER_DAYS = 16;

/** One file out of a zip archive, or null when it is not there. Stored and deflated entries only. */
export function zipEntry(zip: Buffer, name: string): Buffer | null {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.toString("latin1", at + 46, at + 46 + nameLength);
    if (entry.toLowerCase() === name.toLowerCase()) {
      if (zip.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + packed);
      return method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** Every live record of a dBase file, as trimmed text by field name. */
export function* dbfRecords(file: Buffer): Generator<Record<string, string>> {
  if (file.length < 33) return;
  const count = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const fields: { name: string; length: number }[] = [];
  for (let at = 32; at + 32 <= headerLength && file[at] !== 0x0d; at += 32) {
    const raw = file.subarray(at, at + 11);
    const zero = raw.indexOf(0);
    fields.push({ name: raw.toString("latin1", 0, zero < 0 ? 11 : zero).toUpperCase(), length: file[at + 16] });
  }
  for (let i = 0; i < count; i += 1) {
    const start = headerLength + i * recordLength;
    if (start + recordLength > file.length) return;
    // An asterisk marks a deleted record.
    if (file[start] === 0x2a) continue;
    const record: Record<string, string> = {};
    let at = start + 1;
    for (const field of fields) {
      record[field.name] = file.toString("latin1", at, at + field.length).trim();
      at += field.length;
    }
    yield record;
  }
}

export type ResidenceRow = {
  parcel: string;
  /** How many residential records the county holds for this parcel. */
  records: number;
  yearBuilt: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  groundSqft: number;
  upperSqft: number;
  lowerFinishedSqft: number;
  lowerUnfinishedSqft: number;
  basementFinishedSqft: number;
  basementUnfinishedSqft: number;
  atticFinishedSqft: number;
  garageSqft: number;
  /** The county's RESDESIGN code, 1 to 8. */
  design: number | null;
};

export const parcelKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const whole = (value: string | undefined, max: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n <= max ? n : 0;
};

/** One line of the county's RESICHAR table. Pure. */
export function adaResidenceRow(record: Record<string, string>): ResidenceRow | null {
  const parcel = parcelKey(record.PARCEL ?? "");
  if (parcel.length < 6) return null;
  const year = whole(record.YEARBUILT, new Date().getFullYear() + 1);
  const baths = Number(record.BATHROOMS);
  const design = whole(record.RESDESIGN, 8);
  return {
    parcel,
    records: 1,
    // The county writes 1901 when the year is not known.
    yearBuilt: year >= 1850 && year !== 1901 ? year : null,
    bedrooms: whole(record.BEDROOMS, 20) || null,
    bathrooms: Number.isFinite(baths) && baths > 0 && baths <= 20 ? baths : null,
    groundSqft: whole(record.GRFLSQFT, 30_000),
    upperSqft: whole(record.UPFLSQFT, 30_000),
    lowerFinishedSqft: whole(record.LWRFLSQFTF, 30_000),
    lowerUnfinishedSqft: whole(record.LWRFLSQFTU, 30_000),
    basementFinishedSqft: whole(record.BSMTFLSQFF, 30_000),
    basementUnfinishedSqft: whole(record.BSMTFLSQFU, 30_000),
    atticFinishedSqft: whole(record.ATTICSQFTF, 30_000),
    garageSqft: whole(record.CARSTORAGE, 20_000) + whole(record.CARSTOR2, 20_000),
    design: design || null,
  };
}

/** Rows keyed by parcel. A parcel listed more than once keeps its count and nothing else is trusted. */
export function adaResidences(file: Buffer): Map<string, ResidenceRow> {
  const rows = new Map<string, ResidenceRow>();
  for (const record of dbfRecords(file)) {
    const row = adaResidenceRow(record);
    if (!row) continue;
    const seen = rows.get(row.parcel);
    if (seen) seen.records += 1;
    else rows.set(row.parcel, row);
  }
  return rows;
}

/** Styles whose levels are all counted as floors, so "no basement area" means no basement. */
const NO_HIDDEN_LEVEL = new Set([1, 2, 6, 7, 8]);
const STORIES: Record<number, number> = { 1: 1, 2: 2, 8: 3 };

/** What we tell the customer about the building. Pure. */
export function fromAdaResidence(row: ResidenceRow | null): PropertyFacts | null {
  if (!row || row.records !== 1) return null;
  const living = row.groundSqft + row.upperSqft + row.lowerFinishedSqft + row.basementFinishedSqft + row.atticFinishedSqft;
  const basement = row.basementFinishedSqft + row.basementUnfinishedSqft;
  const facts: PropertyFacts = {
    source: ADA_SOURCE_NAME,
    buildingSource: ADA_SOURCE_NAME,
    parcel: row.parcel,
    livingSqft: living >= 200 ? living : null,
    yearBuilt: row.yearBuilt,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    stories: row.design ? STORIES[row.design] ?? null : null,
    hasBasement: basement > 0 ? true : row.design && NO_HIDDEN_LEVEL.has(row.design) && living >= 200 ? false : null,
  };
  return facts.livingSqft || facts.yearBuilt ? facts : null;
}

type StoredRow = {
  records: number;
  year_built: number | null;
  bedrooms: number | null;
  bathrooms: string | null;
  ground_sqft: number;
  upper_sqft: number;
  lower_finished_sqft: number;
  lower_unfinished_sqft: number;
  basement_finished_sqft: number;
  basement_unfinished_sqft: number;
  attic_finished_sqft: number;
  garage_sqft: number;
  design: number | null;
};

/** The county's building record for a parcel, from our copy. Null when we have none. */
export async function residenceFacts(county: string, parcel: string): Promise<PropertyFacts | null> {
  if (county !== "Ada" || !isDatabaseConfigured()) return null;
  try {
    const row = await queryOne<StoredRow>(
      `SELECT records, year_built, bedrooms, bathrooms::text, ground_sqft, upper_sqft, lower_finished_sqft, lower_unfinished_sqft,
              basement_finished_sqft, basement_unfinished_sqft, attic_finished_sqft, garage_sqft, design
         FROM county_residence WHERE county = $1 AND parcel = $2`,
      [county, parcelKey(parcel)],
    );
    if (!row) return null;
    return fromAdaResidence({
      parcel: parcelKey(parcel),
      records: row.records,
      yearBuilt: row.year_built,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms === null ? null : Number(row.bathrooms),
      groundSqft: row.ground_sqft,
      upperSqft: row.upper_sqft,
      lowerFinishedSqft: row.lower_finished_sqft,
      lowerUnfinishedSqft: row.lower_unfinished_sqft,
      basementFinishedSqft: row.basement_finished_sqft,
      basementUnfinishedSqft: row.basement_unfinished_sqft,
      atticFinishedSqft: row.attic_finished_sqft,
      garageSqft: row.garage_sqft,
      design: row.design,
    });
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

const COLUMNS = [
  "parcel",
  "records",
  "year_built",
  "bedrooms",
  "bathrooms",
  "ground_sqft",
  "upper_sqft",
  "lower_finished_sqft",
  "lower_unfinished_sqft",
  "basement_finished_sqft",
  "basement_unfinished_sqft",
  "attic_finished_sqft",
  "garage_sqft",
  "design",
] as const;
const TYPES = ["text", "int", "int", "int", "numeric", "int", "int", "int", "int", "int", "int", "int", "int", "int"];

const values = (row: ResidenceRow): unknown[] => [
  row.parcel,
  row.records,
  row.yearBuilt,
  row.bedrooms,
  row.bathrooms,
  row.groundSqft,
  row.upperSqft,
  row.lowerFinishedSqft,
  row.lowerUnfinishedSqft,
  row.basementFinishedSqft,
  row.basementUnfinishedSqft,
  row.atticFinishedSqft,
  row.garageSqft,
  row.design,
];

export type ImportResult = { ok: boolean; rows: number; detail: string };

/**
 * Download the county file and replace our copy with it, in one transaction.
 * A second import started while one runs does nothing. A file that is far
 * smaller than the county's is refused, so a bad download cannot empty the
 * table.
 */
export async function importAdaResidences(download: () => Promise<Buffer> = downloadAda): Promise<ImportResult> {
  if (!isDatabaseConfigured()) return { ok: false, rows: 0, detail: "No database." };
  const zip = await download();
  const table = zipEntry(zip, "resichar.dbf");
  if (!table) return { ok: false, rows: 0, detail: "The county file has no residential table." };
  const rows = [...adaResidences(table).values()];
  if (rows.length < 50_000) return { ok: false, rows: rows.length, detail: `Only ${rows.length} records read; the county publishes far more. Nothing was changed.` };
  return transaction(async (client) => {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('county_residence:Ada')) AS locked");
    if (!lock.rows[0]?.locked) return { ok: false, rows: 0, detail: "An import is already running." };
    const started = new Date();
    for (let at = 0; at < rows.length; at += 5000) {
      const batch = rows.slice(at, at + 5000).map(values);
      const arrays = COLUMNS.map((_, column) => batch.map((row) => row[column]));
      await client.query(
        `INSERT INTO county_residence (county, ${COLUMNS.join(", ")}, imported_at)
         SELECT 'Ada', t.*, $${COLUMNS.length + 1}::timestamptz FROM unnest(${TYPES.map((type, i) => `$${i + 1}::${type}[]`).join(", ")}) AS t
         ON CONFLICT (county, parcel) DO UPDATE SET ${COLUMNS.slice(1).map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, imported_at = EXCLUDED.imported_at`,
        [...arrays, started],
      );
    }
    // A parcel the county no longer lists is no longer a record.
    await client.query("DELETE FROM county_residence WHERE county = 'Ada' AND imported_at < $1", [started]);
    await client.query(
      `INSERT INTO county_residence_import (county, imported_at, row_count, source) VALUES ('Ada', $1, $2, $3)
       ON CONFLICT (county) DO UPDATE SET imported_at = EXCLUDED.imported_at, row_count = EXCLUDED.row_count, source = EXCLUDED.source`,
      [started, rows.length, ADA_SOURCE_URL],
    );
    return { ok: true, rows: rows.length, detail: "Imported." };
  });
}

async function downloadAda(): Promise<Buffer> {
  const response = await fetch(ADA_SOURCE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`The county download returned ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** Refresh our copy when it is missing or old. Safe to call often; it does nothing most of the time. */
let lastAttempt = 0;

export async function refreshCountyRecordsIfStale(now = new Date()): Promise<ImportResult | null> {
  if (!isDatabaseConfigured()) return null;
  // One try per server every six hours, so a county outage is not retried on every lookup.
  if (now.getTime() - lastAttempt < 6 * 3_600_000) return null;
  try {
    const last = await queryOne<{ imported_at: Date }>("SELECT imported_at FROM county_residence_import WHERE county = 'Ada'");
    if (last && now.getTime() - new Date(last.imported_at).getTime() < REFRESH_AFTER_DAYS * 86_400_000) return null;
    lastAttempt = now.getTime();
    return await importAdaResidences();
  } catch (error) {
    if (isMissingRelation(error)) return null;
    console.error("[estimator] county records refresh failed:", (error as Error).message);
    return { ok: false, rows: 0, detail: (error as Error).message };
  }
}
