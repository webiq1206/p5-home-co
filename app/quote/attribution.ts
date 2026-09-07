"use client";

/**
 * Privacy-safe campaign context kept for the duration of a visit. Only known
 * acquisition parameters are retained; form fields, arbitrary query strings,
 * and fragments never enter analytics or the intake payload.
 */
export type Attribution = Record<string, string>;

const STORAGE_KEY = "p5.quote-attribution.v1";
const KEYS = ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

function clean(value: string | null): string | null {
  const text = value?.trim().slice(0, 300) ?? "";
  return text ? text : null;
}

function campaignValues(search: URLSearchParams): Attribution {
  const values: Attribution = {};
  for (const key of KEYS) {
    const value = clean(search.get(key));
    if (value) values[key] = value;
  }
  return values;
}

function landingPath(location: Location, search: URLSearchParams): string {
  const safe = new URLSearchParams();
  for (const key of KEYS) {
    const value = clean(search.get(key));
    if (value) safe.set(key, value);
  }
  const query = safe.toString();
  return `${location.pathname}${query ? `?${query}` : ""}`;
}

function externalReferrer(referrer: string, location: Location): string | null {
  try {
    const url = new URL(referrer);
    return url.origin === location.origin ? null : url.origin;
  } catch {
    return null;
  }
}

export function inferLeadSource(context: Attribution): string {
  if (context.gclid || context.gbraid || context.wbraid || context.utm_medium?.toLowerCase() === "cpc") {
    return "Paid Search";
  }
  if (context.utm_medium?.toLowerCase().includes("social")) return "Social Media";
  return "Organic Website";
}

/** Merge a new meaningful touch while preserving the first acquisition touch. */
export function mergeAttribution(
  previous: Attribution,
  current: Attribution,
): Attribution {
  const first = Object.fromEntries(
    Object.entries(current).filter(([key]) => key.startsWith("first_")),
  ) as Attribution;
  const latest = Object.fromEntries(
    Object.entries(current).filter(([key]) => !key.startsWith("first_")),
  ) as Attribution;
  const hasCampaign = KEYS.some((key) => key in current) || Object.keys(previous).length === 0;
  if (hasCampaign) {
    const preservedFirst = Object.fromEntries(
      Object.entries(previous).filter(([key]) => key.startsWith("first_")),
    ) as Attribution;
    return { ...preservedFirst, ...latest, ...first };
  }
  return {
    ...previous,
    ...first,
  };
}

export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  const search = new URLSearchParams(window.location.search);
  const currentCampaign = campaignValues(search);
  const current: Attribution = {
    ...currentCampaign,
    landing_page: landingPath(window.location, search),
  };
  const referrer = externalReferrer(document.referrer, window.location);
  if (referrer) current.referrer = referrer;

  const stored = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Attribution;
    } catch {
      return {};
    }
  })();
  const first = Object.keys(stored).length
    ? {}
    : Object.fromEntries(Object.entries(current).map(([key, value]) => [`first_${key}`, value]));
  const merged = mergeAttribution(stored, { ...current, ...first });
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Storage may be unavailable; the current touch is still submitted.
  }
  return merged;
}

export function storedAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Attribution;
  } catch {
    return {};
  }
}