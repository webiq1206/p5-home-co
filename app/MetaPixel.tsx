"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { trackMetaEvent } from "./analytics";
import { metaPixelAllowedOn, metaPixelSnippet } from "./lib/metaPixel";
import { metaPixelId, siteUrl } from "./site";

// The first real interaction a visitor makes. Any one of them starts the pixel.
const INTERACTION_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

// A visitor who only reads is still counted, this long after the load event.
const IDLE_FALLBACK_MS = 5000;

// The Meta pixel is an advertising tool, so it runs on the public site only
// (metaPixelAllowedOn), and only when NEXT_PUBLIC_META_PIXEL_ID names a dataset.
// Without the id this renders nothing and listens for nothing.
//
// No third-party script except gtag may load before the visitor interacts, so
// like HubSpotScript the pixel is not rendered at all until the first
// pointerdown, keydown, scroll or touchstart, or IDLE_FALLBACK_MS after the
// page load event, whichever comes first. Once rendered, lazyOnload still waits
// for the load event and an idle moment. A Lead cannot be missed by this: a
// form can only be sent after an interaction.
export default function MetaPixel() {
  const pathname = usePathname();
  const allowed = metaPixelId !== "" && metaPixelAllowedOn(pathname);
  const [interacted, setInteracted] = useState(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!allowed || interacted) return;
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
  }, [allowed, interacted]);

  // The snippet sends the first PageView. Later in-app navigations are sent
  // here, so a move to a private path is never reported to Meta.
  useEffect(() => {
    if (!interacted) return;
    if (!allowed) {
      lastPath.current = "";
      return;
    }
    const first = lastPath.current === null;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (!first) trackMetaEvent("PageView");
  }, [allowed, interacted, pathname]);

  if (!allowed || !interacted) return null;
  return (
    <Script id="meta-pixel" strategy="lazyOnload">
      {metaPixelSnippet({ id: metaPixelId, hostname: new URL(siteUrl).hostname })}
    </Script>
  );
}
