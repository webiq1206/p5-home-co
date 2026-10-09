import type {LeadSource} from "./types.ts";

function str(value:unknown):string|null {return typeof value==="string"?value.trim().slice(0,4000)||null:null;}

export function collectAttribution(body: Record<string, unknown>): Record<string, string> | null {
  const attribution: Record<string, string> = {};
  for (const key of [
    "gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "landing_page", "referrer", "service",
    "first_gclid", "first_gbraid", "first_wbraid", "first_utm_source", "first_utm_medium",
     "first_utm_campaign", "first_utm_term", "first_utm_content", "first_landing_page", "first_referrer",
  ]) {
    const value = str(body[key]);
    if (!value) continue;
    if (key.endsWith("landing_page")) {
      try {
        const url = new URL(value, "https://p5homeco.invalid");
        if (url.origin === "https://p5homeco.invalid" && url.pathname.startsWith("/")) {
          const safe = new URLSearchParams();
          for (const allowed of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
            const campaignValue = url.searchParams.get(allowed);
            if (campaignValue) safe.set(allowed, campaignValue.slice(0, 300));
          }
          attribution[key] = url.pathname + (safe.size ? `?${safe}` : "");
        }
      } catch {
        // Ignore malformed landing data rather than retaining arbitrary URLs.
      }
    } else if (key.endsWith("referrer")) {
      try {
        const url = new URL(value);
        if (url.protocol === "https:" || url.protocol === "http:") attribution[key] = url.origin;
      } catch {
        // A referrer is optional and must be an origin, never an opaque string.
      }
    } else if (/^[A-Za-z0-9._~:-]{1,300}$/.test(value)) {
      attribution[key] = value;
    }
  }
  return Object.keys(attribution).length ? attribution : null;
}

export function sourceFromAttribution(attribution: Record<string, string> | null): LeadSource {
  if (
    attribution?.gclid || attribution?.gbraid || attribution?.wbraid ||
    attribution?.utm_medium?.toLowerCase() === "cpc"
  ) return "Paid Search";
  if (attribution?.utm_medium?.toLowerCase().includes("social")) return "Social Media";
  return "Organic Website";
}

