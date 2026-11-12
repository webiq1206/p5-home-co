/**
 * Address suggestions for the scope platform, from Google Places (New).
 * Server only: the key (GOOGLE_MAPS_API_KEY in Replit Secrets) never reaches
 * the browser, and only signed-in people can call the route that uses this.
 *
 * Two calls, as Google intends:
 *   suggest()  - as the person types, biased to the Treasure Valley, US only
 *   resolve()  - once, when a suggestion is picked, to get the full postal
 *                address with ZIP code
 * Both carry the same session token so Google bills the pair as one lookup.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";
/** Boise. Results near here rank first; the rest of the US is still found. */
const BIAS = { circle: { center: { latitude: 43.615, longitude: -116.2023 }, radius: 50_000 } };

export type AddressSuggestion = { placeId: string; street: string; rest: string };

export function isAddressLookupConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function key(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("Address suggestions are not set up (GOOGLE_MAPS_API_KEY).");
  return k;
}

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

/** Pure: Google's autocomplete response as the short list the UI shows. */
export function parseSuggestions(body: unknown): AddressSuggestion[] {
  const list = (body as { suggestions?: unknown[] })?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: AddressSuggestion[] = [];
  for (const item of list) {
    const p = (item as { placePrediction?: Record<string, unknown> })?.placePrediction;
    if (!p || typeof p.placeId !== "string") continue;
    const format = p.structuredFormat as { mainText?: { text?: string }; secondaryText?: { text?: string } } | undefined;
    const full = (p.text as { text?: string } | undefined)?.text ?? "";
    const street = format?.mainText?.text ?? full.split(",")[0] ?? "";
    const rest = (format?.secondaryText?.text ?? full.split(",").slice(1).join(",")).replace(/,?\s*(USA|United States)$/i, "").trim();
    if (street.trim()) out.push({ placeId: p.placeId, street: street.trim(), rest });
  }
  return out.slice(0, 5);
}

type Component = { longText?: string; shortText?: string; types?: string[] };

/**
 * Pure: a place's components as one postal line, e.g.
 * "2283 N Coopers Hawk Ave, Kuna, ID 83634". Built from parts rather than
 * Google's formatted string so the country never appears and the street is
 * always first (the project name is taken from it).
 */
export function formatAddress(body: unknown): string | null {
  const b = body as { addressComponents?: Component[]; formattedAddress?: string };
  const parts = Array.isArray(b?.addressComponents) ? b.addressComponents : [];
  const get = (type: string, short = false) => {
    const c = parts.find((x) => x.types?.includes(type));
    return (short ? c?.shortText : c?.longText) ?? c?.longText ?? c?.shortText ?? "";
  };
  const street = [get("street_number"), get("route", true)].filter(Boolean).join(" ");
  const unit = get("subpremise");
  const city = get("locality") || get("sublocality") || get("postal_town") || get("administrative_area_level_3");
  const state = get("administrative_area_level_1", true);
  const zip = get("postal_code");
  if (!street) {
    const formatted = (b?.formattedAddress ?? "").replace(/,?\s*(USA|United States)$/i, "").trim();
    return formatted || null;
  }
  const line1 = unit ? `${street} #${unit.replace(/^#/, "")}` : street;
  return [line1, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export async function suggest(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
  const text = input.trim().slice(0, 200);
  if (text.length < 3) return [];
  const res = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key() },
    body: JSON.stringify({
      input: text,
      includedRegionCodes: ["us"],
      locationBias: BIAS,
      ...(TOKEN.test(sessionToken) ? { sessionToken } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}).`);
  return parseSuggestions(await res.json());
}

export async function resolve(placeId: string, sessionToken: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new Error("Unknown address.");
  const url = `${DETAILS_URL}/${encodeURIComponent(placeId)}${TOKEN.test(sessionToken) ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""}`;
  const res = await fetch(url, {
    headers: { "X-Goog-Api-Key": key(), "X-Goog-FieldMask": "formattedAddress,addressComponents" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}).`);
  return formatAddress(await res.json());
}
