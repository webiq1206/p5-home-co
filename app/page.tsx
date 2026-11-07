import type { Metadata } from "next";
import { selfCanonical } from "@/lib/canonicalUrl";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";
import { siteTitle } from "./structuredData";
import { HOME_DESCRIPTION } from "./visibilityCopy";
import HomePageClient from "./HomePageClient";

// The home canonical belongs only to this page. Keeping it in the root layout
// makes missing routes and unrelated utility pages inherit the home URL.
// selfCanonical drops utm_* so a campaign landing URL is not self-canonical.
// HOME_DESCRIPTION is the home meta only. siteDescription stays on the WebSite JSON-LD.
export const metadata: Metadata = withBrandPageMetadata(
  {
    title: siteTitle,
    description: HOME_DESCRIPTION,
    alternates: { canonical: selfCanonical("https://p5homeco.com") },
  },
  "/",
);

export default function HomePage() {
  return <HomePageClient />;
}
