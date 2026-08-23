"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { hubspotPortalId } from "./site";

// HubSpot is a marketing tool, so it loads on the public site only. The
// finance admin and the vendor/client portals must never report visits or
// form data into the CRM.
export default function HubSpotScript() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin") || pathname.startsWith("/portal")) return null;
  return (
    <Script
      id="hs-script-loader"
      src={`https://js-na2.hs-scripts.com/${hubspotPortalId}.js`}
      strategy="afterInteractive"
    />
  );
}
