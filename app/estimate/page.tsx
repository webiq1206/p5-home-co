import type { Metadata } from "next";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";

export { default } from "./p5-preview/page";

// The public entry point has its own metadata; preview routes remain noindex.
export const metadata: Metadata = withBrandPageMetadata({
  title: { absolute: "Home Project Estimator in Boise | P5 Home Co" },
  description: "Describe your Treasure Valley home project or add plans and photos to start a preliminary estimate for construction, remodeling, cabinetry or repairs.",
  alternates: { canonical: "https://p5homeco.com/estimate" },
  robots: { index: true, follow: true },
}, "/estimate");
