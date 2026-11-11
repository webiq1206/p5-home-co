/** Server-owned Meta routing overrides in the existing settings table. */
import { query } from "../db.ts";
import { BRANDS, type Brand } from "../leads/types.ts";

export const META_SETTINGS_KEY = "meta_leadgen_routing";
export const DEFAULT_META_PAGES: Record<string, Brand> = {
  "1228704823655951": "P5 Home Co",
  "1235083469680398": "Boise Cabinet Co",
};
export type MetaFormMapping = { brand: Brand; service: string; formName: string };
export type MetaMappings = { pages: Record<string, Brand>; forms: Record<string, MetaFormMapping> };

export function validMetaId(value: string): boolean { return /^\d{1,40}$/.test(value); }
export function validMetaBrand(value: unknown): value is Brand {
  return typeof value === "string" && (BRANDS as readonly string[]).includes(value);
}
export function mergeMetaMappings(value: unknown): MetaMappings {
  const result: MetaMappings = { pages: { ...DEFAULT_META_PAGES }, forms: {} };
  if (!value || typeof value !== "object") return result;
  const stored = value as Partial<MetaMappings>;
  for (const [id, brand] of Object.entries(stored.pages ?? {})) {
    if (validMetaId(id) && validMetaBrand(brand)) result.pages[id] = brand;
  }
  for (const [id, form] of Object.entries(stored.forms ?? {})) {
    if (validMetaId(id) && form && validMetaBrand(form.brand)) {
      result.forms[id] = {
        brand: form.brand,
        service: typeof form.service === "string" ? form.service.slice(0, 100) : "",
        formName: typeof form.formName === "string" ? form.formName.slice(0, 300) : "",
      };
    }
  }
  return result;
}
export async function loadMetaMappings(): Promise<MetaMappings> {
  const rows = await query<{ value: unknown }>("SELECT value FROM setting WHERE key=$1", [META_SETTINGS_KEY]);
  return mergeMetaMappings(rows[0]?.value);
}

/** Atomic per-entry merge avoids concurrent administrators losing each other's edits. */
export async function saveMetaMapping(
  kind: "pages" | "forms", id: string, brand: Brand, userId: number,
  formName = "", service = "",
): Promise<void> {
  if (!validMetaId(id) || !validMetaBrand(brand)) throw new Error("Invalid Meta mapping");
  const entry = kind === "pages" ? brand : { brand, formName: formName.slice(0, 300), service: service.slice(0, 100) };
  await query(
    `INSERT INTO setting (key,value,updated_by) VALUES ($1,jsonb_build_object($2::text,jsonb_build_object($3::text,$4::jsonb)),$5)
     ON CONFLICT (key) DO UPDATE SET value=jsonb_set(setting.value,ARRAY[$2::text],
       COALESCE(setting.value->$2::text,'{}'::jsonb) || jsonb_build_object($3::text,$4::jsonb)),
       updated_by=$5,updated_at=now()`,
    [META_SETTINGS_KEY, kind, id, JSON.stringify(entry), userId],
  );
}
