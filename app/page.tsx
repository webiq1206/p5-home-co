import type { Metadata } from "next";
import { selfCanonical } from "@/lib/canonicalUrl";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";
import { siteDescription, siteTitle } from "./structuredData";
import HomePageClient from "./HomePageClient";

// The home canonical belongs only to this page. Keeping it in the root layout
// makes missing routes and unrelated utility pages inherit the home URL.
// selfCanonical drops utm_* so a campaign landing URL is not self-canonical.
// The "/" entry in lib/brand-page-metadata.ts supplies the title and description.
export const metadata: Metadata = withBrandPageMetadata(
  {
    title: siteTitle,
    description: siteDescription,
    alternates: { canonical: selfCanonical("https://p5homeco.com") },
  },
  "/",
);

export default function HomePage() {
  return <HomePageClient />;
}
