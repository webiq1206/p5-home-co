"use client";

import { googleAdsDestinationId, googleAdsLeadLabel } from "./site.ts";

// Thin wrapper so components never touch gtag directly and nothing breaks
// when the tag is absent, which is the case in development.
type GtagParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: GtagParams) => void;
    dataLayer?: unknown[][];
  }
}

export function track(event: string, params?: GtagParams) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") {
    window.dataLayer = window.dataLayer || [];
    window.gtag = (...args) => {
      window.dataLayer!.push(args);
    };
  }
  window.gtag("event", event, params);
}

/** Native Google Ads conversion, called only after the API created a lead. */
export function trackAcceptedInquiry() {
  track("generate_lead", { form: "quote_landing_page" });
  track("conversion", { send_to: `${googleAdsDestinationId}/${googleAdsLeadLabel}` });
}
