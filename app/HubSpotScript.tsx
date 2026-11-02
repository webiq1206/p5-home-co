"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isPrivatePath } from "./lib/privacy";
import { hubspotPortalId } from "./site";

// The first real interaction a visitor makes. Any one of them starts HubSpot.
const INTERACTION_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

// A visitor who only reads still gets tracked, this long after the load event.
const IDLE_FALLBACK_MS = 5000;

// HubSpot is a marketing tool, so it loads on the public site only. The
// finance admin and the vendor/client portals must never report visits or
// form data into the CRM.
//
// No third-party script except gtag may load before the visitor interacts, so
// the loader is not rendered at all until the first pointerdown, keydown,
// scroll or touchstart, or IDLE_FALLBACK_MS after the page load event,
// whichever comes first. Once rendered, lazyOnload still waits for the load
// event and an idle moment, so the tracker never competes with the hero.
export default function HubSpotScript() {
  const pathname = usePathname();
  const isPublic = !(pathname.startsWith("/admin") || pathname.startsWith("/portal") || isPrivatePath(pathname));
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    if (!isPublic || interacted) return;
    let timer: number | undefined;
    const start = () => setInteracted(true);
    const armFallback = () => {
      timer = window.setTimeout(start, IDLE_FALLBACK_MS);
    };
    for (const name of INTERACTION_EVENTS) {
      window.addEventListener(name, start, { once: true, passive: true, capture: true });
    }
    if (document.readyState === "complete") armFallback();
    else window.addEventListener("load", armFallback, { once: true });
    return () => {
      for (const name of INTERACTION_EVENTS) {
        window.removeEventListener(name, start, { capture: true });
      }
      window.removeEventListener("load", armFallback);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isPublic, interacted]);

  if (!isPublic || !interacted) return null;
  return (
    <Script
      id="hs-script-loader"
      src={`https://js-na2.hs-scripts.com/${hubspotPortalId}.js`}
      strategy="lazyOnload"
    />
  );
}
