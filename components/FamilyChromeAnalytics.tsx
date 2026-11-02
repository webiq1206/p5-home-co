"use client";

import { useEffect } from "react";
import { track } from "@/app/analytics";

/** Which part of the family chrome a click came from, in the location names P5 already reports. */
const SURFACES: Array<[selector: string, location: string]> = [
  ["[data-family-bar]", "mobile_bar"],
  ["#family-mobile-menu", "mobile_menu"],
  ["[data-family-header]", "header"],
  ["[data-family-footer]", "footer"],
  ["[data-family-hero]", "hero"],
];

function surfaceOf(element: Element): string | null {
  for (const [selector, location] of SURFACES) if (element.closest(selector)) return location;
  return null;
}

/**
 * Keeps P5's GA4 events on the shared family chrome, which carries no
 * P5-specific handlers of its own: the hero quote click, phone clicks by
 * location, chat opens, Save contact and the sibling-company links. One
 * delegated listener, so the synced components stay untouched. The header,
 * menu and bar quote clicks are reported by the family components themselves
 * (lib/familyBrand.ts analytics), and the Google Ads call and text
 * conversions by the tel: and sms: listener in lib/analyticsBootstrap.ts.
 */
export default function FamilyChromeAnalytics() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest("a,button");
      if (!control) return;
      const location = surfaceOf(control);
      if (!location) return;
      const href = control.getAttribute("href") ?? "";
      const testId = control.getAttribute("data-testid") ?? "";
      if (control.matches('[data-hero-cta="primary"]')) track("quote_click", { location: "hero" });
      else if (href.startsWith("tel:")) track("phone_click", { location });
      else if (testId.startsWith("button-chat-")) track("chat_open", { location });
      else if (testId === "link-save-contact") track("save_contact", { location });
      else if (location === "footer" && control.closest("[data-family-row]") && /^https:\/\//.test(href)) {
        track("company_click", { company: href.replace(/^https:\/\/|\.co$|\.com$/g, ""), location });
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
