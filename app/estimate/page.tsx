import type { Metadata } from "next";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";

export { default } from "./p5-preview/page";

// The public entry point has its own metadata; preview routes remain noindex.
export const metadata: Metadata = withBrandPageMetadata({
  title: { absolute: "Start Your Home Project in Boise | P5 Home Co" },
  description: "Describe your Treasure Valley home project, add plans or photos, and review the details before sending your request to P5 for project review.",
  alternates: { canonical: "https://p5homeco.com/estimate" },
  robots: { index: true, follow: true },
}, "/estimate");
