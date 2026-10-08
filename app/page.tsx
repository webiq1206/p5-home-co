import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import { siteUrl } from "./site";

// The home canonical belongs only to this page. Keeping it in the root layout
// makes missing routes and unrelated utility pages inherit the home URL.
export const metadata: Metadata = {
  alternates: { canonical: siteUrl },
};

export default function HomePage() {
  return <HomePageClient />;
}
