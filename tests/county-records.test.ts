/**
 * County assessor building records: the file readers, the mapping to what a
 * customer is told, and the rule that nothing is inferred.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { ADA_SOURCE_NAME, adaResidenceRow, adaResidences, dbfRecords, fromAdaResidence, importAdaResidences, parcelKey, zipEntry } from "../app/lib/estimator/county-records.ts";
import { RENTCAST_FREE_LIMIT, addressKey, fromCountyProfile, lookupProperty, mergeProperty, rentCastLookup, type LookupLedger } from "../app/lib/estimator/property.ts";
import type { PropertyFacts } from "../app/lib/estimator/types.ts";

const FIELDS: [string, number][] = [
  ["PARCEL", 11],
  ["YEARBUILT", 4],
  ["BEDROOMS", 2],
  ["BATHROOMS", 5],
  ["CARSTORAGE", 5],
  ["CARSTOR2", 5],
  ["GRFLSQFT", 5],
  ["UPFLSQFT", 5],
  ["LWRFLSQFTU", 5],
  ["LWRFLSQFTF", 5],
  ["BSMTFLSQFU", 5],
  ["BSMTFLSQFF", 5],
  ["ATTICSQFTF", 5],
  ["RESDESIGN", 1],
];

/** A dBase file in the county's layout. `deleted` marks records the county has removed. */
function dbf(records: Record<string, string | number>[], deleted: number[] = []): Buffer {
  const recordLength = 1 + FIELDS.reduce((s, [, l]) => s + l, 0);
  const headerLength = 32 + FIELDS.length * 32 + 1;
  const out = Buffer.alloc(headerLength + records.length * recordLength, 0x20);
  out.fill(0, 0, headerLength);
  out[0] = 3;
  out.writeUInt32LE(records.length, 4);
  out.writeUInt16LE(headerLength, 8);
  out.writeUInt16LE(recordLength, 10);
  FIELDS.forEach(([name, length], i) => {
    out.write(name, 32 + i * 32, "latin1");
    out[32 + i * 32 + 11] = 0x43;
    out[32 + i * 32 + 16] = length;
  });
  out[headerLength - 1] = 0x0d;
  records.forEach((record, r) => {
    let at = headerLength + r * recordLength;
    out[at] = deleted.includes(r) ? 0x2a : 0x20;
    at += 1;
    for (const [name, length] of FIELDS) {
      out.write(String(record[name] ?? "").padStart(length).slice(0, length), at, "latin1");
      at += length;
    }
  });
  return out;
}

