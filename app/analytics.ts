"use client";

import { googleAdsDestinationId, googleAdsLeadLabel } from "./site.ts";

// Thin wrapper so components never touch gtag directly and nothing breaks
// when the tag is absent, which is the case in development.
type GtagParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: GtagParams) => void;
    dataLayer?: unknown[][];
    fbq?: (...args: unknown[]) => void;
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

/**
 * Meta pixel event. A no-op unless app/MetaPixel.tsx has started the pixel,
 * which it never does without NEXT_PUBLIC_META_PIXEL_ID, outside production,
 * on a private path or in the framed estimator. Params are a category at most:
 * never a name, email, phone number or address.
 */
export function trackMetaEvent(event: "Lead" | "PageView", params?: { content_category: string }) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  try {
    if (params) window.fbq("track", event, params);
    else window.fbq("track", event);
  } catch {
    // Analytics must never break the page that called it.
  }
}

/**
 * The one accepted-lead signal, called only after the API created a lead:
 * GA4 generate_lead, the native Google Ads conversion and the Meta Lead event.
 * This is the only place a Meta Lead is sent.
 */
export function trackAcceptedInquiry(form: "quote_landing_page" | "instant_estimator" = "quote_landing_page") {
  track("generate_lead", { form });
  track("conversion", { send_to: `${googleAdsDestinationId}/${googleAdsLeadLabel}` });
  trackMetaEvent("Lead", { content_category: form });
}
