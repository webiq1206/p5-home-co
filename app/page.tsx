import type { Metadata } from "next";
import { selfCanonical } from "@/lib/canonicalUrl";
import HomePageClient from "./HomePageClient";

// The home canonical belongs only to this page. Keeping it in the root layout
// makes missing routes and unrelated utility pages inherit the home URL.
// selfCanonical drops utm_* so a campaign landing URL is not self-canonical.
export const metadata: Metadata = {
  alternates: { canonical: selfCanonical("https://p5homeco.com") },
};

export default function HomePage() {
  return <HomePageClient />;
}