function zip(files: [string, Buffer, boolean][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data, compress] of files) {
    const body = compress ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.write(name, 30, "latin1");
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(compress ? 8 : 0, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    entry.write(name, 46, "latin1");
    parts.push(local, body);
    central.push(entry);
    offset += local.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const SINGLE = { PARCEL: "R0475920460", YEARBUILT: 2026, BEDROOMS: 3, BATHROOMS: "2.50", CARSTORAGE: 842, GRFLSQFT: 2572, RESDESIGN: 1 };
const TWO_STORY = { PARCEL: "R5226020100", YEARBUILT: 1975, BEDROOMS: 4, BATHROOMS: "3.00", CARSTORAGE: 639, CARSTOR2: 400, GRFLSQFT: 1595, UPFLSQFT: 864, ATTICSQFTF: 400, RESDESIGN: 2 };
const BASEMENT = { PARCEL: "R1111111111", YEARBUILT: 1962, BEDROOMS: 4, BATHROOMS: "2.00", GRFLSQFT: 1200, BSMTFLSQFU: 600, BSMTFLSQFF: 600, RESDESIGN: 1 };
const SPLIT = { PARCEL: "R2222222222", YEARBUILT: 1978, BEDROOMS: 3, BATHROOMS: "2.00", GRFLSQFT: 1000, LWRFLSQFTF: 700, RESDESIGN: 3 };

test("the county file is read as published: zip, dBase, deleted records", () => {
  const table = dbf([SINGLE, TWO_STORY, BASEMENT], [1]);
  for (const compressed of [true, false]) {
    const archive = zip([["landchar.dbf", Buffer.from("other"), compressed], ["resichar.dbf", table, compressed]]);
    const found = zipEntry(archive, "RESICHAR.DBF");
    assert.ok(found && found.equals(table), "the residential table was not recovered from the archive");
    assert.equal(zipEntry(archive, "missing.dbf"), null);
  }
  assert.equal(zipEntry(Buffer.from("not a zip file at all, just text"), "resichar.dbf"), null);
  const records = [...dbfRecords(table)];
  assert.deepEqual(records.map((r) => r.PARCEL), ["R0475920460", "R1111111111"], "a deleted record was read, or a live one lost");
  assert.equal(records[0].BATHROOMS, "2.50");
  assert.deepEqual([...dbfRecords(Buffer.alloc(10))], []);
});

test("a home's facts are the county's figures, added up and nothing more", () => {
  const single = fromAdaResidence(adaResidenceRow(Object.fromEntries(Object.entries(SINGLE).map(([k, v]) => [k, String(v)]))))!;
  assert.deepEqual(
    { sqft: single.livingSqft, year: single.yearBuilt, beds: single.bedrooms, baths: single.bathrooms, stories: single.stories, basement: single.hasBasement, source: single.buildingSource },
    { sqft: 2572, year: 2026, beds: 3, baths: 2.5, stories: 1, basement: false, source: ADA_SOURCE_NAME },
  );
  const rows = adaResidences(dbf([SINGLE, TWO_STORY, BASEMENT, SPLIT]));
  // Living area is the finished levels: ground, upper and finished attic. The garage is not living area.
  assert.equal(fromAdaResidence(rows.get("R5226020100")!)!.livingSqft, 1595 + 864 + 400);
  // An unfinished basement is a basement, and is not living area.
  const basement = fromAdaResidence(rows.get("R1111111111")!)!;
  assert.equal(basement.hasBasement, true);
  assert.equal(basement.livingSqft, 1800);
  // A split-entry home has a lower level the county does not call a basement. We do not say either way.
  const split = fromAdaResidence(rows.get("R2222222222")!)!;
  assert.equal(split.hasBasement, null);
  assert.equal(split.stories, null);
  assert.equal(split.livingSqft, 1700);
  // The customer is never told how big their garage is in cars: the county gives square feet, not spaces.
  assert.equal(single.garageSpaces, undefined);
});

test("an unknown or ambiguous record reports nothing, never a guess", () => {
  // Two homes on one parcel: we cannot tell which one the customer means.
  const rows = adaResidences(dbf([SINGLE, { ...TWO_STORY, PARCEL: SINGLE.PARCEL }]));
  assert.equal(rows.get("R0475920460")!.records, 2);
  assert.equal(fromAdaResidence(rows.get("R0475920460")!), null);
  assert.equal(fromAdaResidence(null), null);
  // The county writes 1901 when it does not know the year.
  assert.equal(adaResidenceRow({ PARCEL: "R3333333333", YEARBUILT: "1901", GRFLSQFT: "900" })!.yearBuilt, null);
  // No area and no year is no record.
  assert.equal(fromAdaResidence(adaResidenceRow({ PARCEL: "R4444444444", YEARBUILT: "0", RESDESIGN: "1" })), null);
  assert.equal(adaResidenceRow({ PARCEL: "" }), null);
  assert.equal(parcelKey(" r04759-20460 "), "R0475920460");
});

test("the county's building record is used by parcel, ahead of any third party", async () => {
  const county = fromCountyProfile({ profile: { parcelId: "R0475920460", county: "ada", jurisdiction: "City of Boise", zoning: "R-1C", lotSizeAcres: 0.2 } })!;
  const building = fromAdaResidence(adaResidences(dbf([SINGLE])).get("R0475920460")!)!;
  const merged = mergeProperty(county, building)!;
  assert.deepEqual(
    { zoning: merged.zoning, sqft: merged.livingSqft, beds: merged.bedrooms, baths: merged.bathrooms, basement: merged.hasBasement, from: merged.buildingSource },
    { zoning: "R-1C", sqft: 2572, beds: 3, baths: 2.5, basement: false, from: ADA_SOURCE_NAME },
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ profile: { parcelId: "R0475920460", county: "ada", jurisdiction: "City of Boise" } }), { status: 200 })) as typeof fetch;
  try {
    const asked: string[] = [];
    const found = await lookupProperty("100 Example Ave, Boise, ID 83702", {}, async (c, p) => {
      asked.push(`${c}:${p}`);
      return building;
    });
    assert.deepEqual(asked, ["Ada:R0475920460"]);
    assert.equal(found!.livingSqft, 2572);
    assert.equal(found!.jurisdiction, "City of Boise");
    // A failing building lookup costs the building facts only, never the county record.
    const partial = await lookupProperty("100 Example Ave, Boise, ID 83702", {}, async () => {
      throw new Error("database down");
    });
    assert.equal(partial!.parcel, "R0475920460");
    assert.equal(partial!.livingSqft, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an import with no database changes nothing and says so", async () => {
  const before = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await importAdaResidences(async () => {
      throw new Error("must not download without a database");
    });
    assert.equal(result.ok, false);
  } finally {
    if (before !== undefined) process.env.DATABASE_URL = before;
  }
});

