/**
 * Hub-side lead attribution.
 *
 * lib/p5/leadAttribution.ts is a shared estimator file synced from
 * boise-remodeling-co (scripts/p5-sync.mjs), so it is not edited here. This
 * wrapper adds the Meta click id (fbclid, first_fbclid) alongside gclid, and
 * keeps fbclid in a sanitized landing page, for every hub intake. When the
 * shared file gains fbclid upstream this wrapper becomes a no-op.
 */
import {
  collectAttribution as collectShared,
  sourceFromAttribution as sourceShared,
} from "../../../lib/p5/leadAttribution.ts";

const CLICK_ID = /^[A-Za-z0-9._~:-]{1,300}$/;

function str(value: unknown): string | null {
  return typeof value === "string" ? value.trim().slice(0, 4000) || null : null;
}

export function collectAttribution(body: Record<string, unknown>): Record<string, string> | null {
  const attribution: Record<string, string> = { ...(collectShared(body) ?? {}) };
  for (const key of ["fbclid", "first_fbclid"]) {
    const value = str(body[key]);
    if (value && CLICK_ID.test(value)) attribution[key] = value;
  }
  // The shared sanitizer drops fbclid from the landing page; restore it there.
  for (const key of ["landing_page", "first_landing_page"]) {
    const raw = str(body[key]);
    if (!raw || !attribution[key]) continue;
    try {
      const fbclid = new URL(raw, "https://p5homeco.invalid").searchParams.get("fbclid")?.slice(0, 300);
      if (fbclid && CLICK_ID.test(fbclid) && !attribution[key].includes("fbclid=")) {
        attribution[key] += (attribution[key].includes("?") ? "&" : "?") + new URLSearchParams({ fbclid });
      }
    } catch {
      // Malformed landing data was already refused by the shared sanitizer.
    }
  }
  return Object.keys(attribution).length ? attribution : null;
}

export function sourceFromAttribution(attribution: Record<string, string> | null): ReturnType<typeof sourceShared> {
  const shared = sourceShared(attribution);
  // A Meta click id without Google click evidence is a Facebook or Instagram click.
  if (shared === "Organic Website" && (attribution?.fbclid || attribution?.first_fbclid)) return "Social Media";
  return shared;
}
