"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { isPrivatePath } from "./lib/privacy";
import { hubspotPortalId } from "./site";

// HubSpot is a marketing tool, so it loads on the public site only. The
// finance admin and the vendor/client portals must never report visits or
// form data into the CRM. lazyOnload waits until after the page load event
// so the tracker still runs without blocking the hero.
export default function HubSpotScript() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin") || pathname.startsWith("/portal") || isPrivatePath(pathname)) return null;
  return (
    <Script
      id="hs-script-loader"
      src={`https://js-na2.hs-scripts.com/${hubspotPortalId}.js`}
      strategy="lazyOnload"
    />
  );
}