test("the metered service is asked once per address and never past the free allowance", async () => {
  const stored = new Map<string, PropertyFacts | null>();
  let used = 0;
  const ledger: LookupLedger = {
    cached: async (_p, key) => (stored.has(key) ? stored.get(key)! : undefined),
    usedThisMonth: async () => used,
    record: async (_p, key, facts) => {
      stored.set(key, facts);
      used += 1;
    },
  };
  let calls = 0;
  let status = 200;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify(status === 200 ? [{ squareFootage: 1850, yearBuilt: 1994, bedrooms: 3, bathrooms: 2 }] : {}), { status });
  }) as typeof fetch;
  const signal = new AbortController().signal;
  const env = { RENTCAST_API_KEY: "test-key" };
  try {
    // No key, or nowhere to count requests: nothing is requested.
    assert.equal(await rentCastLookup("12 Main St, Nampa, ID", signal, {}, ledger), null);
    assert.equal(await rentCastLookup("12 Main St, Nampa, ID", signal, env, null), null);
    assert.equal(calls, 0);
    const first = await rentCastLookup("12 Main St, Nampa, ID", signal, env, ledger);
    assert.deepEqual({ sqft: first!.livingSqft, year: first!.yearBuilt, beds: first!.bedrooms, baths: first!.bathrooms }, { sqft: 1850, year: 1994, beds: 3, baths: 2 });
    // The same address written differently is the same request.
    await rentCastLookup("12 MAIN ST.,  Nampa ID", signal, env, ledger);
    assert.equal(calls, 1);
    assert.equal(addressKey("12 MAIN ST.,  Nampa ID"), addressKey("12 Main St, Nampa, ID"));
    // "No record" is remembered too, so it is not asked for again.
    status = 404;
    assert.equal(await rentCastLookup("99 Nowhere Rd, Emmett, ID", signal, env, ledger), null);
    assert.equal(await rentCastLookup("99 Nowhere Rd, Emmett, ID", signal, env, ledger), null);
    assert.equal(calls, 2);
    // A service error is not remembered and does not count.
    status = 500;
    assert.equal(await rentCastLookup("5 Error Ln, McCall, ID", signal, env, ledger), null);
    assert.equal(used, 2);
    // At the allowance, nothing more is requested this month.
    status = 200;
    used = RENTCAST_FREE_LIMIT;
    const before = calls;
    assert.equal(await rentCastLookup("7 New St, Caldwell, ID", signal, env, ledger), null);
    assert.equal(calls, before);
    assert.ok(RENTCAST_FREE_LIMIT < 50, "the cap must sit under the free plan's 50 requests");
    // An Ada home with a county building record never spends a request.
    used = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes("rentcast")) calls += 1;
      return new Response(JSON.stringify({ profile: { parcelId: "R0475920460", county: "ada" } }), { status: 200 });
    }) as typeof fetch;
    const spent = calls;
    await lookupProperty("100 Example Ave, Boise, ID 83702", env, async () => ({ source: "county", livingSqft: 2000, yearBuilt: 2001 }));
    assert.equal(calls, spent);
  } finally {
    globalThis.fetch = realFetch;
  }
});
