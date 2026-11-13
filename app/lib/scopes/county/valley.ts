/**
 * Valley County, Idaho. The county's GIS office publishes its parcels and the
 * assessor's improvement records as a free public map service (no login, no
 * key; "for reference purposes only"). Dwellings are read from the
 * improvements layer and joined to their parcel for the address and lot.
 *
 * Owner names and mailing addresses are never requested.
 */

import { compact, type CountyRow, type StoredRecord } from "./ada.ts";
import { streetAddress } from "./address.ts";

export const VALLEY_SOURCE = "Valley County Assessor public records";
const SERVICE = "https://services6.arcgis.com/ikurHvtarxfN6u3u/arcgis/rest/services/ParcelsForReporting/FeatureServer";
const PAGE = 1000;

type Attributes = Record<string, string | number | null>;

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const n = (v: unknown): number => {
  const x = Number(s(v));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Every row of one layer, a page at a time. */
async function layer(id: number, where: string, fields: string[]): Promise<Attributes[]> {
  const out: Attributes[] = [];
  for (let offset = 0; offset < 400_000; offset += PAGE) {
    const url = `${SERVICE}/${id}/query?where=${encodeURIComponent(where)}&outFields=${fields.join(",")}&returnGeometry=false&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Valley County's records could not be read (${res.status}).`);
    const body = (await res.json()) as { features?: { attributes: Attributes }[]; error?: { message?: string } };
    if (body.error) throw new Error(`Valley County's records could not be read (${body.error.message ?? "refused"}).`);
    const rows = body.features ?? [];
    for (const f of rows) out.push(f.attributes);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** One dwelling row from the improvements layer as a property record. Pure. */
export function valleyBuilding(a: Attributes): StoredRecord {
  const finished = n(a.FinSize);
  const year = n(a.YrBuilt);
  const basement = n(a.BsmtArea);
  const basementFinished = Math.min(n(a.BsmtFin), basement || Infinity);
  const lower = n(a.LowerArea);
  const lowerFinished = Math.min(n(a.LowerFin), lower || Infinity);
  // The county counts bathrooms by fixtures: two is a half bath, three or more a full one.
  const full = n(a.Num3Baths) + n(a.Num4Baths) + n(a.Num5Baths);
  const half = n(a.Num2Baths);
  const hasBaths = [a.Num2Baths, a.Num3Baths, a.Num4Baths, a.Num5Baths].some((v) => s(v) !== "");
  const garage = n(a.AttGarSF) + n(a.DetGarSF);
  const quality = s(a.BldgType).replace(/^Class_\d+\s*/i, "").toLowerCase();
  const fireplaces = (s(a.MasonFP) === "Y" ? 1 : 0) + (s(a.PrefabFP) === "Y" ? 1 : 0);
  return compact({
    source: VALLEY_SOURCE,
    livingSqft: finished || null,
    bedrooms: s(a.NumBdRms) === "" ? null : n(a.NumBdRms),
    bathrooms: hasBaths ? full + half * 0.5 : null,
    yearBuilt: year >= 1800 ? year : null,
    propertyType: s(a.UseDesc).replace(/\s*-\s*Owner$/i, "") || null,
    design: s(a.Stories) ? `${s(a.Stories)} ${s(a.Stories) === "1" ? "story" : "stories"}` : null,
    quality: quality ? quality[0].toUpperCase() + quality.slice(1) : null,
    condition: s(a.CondDesc) || null,
    foundation: s(a.Foundat) || null,
    framing: s(a.ConstFr) || null,
    exterior: [s(a.ExtDesc1), s(a.ExtDesc2)].filter(Boolean).join(", ") || null,
    roof: [s(a.RoofDesc), s(a.RoofMatD)].filter(Boolean).join(", ") || null,
    rooms: n(a.NumRms) || null,
    lowerFinishedSqft: lowerFinished || null,
    lowerUnfinishedSqft: lower - lowerFinished > 0 ? lower - lowerFinished : null,
    basementFinishedSqft: basementFinished || null,
    basementUnfinishedSqft: basement - basementFinished > 0 ? basement - basementFinished : null,
    atticFinishedSqft: n(a.AtticFin) || null,
    garageSqft: garage || null,
    carportSqft: n(a.AttCpSF) || null,
    porchSqft: n(a.EnclPSF) + n(a.OpenPSF) || null,
    deckSqft: n(a.DeckSF) || null,
    fireplaces: s(a.MasonFP) || s(a.PrefabFP) ? fireplaces : null,
    heating: s(a.HeatDesc) || null,
    cooling: s(a.CentrlAC) === "Y" ? "Central air" : s(a.CentrlAC) === "N" ? "No central air" : null,
  });
}

const IMPROVEMENT_FIELDS = "PARCELNO,UseDesc,BldgType,Stories,YrBuilt,FinSize,Foundat,ConstFr,ExtDesc1,ExtDesc2,CondDesc,RoofDesc,RoofMatD,NumRms,NumBdRms,Num2Baths,Num3Baths,Num4Baths,Num5Baths,HeatDesc,CentrlAC,AtticFin,BsmtArea,BsmtFin,LowerArea,LowerFin,AttGarSF,DetGarSF,AttCpSF,EnclPSF,OpenPSF,DeckSF,PrefabFP,MasonFP".split(",");
const PARCEL_FIELDS = "PARCELNO,SitusAddress,CityStZip,LegalAc,SqFt,ZonCode,ZoneDesc,SUBDIVNAME,Elec,Gas,Water,Sewer".split(",");

/** Every Valley County parcel with a dwelling. With several dwellings, the largest is kept and the count recorded. */
export async function loadValley(): Promise<{ rows: CountyRow[]; sourceDate: string | null }> {
  const buildings = new Map<string, { record: StoredRecord; count: number }>();
  for (const a of await layer(78, "ImprType = 'DWELLING'", IMPROVEMENT_FIELDS)) {
    const parcel = s(a.PARCELNO);
    if (!parcel) continue;
    const record = valleyBuilding(a);
    const existing = buildings.get(parcel);
    if (!existing) buildings.set(parcel, { record, count: 1 });
    else {
      existing.count++;
      if ((record.livingSqft ?? 0) > (existing.record.livingSqft ?? 0)) existing.record = record;
    }
  }
  const rows: CountyRow[] = [];
  for (const a of await layer(0, "SitusAddress > '0'", PARCEL_FIELDS)) {
    const parcel = s(a.PARCELNO);
    const building = buildings.get(parcel);
    if (!building) continue;
    const address = streetAddress(`${s(a.SitusAddress)}, ${s(a.CityStZip).split(",")[0]}`);
    if (!address) continue;
    const lot = n(a.SqFt) || Math.round(n(a.LegalAc) * 43_560);
    const utilities = (["Elec", "Gas", "Water", "Sewer"] as const).filter((u) => s(a[u]) === "Y").map((u) => ({ Elec: "electric", Gas: "gas", Water: "water", Sewer: "sewer" })[u]);
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
        lotSqft: lot ? Math.round(lot) : null,
        zoning: s(a.ZoneDesc) || s(a.ZonCode) || null,
        subdivision: s(a.SUBDIVNAME) || null,
        utilities: utilities.length ? utilities.join(", ") : null,
      }),
    });
    buildings.delete(parcel);
  }
  return { rows, sourceDate: null };
}
